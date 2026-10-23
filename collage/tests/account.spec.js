const fs = require('fs');
const path = require('path');
const { test: base, expect, fixture, openStep } = require('./helpers');

const FAKE = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');

// Page avec les comptes activés : le vrai client Supabase est remplacé par un faux en mémoire.
const test = base.extend({
  acc: async ({ browser }, use) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/vendor/supabase.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '// remplacé par le faux' }));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'anon', contactEmail: 'test@example.org' };" }));
    await page.addInitScript(FAKE);
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.enabled);
    await use({ page, errors, ctx });
    expect(errors).toEqual([]);
    await ctx.close();
  },
});

// attend que le brouillon (n dessins) soit écrit dans IndexedDB : page.evaluate attend la promesse,
// ce que page.waitForFunction ne fait pas pour une fonction qui rend une promesse
const hasDraft = (page, n) => page.evaluate((n) => new Promise((res) => {
  const q = indexedDB.open('atelier-gribouille');
  q.onsuccess = () => { const db = q.result; try { const g = db.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => { db.close(); res(!!(g.result && g.result.drawings && g.result.drawings.length === n)); }; g.onerror = () => { db.close(); res(false); }; } catch (e) { db.close(); res(false); } };
  q.onerror = () => res(false);
}), n);
const waitDraft = async (page, n) => {
  for (let i = 0; i < 120; i++) { if (await hasDraft(page, n)) return; await page.waitForTimeout(500); }
  throw new Error('brouillon jamais écrit');
};

async function signUpAndIn(page, email, pw, name) {
  await page.locator('#acc-open').click();
  await page.locator('.auth-tabs [data-mode="signup"]').click();
  await page.fill('#auth-name', name);
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', pw);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#acc-menu')).toBeVisible();
}

test.describe('Comptes utilisateurs', () => {
  test('sans réglage, aucune trace des comptes', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#account')).toBeHidden();
    expect(await page.locator('#account-section').count()).toBe(0);
    await ctx.close();
  });

  test('inscription par e-mail avec confirmation, puis connexion', async ({ acc }) => {
    const { page } = acc;
    await page.evaluate(() => { window.__FAKE_CONFIRM = true; });
    await expect(page.locator('#acc-open')).toBeVisible();
    await page.locator('#acc-open').click();
    await expect(page.locator('#account-section')).toBeVisible();
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await expect(page.locator('#auth-name-field')).toBeVisible();
    await page.fill('#auth-name', 'Camille');
    await page.fill('#auth-email', 'camille@example.org');
    // un mot de passe faible est refusé, avec l'indicateur de solidité
    await page.fill('#auth-password', 'camille123');
    await expect(page.locator('#auth-meter')).toBeVisible();
    await expect(page.locator('#auth-meter .pw-label')).toHaveText('Faible');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-status')).toContainText('trop faible');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await expect(page.locator('#auth-meter .pw-label')).toHaveText(/Bon|Excellent/);
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-status')).toContainText('confirmez votre e-mail');
    // l'e-mail est « confirmé » côté faux service, puis connexion
    await page.evaluate(() => { const u = window.__fake.db.users['camille@example.org']; u.confirmed = true; localStorage.setItem('fake.users', JSON.stringify(window.__fake.db.users)); });
    await expect(page.locator('.auth-tabs [data-mode="signin"]')).toHaveClass(/on/);
    await page.fill('#auth-password', 'mauvais-mdp');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-status')).toContainText('incorrect');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-menu')).toBeVisible();
    await expect(page.locator('#acc-menu .acc-name')).toHaveText('Camille');
    await expect(page.locator('#acc-menu .acc-avatar')).toHaveText('C');
    await expect(page.locator('#account-section')).toBeHidden(); // le panneau se referme après connexion
    await expect(page.locator('#saved-hint')).toContainText('votre compte');
    // la session survit à un rechargement
    await page.reload();
    await page.waitForFunction(() => window.Account && window.Account.user());
    await expect(page.locator('#acc-menu .acc-name')).toHaveText('Camille');
  });

  test('Google déclenche la connexion déléguée, lien magique et mot de passe oublié envoient un e-mail', async ({ acc }) => {
    const { page } = acc;
    await page.locator('#acc-open').click();
    await page.locator('.social-btn[data-provider="google"]').click();
    await page.fill('#auth-email', 'x@example.org');
    await page.locator('#auth-magic').click();
    await expect(page.locator('#acc-status')).toContainText('lien de connexion');
    await page.locator('#auth-forgot').click();
    await expect(page.locator('#acc-status')).toContainText('nouveau mot de passe');
    const calls = await page.evaluate(() => window.__fake.calls);
    expect(calls.map((c) => c[0])).toEqual(['oauth', 'otp', 'reset']);
    expect(calls[0][1]).toBe('google');
    expect(calls[0][2]).toMatch(/^http:\/\/localhost:\d+\/index\.html$/);
  });

  test('sans compte : l’exemple et l’import de fichiers sont libres ; seule la photo depuis l’atelier demande de se connecter', async ({ acc }) => {
    const { page } = acc;
    await openStep(page, 'import-section'); // (l'étape Importer est repliée à l'arrivée)
    await expect(page.locator('#import-account')).toBeVisible();
    await expect(page.locator('#import-account')).toContainText('librement');
    // l'exemple : chargé et manipulé sans compte
    await page.locator('#empty-sample').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length > 0 && AtelierGribouille.state.drawings.every((d) => d.sample) && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => AtelierGribouille.selectProposal(1));
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBeTruthy();
    await expect(page.locator('#account-section')).toBeHidden();
    // photographier (sur téléphone : le bouton n'est pas sur ordinateur) : la connexion d'abord
    await expect(page.locator('#camera-open')).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#sheet-tabs [data-tab="import-section"]').click();
    await page.locator('#camera-open').click();
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#acc-status')).toContainText('photographier vos dessins');
    await expect(page.locator('#camera')).toBeHidden();
    await page.locator('#acc-close').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    // des fichiers déposés sans compte : importés tout de suite, à la place de l'exemple
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 3 && AtelierGribouille.state.drawings.every((d) => !d.sample) && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#account-section')).toBeHidden();
    // connecté ensuite : l'indication disparaît
    await page.locator('#acc-open').click();
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await page.fill('#auth-email', 'imp@example.org');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-menu')).toBeVisible();
    await expect(page.locator('#import-account')).toBeHidden();
  });

  test('exporter demande d’être connecté, puis l’action reprend ; dupliquer, non', async ({ acc }) => {
    const { page } = acc;
    // des dessins importés avec un compte, puis déconnecté (l'œuvre reste dans le navigateur)
    await signUpAndIn(page, 'avant@example.org', 'Rouge-Soleil-42', 'Avant');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    // déconnecté : le bouton de téléchargement ouvre la fenêtre de compte avec une explication
    await openStep(page, 'export-section');
    await page.locator('#export').click();
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#acc-status')).toContainText('télécharger votre œuvre');
    // on se connecte : le téléchargement demandé part tout seul, et l'export est gardé dans le compte
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await page.fill('#auth-email', 'exp@example.org');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await page.locator('#dpi').selectOption('screen');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#auth-submit').click()]);
    expect(download.suggestedFilename()).toMatch(/\.jpe?g$/);
    await expect(page.locator('#save-status')).toContainText('gardé dans votre compte', { timeout: 60000 });
    await openStep(page, 'saved-section');
    await expect(page.locator('#exports-box')).toBeVisible();
    await expect(page.locator('#exports-list .saved')).toHaveCount(1);
    await expect(page.locator('#exports-list .saved-meta')).toContainText('JPEG');
    // déconnecté, l'œuvre s'enregistre toujours sur l'appareil, et « Dupliquer » ne demande pas de compte
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await openStep(page, 'export-section');
    await page.locator('#save-comp').click();
    await expect(page.locator('#save-status')).toContainText('ajoutée à Mes œuvres');
    await expect(page.locator('#account-section')).toBeHidden();
  });

  test('Mes œuvres dans le compte : chaque œuvre part d’elle-même (une ligne, un dossier, chaque image une fois), revient sur un autre appareil, se supprime partout', async ({ acc }) => {
    test.setTimeout(240000); // deux imports et deux réouvertures depuis le compte : long sur une machine d'intégration lente
    const { page } = acc;
    await signUpAndIn(page, 'lou@example.org', 'Rouge-Soleil-42', 'Lou');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 3 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 4);
    const w1 = await page.evaluate(() => AtelierGribouille.state.workId);
    // envoi sans attendre le délai : une ligne marquée « œuvre », à l'identifiant de l'œuvre
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id && r.meta.work && r.meta.drawings.length === 4), w1);
    // chaque dessin (page-two.png en donne deux) : son image, sa page de travail et (dessins découpés) la planche de ses masques, dans le dossier de l'œuvre
    const up1 = await page.evaluate((id) => window.__fake.calls.filter((c) => c[0] === 'upload').map((c) => c[1].split('/')[1] === id), w1);
    expect(up1.length).toBe(11);
    expect(up1.every(Boolean)).toBe(true);
    await expect(page.locator('#cloud-sync-status')).toContainText('Enregistrée dans votre compte');
    // un changement repart, sans renvoyer les images, dans la même ligne
    const style1 = await page.evaluate(() => AtelierGribouille.state.comp.style);
    await page.evaluate(() => AtelierGribouille.selectProposal(1));
    const style2 = await page.evaluate(() => AtelierGribouille.state.comp.style);
    expect(style2).not.toBe(style1);
    await page.waitForTimeout(3500);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction((a) => window.__fake.db.rows.find((r) => r.id === a.id).meta.comp.style === a.st, { id: w1, st: style2 });
    expect(await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload').length)).toBe(11);
    expect(await page.evaluate(() => window.__fake.db.rows.length)).toBe(1);
    // une deuxième œuvre : la première est rangée, rien n'est effacé
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await page.setInputFiles('#file', ['page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 2);
    const w2 = await page.evaluate(() => AtelierGribouille.state.workId);
    expect(w2).not.toBe(w1);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction(() => window.__fake.db.rows.filter((r) => r.meta.work).length === 2);
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved')).toHaveCount(2);
    await expect(page.locator('#saved-list .saved.current .saved-meta')).toContainText('2 dessins');
    await expect(page.locator('#saved-list .saved-tag')).not.toContainText(['sur cet appareil']);
    // un autre appareil (rien en local) : la plus récente se rouvre d'elle-même, les deux sont dans la liste
    await page.evaluate(() => new Promise((res) => { localStorage.removeItem('atelier.oeuvres-vues'); localStorage.removeItem('atelier.nouvelle'); const r = indexedDB.deleteDatabase('atelier-gribouille'); r.onsuccess = res; r.onerror = res; r.onblocked = res; }));
    await page.reload();
    await page.waitForFunction((id) => window.AtelierGribouille && AtelierGribouille.state.workId === id && AtelierGribouille.state.drawings.length === 2 && document.getElementById('progress').hidden, w2, { timeout: 120000 });
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved')).toHaveCount(2);
    // l'autre se rouvre depuis le compte, telle qu'elle était
    await page.locator('#saved-list .saved:not(.current)').click();
    await page.waitForFunction((id) => AtelierGribouille.state.workId === id && AtelierGribouille.state.drawings.length === 4 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, w1, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBe(style2);
    // rouverte telle quelle : rien ne repart dans le compte (ni fichier, ni nouvelle version)
    const t1 = await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.date, w1);
    await page.waitForTimeout(3500);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload').length)).toBe(0);
    expect(await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.date, w1)).toBe(t1);
    // supprimée : sa ligne et ses fichiers partent du compte, l'autre reste
    await page.locator('#saved-list .saved.current .saved-del').click();
    await page.locator('#saved-list .saved.current .saved-del').click();
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.map((r) => r.id))).toEqual([w2]);
    const files = await page.evaluate(() => Object.keys(window.__fake.db.files).map((p) => p.split('/')[1]));
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((id) => id === w2)).toBe(true);
  });

  test('une version plus récente venue d’un autre appareil : un bandeau, « Ouvrir cette version » ou « Garder celle-ci », sans ping-pong', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'duo@example.org', 'Rouge-Soleil-42', 'Duo');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 3);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    const id = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id), id);
    const t1 = await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.date, id);
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem('atelier.oeuvres-vues'))[id], id)).toBe(t1);
    const style0 = await page.evaluate(() => AtelierGribouille.state.comp.style);
    // l'autre appareil (un téléphone) a envoyé une version plus récente : la même œuvre, dans un autre style
    const bump = (n) => page.evaluate(({ id, n }) => { const r = window.__fake.db.rows.find((x) => x.id === id); const t = new Date(Date.now() + n * 60000).toISOString(); r.meta = Object.assign({}, r.meta, { date: t, device: 'phone', comp: Object.assign({}, r.meta.comp, { style: r.meta.comp.style === 'frise' ? 'nuage' : 'frise' }) }); return { t, style: r.meta.comp.style }; }, { id, n });
    const other = await bump(1);
    expect(other.style).not.toBe(style0);
    // revenue au premier plan juste après : rien ne bouge (le compte n'est relu qu'après une absence)
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(800);
    await expect(page.locator('#work-newer')).toBeHidden();
    // relu (arrivée, connexion, retour après une absence) : le bandeau le dit, rien n'est tiré ni envoyé
    await page.evaluate(() => AtelierGribouille.checkCurrentWork());
    await expect(page.locator('#work-newer')).toBeVisible();
    await expect(page.locator('#work-newer')).toContainText('téléphone');
    await expect(page.locator('#cloud-sync-status')).toContainText('plus récente');
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBe(style0);
    // même un changement d'ici reste ici tant qu'on n'a pas choisi
    await page.evaluate(() => AtelierGribouille.selectProposal(3));
    await page.waitForTimeout(3500);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForTimeout(500);
    expect(await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.date, id)).toBe(other.t);
    // « Ouvrir cette version » : celle du compte remplace celle d'ici
    await page.locator('#work-newer-open').click();
    await page.waitForFunction((st) => AtelierGribouille.state.comp && AtelierGribouille.state.comp.style === st && document.getElementById('progress').hidden, other.style, { timeout: 120000 });
    await expect(page.locator('#work-newer')).toBeHidden();
    await expect(page.locator('#save-status')).toContainText('plus récente');
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem('atelier.oeuvres-vues'))[id], id)).toBe(other.t);
    // la copie d'ici n'est pas renvoyée au compte (pas de ping-pong entre appareils)
    await page.waitForTimeout(3500);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForTimeout(500);
    expect(await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.date, id)).toBe(other.t);
    // encore une autre version ; « Garder celle-ci » : celle d'ici repart et remplace celle du compte
    const mine = await page.evaluate(() => AtelierGribouille.state.comp.style);
    const third = await bump(2);
    await page.evaluate(() => AtelierGribouille.checkCurrentWork());
    await expect(page.locator('#work-newer')).toBeVisible();
    await page.locator('#work-newer-keep').click();
    await expect(page.locator('#work-newer')).toBeHidden();
    await page.waitForTimeout(3500);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction(({ id, t }) => window.__fake.db.rows.find((r) => r.id === id).meta.date !== t, { id, t: third.t });
    expect(await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.comp.style, id)).toBe(mine);
    await expect(page.locator('#cloud-sync-status')).toContainText('Enregistrée dans votre compte');
    // déconnecté : l'œuvre reste enregistrée ici, la ligne le dit
    await page.locator('#acc-menu').click();
    await page.locator('#acc-signout').click();
    await expect(page.locator('#cloud-sync-status')).toContainText('Connectez-vous pour la retrouver');
  });

  test('Mes œuvres : une lecture du compte bloquée ou en échec ne laisse jamais la liste vide ; « Réessayer »', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'lent@example.org', 'Rouge-Soleil-42', 'Lent');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 3);
    await openStep(page, 'saved-section');
    // le compte ne répond pas (réseau mobile) : l'œuvre de ce navigateur est là, avec un mot
    await page.evaluate(() => { window.__list = window.Account.cloud.list; window.Account.cloud.list = () => new Promise(() => {}); });
    page.evaluate(() => AtelierGribouille.renderSaved({ refresh: true }));
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1);
    await expect(page.locator('#saved-list .saved-cloud')).toContainText('Lecture des œuvres de votre compte');
    await expect(page.locator('#saved-empty')).toBeHidden();
    // le compte répond par une erreur : la liste reste, « Réessayer » relit le compte
    await page.evaluate(() => { window.Account.cloud.list = () => Promise.reject(new Error('Failed to fetch')); });
    await page.evaluate(() => AtelierGribouille.renderSaved({ refresh: true }).catch(() => {}));
    // (la lecture bloquée d'avant tient la place jusqu'à 25 s : on attend son abandon)
    await expect(page.locator('#saved-list .saved-cloud')).toContainText('n’ont pas pu être lues', { timeout: 35000 });
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1);
    await page.evaluate(() => { window.Account.cloud.list = window.__list; });
    await page.locator('#saved-list .saved-cloud button').click();
    await expect(page.locator('#saved-list .saved-cloud')).toHaveCount(0);
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1);
  });

  test('Mes œuvres : un compte aux nombreuses œuvres est lu par pages de 12, toutes affichées', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'beaucoup@example.org', 'Rouge-Soleil-42', 'Beaucoup');
    // 27 œuvres dans le compte, et deux articles du panier (pas dans la liste)
    await page.evaluate(() => {
      const uid = window.__fake.db.session.user.id;
      for (let i = 0; i < 29; i++) {
        const date = new Date(Date.UTC(2026, 9, 1, 8, i)).toISOString();
        const meta = { date, n: 2, work: true, comp: { style: 'nuage', W: 30, H: 40 }, settings: { mode: 'impression', format: 'cadre:30x40' } };
        if (i >= 27) meta.cart = { product: 'hd', qty: 1 };
        window.__fake.db.rows.push({ id: `w${i}`, user_id: uid, created_at: date, name: `Œuvre ${i}`, thumb: null, meta });
      }
      window.__fake.calls.length = 0;
    });
    await openStep(page, 'saved-section');
    await page.evaluate(() => AtelierGribouille.renderSaved({ refresh: true }));
    await expect(page.locator('#saved-list .saved')).toHaveCount(27);
    await expect(page.locator('#saved-list .saved-cloud')).toHaveCount(0);
    const pages = await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'select' && c[1] === 'compositions').map((c) => c[2]));
    expect(pages).toEqual(expect.arrayContaining(['0-11', '12-23', '24-35']));
    expect(pages).not.toContain('all');
  });

  test('gestion du compte : nom, mot de passe, déconnexion, suppression définitive', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'sam@example.org', 'Rouge-Soleil-42', 'Sam');
    await page.locator('#acc-menu').click();
    await expect(page.locator('#profile-box')).toBeVisible();
    await expect(page.locator('#profile-meta')).toContainText('votre e-mail');
    await page.fill('#profile-name', 'Samuel');
    await page.fill('#profile-password', 'Bleu-Nuage-77!');
    await page.locator('#profile-form button[type=submit]').click();
    await expect(page.locator('#acc-status')).toContainText('nom enregistré');
    await expect(page.locator('#acc-status')).toContainText('mot de passe changé');
    await expect(page.locator('#acc-menu .acc-name')).toHaveText('Samuel');
    await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    await expect(page.locator('#acc-menu')).toBeHidden();
    // reconnexion avec le nouveau mot de passe, puis suppression du compte
    await page.locator('#acc-open').click();
    await page.fill('#auth-email', 'sam@example.org');
    await page.fill('#auth-password', 'Bleu-Nuage-77!');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-menu')).toBeVisible();
    await page.locator('#acc-menu').click();
    await page.locator('#acc-delete').click();
    await expect(page.locator('#acc-delete')).toContainText('Confirmer');
    await page.locator('#acc-delete').click();
    await expect(page.locator('#acc-status')).toContainText('Compte supprimé');
    await expect(page.locator('#acc-open')).toBeVisible();
    expect(await page.evaluate(() => Object.keys(window.__fake.db.users).length)).toBe(0);
  });

  test('retour d’un lien « mot de passe oublié » : formulaire de nouveau mot de passe', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'ana@example.org', 'Rouge-Soleil-42', 'Ana');
    await page.evaluate(() => window.__fake.forceRecovery());
    await expect(page.locator('#recover-form')).toBeVisible();
    await page.fill('#recover-password', 'Vert-Pomme-19#');
    await page.locator('#recover-form button[type=submit]').click();
    await expect(page.locator('#acc-status')).toContainText('enregistré');
    await expect(page.locator('#profile-box')).toBeVisible();
  });

  test('retour de connexion : le code à usage unique quitte l’adresse', async ({ acc }) => {
    const { page } = acc;
    await page.goto('index.html?code=7e20c38d-d8f3-4083-ace6-235799df91ff&mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.enabled);
    await expect.poll(() => page.evaluate(() => location.search)).toBe('?mode=toile');
  });

  test('panier partagé par compte : les articles vivent dans le compte et reviennent sur un autre appareil', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'panier@example.org', 'Vert-Prairie-12', 'Pan');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.regenerate(); });
    await page.waitForTimeout(400);
    await openStep(page, 'export-section');
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    // connecté : l'article part dans le compte (ses images aussi), marqué « panier », une seule fois
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('atelier-gribouille:panier')).every((it) => it.recId.startsWith('cloud:')), null, { timeout: 60000 });
    const rows = () => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).map((r) => ({ name: r.name, qty: r.meta.cart.qty, finish: r.meta.cart.finish, size: r.meta.cart.size })));
    expect(await rows()).toEqual([{ name: await page.locator('#cart .cart-item b').first().textContent(), qty: 1, finish: 'cadre', size: '50x70' }]); // (cadre par défaut d'une œuvre imprimée passée de la toile à l'impression)
    // (hors l'œuvre elle-même, qui a son propre dossier)
    const cartUploads = () => page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload' && c[1].split('/')[1] !== AtelierGribouille.state.workId).length);
    expect(await cartUploads()).toBe(9);
    // la quantité change : le compte suit
    await page.locator('#cart .cart-item [data-qty="1"]').click();
    await expect.poll(async () => (await rows())[0].qty).toBe(2);
    // pas dans « Mes œuvres » (tant qu'il n'est pas commandé) : seule l'œuvre affichée y est
    await page.locator('#cart [data-close]').first().click();
    await page.evaluate(() => document.querySelector('#saved-section').classList.contains('collapsed') && document.querySelector('#saved-section > h2').click());
    await page.evaluate(() => AtelierGribouille.renderSaved && AtelierGribouille.renderSaved({ refresh: true }));
    await page.waitForTimeout(500);
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1);
    // un autre appareil (même compte, panier local vide) : l'article revient, avec sa quantité
    await page.evaluate(() => localStorage.removeItem('atelier-gribouille:panier'));
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.user());
    await expect(page.locator('.cart-btn-desk .cart-count')).toHaveText('2', { timeout: 30000 });
    await page.locator('.cart-btn-desk').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await expect(page.locator('#cart .cart-item .cart-qty output')).toHaveText('2');
    // retiré ici : retiré du compte
    await page.locator('#cart .cart-item [data-remove]').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(0);
    await expect.poll(async () => (await rows()).length).toBe(0);
    // déconnecté : le panier du compte n'est plus à portée
    await page.locator('#cart [data-close]').first().click();
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    await expect(page.locator('.cart-btn-desk')).toBeHidden();
  });

  test('commander depuis le panier : connexion demandée, puis compositions enregistrées dans le compte', async ({ acc }) => {
    const { page } = acc;
    // des dessins importés avec un compte, puis déconnecté
    await signUpAndIn(page, 'avant2@example.org', 'Rouge-Soleil-42', 'Avant');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    await page.evaluate(() => AtelierGribouille.setMode('impression'));
    await openStep(page, 'export-section');
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="papier"]').click();
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    // pas connecté : la connexion passe devant, puis la commande reprend d'elle-même
    await page.locator('#cart-order').click();
    await expect(page.locator('#cart')).toBeHidden();
    await expect(page.locator('#acc-status')).toContainText('commander');
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await page.fill('#auth-name', 'Sam');
    await page.fill('#auth-email', 'sam@example.org');
    await page.fill('#auth-password', 'Bleu-Nuage-77');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#cart .cart-status')).toContainText('prête', { timeout: 60000 });
    const uploads = await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload' && c[1].split('/')[1] !== AtelierGribouille.state.workId).length);
    expect(uploads).toBe(9); // les trois dessins de la composition commandée (image, page, masques), envoyés une seule fois (hors l'œuvre elle-même)
    // l'article du panier, parti dans le compte à la connexion, est devenu la composition commandée (plus de « panier »)
    expect(await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length)).toBe(0);
    const orders = await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-gribouille:commandes') || '[]'));
    expect(orders).toHaveLength(1);
    await page.locator('#cart [data-close]').first().click();
    // la composition commandée est dans Mes œuvres, sous la référence de la commande, marquée « commandée »
    await page.evaluate(() => document.querySelector('#saved-section > h2') && document.querySelector('#saved-section').classList.contains('collapsed') && document.querySelector('#saved-section > h2').click());
    const ordered = page.locator('#saved-list .saved', { hasText: orders[0].ref });
    await expect(ordered).toHaveCount(1, { timeout: 30000 });
    await expect(ordered.locator('.saved-tag')).toContainText('commandée');
    // rouverte, c'est une copie : la composition commandée reste telle quelle
    await ordered.click();
    await page.waitForFunction(() => AtelierGribouille.state.copyOf && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#cloud-sync-status')).toContainText('Copie');
    // supprimer le compte efface aussi ses fichiers (dessins de la composition commandée)
    const uid = await page.evaluate(() => window.Account.user().id);
    expect(await page.evaluate((uid) => Object.keys(window.__fake.db.files).filter((p) => p.startsWith(uid + '/')).length, uid)).toBeGreaterThan(0);
    await page.locator('#acc-menu').click();
    await page.locator('#acc-delete').click();
    await page.locator('#acc-delete').click();
    await expect(page.locator('#acc-status')).toContainText('Compte supprimé');
    expect(await page.evaluate((uid) => Object.keys(window.__fake.db.files).filter((p) => p.startsWith(uid + '/')).length, uid)).toBe(0);
  });
});
