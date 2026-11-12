// Les polices (Montserrat, Playfair Display) sont servies par le site lui-même, depuis fonts/ de
// l'atelier : aucune page ne demande quoi que ce soit à Google Fonts (l'adresse IP des visiteurs ne
// part pas chez Google), et les polices sont bien chargées, en romain comme en italique.
const { test, expect } = require('@playwright/test');
const path = require('path');

const LANDING = path.join(__dirname, '..', '..', 'landing');
const ATELIER = path.join(__dirname, '..');

async function checkFonts(page) {
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(async () => {
    const faces = ['400 16px Montserrat', '600 16px Montserrat', '400 16px "Playfair Display"', 'italic 400 16px "Playfair Display"'];
    await Promise.all(faces.map((f) => document.fonts.load(f, 'Aé€')));
    return faces.map((f) => document.fonts.check(f, 'Aé€'));
  });
  expect(ok).toEqual([true, true, true, true]);
  // la police du titre est vraiment Playfair Display (et non la police de secours) : une fonte chargée
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
  expect(loaded).toContain('Montserrat');
  expect(loaded).toContain('Playfair Display');
}

for (const file of ['index.html', 'tarifs.html', 'idees-dessins-enfants.html', 'photographier-les-dessins.html']) {
  test(`polices servies par le site, sans Google : accueil, ${file}`, async ({ page }) => {
    const google = [];
    page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) google.push(r.url()); });
    const fonts = [];
    await page.route('http://accueil.test/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/atelier/fonts/')) { fonts.push(url.pathname); return route.fulfill({ path: path.join(ATELIER, url.pathname.slice('/atelier/'.length)) }); }
      if (url.pathname.startsWith('/atelier/')) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: path.join(LANDING, url.pathname === '/' ? 'index.html' : url.pathname) });
    });
    await page.goto(`http://accueil.test/${file === 'index.html' ? '' : file}`);
    await checkFonts(page);
    expect(fonts).toContain('/atelier/fonts/fonts.css');
    expect(fonts.some((f) => f.endsWith('.woff2'))).toBe(true);
    expect(google).toEqual([]);
  });
}

for (const file of ['index.html', 'confidentialite.html']) {
  test(`polices servies par le site, sans Google : atelier, ${file}`, async ({ page }) => {
    const google = [];
    page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) google.push(r.url()); });
    const bad = [];
    page.on('response', (r) => { if (r.url().includes('/fonts/') && !r.ok()) bad.push(r.url()); });
    await page.goto(file);
    await checkFonts(page);
    expect(bad).toEqual([]);
    expect(google).toEqual([]);
  });
}
