const fs = require('fs');
const path = require('path');
const { test: base, expect, fixture } = require('./helpers');

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

  test('exporter ou sauvegarder demande d’être connecté, puis l’action reprend', async ({ acc }) => {
    const { page } = acc;
    await page.setInputFiles('#file', ['page-cutout.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // déconnecté : le bouton de téléchargement ouvre la fenêtre de compte avec une explication
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
    await expect(page.locator('#exports-box')).toBeVisible();
    await expect(page.locator('#exports-list .saved')).toHaveCount(1);
    await expect(page.locator('#exports-list .saved-meta')).toContainText('JPEG');
    // sauvegarder sans être connecté : même mécanisme
    await page.locator('#acc-menu').click(); await page.locator('#acc-signout').click();
    await page.locator('#save-comp').click();
    await expect(page.locator('#acc-status')).toContainText('sauvegarder votre composition');
    await page.locator('#acc-close').click();
  });

  test('compositions dans le compte : sauvegarde, liste, réouverture, suppression', async ({ acc }) => {
    const { page } = acc;
    await signUpAndIn(page, 'lou@example.org', 'Rouge-Soleil-42', 'Lou');
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 3 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.locator('#save-comp').click();
    await page.fill('#save-name', 'Dans le cloud');
    await page.locator('#save-form button[type=submit]').click();
    await expect(page.locator('#save-status')).toContainText('dans votre compte', { timeout: 60000 });
    // une seule entrée, celle du compte (plus de copie locale quand les comptes sont actifs)
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await expect(page.locator('#saved-list .saved-where')).toContainText('mon compte');
    const uploads = await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload').length);
    expect(uploads).toBe(3);
    const before = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { n: c.items.length, x: c.items[0].x }; });
    // sur un autre appareil (page rechargée, rien en local), la composition du compte se rouvre
    await page.reload();
    await page.waitForFunction(() => window.Account && window.Account.user() && document.querySelectorAll('#saved-list .saved').length === 1);
    await page.locator('#saved-list .saved').first().click();
    // (l'œuvre en cours se rouvre d'abord d'elle-même : on attend la composition demandée, par son nom)
    await expect(page.locator('#saved-status')).toContainText('« Dans le cloud » rouverte', { timeout: 120000 });
    const after = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { n: c.items.length, x: c.items[0].x }; });
    expect(after.n).toBe(before.n);
    expect(after.x).toBeCloseTo(before.x, 3);
    // suppression en deux temps : ligne et fichiers effacés
    await page.locator('#saved-list .saved-del').first().click();
    await page.locator('#saved-list .saved-del').first().click();
    await expect(page.locator('#saved-list .saved')).toHaveCount(0);
    const left = await page.evaluate(() => ({ rows: window.__fake.db.rows.length, files: Object.keys(window.__fake.db.files).length }));
    expect(left).toEqual({ rows: 0, files: 0 });
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

  test('commander depuis le panier : connexion demandée, puis compositions enregistrées dans le compte', async ({ acc }) => {
    const { page } = acc;
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.locator('#add-cart').click();
    await page.locator('#cart-add [data-finish="toile"]').click();
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
    const uploads = await page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'upload').length);
    expect(uploads).toBe(2); // les deux dessins de la composition commandée
    const orders = await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-gribouille:commandes') || '[]'));
    expect(orders).toHaveLength(1);
    await page.locator('#cart [data-close]').first().click();
    // la composition commandée est dans le compte, sous la référence de la commande
    await page.evaluate(() => document.querySelector('#saved-section > h2') && document.querySelector('#saved-section').classList.contains('collapsed') && document.querySelector('#saved-section > h2').click());
    await expect(page.locator('#saved-list .saved')).toHaveCount(1, { timeout: 30000 });
    await expect(page.locator('#saved-list .saved').first()).toContainText(orders[0].ref);
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
