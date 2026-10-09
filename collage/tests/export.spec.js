const { test, expect } = require('./helpers');

test.describe('Export', () => {
  test.beforeEach(async ({ app }) => {
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
  });

  test('300 dpi par défaut, dimensions cohérentes avec la toile', async ({ app }) => {
    const { page } = app;
    expect(await page.locator('#dpi').inputValue()).toBe('300');
    const r = await page.evaluate(() => { const { w, h } = AtelierGribouille.exportSize(); const c = AtelierGribouille.state.comp; return { w, h, W: c.W, H: c.H }; });
    expect(r.w / r.W).toBeCloseTo(300 / 2.54, 0);
    expect(r.w / r.h).toBeCloseTo(r.W / r.H, 1);
  });

  test('téléchargement JPEG : un vrai fichier image', async ({ app }) => {
    const { page } = app;
    await page.locator('#dpi').selectOption('150');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    expect(download.suggestedFilename()).toMatch(/\.jpe?g$/);
    const path = await download.path();
    const fs = require('fs');
    const buf = fs.readFileSync(path);
    expect(buf.length).toBeGreaterThan(20000);
    expect(buf[0]).toBe(0xff); // signature JPEG
    expect(buf[1]).toBe(0xd8);
    await expect(page.locator('#save-status')).toContainText('Téléchargement lancé');
  });

  test('export PDF à l’échelle : un document PDF', async ({ app }) => {
    const { page } = app;
    await page.locator('#fmt').selectOption('application/pdf');
    await expect(page.locator('#export-info')).toContainText('PDF');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const buf = require('fs').readFileSync(await download.path());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('haute définition : relecture des sources puis libération', async ({ app }) => {
    const r = await app.page.evaluate(async () => {
      const A = AtelierGribouille; const comp = A.state.comp;
      const s = 300 / 2.54;
      await A.hydrateHD(comp, s);
      const during = comp.items.filter((L) => L.piece.hd).length;
      A.releaseHD();
      const after = comp.items.filter((L) => L.piece.hd).length;
      return { during, after, items: comp.items.length };
    });
    expect(r.after).toBe(0);
    expect(r.during).toBeLessThanOrEqual(r.items);
  });

  test('guide de création : un PDF de plusieurs pages', async ({ app }) => {
    const { page } = app;
    await page.locator('#export-section details.guide-box summary').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#guide').click()]);
    expect(download.suggestedFilename()).toMatch(/guide.*\.pdf$/);
    const buf = require('fs').readFileSync(await download.path());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(50000);
  });

  test('écran tactile : le fichier prêt s’ouvre avec « Télécharger le fichier »', async ({ app }) => {
    const { page } = app;
    // iPhone et tablettes : le téléchargement n'est lancé que par un toucher sur le fichier prêt
    await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 }));
    for (const [fmt, ext] of [['image/png', /\.png$/], ['application/pdf', /\.pdf$/]]) {
      await page.locator('#fmt').selectOption(fmt);
      await page.locator('#dpi').selectOption('screen');
      await page.locator('#export').click();
      await expect(page.locator('#preview')).toBeVisible();
      await expect(page.locator('#preview-title')).toHaveText(fmt === 'image/png' ? 'Votre image est prête' : 'Votre fichier est prêt');
      await expect(page.locator('#preview-img')).toBeVisible({ visible: fmt === 'image/png' });
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('#preview-dl').click()]);
      expect(download.suggestedFilename()).toMatch(ext);
      await expect(page.locator('#save-status')).toContainText('Téléchargement lancé');
      await page.locator('#preview-close').click();
      await expect(page.locator('#preview')).toBeHidden();
    }
  });
});
