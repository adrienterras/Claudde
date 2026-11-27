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

// l'administrateur valide la double authentification : activation (code à scanner) la première fois,
// code seul ensuite ; le faux serveur attend le code 123456
async function adminMfa(page, { enroll } = {}) {
  const box = page.locator('#admin-mfa');
  await expect(box).toBeVisible();
  await expect(page.locator('#admin-list .saved')).toHaveCount(0);
  if (enroll) {
    await expect(box).toContainText('double authentification est obligatoire');
    await page.locator('#admin-mfa-start').click();
    await expect(page.locator('#admin-mfa-qr code')).toHaveText('JBSWY3DPEHPK3PXP');
  } else {
    await expect(page.locator('#admin-mfa-start')).toBeHidden();
  }
  await page.fill('#admin-mfa-code', '123456');
  await page.locator('#admin-mfa-form button').click();
  await expect(box).toBeHidden();
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

  test('téléphone : les champs de connexion font 16 px (iOS ne zoome pas en les remplissant)', async ({ acc }) => {
    const { page } = acc;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#acc-head').click(); // (téléphone : le compte s'ouvre par « Mon compte », dans l'en-tête)
    await page.locator('#acc-open').click();
    await expect(page.locator('#auth-email')).toBeVisible();
    for (const id of ['#auth-email', '#auth-password']) expect(parseFloat(await page.locator(id).evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    expect(parseFloat(await page.locator('#auth-name').evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
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
    // (adresse inconnue : même réponse qu'une adresse connue, sans créer de compte)
    await expect(page.locator('#acc-status')).toContainText('Si un compte existe');
    await page.locator('#auth-forgot').click();
    await expect(page.locator('#acc-status')).toContainText('nouveau mot de passe');
    const calls = await page.evaluate(() => window.__fake.calls);
    expect(calls.map((c) => c[0])).toEqual(['oauth', 'otp', 'reset']);
    expect(calls[1][2]).toBe(false); // shouldCreateUser
    expect(calls[1][3]).toBeUndefined(); // (sans clé de vérification anti-robot : pas de jeton)
    expect(calls[0][1]).toBe('google');
    expect(calls[0][2]).toMatch(/^http:\/\/localhost:\d+\/index\.html$/);
  });

  test('vérification anti-robot (Turnstile) activée par la clé du site : chaque demande au service des comptes porte un jeton', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('**/vendor/supabase.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '// remplacé par le faux' }));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'anon', captchaSiteKey: 'cle-publique-test' };" }));
    // (un faux Turnstile : le vrai script de Cloudflare n'est pas chargé dans les tests)
    await page.addInitScript(() => {
      let n = 0;
      window.turnstile = { render: (el, o) => { window.__ts = o; setTimeout(() => o.callback(`jeton-${++n}`), 50); return n; }, remove() {} };
    });
    await page.addInitScript(FAKE);
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.enabled);
    await page.locator('#acc-open').click();
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await page.fill('#auth-email', 'robot@example.org');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-menu')).toBeVisible();
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    await page.locator('#acc-open').click();
    await page.fill('#auth-email', 'robot@example.org');
    await page.locator('#auth-magic').click();
    await expect(page.locator('#acc-status')).toContainText('Si un compte existe');
    await page.locator('#auth-forgot').click();
    await expect(page.locator('#acc-status')).toContainText('nouveau mot de passe');
    const calls = await page.evaluate(() => window.__fake.calls);
    expect(calls.find((c) => c[0] === 'captcha' && c[1] === 'signup')[2]).toMatch(/^jeton-/);
    expect(calls.find((c) => c[0] === 'otp')[3]).toMatch(/^jeton-/);
    expect(calls.find((c) => c[0] === 'reset')[2]).toMatch(/^jeton-/);
    expect(await page.evaluate(() => window.__ts.sitekey)).toBe('cle-publique-test');
    await ctx.close();
  });

  test('sans compte : l’exemple, l’import de fichiers et la photo sont libres ; l’icône Enregistrer demande de se connecter, puis enregistre', async ({ acc }) => {
    const { page } = acc;
    // (pas d'étape Importer avant le premier import : le type d'œuvre et le dépôt se font au centre)
    await expect(page.locator('#import-section')).toBeHidden();
    // l'exemple : chargé et manipulé sans compte
    await page.locator('#empty-sample').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length > 0 && AtelierGribouille.state.drawings.every((d) => d.sample) && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await openStep(page, 'import-section'); // (l'étape Importer, venue avec les dessins, est repliée)
    await expect(page.locator('#import-account')).toBeVisible();
    await expect(page.locator('#import-account')).toContainText('librement');
    await page.evaluate(() => AtelierGribouille.selectProposal(1));
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBeTruthy();
    await expect(page.locator('#account-section')).toBeHidden();
    // photographier (sur téléphone : le bouton n'est pas sur ordinateur) : sans compte, le conseil puis
    // l'appareil photo, pas de connexion demandée
    await expect(page.locator('#camera-open')).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#sheet-tabs [data-tab="import-section"]').click();
    await page.locator('#camera-open').click();
    await expect(page.locator('#camera-advice')).toBeVisible();
    await expect(page.locator('#account-section')).toBeHidden();
    await page.locator('#camera-advice [data-close]').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    // des fichiers déposés sans compte : importés tout de suite, à la place de l'exemple
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 3 && AtelierGribouille.state.drawings.every((d) => !d.sample) && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#account-section')).toBeHidden();
    // l'icône Enregistrer, tout à gauche de la barre d'outils : sans compte, la connexion ou la création
    // d'un compte d'abord ; connecté, l'œuvre est enregistrée d'elle-même (un message sur l'œuvre)
    const first = await page.evaluate(() => document.querySelector('#toolbar button').id);
    expect(first).toBe('tb-save');
    await expect(page.locator('#tb-save')).toBeEnabled();
    await page.locator('#tb-save').click();
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#acc-status')).toContainText('enregistrer votre œuvre');
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await page.fill('#auth-email', 'imp@example.org');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-menu')).toBeVisible();
    await expect(page.locator('#stage-toast')).toContainText('enregistrée dans votre compte', { timeout: 30000 });
    // connecté : l'indication disparaît
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
    await page.evaluate(() => { AtelierGribouille.state.exportDpi = 60; }); // (petit fichier pour l'essai : l'export est toujours à 300 dpi)
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#auth-submit').click()]);
    expect(download.suggestedFilename()).toMatch(/\.jpe?g$/);
    await expect(page.locator('#save-status')).toContainText('gardé dans votre compte', { timeout: 60000 });
    await openStep(page, 'saved-section');
    await expect(page.locator('#exports-box')).toBeVisible();
    await expect(page.locator('#exports-list .saved')).toHaveCount(1);
    await expect(page.locator('#exports-list .saved-meta')).toContainText('JPEG');
    // déconnecté : « Enregistrer cette œuvre » demande de se connecter ou de créer un compte
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await openStep(page, 'compose-section');
    await page.locator('#save-comp').click();
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#acc-status')).toContainText('enregistrer votre œuvre');
    await expect(page.locator('#freeze-status')).not.toContainText('enregistrée dans Mes œuvres');
  });

  test('le compte garde 15 œuvres au plus, 60 jours : la 16e attend avec une alerte, part dès qu’on en supprime une ; une œuvre de plus de 60 jours est effacée', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    await signUpAndIn(page, 'max@example.org', 'Rouge-Soleil-42', 'Max');
    // le compte contient déjà 15 œuvres récentes, et une vieille de 61 jours
    await page.evaluate(() => {
      const uid = window.__fake.db.session.user.id;
      const row = (i, daysAgo) => { const date = new Date(Date.now() - daysAgo * 86400e3).toISOString(); return { id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, user_id: uid, created_at: date, name: `Œuvre ${i}`, thumb: null, __table: 'compositions', meta: { date, work: true, n: 0, drawings: [], comp: { style: 'nuage', W: 30, H: 40 }, settings: { mode: 'impression', format: 'cadre:30x40' } } }; };
      for (let i = 1; i <= 15; i++) window.__fake.db.rows.push(row(i, i));
      window.__fake.db.rows.push(row(99, 61));
    });
    await page.evaluate(() => AtelierGribouille.renderSaved({ refresh: true }));
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved')).toHaveCount(15);
    expect(await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.work).length)).toBe(15); // la vieille est partie
    await expect(page.locator('#saved-hint')).toContainText('15 œuvres');
    await expect(page.locator('#saved-full')).toBeHidden();
    // une nouvelle œuvre : elle s'enregistre sur l'appareil mais n'entre pas dans le compte, l'alerte le dit
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 1);
    const w = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.work).length)).toBe(15);
    await expect(page.locator('#saved-full')).toBeVisible();
    await expect(page.locator('#saved-full')).toContainText('(15) est atteint');
    await expect(page.locator('#cloud-sync-status')).toContainText('maximum de 15 œuvres');
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved')).toHaveCount(16);
    // une œuvre supprimée : celle en cours part dans le compte, l'alerte disparaît
    const del = page.locator('#saved-list .saved:not(.current) .saved-del').first();
    await del.click(); await del.click();
    await expect.poll(() => page.evaluate((id) => window.__fake.db.rows.some((r) => r.id === id && r.meta.work), w), { timeout: 20000 }).toBe(true);
    expect(await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.work).length)).toBe(15);
    await expect(page.locator('#saved-full')).toBeHidden();
    await expect(page.locator('#cloud-sync-status')).toContainText('Enregistrée dans votre compte');
  });

  test('une œuvre commandée n’est jamais effacée par la purge des 60 jours, et ne compte pas dans les 15', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'cmd@example.org', 'Rouge-Soleil-42', 'Cmd');
    await page.evaluate(() => {
      const uid = window.__fake.db.session.user.id;
      const row = (i, daysAgo, extra) => { const date = new Date(Date.now() - daysAgo * 86400e3).toISOString(); return { id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, user_id: uid, created_at: date, name: `Œuvre ${i}`, thumb: null, __table: 'compositions', meta: Object.assign({ date, work: true, n: 0, drawings: [], comp: { style: 'nuage', W: 30, H: 40 }, settings: { mode: 'impression', format: 'cadre:30x40' } }, extra) }; };
      window.__fake.db.rows.push(row(1, 90, { ordered: true }));
      window.__fake.db.rows.push(Object.assign(row(2, 90, {}), { name: 'AG-260801-AB12 · Ancienne commande' }));
      window.__fake.db.rows.push(row(3, 90, {}));
    });
    await page.evaluate(() => AtelierGribouille.renderSaved({ refresh: true }));
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved')).toHaveCount(2);
    expect(await page.evaluate(() => window.__fake.db.rows.filter((r) => r.__table === 'compositions').map((r) => r.id.slice(-1)).sort())).toEqual(['1', '2']);
    await expect(page.locator('#saved-hint')).toContainText('commandées sont gardées');
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
    // chaque dessin : son image, sa page de travail et (dessins découpés) la planche de ses masques, dans le dossier de l'œuvre ;
    // page-two.png donne deux dessins, qui partagent son image (envoyée une fois)
    const up1 = await page.evaluate((id) => window.__fake.calls.filter((c) => c[0] === 'upload').map((c) => c[1].split('/')[1] === id), w1);
    expect(up1.length).toBe(10);
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
    expect(await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload').length)).toBe(10);
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
    await page.evaluate(() => new Promise((res) => { Object.keys(localStorage).filter((k) => k.startsWith('atelier.oeuvres-vues')).forEach((k) => localStorage.removeItem(k)); localStorage.removeItem('atelier.nouvelle'); const r = indexedDB.deleteDatabase('atelier-gribouille'); r.onsuccess = res; r.onerror = res; r.onblocked = res; }));
    await page.reload();
    await page.waitForFunction((id) => window.AtelierGribouille && AtelierGribouille.state.workId === id && AtelierGribouille.state.drawings.length === 2 && document.getElementById('progress').hidden, w2, { timeout: 120000 });
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved')).toHaveCount(2);
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1); // (la liste se redessine avec l'œuvre rouverte en tête)
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
    // un effacement dans le compte qui échoue : l'œuvre disparaît d'abord de la liste, puis y revient avec le message
    await page.evaluate(() => { window.__delReal = window.Account.cloud.del; window.Account.cloud.del = () => new Promise((_, ko) => setTimeout(() => ko(new Error('réseau coupé')), 800)); });
    const nonCurrent = page.locator('#saved-list .saved:not(.current) .saved-del');
    await nonCurrent.click(); await nonCurrent.click();
    await expect(page.locator('#saved-list .saved')).toHaveCount(1, { timeout: 500 });
    await expect(page.locator('#saved-status')).toContainText('réseau coupé');
    await expect(page.locator('#saved-list .saved')).toHaveCount(2);
    // un compte lent : la ligne part tout de suite, sans attendre le serveur
    await page.evaluate(() => { const real = window.__delReal; window.Account.cloud.del = (id) => new Promise((res) => setTimeout(res, 2500)).then(() => real(id)); });
    // supprimée : sa ligne et ses fichiers partent du compte, l'autre reste
    await page.locator('#saved-list .saved.current .saved-del').click();
    await page.locator('#saved-list .saved.current .saved-del').click();
    await expect(page.locator('#saved-list .saved')).toHaveCount(1, { timeout: 1500 });
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.map((r) => r.id))).toEqual([w2]);
    const files = await page.evaluate(() => Object.keys(window.__fake.db.files).map((p) => p.split('/')[1]));
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((id) => id === w2)).toBe(true);
  });

  test('administration : le compte qui a le rôle administrateur (écrit côté serveur, pas son e-mail) voit les œuvres de tous les comptes (par e-mail) et les ouvre en copie dans son compte, sans toucher à l’original ; un autre compte ne voit rien de tel', async ({ acc }) => {
    test.setTimeout(240000);
    const { page } = acc;
    // Lou fait une œuvre, qui part dans son compte
    await signUpAndIn(page, 'lou@example.org', 'Rouge-Soleil-42', 'Lou');
    await page.setInputFiles('#file', ['page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 2);
    const w1 = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id && r.meta.work), w1);
    await openStep(page, 'saved-section');
    await expect(page.locator('#admin-box')).toBeHidden(); // (un compte ordinaire : pas de vue d'administration)
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    // l'adresse de l'éditeur sans le rôle : un compte ordinaire (le rôle seul compte, pas l'e-mail)
    await signUpAndIn(page, 'adrien@terras.me', 'Rouge-Soleil-42', 'Adrien');
    await openStep(page, 'saved-section');
    await expect(page.locator('#admin-box')).toBeHidden();
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    // l'administrateur (rôle donné côté serveur) se connecte : la vue liste l'œuvre de Lou, sous son e-mail
    await page.evaluate(() => { window.__FAKE_ADMINS = ['admin@example.org']; });
    await signUpAndIn(page, 'admin@example.org', 'Rouge-Soleil-42', 'Admin');
    await openStep(page, 'saved-section');
    await expect(page.locator('#admin-box')).toBeVisible();
    await expect(page.locator('#saved-hint')).toContainText('sans limite de nombre'); // (pas de plafond de 15 œuvres pour ce compte)
    // le mot de passe seul ne suffit pas : rien n'est lu avant la double authentification, que le
    // serveur exige aussi (un appel direct est refusé)
    expect(await page.evaluate(async () => { try { await window.Account.adminList(0); return 'lu'; } catch (e) { return e.message; } })).toContain('double authentification');
    // un code faux : refusé, la liste reste fermée ; le bon code l'ouvre
    await page.locator('#admin-mfa-start').click();
    await page.fill('#admin-mfa-code', '000000');
    await page.locator('#admin-mfa-form button').click();
    await expect(page.locator('#admin-status')).toContainText('Code incorrect');
    await expect(page.locator('#admin-mfa')).toBeVisible();
    await page.fill('#admin-mfa-code', '123456');
    await page.locator('#admin-mfa-form button').click();
    await expect(page.locator('#admin-mfa')).toBeHidden();
    await expect(page.locator('#admin-list .admin-owner')).toContainText('lou@example.org');
    // les fichiers de Lou ne lui sont ouverts qu'une fois son œuvre ouverte (et inscrite au journal)
    const louFile = await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.drawings[0].file, w1);
    const canRead = () => page.evaluate(async (p) => !!(await window.supabase.createClient().storage.from('drawings').download(p)).data, louFile);
    expect(await canRead()).toBe(false);
    expect(await page.evaluate(() => window.__fake.adminLog.length)).toBe(0);
    await expect(page.locator('#admin-list .saved')).toHaveCount(1);
    await expect(page.locator('#admin-list .saved .saved-meta')).toContainText('2 dessins');
    // ses propres œuvres et son panier ne mêlent pas celles des autres comptes (les règles lui ouvrent leur
    // lecture : sans filtre, l'œuvre de Lou apparaissait dans Mes œuvres et sa suppression échouait)
    expect(await page.evaluate(async (id) => (await window.Account.cloud.list()).some((e) => String(e.id).includes(id)), w1)).toBe(false);
    expect(await page.evaluate(async () => (await window.Account.cloud.cart()).length)).toBe(0);
    const before = await page.evaluate(() => JSON.stringify(window.__fake.db.rows.map((r) => [r.id, r.user_id, r.meta.date])));
    // ouverte en copie : les dessins de Lou, une copie qui ne rejoint le compte qu'au premier changement
    await page.locator('#admin-list .saved .saved-copy').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && AtelierGribouille.state.copyOf && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#cloud-sync-status')).toContainText('Copie');
    expect(await page.evaluate(() => JSON.stringify(window.__fake.db.rows.map((r) => [r.id, r.user_id, r.meta.date])))).toBe(before);
    expect(await page.evaluate(() => window.__fake.adminLog.map((l) => l.id))).toEqual([w1]);
    expect(await canRead()).toBe(true);
    // un changement : la copie devient une œuvre de l'administrateur ; celle de Lou n'a pas bougé
    await page.evaluate(() => AtelierGribouille.selectProposal(1));
    await page.waitForFunction(() => AtelierGribouille.state.workId && !AtelierGribouille.state.copyOf);
    await waitDraft(page, 2);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction(() => window.__fake.db.rows.filter((r) => r.meta.work).length === 2);
    const rows = await page.evaluate(() => window.__fake.db.rows.map((r) => ({ id: r.id, owner: window.__fake.db.users[Object.keys(window.__fake.db.users).find((k) => window.__fake.db.users[k].id === r.user_id)].email, date: r.meta.date, n: r.meta.drawings.length })));
    const lou = rows.find((r) => r.id === w1), mine = rows.find((r) => r.id !== w1);
    expect(lou.owner).toBe('lou@example.org');
    expect(JSON.parse(before).find((r) => r[0] === w1)[2]).toBe(lou.date);
    expect(mine.owner).toBe('admin@example.org');
    expect(mine.n).toBe(2);
    // il supprime sa propre œuvre ; celle de Lou reste
    await page.evaluate(async (id) => window.Account.cloud.del('cloud:' + id), mine.id);
    const left = await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta.work).map((r) => r.id));
    expect(left).toEqual([w1]);
  });

  test('administration : Commandes — adresse, œuvres, statut et suivi ; le client est prévenu ; annuler rembourse ; un autre compte ne voit rien', async ({ acc }) => {
    const { page } = acc;
    await page.evaluate(() => { window.__FAKE_ADMINS = ['admin@example.org']; });
    await signUpAndIn(page, 'admin@example.org', 'Rouge-Soleil-42', 'Admin');
    await page.evaluate(() => {
      const now = new Date().toISOString();
      const items = [{ compId: '55555555-5555-4555-8555-000000000001', title: 'Courtepointe', label: 'Affiche 21 × 30 cm', product: 'print', finish: 'papier', size: '21x30', W: 21, H: 30, qty: 1, unit: 39 }];
      const base = { __table: 'orders', user_id: 'u-client', email: 'client@example.org', consent: false, items, subtotal_cents: 3900, created_at: now, paid_at: now, carrier: null, tracking: null };
      window.__fake.db.rows.push(Object.assign({}, base, { id: '66666666-6666-4666-8666-000000000001', ref: 'AG-261125-AAAA', status: 'payee', shipping_cents: 990, total_cents: 4890, delivery: 'domicile', customer: { name: 'Camille Martin', email: 'client@example.org', phone: '+33600000000' }, shipping: { name: 'Camille Martin', address: { line1: '3 rue des Lilas', postal_code: '75011', city: 'Paris', country: 'FR' } } }));
      window.__fake.db.rows.push(Object.assign({}, base, { id: '66666666-6666-4666-8666-000000000002', ref: 'AG-261125-BBBB', status: 'payee', shipping_cents: 1990, total_cents: 5890, delivery: 'express', customer: { name: 'Sam', email: 'sam@example.org' }, shipping: { name: 'Sam', address: { line1: '1 place Bellecour', postal_code: '69002', city: 'Lyon', country: 'FR' } } }));
      // (paiements commencés puis abandonnés : pas dans la liste)
      window.__fake.db.rows.push(Object.assign({}, base, { id: '66666666-6666-4666-8666-000000000003', ref: 'AG-261125-CCCC', status: 'abandonnee', shipping_cents: 0, total_cents: 3900 }));
    });
    await openStep(page, 'saved-section');
    await adminMfa(page, { enroll: true });
    const orders = page.locator('#admin-orders .admin-order');
    await expect(orders).toHaveCount(2);
    await expect(page.locator('#admin-orders-count')).toHaveText('(2)');
    const first = orders.filter({ hasText: 'AG-261125-AAAA' });
    await expect(first).toContainText('Camille Martin');
    await expect(first).toContainText('3 rue des Lilas');
    await expect(first).toContainText('Colissimo');
    await expect(first.locator('[data-open]')).toHaveText('Ouvrir l’œuvre');
    await expect(orders.filter({ hasText: 'AG-261125-BBBB' })).toContainText('Express Chronopost 24 h');
    await expect(orders.filter({ hasText: 'AG-261125-BBBB' }).locator('input[name="carrier"]')).toHaveValue('Chronopost');
    // expédiée, avec le numéro de suivi : enregistrée, le client prévenu
    await first.locator('select[name="status"]').selectOption('expediee');
    await first.locator('input[name="tracking"]').fill('6A12345678901');
    await first.locator('button[type="submit"]').click();
    await expect(page.locator('#admin-orders-status')).toContainText('le client est prévenu par e-mail');
    const o = await page.evaluate(() => window.__fake.db.rows.find((r) => r.ref === 'AG-261125-AAAA'));
    expect([o.status, o.carrier, o.tracking]).toEqual(['expediee', 'Colissimo', '6A12345678901']);
    await expect(orders.filter({ hasText: 'AG-261125-AAAA' }).locator('.order-status')).toHaveText('Expédiée');
    // annuler et rembourser l'autre (deux touches)
    const second = orders.filter({ hasText: 'AG-261125-BBBB' });
    await second.locator('[data-cancel]').click();
    await expect(second.locator('[data-cancel]')).toContainText('Rembourser');
    await second.locator('[data-cancel]').click();
    await expect(page.locator('#admin-orders-status')).toContainText('annulée et remboursée');
    await expect(orders.filter({ hasText: 'AG-261125-BBBB' }).locator('.order-status')).toHaveText('Annulée');
    await expect(orders.filter({ hasText: 'AG-261125-BBBB' }).locator('form')).toHaveCount(0);
    // un compte ordinaire : ni la section, ni les commandes des autres
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await signUpAndIn(page, 'simple@example.org', 'Rouge-Soleil-42', 'Simple');
    await expect(page.locator('#admin-orders')).toBeHidden();
    expect(await page.evaluate(() => window.Account.orders.admin())).toEqual([]);
  });

  test('administration : la liste se lit par pages de 60, « Afficher les œuvres suivantes » charge la suite', async ({ acc }) => {
    const { page } = acc;
    await page.evaluate(() => { window.__FAKE_ADMINS = ['admin@example.org']; });
    await signUpAndIn(page, 'admin@example.org', 'Rouge-Soleil-42', 'Admin');
    await page.evaluate(() => {
      const date = new Date().toISOString();
      for (let i = 0; i < 65; i++) window.__fake.db.rows.push({ id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, user_id: 'u-autre', created_at: new Date(Date.now() - i * 1000).toISOString(), name: `Œuvre ${i}`, thumb: null, __table: 'compositions', meta: { date, work: true, n: 1, drawings: [], comp: { style: 'nuage', W: 30, H: 40 }, settings: { mode: 'impression' } } });
    });
    await openStep(page, 'saved-section');
    await adminMfa(page, { enroll: true });
    await expect(page.locator('#admin-list .saved')).toHaveCount(60);
    await expect(page.locator('#admin-count')).toHaveText('(60)');
    await page.locator('#admin-more').click();
    await expect(page.locator('#admin-list .saved')).toHaveCount(65);
    await expect(page.locator('#admin-more')).toBeHidden();
  });

  test('suppression : si l’effacement des fichiers échoue, l’œuvre reste (fiche et dessins) et la suppression se relance ; ensuite tout est effacé', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    await signUpAndIn(page, 'lou@example.org', 'Rouge-Soleil-42', 'Lou');
    await page.setInputFiles('#file', ['page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 2);
    const w = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id && r.meta.work), w);
    const state = () => page.evaluate((id) => { const uid = window.__fake.db.session.user.id; return { row: window.__fake.db.rows.some((r) => r.id === id), files: Object.keys(window.__fake.db.files).filter((p) => p.startsWith(`${uid}/${id}/`)).length }; }, w);
    const before = await state();
    expect(before.row).toBe(true);
    expect(before.files).toBeGreaterThan(0);
    // le réseau coupe pendant l'effacement des fichiers : erreur, rien n'est perdu de vue
    await page.evaluate(() => { window.__FAKE_REMOVE_FAIL = true; });
    const msg = await page.evaluate(async (id) => { try { await window.Account.cloud.del('cloud:' + id); return ''; } catch (e) { return e.message; } }, w);
    expect(msg).toContain('réseau coupé');
    expect(await state()).toEqual(before);
    // le réseau revient : la suppression relancée efface la fiche et tous les dessins
    await page.evaluate(() => { window.__FAKE_REMOVE_FAIL = false; });
    await page.evaluate(async (id) => window.Account.cloud.del('cloud:' + id), w);
    expect(await state()).toEqual({ row: false, files: 0 });
  });

  test('administration : sans réponse du serveur, « Toutes les œuvres » ne reste pas sur « Lecture… » : un message et « Réessayer »', async ({ acc }) => {
    test.setTimeout(150000);
    const { page } = acc;
    await page.evaluate(() => { window.__FAKE_ADMINS = ['admin@example.org']; });
    await signUpAndIn(page, 'admin@example.org', 'Rouge-Soleil-42', 'Admin');
    await openStep(page, 'saved-section');
    await expect(page.locator('#admin-box')).toBeVisible();
    await adminMfa(page, { enroll: true });
    await expect(page.locator('#admin-list')).toContainText('Aucune œuvre dans les autres comptes');
    // le serveur ne répond plus : la lecture suivante (à la reconnexion) reste sans réponse
    await page.evaluate(() => { window.__realAdminList = window.Account.adminList; window.Account.adminList = () => new Promise(() => {}); });
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    await page.locator('#acc-open').click();
    await page.locator('.auth-tabs [data-mode="signin"]').click();
    await page.fill('#auth-email', 'admin@example.org');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#acc-menu')).toBeVisible();
    await openStep(page, 'saved-section');
    // nouvelle connexion : le code de l'application est redemandé (l'application est déjà activée)
    await adminMfa(page);
    const st = page.locator('#admin-status');
    await expect(st).toContainText('Lecture des œuvres');
    await expect(st).toContainText('pas de réponse du serveur', { timeout: 45000 });
    // le serveur répond de nouveau : « Réessayer » affiche la liste
    await page.evaluate(() => { window.Account.adminList = window.__realAdminList; });
    await st.locator('button').click();
    await expect(st).toBeHidden({ timeout: 30000 });
    await expect(page.locator('#admin-list')).toContainText('Aucune œuvre dans les autres comptes');
  });

  test('nouvelle visite, rien sur l’appareil, une œuvre dans le compte : la fenêtre « Reprendre / Nouvelle œuvre » avant tout téléchargement', async ({ acc }) => {
    test.setTimeout(240000);
    const { page } = acc;
    await signUpAndIn(page, 'lou@example.org', 'Rouge-Soleil-42', 'Lou');
    await page.setInputFiles('#file', ['page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 2);
    const w1 = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id && r.meta.work), w1);
    // un autre appareil (rien en local), arrivée par un lien : on demande, rien ne se télécharge
    const wipe = () => page.evaluate(() => new Promise((res) => { Object.keys(localStorage).filter((k) => k.startsWith('atelier.oeuvres-vues')).forEach((k) => localStorage.removeItem(k)); localStorage.removeItem('atelier.nouvelle'); const r = indexedDB.deleteDatabase('atelier-gribouille'); r.onsuccess = res; r.onerror = res; r.onblocked = res; }));
    await wipe();
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.user());
    await expect(page.locator('#resume-modal')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#resume-text')).toContainText('2 dessins');
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    // « Commencer une nouvelle œuvre » : l'atelier reste vide, et une visite suivante ne redemande pas
    await page.locator('#resume-new').click();
    await expect(page.locator('#resume-modal')).toBeHidden();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.user());
    await page.waitForTimeout(2500);
    await expect(page.locator('#resume-modal')).toBeHidden();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    // « Reprendre » : l'œuvre du compte se rouvre
    await wipe();
    await page.goto('index.html');
    await expect(page.locator('#resume-modal')).toBeVisible({ timeout: 30000 });
    await page.locator('#resume-yes').click();
    await page.waitForFunction((id) => AtelierGribouille.state.workId === id && AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, w1, { timeout: 120000 });
    // une actualisation, elle, rouvre sans demander
    await waitDraft(page, 2);
    expect(await page.evaluate(() => localStorage.getItem('atelier.nouvelle'))).toBeNull(); // (« Reprendre » a levé la marque « nouvelle œuvre »)
    await page.reload();
    await page.waitForFunction((id) => window.AtelierGribouille && AtelierGribouille.state.workId === id && AtelierGribouille.state.drawings.length === 2 && document.getElementById('progress').hidden, w1, { timeout: 120000 });
    await expect(page.locator('#resume-modal')).toBeHidden();
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
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('atelier.oeuvres-vues:'))))[id], id)).toBe(t1);
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
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('atelier.oeuvres-vues:'))))[id], id)).toBe(other.t);
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

  test('appareils synchronisés : une œuvre faite ailleurs apparaît au retour sur la page, sans recharger ; un envoi manqué repart de lui-même quand la connexion revient', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'sync@example.org', 'Rouge-Soleil-42', 'Sync');
    await page.setInputFiles('#file', ['page-cutout.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 1);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    const id = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id), id);
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    // sur le téléphone, pendant ce temps, une autre œuvre est faite et part dans le compte
    await page.evaluate((id) => { const r = window.__fake.db.rows.find((x) => x.id === id); const t = new Date(Date.now() + 60000).toISOString(); window.__fake.db.rows.push(Object.assign({}, r, { id: '0b9c6e2a-4a1d-4c4e-9a43-2f5d0c1e7b11', name: 'Œuvre du téléphone', meta: Object.assign({}, r.meta, { date: t, device: 'phone' }) })); }, id);
    // la page passe en arrière-plan, puis revient 40 s plus tard : la liste est relue, l'œuvre du téléphone y est
    await page.evaluate(() => {
      let vis = 'visible'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
      vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
      const real = Date.now; Date.now = () => real() + 40000;
      vis = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('#saved-list .saved')).toHaveCount(2);
    await expect(page.locator('#saved-list')).toContainText('Œuvre du téléphone');
    // un changement qui ne part pas (réseau coupé) : l'œuvre reste ici, puis part d'elle-même quand la connexion revient
    const t0 = await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.date, id);
    await page.evaluate(() => { window.__put = window.Account.cloud.workPut; window.Account.cloud.workPut = () => Promise.reject(new Error('Failed to fetch')); });
    await page.evaluate(() => AtelierGribouille.selectProposal(1));
    await page.waitForTimeout(3500);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await expect(page.locator('#cloud-sync-status')).toContainText('dès que la connexion le permettra');
    await page.evaluate(() => { window.Account.cloud.workPut = window.__put; window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(({ id, t0 }) => window.__fake.db.rows.find((r) => r.id === id).meta.date !== t0, { id, t0 }, { timeout: 10000 });
    await expect(page.locator('#cloud-sync-status')).toContainText('Enregistrée dans votre compte');
  });

  test('deux comptes sur un appareil : une œuvre du premier compte reste à lui, la ligne le dit ; une œuvre faite sans compte part dans celui qui se connecte ; « Envoyer dans mon compte » et la raison d’un échec', async ({ acc }) => {
    test.setTimeout(240000);
    const { page } = acc;
    await signUpAndIn(page, 'pro@example.org', 'Rouge-Soleil-42', 'Pro');
    await page.setInputFiles('#file', ['page-cutout.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 1);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    const id = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.waitForFunction((id) => window.__fake.db.rows.filter((r) => r.id === id).length === 1, id);
    await page.locator('#acc-menu').click();
    await page.locator('#acc-signout').click();
    await expect(page.locator('#cloud-sync-status')).toContainText('Connectez-vous pour la retrouver');
    // l'autre compte : l'œuvre du premier n'y est pas copiée, et la ligne ne prétend pas qu'elle y est
    await signUpAndIn(page, 'perso@example.org', 'Rouge-Soleil-42', 'Perso');
    await expect(page.locator('#cloud-sync-status')).toContainText('dans un autre compte');
    await expect(page.locator('#cloud-sync-send')).toBeHidden();
    await page.waitForTimeout(4000);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__fake.db.rows.length)).toBe(1);
    // une œuvre faite ici avec ce compte-là : l'envoi échoue (le serveur refuse), la raison est dite, le bouton l'envoie ensuite
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await page.evaluate(() => { window.__put = window.Account.cloud.workPut; window.Account.cloud.workPut = () => Promise.reject(new Error('new row violates row-level security policy')); });
    await page.setInputFiles('#file', ['page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 2);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await expect(page.locator('#cloud-sync-status')).toContainText('row-level security');
    await expect(page.locator('#cloud-sync-send')).toBeVisible();
    await page.evaluate(() => { window.Account.cloud.workPut = window.__put; });
    await page.locator('#cloud-sync-send').click();
    await page.waitForFunction(() => window.__fake.db.rows.length === 2, null, { timeout: 15000 });
    await expect(page.locator('#cloud-sync-status')).toContainText('Enregistrée dans votre compte');
    await expect(page.locator('#cloud-sync-send')).toBeHidden();
  });

  test('connecté, « Enregistrer » envoie l’œuvre dans le compte et le dit ; un envoi refusé le dit aussi', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    await signUpAndIn(page, 'fige@example.org', 'Rouge-Soleil-42', 'Fige');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await openStep(page, 'compose-section');
    const before = await page.evaluate(() => window.__fake.db.rows.length);
    await page.locator('#save-comp').click();
    await expect(page.locator('#freeze-status')).toContainText('enregistrée dans votre compte', { timeout: 30000 });
    // (la ligne est dans le compte au moment où le message le dit)
    const rows = await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.frozen).length);
    expect(rows).toBe(1);
    expect(await page.evaluate(() => window.__fake.db.rows.length)).toBeGreaterThan(before);
    // le serveur refuse : la raison est dite, l'œuvre est gardée sur l'appareil
    await page.evaluate(() => { window.Account.cloud.workPut = () => Promise.reject(new Error('new row violates row-level security policy')); });
    await page.locator('#save-comp').click();
    await expect(page.locator('#freeze-status')).toContainText('n’a pas pu être envoyée dans votre compte (new row violates', { timeout: 30000 });
    await expect(page.locator('#freeze-status')).toContainText('gardée sur cet appareil');
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
    // (une seule lecture entière, légère : les dates seules, pour effacer les œuvres de plus de 60 jours)
    expect(pages.filter((p) => p === 'all').length).toBeLessThanOrEqual(1);
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
    await expect(page.locator('#notice')).toContainText('Compte supprimé', { timeout: 30000 });
    await expect(page.locator('#acc-open')).toBeVisible();
    expect(await page.evaluate(() => Object.keys(window.__fake.db.users).length)).toBe(0);
  });

  test('appareil partagé : « Se déconnecter et effacer cet appareil » efface œuvres, panier et commandes de l’appareil (pas du compte), garde les préférences', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    await signUpAndIn(page, 'parent@example.org', 'Rouge-Soleil-42', 'Parent');
    await page.setInputFiles('#file', ['page-cutout.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 1);
    const w = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id && r.meta.work), w);
    await page.evaluate(() => {
      localStorage.setItem('atelier-gribouille:commandes', JSON.stringify([{ ref: 'AG-1' }]));
      localStorage.setItem('atelier-collage:taille:dessin.png:2000', '21');
      localStorage.setItem('atelier.mode', 'impression');
    });
    await page.locator('#acc-menu').click();
    const wipe = page.locator('#acc-signout-wipe');
    await wipe.click();
    await expect(wipe).toContainText('Confirmer');
    await expect(page.locator('#acc-status')).toContainText('restent dans votre compte');
    await wipe.click();
    await expect(page.locator('#notice')).toContainText('effacées de cet appareil', { timeout: 30000 });
    await page.waitForFunction(() => window.Account && window.Account.enabled);
    await expect(page.locator('#acc-open')).toBeVisible();
    expect(await hasDraft(page, 1)).toBe(false);
    expect(await page.evaluate(() => [localStorage.getItem('atelier-gribouille:commandes'), localStorage.getItem('atelier-collage:taille:dessin.png:2000'), localStorage.getItem('atelier.mode')])).toEqual([null, null, 'impression']);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    // l'œuvre est toujours dans le compte
    expect(await page.evaluate((id) => window.__fake.db.rows.some((r) => r.id === id), w)).toBe(true);
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
    // pas connecté : ajouter au panier demande d'abord de se connecter ou de créer un compte, puis
    // l'article choisi s'ajoute de lui-même
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart-add')).toBeHidden();
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#acc-status')).toContainText('ajouter l’œuvre au panier');
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await page.fill('#auth-name', 'Sam');
    await page.fill('#auth-email', 'sam@example.org');
    await page.fill('#auth-password', 'Bleu-Nuage-77');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1, { timeout: 60000 });
    await page.locator('#cart-order').click();
    await expect(page.locator('#cart .cart-status')).toContainText('prête', { timeout: 60000 });
    const uploads = await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload' && c[1].split('/')[1] !== AtelierGribouille.state.workId).length);
    expect(uploads).toBe(9); // les trois dessins de la composition commandée (image, page, masques), envoyés une seule fois (hors l'œuvre elle-même)
    // l'article du panier, parti dans le compte à la connexion, est devenu la composition commandée (plus de « panier »)
    expect(await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length)).toBe(0);
    const orders = await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-gribouille:commandes') || '[]'));
    expect(orders).toHaveLength(1);
    // la trace de la commande reste dans la fiche de l'œuvre commandée (référence, produit, quantité, prix)
    const trace = await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.ordered).map((r) => r.meta.order));
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ ref: orders[0].ref, qty: 1 });
    expect(trace[0].unit).toBeGreaterThan(0);
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
    // (l'appareil est nettoyé aussi : la page se recharge, vide, avec l'avis)
    await expect(page.locator('#notice')).toContainText('Compte supprimé', { timeout: 30000 });
    await page.waitForFunction(() => window.__fake);
    expect(await page.evaluate((uid) => Object.keys(window.__fake.db.files).filter((p) => p.startsWith(uid + '/')).length, uid)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('atelier-gribouille:commandes'))).toBeNull();
  });

  // (une œuvre de deux dessins, dans le compte ; prête à aller au panier)
  async function workInAccount(page, email, name) {
    await signUpAndIn(page, email, 'Rouge-Soleil-42', name);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 3);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    const workId = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id), workId);
    await page.evaluate(() => AtelierGribouille.setMode('impression'));
    await openStep(page, 'export-section');
    return workId;
  }
  const cartFiles = (meta) => meta.drawings.flatMap((d) => [d.file, d.saved && d.saved.page && d.saved.page.data, ...((d.saved && d.saved.atlases) || []).map((a) => a.data)]).filter(Boolean);

  test('ajouter au panier une œuvre déjà dans le compte : ses fichiers sont repris tels quels, sans copie ni envoi ; le bouton se libère aussitôt', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    const workId = await workInAccount(page, 'copie@example.org', 'Copie');
    await page.evaluate(() => { window.__fake.calls.length = 0; });
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="papier"]').click();
    // (la barre de progression du panier, au-dessus de « Commander » : ses états pendant l'envoi)
    await page.evaluate(() => {
      window.__bar = [];
      const wrap = document.querySelector('#cart .cart-progress');
      new MutationObserver(() => { if (!wrap.hidden) window.__bar.push(wrap.classList.contains('waiting') ? 'busy' : wrap.querySelector('.cart-progress-bar').getAttribute('aria-valuenow')); }).observe(wrap, { attributes: true, subtree: true });
    });
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart-add')).toBeHidden();
    await expect(page.locator('#cart-add-ok')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length), { timeout: 60000 }).toBe(1);
    // la barre s'est animée (préparation) ; l'envoi fini, le message et la barre disparaissent
    // la préparation avance dessin par dessin, de 0 à 100 % (une barre qui avance, pas une attente sans fin)
    const bar = (await page.evaluate(() => window.__bar)).filter((x) => x !== 'busy').map(Number);
    expect(bar[0]).toBe(0);
    expect(bar).toContain(100);
    expect(bar.some((x) => x > 0 && x < 100)).toBe(true);
    await expect(page.locator('#cart .cart-progress')).toBeHidden();
    await expect(page.locator('#cart .cart-status')).toBeHidden();
    // elle est juste au-dessus de « Commander », sous le message
    expect(await page.evaluate(() => document.querySelector('#cart .cart-status').nextElementSibling.classList.contains('cart-progress') && document.querySelector('#cart .cart-progress').nextElementSibling.id === 'cart-order')).toBe(true);
    // ni copie ni envoi : l'article se sert des fichiers de l'œuvre, qui sont là
    const res = await page.evaluate((id) => {
      const cart = window.__fake.db.rows.find((r) => r.meta && r.meta.cart);
      return { copies: window.__fake.calls.filter((c) => c[0] === 'copy').length, uploads: window.__fake.calls.filter((c) => c[0] === 'upload' && c[1].split('/')[1] === cart.id).length, meta: cart.meta, from: cart.meta.fromWork === id };
    }, workId);
    expect(res.copies).toBe(0);
    expect(res.uploads).toBe(0);
    expect(res.from).toBe(true);
    const files = cartFiles(res.meta);
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((f) => f.split('/')[1] === workId)).toBe(true);
    expect(await page.evaluate((files) => files.every((f) => !!window.__fake.db.files[f]), files)).toBe(true);
  });

  test('fichiers partagés entre une œuvre et son article du panier : gardés tant que l’un s’en sert ; un fichier manquant est envoyé pour l’article', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    const workId = await workInAccount(page, 'partage@example.org', 'Partage');
    // un fichier de l'œuvre a disparu du compte (retouchée ailleurs au même moment) : l'article l'envoie
    // dans son dossier, lu sur l'appareil à ce moment-là, et s'en sert
    const lost = await page.evaluate((id) => { const p = Object.keys(window.__fake.db.files).find((x) => x.split('/')[1] === id && x.endsWith('.jpg') && !x.endsWith('-page.jpg')); delete window.__fake.db.files[p]; window.__fake.calls.length = 0; return p; }, workId);
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="papier"]').click();
    await page.locator('#cart-add-ok').click();
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length), { timeout: 60000 }).toBe(1);
    await expect(page.locator('#cart .cart-status')).toBeHidden({ timeout: 60000 });
    const r1 = await page.evaluate((lost) => {
      const cart = window.__fake.db.rows.find((r) => r.meta && r.meta.cart);
      const files = cart.meta.drawings.flatMap((d) => [d.file, d.saved && d.saved.page && d.saved.page.data, ...((d.saved && d.saved.atlases) || []).map((a) => a.data)]).filter(Boolean);
      return { id: cart.id, files, present: files.every((f) => !!window.__fake.db.files[f]), usesLost: files.includes(lost), own: files.filter((f) => f.split('/')[1] === cart.id).length, uploads: window.__fake.calls.filter((c) => c[0] === 'upload' && c[1].split('/')[1] === cart.id).length, loaders: JSON.stringify(cart.meta).includes('load') };
    }, lost);
    expect(r1.present).toBe(true);
    expect(r1.usesLost).toBe(false);
    expect(r1.own).toBe(1);
    expect(r1.uploads).toBe(1);
    expect(r1.loaders).toBe(false); // (rien de la lecture différée dans la composition enregistrée)
    // l'œuvre supprimée : ses fichiers dont l'article se sert restent ; les autres partent
    await page.evaluate((id) => window.Account.cloud.del(`cloud:${id}`), workId);
    const r2 = await page.evaluate(({ files, workId }) => ({ present: files.every((f) => !!window.__fake.db.files[f]), work: !!window.__fake.db.rows.find((r) => r.id === workId) }), { files: r1.files, workId });
    expect(r2).toEqual({ present: true, work: false });
    // l'article retiré à son tour : plus rien ne s'en sert, tout part
    await page.evaluate((id) => window.Account.cloud.del(`cloud:${id}`), r1.id);
    expect(await page.evaluate(({ files, workId }) => files.filter((f) => !!window.__fake.db.files[f]).length + Object.keys(window.__fake.db.files).filter((p) => p.split('/')[1] === workId).length, { files: r1.files, workId })).toBe(0);
  });

  test('recommander depuis Mes commandes : l’œuvre commandée se rouvre, l’article déjà choisi ; seuls taille, encadrement, bordure et passe-partout se changent ; rien ne repart de l’appareil', async ({ acc }) => {
    test.setTimeout(240000);
    const { page } = acc;
    const workId = await workInAccount(page, 'encore@example.org', 'Encore');
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="papier"]').click();
    await page.locator('#cart-add-ok').click();
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length), { timeout: 60000 }).toBe(1);
    await expect(page.locator('#cart .cart-status')).toBeHidden({ timeout: 60000 });
    // l'article est commandé (comme le fait le serveur après le paiement)
    const ordered = await page.evaluate(async () => {
      const r = window.__fake.db.rows.find((x) => x.meta && x.meta.cart), id = r.id, title = r.name;
      await window.Account.cloud.cartSet(`cloud:${id}`, null, `AG-261126-ABCD · ${title}`, { ref: 'AG-261126-ABCD' });
      return { id, title };
    });
    await page.evaluate(() => { localStorage.removeItem('atelier-gribouille:panier'); window.__fake.calls.length = 0; });
    await page.goto(`index.html?recommander=${ordered.id}&taille=50x70&finition=cadre&cadre=bois-noir&pp=1&bord=0`);
    const box = page.locator('#cart-add');
    await expect(box).toBeVisible({ timeout: 120000 });
    await expect(box).toHaveClass(/reorder/);
    await expect(box.locator('#cart-add-title')).toHaveText('Recommander l’œuvre');
    await expect(box.locator('.cart-what-name')).toHaveText(ordered.title);
    expect(page.url()).not.toContain('recommander');
    // l'article commandé : encadré, bois noir, passe-partout, 50 × 70 ; ni fichier HD ni couleur à choisir
    await expect(box.locator('[data-finish="cadre"]')).toHaveClass(/on/);
    await expect(box.locator('.cart-print-sizes [data-size="50x70"]')).toHaveClass(/on/);
    await expect(box.locator('.cart-mat-field [data-mat="1"]')).toHaveClass(/on/);
    await expect(box.locator('input[value="hd"]')).toBeHidden();
    await expect(box.locator('.cart-frame-colors')).toBeHidden();
    await expect(box.locator('.cart-frame-name')).toHaveText('Bois noir');
    // la taille change : 70 × 100
    await box.locator('.cart-print-sizes [data-size="70x100"]').click();
    await box.locator('#cart-add-ok').click();
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length), { timeout: 60000 }).toBe(1);
    await expect(page.locator('#cart .cart-status')).toBeHidden({ timeout: 60000 });
    const res = await page.evaluate((workId) => {
      const r = window.__fake.db.rows.find((x) => x.meta && x.meta.cart);
      const files = r.meta.drawings.flatMap((d) => [d.file, d.saved && d.saved.page && d.saved.page.data, ...((d.saved && d.saved.atlases) || []).map((a) => a.data)]).filter(Boolean);
      return { cart: r.meta.cart, fromWork: r.meta.fromWork === workId, uploads: window.__fake.calls.filter((c) => c[0] === 'upload' && c[1].split('/')[1] === r.id).length, present: files.every((f) => !!window.__fake.db.files[f]) };
    }, workId);
    expect(res.cart).toMatchObject({ product: 'print', finish: 'cadre', size: '70x100', frame: 'bois-noir', mat: true, qty: 1 });
    expect(res.fromWork).toBe(true);
    expect(res.uploads).toBe(0);
    expect(res.present).toBe(true);
    // la fenêtre d'ajout redevient ordinaire ensuite
    await page.locator('#cart [data-close]').first().click();
    await openStep(page, 'export-section');
    await page.locator('#add-cart').click();
    await expect(box).not.toHaveClass(/reorder/);
    await expect(box.locator('#cart-add-title')).toHaveText('Ajouter au panier');
  });

  test('partager une œuvre : un lien ; la personne qui l’ouvre crée son compte et reçoit sa propre copie, à modifier ; l’original ne change pas ; le lien se désactive', async ({ acc }) => {
    test.setTimeout(240000);
    const { page } = acc;
    const workId = await workInAccount(page, 'auteur@example.org', 'Camille');
    const share = async () => {
      await page.evaluate(() => AtelierGribouille.renderSaved());
      await page.waitForFunction(() => document.querySelector('.saved.current .saved-share'));
      await page.evaluate(() => document.querySelector('.saved.current .saved-share').click());
      await expect(page.locator('#share-modal .share-link')).toBeVisible({ timeout: 60000 });
      return page.locator('#share-url').inputValue();
    };
    const url1 = await share();
    expect(url1).toMatch(/\?partage=[A-Za-z0-9_-]{16,64}$/);
    await expect(page.locator('#share-modal .share-expires')).toContainText('pour autant de personnes que vous voulez');
    const tokenOf = (u) => new URL(u).searchParams.get('partage');
    expect(await page.evaluate((id) => window.__fake.db.rows.find((r) => r.id === id).meta.share.token, workId)).toBe(tokenOf(url1));
    // partager de nouveau : le même lien ; désactivé (en deux temps), il disparaît ; un nouveau ensuite
    await page.locator('#share-modal [data-close]').click();
    expect(await share()).toBe(url1);
    await page.locator('#share-revoke').click();
    await page.locator('#share-revoke').click();
    await expect(page.locator('#share-modal .share-status')).toContainText('Lien désactivé');
    expect(await page.evaluate((id) => !!window.__fake.db.rows.find((r) => r.id === id).meta.share, workId)).toBe(false);
    await page.locator('#share-modal [data-close]').click();
    const url = await share();
    expect(url).not.toBe(url1);
    await page.locator('#share-modal [data-close]').click();
    const before = await page.evaluate((id) => JSON.stringify(window.__fake.db.rows.find((r) => r.id === id).meta.drawings), workId);
    await page.locator('#acc-menu').click();
    await page.locator('#acc-signout').click();
    // l'ancien lien ne mène plus à rien
    await page.goto(url1);
    await expect(page.locator('#share-receive .share-status')).toContainText('n’est plus valable', { timeout: 60000 });
    await expect(page.locator('#share-receive-ok')).toBeHidden();
    await expect(page.locator('#share-receive .share-progress')).toBeHidden(); // la barre d'attente s'en va avec l'erreur
    await expect(page.locator('#share-receive .share-progress.waiting .cart-progress-bar')).toHaveCount(1); // (elle accompagne la lecture du lien)
    // le lien : l'œuvre, qui la partage ; « Recevoir » demande un compte
    await page.goto(url);
    const rec = page.locator('#share-receive');
    await expect(rec).toBeVisible({ timeout: 60000 });
    await expect(rec.locator('.share-receive-text')).toHaveText('Camille vous partage cette œuvre.');
    expect(page.url()).not.toContain('partage=');
    await rec.locator('#share-receive-ok').click();
    await page.locator('.auth-tabs [data-mode="signup"]').click();
    await page.fill('#auth-name', 'Lou');
    await page.fill('#auth-email', 'lou@example.org');
    await page.fill('#auth-password', 'Rouge-Soleil-42');
    await page.locator('#auth-submit').click();
    // reçue : une copie à Lou, ses fichiers dans son dossier, ouverte dans l'atelier comme son œuvre
    const token = tokenOf(url);
    await expect.poll(() => page.evaluate((t) => window.__fake.db.rows.filter((r) => r.meta && r.meta.sharedFrom === t).length, token), { timeout: 60000 }).toBe(1);
    const copy = await page.evaluate((t) => { const r = window.__fake.db.rows.find((x) => x.meta && x.meta.sharedFrom === t); const files = r.meta.drawings.map((d) => d.file); return { id: r.id, uid: r.user_id, me: window.Account.user().id, files, present: files.every((f) => !!window.__fake.db.files[f]), mine: files.every((f) => f.startsWith(`${r.user_id}/${r.id}/`)), share: !!r.meta.share }; }, token);
    expect(copy.uid).toBe(copy.me);
    expect(copy.present).toBe(true);
    expect(copy.mine).toBe(true);
    expect(copy.share).toBe(false);
    await page.waitForFunction((id) => AtelierGribouille.state.workId === id && AtelierGribouille.state.drawings.length >= 2 && !AtelierGribouille.state.copyOf, copy.id, { timeout: 120000 });
    // l'original n'a pas changé
    expect(await page.evaluate((id) => JSON.stringify(window.__fake.db.rows.find((r) => r.id === id).meta.drawings), workId)).toBe(before);
    // le lien rouvert : la même copie, pas une deuxième
    await page.goto(url);
    await expect(rec.locator('#share-receive-ok')).toBeEnabled({ timeout: 60000 });
    await rec.locator('#share-receive-ok').click();
    await page.waitForFunction((id) => AtelierGribouille.state.workId === id, copy.id, { timeout: 120000 });
    expect(await page.evaluate((t) => window.__fake.db.rows.filter((r) => r.meta && r.meta.sharedFrom === t).length, token)).toBe(1);
  });

  test('la même œuvre ajoutée deux fois au panier avec les mêmes options : un seul article, quantité 2, un seul envoi ; autre taille : un autre article', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    await workInAccount(page, 'deuxfois@example.org', 'Deux');
    const add = async () => {
      await page.locator('#add-cart').click();
      await page.locator('#cart-add [data-finish="papier"]').click();
      await page.locator('#cart-add-ok').click();
      await expect(page.locator('#cart-add')).toBeHidden();
    };
    await add();
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length), { timeout: 60000 }).toBe(1);
    await page.locator('#cart [data-close]').first().click();
    await add();
    await expect(page.locator('#cart .cart-status')).toContainText('déjà dans votre panier : quantité 2');
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await expect(page.locator('#cart .cart-qty output')).toHaveText('2');
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).map((r) => r.meta.cart.qty)), { timeout: 30000 }).toEqual([2]);
    // une autre taille : un autre article
    await page.locator('#cart [data-close]').first().click();
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="papier"]').click();
    await page.locator('#cart-add .cart-sizes button:not([hidden]):not(.on)').first().click();
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(2);
  });

  test('Mes commandes : une page du site, hors de l’atelier ; ?commandes y mène ; sans commande, « Aucune commande pour l’instant »', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'sanscommande@example.org', 'Rouge-Soleil-42', 'Sans');
    // plus de liste dans l'atelier ; Mon compte a un lien vers la page
    await expect(page.locator('#orders-box')).toHaveCount(0);
    await page.locator('#acc-menu').click();
    await expect(page.locator('#profile-box .acc-orders-link')).toHaveAttribute('href', '../commandes.html');
    // l'ancien lien (?commandes) mène à la page du site
    await page.goto('index.html?commandes');
    await page.waitForURL(/\/commandes\.html/, { timeout: 30000 });
    await expect(page.locator('#o-empty')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#o-empty')).toContainText('Aucune commande pour l’instant');
    await expect(page.locator('#o-signin')).toBeHidden();
  });

  test('une œuvre que le serveur a déjà dans un autre compte (trace perdue sur l’appareil) : pas d’erreur technique, la ligne dit « dans un autre compte »', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    await signUpAndIn(page, 'premier@example.org', 'Rouge-Soleil-42', 'Premier');
    await page.setInputFiles('#file', ['page-cutout.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 1);
    await page.evaluate(() => AtelierGribouille.syncCloud());
    const id = await page.evaluate(() => AtelierGribouille.state.workId);
    await page.waitForFunction((id) => window.__fake.db.rows.some((r) => r.id === id), id);
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    // (la trace du premier compte sur l'appareil a disparu)
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('atelier.oeuvres-vues:')).forEach((k) => localStorage.removeItem(k)));
    await signUpAndIn(page, 'second@example.org', 'Rouge-Soleil-42', 'Second');
    await page.evaluate(() => AtelierGribouille.syncCloud());
    await expect(page.locator('#cloud-sync-status')).toContainText('dans un autre compte', { timeout: 30000 });
    await expect(page.locator('#cloud-sync-status')).not.toContainText('duplicate');
    // la ligne du premier compte est intacte, et les fichiers envoyés pour rien sont retirés
    const uid = await page.evaluate(() => window.Account.user().id);
    expect(await page.evaluate(({ id, uid }) => Object.keys(window.__fake.db.files).filter((p) => p.startsWith(`${uid}/${id}/`)).length, { id, uid })).toBe(0);
    expect(await page.evaluate((id) => window.__fake.db.rows.filter((r) => r.id === id).length, id)).toBe(1);
  });

  test('page Mes commandes : la liste (visuels encadrés, statut, total), le détail dans une fenêtre (frise, œuvres, livraison, suivi) ; le lien #REF l’ouvre ; sans session, la connexion', async ({ acc }) => {
    const { page } = acc;
    // sans session : la page propose de se connecter
    await page.goto('commandes.html');
    await expect(page.locator('#o-signin')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#o-list .o-item')).toHaveCount(0);
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.enabled);
    await signUpAndIn(page, 'suivi@example.org', 'Rouge-Soleil-42', 'Suivi');
    // deux commandes, leurs œuvres (vignettes) dans le compte
    await page.evaluate(() => {
      const uid = window.Account.user().id, now = new Date().toISOString();
      const c = document.createElement('canvas'); c.width = 140; c.height = 100; const x = c.getContext('2d'); x.fillStyle = '#c44'; x.fillRect(0, 0, 140, 100);
      const thumb = c.toDataURL('image/jpeg', 0.8);
      const A = 'aaaaaaaa-1111-4111-8111-111111111111', B = 'bbbbbbbb-2222-4222-8222-222222222222';
      [A, B].forEach((id) => window.__fake.db.rows.push({ id, user_id: uid, name: 'x', thumb, created_at: now, meta: { ordered: true } }));
      window.__fake.db.rows.push({ __table: 'orders', id: '11111111-1111-1111-1111-111111111111', user_id: uid, ref: 'AG-261125-OLD1', status: 'expediee', carrier: 'Colissimo', tracking: '6A12345678901', created_at: '2026-11-20T10:00:00Z', paid_at: '2026-11-20T10:00:00Z', subtotal_cents: 12900, shipping_cents: 2490, total_cents: 15390, delivery: 'domicile',
        shipping: { name: 'Camille Martin', address: { line1: '3 rue des Lilas', postal_code: '75011', city: 'Paris', country: 'FR' } },
        items: [{ compId: A, product: 'print', finish: 'cadre', size: '50x70', frame: 'bois-noir', mat: true, W: 70, H: 50, title: 'Le grand voyage', label: 'Tableau encadré 70 × 50 cm, cadre bois noir, avec passe-partout', qty: 1, unit: 129 }] });
      window.__fake.db.rows.push({ __table: 'orders', id: '22222222-2222-2222-2222-222222222222', user_id: uid, ref: 'AG-261125-NEW2', status: 'payee', created_at: now, paid_at: now, subtotal_cents: 3900, shipping_cents: 990, total_cents: 4890, delivery: 'domicile',
        items: [{ compId: B, product: 'print', finish: 'papier', size: '21x30', margin: true, W: 30, H: 21, title: 'Courtepointe', label: 'Affiche 30 × 21 cm, bordure blanche', qty: 1, unit: 39 }] });
      window.__fake.db.rows.push({ __table: 'orders', id: '33333333-3333-3333-3333-333333333333', user_id: uid, ref: 'AG-261125-GONE', status: 'abandonnee', created_at: now, total_cents: 100, items: [] });
      localStorage.setItem('fake.rows', JSON.stringify(window.__fake.db.rows));
    });
    // le lien des e-mails : commandes.html#REF ouvre cette commande
    await page.goto('commandes.html#AG-261125-OLD1');
    const detail = page.locator('#o-detail');
    await expect(detail).toBeVisible({ timeout: 30000 });
    await expect(detail.locator('#od-title')).toHaveText('AG-261125-OLD1');
    // la frise : confirmée, en préparation, expédiée (en cours), livrée
    await expect(detail.locator('.od-steps li')).toHaveCount(4);
    await expect(detail.locator('.od-steps li.done')).toHaveCount(3);
    await expect(detail.locator('.od-steps li.now')).toHaveText('Expédiée');
    // l'œuvre dans son cadre noir (paysage), le prix, la livraison, l'adresse, le suivi (lien La Poste)
    const vis = detail.locator('.od-items .o-vis');
    await expect(vis).toHaveCount(1);
    expect(await vis.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(38, 36, 34)');
    const box = await vis.boundingBox();
    expect(box.width).toBeGreaterThan(box.height);
    await expect(detail.locator('.od-items')).toContainText('129,00');
    await expect(detail.locator('.od-sum .total')).toContainText('153,90');
    await expect(detail).toContainText('3 rue des Lilas');
    await expect(detail.locator('.od-track a')).toHaveAttribute('href', /laposte\.fr.*6A12345678901/);
    await expect(detail.locator('.od-cancel')).toHaveCount(0); // (expédiée : plus annulable en ligne)
    // recommander le tableau : un lien vers l'atelier, l'article commandé déjà choisi
    const again = detail.locator('.od-items .od-again');
    await expect(again).toHaveText('Recommander');
    expect(await again.getAttribute('href')).toBe('atelier/?recommander=aaaaaaaa-1111-4111-8111-111111111111&taille=50x70&finition=cadre&cadre=bois-noir&pp=1&bord=0');
    if (process.env.CAP_OUT) await page.screenshot({ path: `${process.env.CAP_OUT}/commandes-detail.png` });
    await detail.locator('#od-close').click();
    await expect(detail).toBeHidden();
    expect(page.url()).not.toContain('#');
    // la liste : la plus récente d'abord, sans la commande abandonnée ; statut, total, visuels
    const items = page.locator('#o-list .o-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('AG-261125-NEW2');
    await expect(items.nth(0).locator('.o-pill')).toHaveText('Payée');
    await expect(items.nth(0)).toContainText('48,90');
    await expect(items.nth(1).locator('.o-pill')).toHaveText('Expédiée');
    // sur la commande expédiée, le suivi : le transporteur, le numéro et le lien pour suivre le colis
    const track = page.locator('#o-list .o-card').nth(1).locator('.o-track');
    await expect(track).toContainText('Colissimo 6A12345678901');
    await expect(track.locator('a')).toHaveText('Suivre le colis ›');
    await expect(track.locator('a')).toHaveAttribute('href', /laposte\.fr.*6A12345678901/);
    await expect(track.locator('a')).toHaveAttribute('target', '_blank');
    await expect(page.locator('#o-list .o-card').nth(0).locator('.o-track')).toHaveCount(0); // (payée : pas encore de suivi)
    await expect(page.locator('#o-list .o-vis')).toHaveCount(2);
    if (process.env.CAP_OUT) await page.screenshot({ path: `${process.env.CAP_OUT}/commandes-liste.png` });
    // téléphone : la fenêtre monte du bas, sur toute la largeur ; rien ne déborde
    await page.setViewportSize({ width: 390, height: 844 });
    await items.nth(0).click();
    await expect(detail).toBeVisible();
    const sheet = await detail.locator('.o-sheet').boundingBox();
    expect(sheet.width).toBeGreaterThan(385);
    expect(Math.abs(sheet.y + sheet.height - 844)).toBeLessThan(4);
    await expect(detail.locator('.od-cancel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.CAP_OUT) await page.screenshot({ path: `${process.env.CAP_OUT}/commandes-detail-telephone.png` });
    await detail.locator('#od-close').click();
    if (process.env.CAP_OUT) await page.screenshot({ path: `${process.env.CAP_OUT}/commandes-liste-telephone.png`, fullPage: true });
  });

  test('paiement en ligne (essai, ?paiement=test) : livraison au panier, page de paiement, retour, Mes commandes ; une erreur du serveur est dite', async ({ acc }) => {
    test.setTimeout(180000);
    const { page } = acc;
    await page.goto('index.html?paiement=test');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.enabled);
    await signUpAndIn(page, 'paye@example.org', 'Rouge-Soleil-42', 'Paye');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => AtelierGribouille.setMode('impression'));
    await openStep(page, 'export-section');
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="papier"]').click();
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart-add')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length), { timeout: 60000 }).toBe(1);
    // (le panier s'ouvre de lui-même après l'ajout)
    if (!(await page.locator('#cart').isVisible())) await page.locator('.cart-btn-desk').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    // la livraison à domicile est comptée dans le total ; le paiement passe par Stripe
    await expect(page.locator('#cart .cart-ship')).toBeVisible();
    await expect(page.locator('#cart .cart-ship b')).toHaveText(/^(9,90|11,90)\s€$/);
    await expect(page.locator('#cart .cart-note')).toContainText('Stripe');
    // le serveur refuse : la raison est dite, rien n'est perdu
    await page.evaluate(() => { window.__fake.fns = { commande: () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'paiement non configuré' }) } } }) }; });
    await page.locator('#cart-order').click();
    await expect(page.locator('#cart .cart-status')).toContainText('paiement non configuré', { timeout: 30000 });
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    // le service ne répond pas (réseau, fonction absente) : un message clair
    await page.evaluate(() => { window.__fake.fns = { commande: () => ({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: {} } }) }; });
    await page.locator('#cart-order').click();
    await expect(page.locator('#cart .cart-status')).toContainText('le service de paiement ne répond pas', { timeout: 30000 });
    // payé : retour sur la page « Mes commandes » du site (?commande=…), merci, panier vidé, la commande
    await page.evaluate(() => { window.__fake.fns = {}; });
    await page.locator('#cart-consent').check();
    await page.locator('#cart-order').click();
    await page.waitForURL(/commandes\.html\?commande=AG-/, { timeout: 30000 });
    await expect(page.locator('#o-status')).toContainText('Merci', { timeout: 30000 });
    const item = page.locator('#o-list .o-item');
    await expect(item).toHaveCount(1, { timeout: 30000 });
    await expect(item).toContainText('AG-261125-T1');
    await expect(item.locator('.o-pill')).toHaveText('Payée');
    // le visuel de l'article : l'œuvre commandée, sur sa feuille (une affiche), à ses proportions
    await expect(item.locator('.o-vis img')).toHaveCount(1);
    expect(await item.locator('.o-vis img').evaluate((img) => img.src.startsWith('data:image/') && img.complete && Math.abs(img.width / img.height - img.naturalWidth / img.naturalHeight) < 0.05)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.cart).length), { timeout: 30000 }).toBe(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('atelier-gribouille:panier') || '[]').length), { timeout: 30000 }).toBe(0);
    // (l'adresse oublie le retour de paiement)
    await expect.poll(() => page.url(), { timeout: 60000 }).not.toContain('commande=');
    // le détail, dans une fenêtre ; tant qu'elle est « payée », le client l'annule (deux touches) : remboursée
    await item.click();
    const detail = page.locator('#o-detail');
    await expect(detail).toBeVisible();
    await expect(detail.locator('#od-title')).toHaveText('AG-261125-T1');
    await expect(detail.locator('.od-steps li.now')).toHaveText('Confirmée');
    await expect(detail.locator('.od-items li')).toHaveCount(1);
    const cancel = detail.locator('.od-cancel');
    await expect(cancel).toHaveText('Annuler la commande');
    await cancel.click();
    await expect(cancel).toContainText('remboursement de');
    await cancel.click();
    await expect(page.locator('#o-status')).toContainText('annulée', { timeout: 30000 });
    await expect(detail.locator('.od-cancelled')).toBeVisible();
    await expect(detail.locator('.od-cancel')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await expect(item.locator('.o-pill')).toHaveText('Annulée');
    expect(await page.evaluate(() => window.__fake.db.rows.find((r) => r.__table === 'orders').status)).toBe('annulee');
    // (l'adresse oublie le retour de paiement)
    expect(page.url()).not.toContain('commande=');
    const order = await page.evaluate(() => window.__fake.db.rows.find((r) => r.__table === 'orders'));
    expect(order.consent).toBe(true);
    // l'œuvre commandée est dans Mes œuvres, marquée « commandée »
    expect(await page.evaluate(() => window.__fake.db.rows.filter((r) => r.meta && r.meta.ordered).length)).toBe(1);
  });

  test('venu de l’en-tête du site : ?connexion ouvre le panneau de connexion ; ?compte, connecté, le profil', async ({ acc }) => {
    const { page } = acc;
    await page.goto('index.html?connexion');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.enabled);
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#auth-form')).toBeVisible();
    await page.locator('#acc-close').click();
    await expect(page.locator('#account-section')).toBeHidden();
    await signUpAndIn(page, 'tete@example.org', 'Rouge-Soleil-42', 'Tête');
    await page.goto('index.html?compte');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && Account.user());
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#profile-box')).toBeVisible();
    await expect(page.locator('#profile-title')).toContainText('Tête');
    // l'adresse l'oublie : actualiser ne rouvre pas le compte
    await expect.poll(() => page.evaluate(() => location.search)).not.toMatch(/compte/);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && Account.user());
    await page.waitForTimeout(800);
    await expect(page.locator('#account-section')).toBeHidden();
    // téléphone : le tiroir s'ouvre sur l'onglet Compte (connecté : pas de panneau par-dessus)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('index.html?compte');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && Account.user());
    await expect(page.locator('body')).not.toHaveClass(/stage-full/);
    await expect.poll(() => page.evaluate(() => document.querySelector('.panel').dataset.tab)).toBe('more');
    await expect(page.locator('#acc-menu')).toBeVisible();
    await expect(page.locator('#account-section')).toBeHidden();
    // pas connecté : l'onglet Compte, et le panneau de connexion par-dessus
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await expect(page.locator('#acc-open')).toBeVisible();
    await page.goto('index.html?connexion');
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && window.Account.enabled);
    await expect.poll(() => page.evaluate(() => document.querySelector('.panel').dataset.tab)).toBe('more');
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#auth-form')).toBeVisible();
  });

  test('se déconnecter pendant que l’atelier relit le compte : aucune erreur', async ({ acc }) => {
    const { page, errors } = acc;
    await signUpAndIn(page, 'deco@example.org', 'Rouge-Soleil-42', 'Déco');
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page, 1);
    // la relecture du compte commence (elle attend la liste, puis la base locale), et l'on se déconnecte
    // pendant ces attentes : plusieurs délais, pour tomber au milieu
    for (const ms of [0, 2, 5, 10, 20, 40, 80]) {
      await page.evaluate((ms) => new Promise((res) => { AtelierGribouille.checkWorks(); setTimeout(() => Account.signOut().then(res, res), ms); }), ms);
      await page.waitForTimeout(400);
      await page.evaluate(() => Account.signInEmail('deco@example.org', 'Rouge-Soleil-42'));
      await page.waitForFunction(() => Account.user());
    }
    await page.evaluate(() => Account.signOut());
    await expect(page.locator('#acc-open')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('#fatal')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('découpe : la même partout, la découpe standard ; les réglages appris autrefois (navigateur, compte) sont ignorés', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'decoupe@example.org', 'Rouge-Soleil-42', 'Découpe');
    // des réglages appris autrefois : dans le compte (métadonnées) et dans ce navigateur
    await page.evaluate(() => Account.updateProfile({ decoupe: { prefs: Object.assign({}, Extract.CUT_DEFAULT, { margin: 0.009, close: 0.02 }), at: Date.now() } }));
    await page.evaluate(() => { localStorage.setItem('atelier.decoupe', JSON.stringify(Object.assign({}, Extract.CUT_DEFAULT, { margin: 0.009 }))); localStorage.setItem('atelier.decoupe-date', '1'); localStorage.setItem('atelier.decoupe-locale', '1'); });
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && window.Account && Account.user());
    await page.waitForTimeout(800);
    // la découpe standard, et rien de gardé dans le navigateur
    expect(await page.evaluate(() => Extract.cutIsDefault())).toBe(true);
    expect(await page.evaluate(() => ['atelier.decoupe', 'atelier.decoupe-date', 'atelier.decoupe-locale'].map((k) => localStorage.getItem(k)))).toEqual([null, null, null]);
    // plus d'avis ni de réglages de découpe dans l'atelier
    for (const id of ['#cut-remote', '#cut-sync', '#cut-learned']) await expect(page.locator(id)).toHaveCount(0);
    // un import se découpe avec la marge standard
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].cutPrefs.margin)).toBe(await page.evaluate(() => Extract.CUT_DEFAULT.margin));
  });
});
