// Une page à plusieurs sujets devient un dessin par sujet dans la liste : chacun se retire et se remet
// à part, garde l'échelle de sa feuille, et l'œuvre rouverte retrouve les mêmes dessins.
const { test, expect } = require('./helpers');

const hasDraft = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('atelier-gribouille');
  r.onsuccess = () => { const db = r.result; try { const g = db.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => { db.close(); res(!!(g.result && g.result.drawings && g.result.drawings.length)); }; g.onerror = () => { db.close(); res(false); }; } catch (e) { db.close(); res(false); } };
  r.onerror = () => res(false);
}));

test.describe('Une page, plusieurs sujets', () => {
  test('chaque sujet devient un dessin de la liste, à l’échelle de sa feuille ; retiré et remis seul ; gardé à la réouverture', async ({ app }) => {
    test.setTimeout(180000);
    const { page } = app;
    // page-two.png : deux sujets sur une feuille ; page-cutout.png : un seul
    await app.import(['page-cutout.png', 'page-two.png'], 3);
    const list = () => page.evaluate(() => AtelierGribouille.state.drawings.map((d) => ({ name: d.name, pieces: (d.analysis.pieces || []).length, cmPx: d.sizeCm / d.srcLong, sheet: !!d.sheet })));
    const ds = await list();
    expect(ds.map((d) => d.name)).toEqual(['page-cutout.png', 'page-two — 1', 'page-two — 2']);
    expect(ds.every((d) => d.pieces === 1)).toBe(true);
    // les deux sujets gardent l'échelle de leur feuille (même nombre de centimètres par pixel)
    expect(Math.abs(ds[1].cmPx / ds[2].cmPx - 1)).toBeLessThan(0.01); // (tailles arrondies au millimètre)
    // deux vignettes dans la liste, sur l'œuvre chacun le sien
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    await expect(page.locator('#drawings .thumb')).toHaveCount(3);
    const on = () => page.evaluate(() => { const S = AtelierGribouille.state; return S.drawings.map((d) => S.comp.items.filter((L) => L.piece.drawing === d).length); });
    expect((await on()).every((n) => n > 0)).toBe(true);
    // le premier sujet retiré seul : l'autre reste
    await page.evaluate(() => { const S = AtelierGribouille.state; S.selected = S.comp.items.find((L) => L.piece.drawing === S.drawings[1]); });
    await page.keyboard.press('Delete');
    let n = await on();
    expect(n[1]).toBe(0);
    expect(n[2]).toBeGreaterThan(0);
    await expect(page.locator('#drawings .thumb[data-i="1"] + .thumb-add')).toHaveCount(1);
    // remis par son « + »
    await page.locator('#drawings .thumb[data-i="1"] + .thumb-add').click();
    n = await on();
    expect(n[1]).toBeGreaterThan(0);
    // l'œuvre rouverte : les mêmes dessins, pas une nouvelle découpe de la feuille
    for (let i = 0; i < 120 && !(await hasDraft(page)); i++) await page.waitForTimeout(500);
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.comp && document.getElementById('progress').hidden && AtelierGribouille.state.drawings.length >= 3, null, { timeout: 120000 });
    const again = await list();
    expect(again.map((d) => d.name)).toEqual(ds.map((d) => d.name));
    expect(again.every((d) => d.pieces === 1)).toBe(true);
    expect(Math.abs(again[1].cmPx / ds[1].cmPx - 1)).toBeLessThan(0.01);
    // la feuille réimportée est reconnue : elle n'est pas ajoutée une deuxième fois
    await page.setInputFiles('#file', [require('./helpers').fixture('page-two.png')]);
    await expect(page.locator('#notice')).toContainText('déjà dans l’atelier');
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(3);
  });
});
