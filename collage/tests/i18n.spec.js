// Deux langues : l'interface est écrite en français et traduite en anglais (js/i18n.js).
const { test, expect, fixture } = require('./helpers');

const noAccounts = (page) => page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));

test.describe('langues', () => {
  test('?lang=en traduit la page, le choix est mémorisé et le bouton FR revient au français', async ({ page }) => {
    await noAccounts(page);
    await page.goto('index.html?lang=en');
    await page.waitForFunction(() => window.AtelierGribouille && window.I18n);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#import-section h2')).toContainText('Import');
    await expect(page.locator('#drop strong')).toHaveText('Drop the photos or scans of the drawings');
    await expect(page.locator('#export')).toContainText('Download the artwork');
    // deux sélecteurs : celui du carnet (grand écran) et celui du bandeau (téléphone)
    await expect(page.locator('.brand [data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mobile-brand [data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
    // la langue reste mémorisée sans le paramètre d'URL
    await page.goto('index.html');
    await page.waitForFunction(() => window.I18n);
    await expect(page.locator('#import-section h2')).toContainText('Import');
    // retour au français par le sélecteur
    await page.click('.brand [data-lang="fr"]');
    await page.waitForFunction(() => window.I18n && window.I18n.lang === 'fr');
    await expect(page.locator('#import-section h2')).toContainText('Importer');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  });

  test('en anglais, aucun texte dynamique ne manque au dictionnaire après un import complet', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await noAccounts(page);
    await page.goto('index.html?lang=en');
    await page.waitForFunction(() => window.AtelierGribouille && window.Extract && window.Compose);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-texture.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 3 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // parcourt les propositions, ouvre un dessin et change de toile pour déclencher les textes dynamiques
    const n = await page.evaluate(() => AtelierGribouille.state.proposals.length);
    for (let i = 0; i < n; i++) await page.evaluate((i) => AtelierGribouille.selectProposal(i), i);
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector('h2').click(); });
    await page.locator('#drawings .thumb[data-i="0"]').click();
    await page.evaluate(() => { document.getElementById('advanced').open = true; });
    await page.selectOption('#format', { index: 3 });
    await page.waitForTimeout(500);
    await expect(page.locator('#label-meta')).toContainText(/ · (canvas|print) /);
    await expect(page.locator('#pieces-count')).toContainText('in the artwork');
    await expect(page.locator('#detail')).toContainText('Real size');
    const missing = await page.evaluate(() => I18n.missing());
    expect(missing, 'textes sans traduction').toEqual([]);
    expect(errors).toEqual([]);
  });
});

// La page d'accueil et la page Tarifs (landing/) ont le bouton FR / EN : tout leur texte doit avoir une
// traduction — on compare la page en français et en anglais, texte par texte, avec le vrai mécanisme
test.describe('page d’accueil en anglais', () => {
  test('tout le texte de l’accueil et de la page Tarifs est traduit', async ({ browser }) => {
    const path = require('path');
    const LANDING = path.resolve(__dirname, '..', '..', 'landing');
    const ALLOW = new Set(['Atelier', 'Gribouille', 'Atelier Gribouille', '© Atelier Gribouille', 'ateliergribouille.art', 'FR', 'EN', '×', 'This site is also available in English.', 'View in English', 'Contact', 'Instagram', 'Pop art']);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const collect = () => page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeType === 1 ? (['SCRIPT', 'STYLE', 'svg'].includes(n.tagName === 'svg' ? 'svg' : n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) : (/\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)) });
      let n;
      while ((n = w.nextNode())) {
        if (n.nodeType === 1) ['title', 'placeholder', 'aria-label', 'alt'].forEach((a) => { const v = n.getAttribute(a); if (v && v.trim()) out.push(v.trim()); });
        else out.push(n.nodeValue.replace(/\s+/g, ' ').trim());
      }
      return out;
    });
    for (const f of ['index.html', 'tarifs.html']) {
      await page.goto(`file://${LANDING}/${f}?lang=fr`);
      const fr = await collect();
      await page.goto(`file://${LANDING}/${f}?lang=en`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      const en = await collect();
      expect(en.length, `${f} : même nombre de textes`).toBe(fr.length);
      const left = fr.filter((t, i) => t === en[i] && !ALLOW.has(t) && !/^[\d\s€×,.:%+·|–—-]+(cm)?$/.test(t) && !/^[A-Z]{1,3}$/.test(t));
      expect(left, `${f} : textes restés en français`).toEqual([]);
    }
    await ctx.close();
  });
});
