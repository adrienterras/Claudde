const { test, expect, fixture } = require('./helpers');

// Deux ateliers : Impression (cadres standard du marché, dessins réduits pour y tenir, tirages et
// fichier HD) et Toile (taille réelle, toiles du commerce, guide, kit et Atelier Signature).
test.describe('Atelier Impression et atelier Toile', () => {
  test('sans choix : les deux cartes sont proposées ; ?mode= choisit, et c’est mémorisé', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-pick')).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('#mode-switch button.on').length)).toBe(0);
    await page.locator('#mode-pick [data-mode="impression"]').click();
    await expect(page.locator('#mode-pick')).toBeHidden();
    await expect(page.locator('#mode-switch [data-mode="impression"]')).toHaveClass(/on/);
    expect(await page.evaluate(() => localStorage.getItem('atelier.mode'))).toBe('impression');
    // rechargée sans paramètre : le choix revient ; ?mode=toile le remplace
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-pick')).toBeHidden();
    await expect(page.locator('#format-label')).toHaveText('Cadre');
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-switch [data-mode="toile"]')).toHaveClass(/on/);
    await expect(page.locator('#format-label')).toHaveText('Toile');
  });

  test('Impression : cadres standard seulement, œuvre à la taille du cadre, dessins réduits, produits impression', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png', 'photo-wood.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const opts = await page.evaluate(() => [...document.getElementById('format').options].filter((o) => !o.hidden && !o.disabled).map((o) => o.value));
    expect(opts.length).toBeGreaterThan(10);
    expect(opts.every((v) => v.startsWith('cadre:'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('format').value)).toBe('cadre:70x50');
    expect(await page.evaluate(() => document.getElementById('grain').checked)).toBe(false);
    await expect(page.locator('#guide-box')).toBeHidden();
    // le cadre 18 × 24 : l'œuvre fait exactement 24 × 18 (paysage), les dessins sont réduits pour y tenir
    await page.selectOption('#format', 'cadre:24x18');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const A = AtelierGribouille, c = A.state.comp;
      const d = A.state.drawings[0], p = c.items.find((L) => L.piece.drawing === d);
      return { W: c.W, H: c.H, k: A.scale(), all: A.state.proposals.every((pr) => Math.abs(pr.comp.W - 24) < 1e-6 && Math.abs(pr.comp.H - 18) < 1e-6), pieceCm: p ? Math.max(p.w, p.h) : null, sheetCm: d.sizeCm };
    });
    expect(r.W).toBe(24); expect(r.H).toBe(18);
    expect(r.all).toBe(true);
    expect(r.k).toBeGreaterThan(0.05); expect(r.k).toBeLessThan(1);
    if (r.pieceCm) expect(r.pieceCm).toBeLessThan(r.sheetCm);
    await expect(page.locator('#scale-info')).toContainText('Impression de 24 × 18 cm');
    await expect(page.locator('#export-info')).toContainText('impression de 24 × 18 cm');
    // portrait : 18 × 24
    await page.locator('#canvas-orient [data-orient="port"]').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual([18, 24]);
    // panier : tirages et fichier HD seulement
    await page.locator('#add-cart').click();
    await expect(page.locator('#cart-add')).toBeVisible();
    await expect(page.locator('#cart-add input[value="print"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="hd"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="kit"]')).toBeHidden();
    await expect(page.locator('#cart-add input[value="signature"]')).toBeHidden();
    await expect(page.locator('.cart-what-size')).toContainText('impression de 18 × 24 cm');
    await page.locator('#cart-add [data-close]').first().click();
    // sauvegardée puis rouverte : le mode et le cadre reviennent
    await page.locator('#save-comp').click();
    await page.fill('#save-name', 'Cadre 18x24');
    await page.locator('#save-form button[type=submit]').click();
    await expect(page.locator('#save-status')).toContainText('sauvegardée');
    await page.goto('index.html?mode=toile&nouveau');
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('« Cadre 18x24 » rouverte', { timeout: 120000 });
    await expect(page.locator('#mode-switch [data-mode="impression"]')).toHaveClass(/on/);
    expect(await page.evaluate(() => [document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual(['cadre:24x18', 18, 24]);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });

  test('Toile : taille réelle et toiles du commerce, guide, kit et Atelier Signature ; la bascule recompose', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const opts = await page.evaluate(() => [...document.getElementById('format').options].filter((o) => !o.hidden && !o.disabled).map((o) => o.value));
    expect(opts.slice(0, 3).every((v) => v.startsWith('auto:'))).toBe(true);
    expect(opts.some((v) => v === '70x50')).toBe(true);
    expect(opts.some((v) => v.startsWith('cadre:'))).toBe(false);
    expect(await page.evaluate(() => AtelierGribouille.scale())).toBe(1);
    expect(await page.evaluate(() => document.getElementById('grain').checked)).toBe(true);
    await expect(page.locator('#guide-box')).toBeVisible();
    await page.locator('#add-cart').click();
    await expect(page.locator('#cart-add input[value="guide"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="kit"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="signature"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="print"]')).toBeHidden();
    await expect(page.locator('#cart-add .cart-print')).toBeHidden();
    // Atelier Signature : 490 € jusqu'à 75 cm, 690 € au-delà
    const long = await page.evaluate(() => Math.max(AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H));
    await page.locator('#cart-add input[value="signature"]').check();
    await expect(page.locator('.cart-add-total')).toContainText(long > 75 ? '690' : '490');
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await expect(page.locator('#cart .cart-item')).toContainText('Atelier Signature');
    await page.locator('#cart [data-close]').first().click();
    // bascule vers Impression : cadre par défaut, œuvre recomposée à sa taille
    await page.locator('#mode-switch [data-mode="impression"]').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => [document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual(['cadre:70x50', 70, 50]);
    await page.locator('#mode-switch [data-mode="toile"]').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.getElementById('format').value)).toBe('auto:1.4286');
    expect(await page.evaluate(() => AtelierGribouille.state.comp.W !== 70 || AtelierGribouille.state.comp.H !== 50)).toBe(true);
  });
});
