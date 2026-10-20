const { test, expect, fixture } = require('./helpers');

// Photographier un dessin : l'appareil photo du téléphone lui-même (champ de fichier capture="environment"),
// les photos entrent comme des fichiers importés. Sur ordinateur, pas de bouton.
test.describe('Photographier un dessin', () => {
  test('sur téléphone, le bouton ouvre l’appareil du téléphone ; les photos prises sont importées', async ({ app }) => {
    const page = app.page;
    await expect(page.locator('#camera-open')).toBeHidden(); // ordinateur
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#camera-open')).toBeVisible();
    const attrs = await page.evaluate(() => { const i = document.getElementById('camera-native'); return { capture: i.getAttribute('capture'), accept: i.accept, multiple: i.multiple }; });
    expect(attrs).toEqual({ capture: 'environment', accept: 'image/*', multiple: true });
    // le clic ouvre le champ natif (pas de visée maison)
    await page.evaluate(() => { window.__opened = 0; document.getElementById('camera-native').addEventListener('click', (e) => { window.__opened++; e.preventDefault(); }); });
    await page.locator('#camera-open').click();
    expect(await page.evaluate(() => window.__opened)).toBe(1);
    expect(await page.evaluate(() => !!document.getElementById('camera'))).toBe(false);
    // les photos choisies entrent dans l'atelier
    await page.setInputFiles('#camera-native', [fixture('photo-wood.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 1 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const ds = await app.drawings();
    expect(ds[0].name).toBe('photo-wood.png');
    expect(app.errors).toEqual([]);
  });
});
