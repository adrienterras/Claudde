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
