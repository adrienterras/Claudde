const { test, expect } = require('./helpers');

test.describe('Compositions sauvegardées', () => {
  test('sauvegarder, recharger, rouvrir : la mise en place est identique', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png', 'photo-wood.png']);
    await app.select('tournesol');
    const before = await page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      c.items[0].x += 3.5; c.items[0].rot = 0.3; // une retouche manuelle doit être conservée
      return { style: c.style, n: c.items.length, bg: c.bg.length, first: [c.items[0].x, c.items[0].y, c.items[0].rot], W: c.W, H: c.H };
    });
    await page.locator('#save-comp').click();
    await expect(page.locator('#save-form')).toBeVisible();
    await page.fill('#save-name', 'Essai automatique');
    await page.locator('#save-form button[type=submit]').click();
    await expect(page.locator('#save-status')).toContainText('sauvegardée');
    await expect(page.locator('.saved')).toHaveCount(1);
    await expect(page.locator('.saved .saved-meta')).toContainText('4 dessins');

    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    const after = await page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      return { style: c.style, n: c.items.length, bg: c.bg.length, first: [c.items[0].x, c.items[0].y, c.items[0].rot], W: c.W, H: c.H, drawings: AtelierGribouille.state.drawings.length };
    });
    expect(after.style).toBe(before.style);
    expect(after.n).toBe(before.n);
    expect(after.bg).toBe(before.bg);
    expect(after.W).toBeCloseTo(before.W, 3);
    expect(after.first[0]).toBeCloseTo(before.first[0], 3);
    expect(after.first[1]).toBeCloseTo(before.first[1], 3);
    expect(after.first[2]).toBeCloseTo(before.first[2], 3);
    expect(after.drawings).toBe(4);

    // suppression en deux temps
    await page.locator('.saved-del').click();
    await expect(page.locator('.saved-del')).toContainText('Supprimer ?');
    await page.locator('.saved-del').click();
    await expect(page.locator('.saved')).toHaveCount(0);
  });

  test('sans dessin, la sauvegarde explique quoi faire', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('#export-section')).toBeHidden();
    await page.evaluate(() => document.getElementById('save-comp').click());
    await expect(page.locator('#save-status')).toContainText('Importez des dessins');
  });
});
