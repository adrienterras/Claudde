// Page d'accueil (landing/), servie telle qu'en ligne : une image dont le chargement échoue (réseau
// faible sur téléphone) est redemandée et finit par s'afficher.
const { test, expect } = require('@playwright/test');
const path = require('path');

const LANDING = path.join(__dirname, '..', '..', 'landing');

test('accueil : une image qui n’a pas pu se charger est redemandée', async ({ page }) => {
  let fails = 2; // les deux premières demandes de l'image Frise échouent
  const asked = [];
  await page.route('http://accueil.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/img/oeuvre-frise.jpg') { asked.push(url.search); if (fails-- > 0) return route.abort('connectionreset'); }
    if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: path.join(LANDING, url.pathname === '/' ? 'index.html' : url.pathname) });
  });
  await page.goto('http://accueil.test/');
  const frise = page.locator('img[src*="oeuvre-frise"]');
  await frise.scrollIntoViewIfNeeded();
  await expect.poll(() => frise.evaluate((i) => i.naturalWidth), { timeout: 15000 }).toBe(900);
  expect(asked.length).toBe(3);
  expect(asked.slice(1)).toEqual(['?r=1', '?r=2']);
});

// L'en-tête porte le compte : toujours une pastille ronde et entourée, l'icône de profil sans session ;
// la photo du compte (ou son initiale), sans le prénom, quand l'atelier (même origine) a une session
// Supabase dans le stockage local (compte.js).
test('accueil : la pastille du compte, ronde, l’icône sans session, la photo ou l’initiale avec', async ({ browser }) => {
  const serve = async (page) => page.route('http://accueil.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: path.join(LANDING, url.pathname === '/' ? 'index.html' : url.pathname) });
  });
  const round = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderTopLeftRadius, border: cs.borderTopStyle }; });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await serve(page);
  await page.goto('http://accueil.test/');
  const acc = page.locator('a.nav-account');
  await expect(acc).toBeVisible();
  await expect(acc).toHaveAttribute('aria-label', 'Se connecter');
  await expect(acc.locator('svg')).toBeVisible();
  await expect(acc.locator('span')).toHaveText('Se connecter'); // (pour les lecteurs d'écran ; invisible)
  expect(await acc.locator('span').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  expect(await round(acc)).toEqual({ w: 38, h: 38, radius: '50%', border: 'solid' });
  // tout l'en-tête tient sur un téléphone, sans défilement horizontal
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // en anglais : traduit avec le reste
  await page.goto('http://accueil.test/?lang=en');
  await expect(page.locator('a.nav-account')).toHaveAttribute('aria-label', 'Sign in');
  await ctx.close();
  // une session de l'atelier : l'initiale dans la pastille, sans le prénom
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  await serve(page2);
  await page2.addInitScript(() => {
    localStorage.setItem('atelier-gribouille:lang', 'fr');
    localStorage.setItem('sb-fakeproj-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: 'lou@example.org', user_metadata: { name: 'Lou' } } }));
  });
  await page2.goto('http://accueil.test/');
  const acc2 = page2.locator('a.nav-account');
  await expect(acc2).toHaveClass(/on/);
  await expect(acc2).toHaveAttribute('aria-label', 'Mon compte');
  await expect(acc2.locator('.acc-avatar')).toHaveText('L');
  await expect(acc2.locator('.acc-avatar')).toBeVisible();
  await expect(acc2.locator('svg')).toBeHidden();
  expect(await acc2.locator('span').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(1); // (pas de prénom visible)
  expect(await round(acc2)).toEqual({ w: 38, h: 38, radius: '50%', border: 'solid' });
  // la pastille ouvre un menu : « Mon compte » (l'atelier, panneau du compte) et « Se déconnecter »
  await acc2.click();
  const pop = page2.locator('.acc-pop');
  await expect(pop).toBeVisible();
  await expect(pop.locator('[role="menuitem"]')).toHaveText(['Mon compte', 'Mon panier', 'Se déconnecter']);
  expect(await pop.locator('a').first().getAttribute('href')).toBe('atelier/?compte');
  // « Mon panier » : l'icône du chariot, pas de nombre sans article ; ouvre le panier dans l'atelier
  const cart = pop.locator('a.cart');
  expect(await cart.getAttribute('href')).toBe('atelier/?panier');
  await expect(cart.locator('svg')).toBeVisible();
  await expect(cart.locator('.cart-count')).toHaveCount(0);
  await page2.keyboard.press('Escape');
  // deux articles (quantités 2 et 1) dans le panier de l'atelier : « 3 »
  await page2.evaluate(() => localStorage.setItem('atelier-gribouille:panier', JSON.stringify([{ qty: 2 }, { qty: 1 }])));
  await acc2.click();
  await expect(pop.locator('a.cart .cart-count')).toHaveText('3');
  await expect(pop.locator('a.cart')).toHaveAttribute('aria-label', 'Mon panier : 3 article(s)');
  expect(page2.url()).toBe('http://accueil.test/');
  await page2.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await ctx2.close();
  // avec une photo de compte (Google) : la photo, sans initiale ; l'en-tête tient sur un téléphone
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page3 = await ctx3.newPage();
  await serve(page3);
  await page3.addInitScript(() => {
    localStorage.setItem('atelier-gribouille:lang', 'fr');
    if (!localStorage.getItem('sb-fakeproj-auth-token')) localStorage.setItem('sb-fakeproj-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: 'lou@example.org', user_metadata: { name: 'Lou', avatar_url: 'https://lh3.googleusercontent.com/a/photo-de-lou=s96-c' } } }));
  });
  await page3.goto('http://accueil.test/');
  const av = page3.locator('a.nav-account .acc-avatar');
  await expect(av).toHaveText('');
  expect(await av.evaluate((e) => e.style.backgroundImage)).toContain('lh3.googleusercontent.com/a/photo-de-lou');
  // une adresse d'image qui n'est pas une photo de compte Google : refusée, l'initiale à la place
  await page3.evaluate(() => { const k = 'sb-fakeproj-auth-token'; const s = JSON.parse(localStorage.getItem(k)); s.user.user_metadata.avatar_url = 'https://evil.example/x.png"); background: red; ("'; localStorage.setItem(k, JSON.stringify(s)); });
  await page3.reload();
  await expect(page3.locator('a.nav-account .acc-avatar')).toHaveText('L');
  expect(await page3.locator('a.nav-account .acc-avatar').evaluate((e) => e.style.backgroundImage)).toBe('');
  expect(await page3.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx3.close();
});

// Se connecter ou créer un compte depuis les pages du site : la fenêtre s'ouvre sur la page même, on y
// reste (faux service des comptes, vrai module de l'atelier, chargé au besoin).
test('site : connexion et création de compte sans quitter la page ; menu du compte ; déconnexion', async ({ browser }) => {
  const FAKE = require('fs').readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
  const COLLAGE = path.join(__dirname, '..');
  for (const f of ['index.html', 'tarifs.html']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const loaded = [];
    await page.route('http://accueil.test/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/atelier/')) loaded.push(url.pathname);
      if (url.pathname === '/atelier/vendor/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: FAKE });
      if (url.pathname === '/atelier/config.js') return route.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'anon' };" });
      if (url.pathname === '/atelier/js/account.js') return route.fulfill({ path: path.join(COLLAGE, 'js', 'account.js') });
      if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: path.join(LANDING, url.pathname === '/' ? 'index.html' : url.pathname.slice(1)) });
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('atelier-gribouille:lang', 'fr'));
    const home = `http://accueil.test/${f === 'index.html' ? '' : f}`;
    await page.goto(home);
    // rien de chargé à l'arrivée : le service des comptes ne vient qu'au besoin
    expect(loaded.filter((p) => /supabase|account/.test(p))).toEqual([]);
    await page.locator('a.nav-account').click();
    const modal = page.locator('#acc-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h2')).toHaveText('Bienvenue à l’atelier');
    expect(page.url(), f).toBe(home);
    // créer un compte : mot de passe trop faible refusé, puis accepté ; on reste sur la page, connecté
    await modal.locator('[data-mode="signup"]').click();
    await page.fill('#accm-name', 'Camille');
    await page.fill('#accm-email', 'camille@example.org');
    await page.fill('#accm-password', 'faible');
    await page.locator('#accm-submit').click();
    await expect(modal.locator('.status')).toContainText('Mot de passe trop faible');
    await page.fill('#accm-password', 'Rouge-Soleil-42');
    await page.locator('#accm-submit').click();
    await expect(modal).toBeHidden();
    expect(page.url(), f).toBe(home);
    const acc = page.locator('a.nav-account');
    await expect(acc).toHaveClass(/on/);
    await expect(acc.locator('.acc-avatar')).toHaveText('C');
    // le menu : se déconnecter, sur la page
    await acc.click();
    await page.locator('.acc-pop button').click();
    await expect(acc).not.toHaveClass(/on/);
    await expect(acc).toHaveAttribute('aria-label', 'Se connecter');
    // se connecter : mauvais mot de passe, puis le bon
    await acc.click();
    await expect(modal).toBeVisible();
    await modal.locator('[data-mode="signin"]').click();
    await page.fill('#accm-email', 'camille@example.org');
    await page.fill('#accm-password', 'Mauvais-Mot-42');
    await page.locator('#accm-submit').click();
    await expect(modal.locator('.status')).toHaveText('E-mail ou mot de passe incorrect.');
    await page.fill('#accm-password', 'Rouge-Soleil-42');
    await page.locator('#accm-submit').click();
    await expect(modal).toBeHidden();
    await expect(acc.locator('.acc-avatar')).toHaveText('C');
    expect(page.url(), f).toBe(home);
    // Google : la connexion déléguée revient sur cette page-ci
    await acc.click();
    await page.locator('.acc-pop button').click();
    await acc.click();
    await modal.locator('.google').click();
    await expect.poll(() => page.evaluate(() => window.__fake.calls.filter((c) => c[0] === 'oauth').length)).toBe(1);
    expect(await page.evaluate(() => window.__fake.calls.find((c) => c[0] === 'oauth')[2])).toBe(`http://accueil.test/${f === 'index.html' ? '' : f}`);
    // mot de passe oublié : le lien ramène dans l'atelier, qui a le formulaire
    await page.fill('#accm-email', 'camille@example.org');
    await page.locator('#accm-forgot').click();
    await expect(modal.locator('.status')).toContainText('nouveau mot de passe');
    // Échap ferme la fenêtre
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // en anglais
    await page.goto(`${home}?lang=en`);
    await page.locator('a.nav-account').click();
    await expect(page.locator('#acc-modal h2')).toHaveText('Welcome to the studio');
    await expect(page.locator('#accm-submit')).toHaveText('Sign in');
    expect(errors).toEqual([]);
    await ctx.close();
  }
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 } };
// Le choix de langue flotte en bas à droite de l'accueil et de la page Tarifs, sur téléphone comme sur ordinateur, et
// reste en place quand on défile ; il traduit la page.
test('accueil et Tarifs : le choix de langue flotte en bas à droite, sur téléphone et sur ordinateur', async ({ browser }) => {
  for (const [page0, opts] of [['index.html', PHONE], ['index.html', DESK], ['tarifs.html', PHONE], ['tarifs.html', DESK], ['idees-dessins-enfants.html', PHONE], ['photographier-les-dessins.html', DESK]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.route('http://accueil.test/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: path.join(LANDING, url.pathname === '/' ? page0 : url.pathname) });
    });
    await page.addInitScript(() => localStorage.setItem('atelier-gribouille:lang', 'fr'));
    await page.goto('http://accueil.test/');
    const sw = page.locator('.lang-float');
    await expect(sw).toBeVisible();
    await expect(page.locator('header .lang-switch')).toHaveCount(0);
    const where = () => sw.evaluate((e) => { const r = e.getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom) }; });
    expect(await where()).toEqual({ right: 16, bottom: 16 });
    await page.evaluate(() => window.scrollTo(0, 1500));
    expect(await where()).toEqual({ right: 16, bottom: 16 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
    await sw.locator('[data-lang="en"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await ctx.close();
  }
});

// Sur téléphone, l'accueil a un menu à trois traits : les sections de la page et les autres pages ;
// il se referme en choisissant un lien, par Échap ou en touchant ailleurs. Pas de menu sur ordinateur.
test('accueil : menu à trois traits sur téléphone, avec les sections et les pages du site', async ({ browser }) => {
  const serve = (page) => page.route('http://accueil.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: path.join(LANDING, url.pathname === '/' ? 'index.html' : url.pathname) });
  });
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await serve(page);
  await page.addInitScript(() => localStorage.setItem('atelier-gribouille:lang', 'fr'));
  await page.goto('http://accueil.test/');
  const burger = page.locator('#nav-burger');
  const menu = page.locator('#nav-menu');
  await expect(burger).toBeVisible();
  await expect(menu).toBeHidden();
  await burger.click();
  await expect(menu).toBeVisible();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');
  expect(await menu.locator('a').allTextContents()).toEqual(['Comment ça marche', 'Les styles', 'Chez vous', 'L’atelier', 'Tarifs', 'Idées', 'Photographier les dessins', 'Questions fréquentes', 'À propos', 'Contact']);
  const hrefs = await menu.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['#comment', '#styles', '#chez-vous', 'atelier/', 'tarifs.html', 'idees-dessins-enfants.html', 'photographier-les-dessins.html', '#questions', 'a-propos.html', 'mailto:bonjour@atelier-gribouille.com']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // un lien de section : on y va, le menu se referme
  await menu.locator('a[href="#styles"]').click();
  await expect(menu).toBeHidden();
  await expect(burger).toHaveAttribute('aria-expanded', 'false');
  // Échap, puis toucher ailleurs
  await burger.click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await burger.click();
  await page.mouse.click(200, 700);
  await expect(menu).toBeHidden();
  // en anglais : traduit
  await page.goto('http://accueil.test/?lang=en');
  await page.locator('#nav-burger').click();
  await expect(page.locator('#nav-menu a').nth(6)).toHaveText('Photographing drawings');
  await ctx.close();
  // sur ordinateur : le même menu (les sections quittent l'en-tête), en carte sous le bouton, à droite
  const ctx2 = await browser.newContext(DESK);
  const page2 = await ctx2.newPage();
  await serve(page2);
  await page2.goto('http://accueil.test/');
  await expect(page2.locator('#nav-burger')).toBeVisible();
  await expect(page2.locator('header .wrap > nav a[href="#styles"]')).toBeHidden();
  await page2.locator('#nav-burger').click();
  const menu2 = page2.locator('#nav-menu');
  await expect(menu2).toBeVisible();
  expect(await menu2.locator('a').allTextContents()).toEqual(['Comment ça marche', 'Les styles', 'Chez vous', 'L’atelier', 'Tarifs', 'Idées', 'Photographier les dessins', 'Questions fréquentes', 'À propos', 'Contact']);
  const box = await menu2.boundingBox(), btn = await page2.locator('#nav-burger').boundingBox();
  expect(box.width).toBeLessThan(400);
  expect(Math.abs(box.x + box.width - (btn.x + btn.width))).toBeLessThan(4);
  await page2.keyboard.press('Escape');
  await expect(menu2).toBeHidden();
  await ctx2.close();
});

// Tarifs, Idées et Photographier ont l'en-tête de l'accueil (compte, menu à trois traits sur téléphone,
// choix de langue flottant) et, en haut, le bouton « Créer une œuvre » de l'accueil.
test('Tarifs, Idées, Photographier : l’en-tête de l’accueil et « Créer une œuvre » en haut', async ({ browser }) => {
  for (const f of ['tarifs.html', 'idees-dessins-enfants.html', 'photographier-les-dessins.html', 'a-propos.html']) {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await page.route('http://accueil.test/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: path.join(LANDING, url.pathname.slice(1)) });
    });
    await page.addInitScript(() => localStorage.setItem('atelier-gribouille:lang', 'fr'));
    await page.goto(`http://accueil.test/${f}`);
    await expect(page.locator('a.nav-account'), f).toHaveAttribute('aria-label', 'Se connecter');
    await expect(page.locator('.lang-float'), f).toBeVisible();
    await page.locator('#nav-burger').click();
    await expect(page.locator('#nav-menu a'), f).toHaveCount(10);
    await page.keyboard.press('Escape');
    const cta = page.locator('.page-cta a');
    await expect(cta, f).toHaveText('Créer une œuvre');
    expect(await cta.getAttribute('href')).toBe('atelier/?nouveau');
    // en haut : visible sans défiler, sous le titre
    const box = await cta.boundingBox(), h1 = await page.locator('h1').boundingBox();
    expect(box.y, f).toBeGreaterThan(h1.y);
    expect(box.y + box.height, f).toBeLessThan(844);
    expect(box.width, `${f} : pleine largeur sur téléphone`).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), f).toBeLessThanOrEqual(390);
    // en anglais aussi
    await page.goto(`http://accueil.test/${f}?lang=en`);
    await expect(page.locator('.page-cta a'), f).toHaveText('Create an artwork');
    await ctx.close();
  }
});

// La page Idées ne parle que de ce que fait l'atelier : ni calendrier, ni cartes, ni papier cadeau.
test('Idées : ni calendrier, ni cartes, ni papier cadeau ; cinq idées', async ({ page }) => {
  await page.goto(`file://${LANDING}/idees-dessins-enfants.html`);
  const text = (await page.locator('body').innerText()) + (await page.title());
  expect(text).not.toMatch(/calendrier|cartes? de vœux|papier cadeau|faire-part|imprimeur en ligne/i);
  await expect(page.locator('.idea')).toHaveCount(5);
  await expect(page.locator('.toc li')).toHaveCount(5);
  expect(await page.title()).toContain('5 idées');
});
