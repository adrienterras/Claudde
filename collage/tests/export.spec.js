const { test, expect, openStep } = require('./helpers');

test.describe('Export', () => {
  test.beforeEach(async ({ app }) => {
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
  });

  test('toujours 300 dpi (plus de choix de qualité), dimensions cohérentes avec la toile', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('#dpi')).toHaveCount(0);
    const r = await page.evaluate(() => { const { w, h } = AtelierGribouille.exportSize(); const c = AtelierGribouille.state.comp; return { w, h, W: c.W, H: c.H }; });
    expect(r.w / r.W).toBeCloseTo(300 / 2.54, 0);
    expect(r.w / r.h).toBeCloseTo(r.W / r.H, 1);
  });

  test('téléchargement JPEG : un vrai fichier image', async ({ app }) => {
    const { page } = app;
    await openStep(page, 'export-section');
    await page.evaluate(() => { AtelierGribouille.state.exportDpi = 60; }); // (petit fichier pour l'essai : l'export est toujours à 300 dpi)
    // le fichier porte le nom de l'œuvre dans Mes œuvres, sans accents ni espaces
    await page.evaluate(() => { AtelierGribouille.state.workName = 'Les vacances à la mer — été'; AtelierGribouille.state.title = 'Les vacances à la mer — été'; AtelierGribouille.state.titles = null; });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    expect(download.suggestedFilename()).toBe('les-vacances-a-la-mer-ete.jpg');
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
    await openStep(page, 'export-section');
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

  test('netteté pour l’impression : appliquée à l’export (300 dpi), puis libérée', async ({ app }) => {
    const r = await app.page.evaluate(async () => {
      const A = AtelierGribouille; const comp = A.state.comp;
      const s = 300 / 2.54;
      await A.hydrateHD(comp, s);
      await A.sharpenHD(comp, s);
      const items = comp.items.filter((L) => L.piece.hd).length;
      const pages = comp.bg.filter((L) => !L.paper && L.src && L.src.hd).length;
      A.releaseHD();
      const after = comp.items.filter((L) => L.piece.hd).length + comp.bg.filter((L) => L.src && L.src.hd).length;
      return { items, pages, n: comp.items.length, nb: comp.bg.filter((L) => !L.paper).length, after };
    });
    expect(r.items).toBe(r.n);
    expect(r.pages).toBe(r.nb);
    expect(r.after).toBe(0);
  });

  test('guide de création : un PDF de plusieurs pages', async ({ app }) => {
    const { page } = app;
    await openStep(page, 'export-section');
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
    await openStep(page, 'export-section');
    for (const [fmt, ext] of [['image/png', /\.png$/], ['application/pdf', /\.pdf$/]]) {
      await page.locator('#fmt').selectOption(fmt);
      await page.evaluate(() => { AtelierGribouille.state.exportDpi = 60; }); // (petit fichier pour l'essai : l'export est toujours à 300 dpi)
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

  test('canvas vide (mémoire de l’iPad dépassée) : l’image est refaite plus petite, jamais noire', async ({ app }) => {
    const { page } = app;
    // Safari laisse vide, sans erreur, un canvas au-delà de sa mémoire : on simule ce cas au-delà de 2 Mpx
    await page.evaluate(() => {
      const orig = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...a) {
        return this.canvas.width * this.canvas.height > 2e6 ? new ImageData(a[2], a[3]) : orig.apply(this, a);
      };
    });
    await openStep(page, 'export-section');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    expect(download.suggestedFilename()).toMatch(/\.jpe?g$/);
    await expect(page.locator('#notice')).toContainText('Image réduite');
    const px = await page.evaluate(() => { const t = document.getElementById('notice').textContent.match(/(\d+) × (\d+)/); return Number(t[1]) * Number(t[2]); });
    expect(px).toBeLessThanOrEqual(2e6);
    expect(px).toBeGreaterThan(5e5);
  });
});
