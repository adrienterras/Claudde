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
  for (const [page0, opts] of [['index.html', PHONE], ['index.html', DESK], ['tarifs.html', PHONE], ['tarifs.html', DESK]]) {
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
