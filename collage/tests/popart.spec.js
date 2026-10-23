// Pop art (atelier Impression) : la toile en grille de cases bord à bord, une couleur vive par case et un
// dessin au centre de chacune ; de 1 à 3 dessins, le plus beau répété en 2 × 2.
const path = require('path');
const { test, expect, openStep, fixture } = require('./helpers');

const sample = (n) => path.join(__dirname, '..', 'samples', `${n}.jpg`);
const open = async (page, files) => {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto('index.html?mode=impression');
  await page.waitForFunction(() => window.AtelierGribouille);
  await page.setInputFiles('#file', files);
  await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 180000 });
};
const pop = (page) => page.evaluate(() => {
  const A = AtelierGribouille, c = A.state.comp;
  const T = c.tiles || [];
  const area = T.reduce((a, t) => a + t.w * t.h, 0);
  // deux cases voisines (côte à côte ou l'une sur l'autre) n'ont jamais la même couleur
  const touch = (a, b) => (Math.abs(a.x + a.w - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01) || (Math.abs(a.y + a.h - b.y) < 0.01 && Math.abs(a.x - b.x) < 0.01);
  const same = T.some((a) => T.some((b) => a !== b && touch(a, b) && a.color === b.color));
  // chaque dessin au centre de sa case, dans la case
  const inCell = c.items.every((L, i) => { const t = T[L.frame]; return t && Math.abs(L.x - (t.x + t.w / 2)) < 0.01 && Math.abs(L.y - (t.y + t.h / 2)) < 0.01 && L.w <= t.w && L.h <= t.h; });
  return { style: c.style, W: c.W, H: c.H, tiles: T.length, cover: area / (c.W * c.H), same, inCell, items: c.items.length, drawings: new Set(c.items.map((L) => L.piece.drawing)).size, colors: T.map((t) => t.color) };
});

test.describe('Pop art', () => {
  test('neuf dessins : une case vive par dessin, voisines de couleurs différentes ; rangé puis rouvert à l’identique ; exporté', async ({ page }) => {
    test.setTimeout(240000);
    await open(page, ['chat', 'soleil', 'maison', 'arbre', 'oiseau', 'fleur', 'papillon', 'voiture', 'escargot'].map(sample));
    const ids = await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id));
    expect(ids).toContain('popart');
    expect(ids).not.toContain('village'); // (le Village n'est plus proposé)
    await page.locator('#proposals .proposal').nth(ids.indexOf('popart')).click();
    await expect(page.locator('#label')).toContainText(/pop art/i);
    // pas de choix de la couleur du fond (les cases couvrent tout) ; il revient sur une autre proposition
    await expect(page.locator('#ground-open')).toBeHidden();
    await expect(page.locator('.ground-field')).toBeHidden();
    await page.evaluate(() => AtelierGribouille.selectProposal(0));
    await expect(page.locator('#ground-open')).toBeVisible();
    await page.locator('#proposals .proposal').nth(ids.indexOf('popart')).click();
    await expect(page.locator('#ground-open')).toBeHidden();
    const v = await pop(page);
    expect(v).toMatchObject({ style: 'popart', tiles: 9, items: 9, drawings: 9, same: false, inCell: true });
    expect(v.cover).toBeCloseTo(1, 3);
    // rangée puis rouverte : mêmes cases, mêmes couleurs
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1, { timeout: 30000 });
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await openStep(page, 'saved-section');
    await page.locator('#saved-list .saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 180000 });
    const w = await pop(page);
    expect(w.style).toBe('popart');
    expect(w.colors).toEqual(v.colors);
    expect(w.items).toBe(9);
    // un autre cadre : les cases suivent (toujours toute la toile)
    await page.selectOption('#format', 'cadre:40x50');
    await page.waitForTimeout(400);
    const x = await pop(page);
    expect([x.W, x.H]).toEqual([40, 50]);
    expect(x.cover).toBeCloseTo(1, 3);
    expect(x.colors).toEqual(v.colors);
    // l'image et le PDF se rendent
    await openStep(page, 'export-section');
    await page.locator('#dpi').selectOption('150');
    const [d1] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#export').click()]);
    expect(require('fs').readFileSync(await d1.path())[0]).toBe(0xff);
    await page.locator('#fmt').selectOption('application/pdf');
    const [d2] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#export').click()]);
    expect(require('fs').readFileSync(await d2.path()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('deux dessins : le plus beau, répété en 2 × 2 sur quatre couleurs', async ({ page }) => {
    await open(page, ['chat', 'maison'].map(sample));
    await page.evaluate(() => { const A = AtelierGribouille; A.selectProposal(A.state.proposals.findIndex((p) => p.style.id === 'popart')); });
    const v = await pop(page);
    expect(v).toMatchObject({ tiles: 4, items: 4, drawings: 1, same: false, inCell: true });
    expect(new Set(v.colors).size).toBe(4);
  });

  test('pas de Pop art en collage des originaux', async ({ app }) => {
    await app.import(['page-cutout.png', 'page-texture.png']);
    const ids = await app.page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id));
    expect(ids).not.toContain('popart');
  });
});
