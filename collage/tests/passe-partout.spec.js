// Tableau imprimé : le passe-partout est proposé par défaut, dans la mise en scène comme à la commande
// (les autres tests partent du choix « sans » mémorisé, voir playwright.config.js).
const { test, expect, fixture, openStep } = require('./helpers');

test.describe('Passe-partout par défaut', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('une nouvelle œuvre imprimée part avec passe-partout : Tailles, mise en scène et commande', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // l'œuvre est à la taille de l'impression dans le passe-partout du cadre (30 × 40 → 21 × 29,7)
    expect(await page.evaluate(() => { const f = AtelierGribouille.formatCm(); return [f.mat, f.frameW, f.frameH, f.w, f.h]; })).toEqual([true, 30, 40, 21, 29.7]);
    await expect(page.locator('#print-mat [data-mat="1"]')).toHaveClass(/on/);
    await expect(page.locator('#scale-info')).toHaveText('Impression de 21 × 29,7 cm avec passe-partout, dans un cadre de 30 × 40 cm.');
    // la mise en scène s'ouvre sur « avec passe-partout »
    await openStep(page, 'sizes-section');
    await page.locator('#scene-open-side').click();
    await expect(page.locator('#scene-modal')).toBeVisible();
    await expect(page.locator('#scene-mat [data-mat="1"]')).toHaveClass(/on/);
    await expect(page.locator('#scene-info')).toContainText('Avec passe-partout');
    await page.keyboard.press('Escape');
    // la commande aussi : encadré avec passe-partout (donc pas de 21 × 30)
    await openStep(page, 'export-section');
    await page.locator('#add-cart').click();
    await expect(page.locator('#cart-add [data-finish="cadre"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add [data-mat="1"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add [data-size="21x30"]')).toBeHidden();
    // le choix « sans » est mémorisé pour la suite
    await page.locator('#cart-add [data-close]').first().click();
    await page.locator('#scene-open-side').click();
    await page.locator('#scene-mat [data-mat="0"]').click();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => localStorage.getItem('atelier.passe-partout'))).toBe('0');
  });
});
