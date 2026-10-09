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

  test('la résolution écrite par le scanner (JPEG 300 dpi, PNG 150 dpi) donne la taille réelle', async ({ app }) => {
    await app.import(['scan-300dpi.jpg', 'scan-150dpi.png'], 2);
    const ds = await app.page.evaluate(() => AtelierGribouille.state.drawings.map((d) => ({ name: d.name, sizeCm: d.sizeCm, phys: d.physSource, uncertain: d.uncertain })));
    expect(ds[0].phys).toBe('300 dpi');
    expect(ds[0].sizeCm).toBeCloseTo(29.7, 0);
    expect(ds[1].phys).toBe('150 dpi');
    expect(ds[1].sizeCm).toBeCloseTo(29.7, 0);
    expect(ds.every((d) => !d.uncertain)).toBe(true);
    await expect(app.page.locator('#sizes-check')).toBeHidden();
  });

  test('deux tailles corrigées qui concordent étalonnent les scans sans résolution connue, une seule non', async ({ app }) => {
    await app.import(['noscale-small.jpg', 'noscale-medium.jpg', 'noscale-large.jpg'], 3);
    const read = () => app.page.evaluate(() => AtelierGribouille.state.drawings.map((d) => ({ sizeCm: d.sizeCm, mode: d.sizeMode, calibrated: !!d.calibrated, uncertain: d.uncertain })));
    // une seule correction (petite feuille à 20 cm) ne redimensionne pas les autres
    await app.page.evaluate(() => { const d = AtelierGribouille.state.drawings[0]; d.sizeCm = 20; d.sizeMode = 'manual'; AtelierGribouille.estimateSizes(); });
    let ds = await read();
    expect(ds[0]).toMatchObject({ sizeCm: 20, mode: 'manual' });
    expect(ds[1].calibrated).toBe(false);
    expect(ds[2].calibrated).toBe(false);
    // une seconde correction cohérente (grande feuille à 40 cm, deux fois plus de pixels) : la moyenne suit
    await app.page.evaluate(() => { const d = AtelierGribouille.state.drawings[2]; d.sizeCm = 40; d.sizeMode = 'manual'; AtelierGribouille.estimateSizes(); });
    ds = await read();
    expect(ds[1].calibrated).toBe(true);
    expect(ds[1].sizeCm).toBeCloseTo(30, 0);
    expect(ds[1].uncertain).toBe(false);
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

test('les bibliothèques PDF ne sont chargées qu’au besoin', async ({ app }) => {
  const { page } = app;
  expect(await page.evaluate(() => ({ lire: !!window.pdfjsLib, creer: !!window.jspdf }))).toEqual({ lire: false, creer: false });
  await app.import(['two-pages.pdf'], 2);
  expect(await page.evaluate(() => !!window.pdfjsLib)).toBe(true);
});
