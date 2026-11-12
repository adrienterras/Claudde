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

// L'en-tête porte le compte : « Se connecter » sans session ; le prénom, vers le panneau Mon compte,
// quand l'atelier (même origine) a une session Supabase dans le stockage local (compte.js).
test('accueil : « Se connecter » dans l’en-tête, ou la pastille et le prénom quand l’atelier est connecté', async ({ browser }) => {
  const serve = async (page) => page.route('http://accueil.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: path.join(LANDING, url.pathname === '/' ? 'index.html' : url.pathname) });
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await serve(page);
  await page.goto('http://accueil.test/');
  const acc = page.locator('a.nav-account');
  await expect(acc).toBeVisible();
  await expect(acc).toHaveText('Se connecter');
  expect(await acc.getAttribute('href')).toBe('atelier/?connexion');
  // tout l'en-tête tient sur un téléphone, sans défilement horizontal
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // en anglais : traduit avec le reste
  await page.goto('http://accueil.test/?lang=en');
  await expect(page.locator('a.nav-account')).toHaveText('Sign in');
  expect(await page.locator('a.nav-account').getAttribute('href')).toBe('atelier/?connexion&lang=en');
  await ctx.close();
  // une session de l'atelier : le prénom, vers Mon compte
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  await serve(page2);
  await page2.addInitScript(() => {
    localStorage.setItem('atelier-gribouille:lang', 'fr');
    localStorage.setItem('sb-fakeproj-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: 'lou@example.org', user_metadata: { name: 'Lou' } } }));
  });
  await page2.goto('http://accueil.test/');
  await expect(page2.locator('a.nav-account span')).toHaveText('Lou');
  expect(await page2.locator('a.nav-account').getAttribute('href')).toBe('atelier/?compte');
  await expect(page2.locator('a.nav-account')).toHaveClass(/on/);
  // la pastille du compte, comme dans l'atelier : l'initiale (sans photo), à la place de l'icône
  await expect(page2.locator('a.nav-account .acc-avatar')).toHaveText('L');
  await expect(page2.locator('a.nav-account .acc-avatar')).toBeVisible();
  await expect(page2.locator('a.nav-account svg')).toBeHidden();
  await ctx2.close();
  // avec une photo de compte (Google) : la photo, sans initiale ; l'en-tête tient sur un téléphone
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page3 = await ctx3.newPage();
  await serve(page3);
  await page3.addInitScript(() => {
    localStorage.setItem('atelier-gribouille:lang', 'fr');
    localStorage.setItem('sb-fakeproj-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: 'lou@example.org', user_metadata: { name: 'Lou', avatar_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=' } } }));
  });
  await page3.goto('http://accueil.test/');
  const av = page3.locator('a.nav-account .acc-avatar');
  await expect(av).toHaveText('');
  expect(await av.evaluate((e) => e.style.backgroundImage)).toContain('data:image/gif');
  expect(await page3.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx3.close();
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
  expect(await menu.locator('a').allTextContents()).toEqual(['Comment ça marche', 'Les styles', 'Chez vous', 'L’atelier', 'Tarifs', 'Idées', 'Photographier les dessins', 'Contact']);
  const hrefs = await menu.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(['#comment', '#styles', '#chez-vous', 'atelier/', 'tarifs.html', 'idees-dessins-enfants.html', 'photographier-les-dessins.html', 'mailto:bonjour@atelier-gribouille.com']);
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
  // sur ordinateur : pas de menu, les sections restent dans l'en-tête
  const ctx2 = await browser.newContext(DESK);
  const page2 = await ctx2.newPage();
  await serve(page2);
  await page2.goto('http://accueil.test/');
  await expect(page2.locator('#nav-burger')).toBeHidden();
  await expect(page2.locator('header .wrap a[href="#styles"]')).toBeVisible();
  await ctx2.close();
});

// Tarifs, Idées et Photographier ont l'en-tête de l'accueil (compte, menu à trois traits sur téléphone,
// choix de langue flottant) et, en haut, le bouton « Créer une œuvre » de l'accueil.
test('Tarifs, Idées, Photographier : l’en-tête de l’accueil et « Créer une œuvre » en haut', async ({ browser }) => {
  for (const f of ['tarifs.html', 'idees-dessins-enfants.html', 'photographier-les-dessins.html']) {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await page.route('http://accueil.test/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: path.join(LANDING, url.pathname.slice(1)) });
    });
    await page.addInitScript(() => localStorage.setItem('atelier-gribouille:lang', 'fr'));
    await page.goto(`http://accueil.test/${f}`);
    await expect(page.locator('a.nav-account'), f).toHaveText('Se connecter');
    await expect(page.locator('.lang-float'), f).toBeVisible();
    await page.locator('#nav-burger').click();
    await expect(page.locator('#nav-menu a'), f).toHaveCount(8);
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
