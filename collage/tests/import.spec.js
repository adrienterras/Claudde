const { test, expect } = require('./helpers');

test.describe('Import des scans', () => {
  test('images : chaque page est classée et les sections s’ouvrent', async ({ app }) => {
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png', 'page-pale.png', 'photo-wood.png']);
    const ds = await app.drawings();
    expect(ds.map((d) => d.name)).toEqual(['page-cutout.png', 'page-two.png', 'page-texture.png', 'page-pale.png', 'photo-wood.png']);
    const by = Object.fromEntries(ds.map((d) => [d.name, d]));
    expect(by['page-cutout.png'].kind).toBe('cutout');
    expect(by['page-cutout.png'].pieces).toBe(1);
    expect(by['page-two.png'].pieces).toBe(2);
    expect(by['page-texture.png'].kind).toBe('texture');
    expect(by['photo-wood.png'].photo).toBe('bois');
    expect(by['photo-wood.png'].role).toBe('cutout'); // une photo détourée est toujours une découpe
    // la page pâle (texte seul) est mise de côté par défaut
    expect(by['page-pale.png'].role).toBe('off');
    await expect(app.page.locator('#compose-section')).toBeVisible();
    await expect(app.page.locator('#export-section')).toBeVisible();
    await expect(app.page.locator('#drawings-count')).toContainText('5');
  });

  test('PDF : une page par dessin, nommée d’après le fichier', async ({ app }) => {
    await app.import(['two-pages.pdf'], 2);
    const ds = await app.drawings();
    expect(ds.map((d) => d.name)).toEqual(['two-pages.pdf — p.1', 'two-pages.pdf — p.2']);
    expect(ds[0].kind).toBe('cutout');
    expect(ds[1].kind).toBe('texture');
    // un PDF à 150 dpi donne la vraie taille de la feuille : A4
    expect(ds[0].sizeCm).toBeCloseTo(29.7, 0);
  });

  test('un fichier illisible est signalé sans bloquer les autres', async ({ app }) => {
    const { page } = app;
    await page.setInputFiles('#file', [{ name: 'cassé.pdf', mimeType: 'application/pdf', buffer: Buffer.from('ceci n’est pas un PDF') }]);
    await expect(page.locator('#notice')).toBeVisible();
    await expect(page.locator('#notice')).toContainText('cassé.pdf');
    await app.import(['page-cutout.png'], 1);
    expect((await app.drawings()).length).toBe(1);
  });

  test('un dessin peut changer de rôle et de taille', async ({ app }) => {
    await app.import(['page-cutout.png', 'page-texture.png']);
    const before = await app.proposals();
    await app.page.evaluate(() => { const d = AtelierGribouille.state.drawings[0]; d.role = 'texture'; d.sizeCm = 42; d.sizeMode = 'manual'; AtelierGribouille.regenerate(); });
    const ds = await app.drawings();
    expect(ds[0].role).toBe('texture');
    expect(ds[0].sizeCm).toBe(42);
    const after = await app.proposals();
    expect(after[0].bg).toBeGreaterThanOrEqual(before[0].bg);
  });
});
