// Référencement : chaque page publique a un titre, une description, une adresse canonique, des
// données structurées valides et sa place dans le plan du site ; le français est la langue par
// défaut (Googlebot navigue en anglais : sans cela, la page indexée serait la traduction).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SITE = 'https://ateliergribouille.art/';
const PAGES = {
  '': 'landing/index.html',
  'tarifs.html': 'landing/tarifs.html',
  'idees-dessins-enfants.html': 'landing/idees-dessins-enfants.html',
  'atelier/': 'collage/index.html',
  'livre/': 'livre/index.html',
  'confidentialite.html': 'collage/confidentialite.html',
};
const attr = (html, re) => { const m = html.match(re); return m ? m[1] : null; };

test.describe('Référencement', () => {
  for (const [url, file] of Object.entries(PAGES)) {
    test(`${url || 'accueil'} : titre, description, canonique, données structurées`, () => {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(attr(html, /<html lang="([^"]+)"/)).toBe('fr');
      const title = attr(html, /<title>([^<]+)<\/title>/);
      expect(title && title.length).toBeGreaterThanOrEqual(20);
      expect(title.length).toBeLessThanOrEqual(90);
      const desc = attr(html, /<meta name="description" content="([^"]+)"/);
      expect(desc && desc.length).toBeGreaterThanOrEqual(70);
      expect(desc.length).toBeLessThanOrEqual(200);
      expect(attr(html, /<link rel="canonical" href="([^"]+)"/)).toBe(SITE + url);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) expect(() => JSON.parse(m[1])).not.toThrow();
      // images : un texte de remplacement partout (vide pour les images décoratives)
      for (const m of html.matchAll(/<img\b[^>]*>/g)) expect(m[0]).toMatch(/\balt="/);
    });
  }

  test('plan du site et robots.txt', () => {
    const map = fs.readFileSync(path.join(ROOT, 'landing/sitemap.xml'), 'utf8');
    const locs = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const url of Object.keys(PAGES)) expect(locs).toContain(SITE + url);
    const robots = fs.readFileSync(path.join(ROOT, 'landing/robots.txt'), 'utf8');
    expect(robots).toContain(`Sitemap: ${SITE}sitemap.xml`);
    expect(robots).not.toMatch(/Disallow: \/\s*$/m);
  });

  test('le français est la langue par défaut, l’anglais seulement sur demande', () => {
    for (const f of ['landing/i18n.js', 'collage/js/i18n.js', 'livre/js/i18n.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const pick = src.slice(src.indexOf('function pick'), src.indexOf('}', src.indexOf("return 'fr';")) + 1);
      expect(pick, f).toContain("return 'fr';");
      expect(pick, f).not.toContain('navigator.language');
    }
  });
});
