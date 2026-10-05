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
    await expect(page.locator('#drop strong')).toHaveText('Drop your scans');
    await expect(page.locator('#export')).toContainText('Download the artwork');
    await expect(page.locator('[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
    // la langue reste mémorisée sans le paramètre d'URL
    await page.goto('index.html');
    await page.waitForFunction(() => window.I18n);
    await expect(page.locator('#import-section h2')).toContainText('Import');
    // retour au français par le sélecteur
    await page.click('[data-lang="fr"]');
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
    await page.locator('#drawings .thumb').first().click();
    await page.locator('#advanced summary').click();
    await page.selectOption('#format', { index: 3 });
    await page.waitForTimeout(500);
    await expect(page.locator('#label-meta')).toContainText('collage of');
    await expect(page.locator('#pieces-count')).toContainText('in the artwork');
    await expect(page.locator('#detail')).toContainText('Real size');
    const missing = await page.evaluate(() => I18n.missing());
    expect(missing, 'textes sans traduction').toEqual([]);
    expect(errors).toEqual([]);
  });
});
