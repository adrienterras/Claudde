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

  test('« Dupliquer » : un nouveau dessin dans la liste, indépendant de l’original ; Défaire le retire ; une page de fond aussi', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-texture.png']);
    const names = () => page.evaluate(() => AtelierGribouille.state.drawings.map((d) => d.name));
    const on = (name) => page.evaluate((name) => { const S = AtelierGribouille.state, d = S.drawings.find((x) => x.name === name); return d ? S.comp.items.filter((L) => L.piece.drawing === d).length + S.comp.bg.filter((L) => !L.paper && L.drawing === d).length : -1; }, name);
    // la découpe sélectionnée, dupliquée par la barre d'outils
    await page.evaluate(() => { const S = AtelierGribouille.state; S.selected = S.comp.items.find((L) => L.piece.drawing === S.drawings[0]); AtelierGribouille.render(); });
    await page.locator('#toolbar [data-act="dup"]').click();
    expect(await names()).toEqual(['page-cutout.png', 'page-cutout.png (copie)', 'page-texture.png']);
    expect(await on('page-cutout.png (copie)')).toBe(1);
    // la copie a sa page et sa découpe à elle
    const own = await page.evaluate(() => { const [a, b] = AtelierGribouille.state.drawings; return a.analysis.page !== b.analysis.page && a.analysis.pieces[0] !== b.analysis.pieces[0] && a.analysis.pieces[0].canvas !== b.analysis.pieces[0].canvas && b.analysis.pieces[0].drawing === b; });
    expect(own).toBe(true);
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    await expect(page.locator('#drawings .thumb')).toHaveCount(3);
    // retirée de l'œuvre : la copie seule passe dans « Non utilisé », l'original reste
    await page.keyboard.press('Delete');
    expect(await on('page-cutout.png (copie)')).toBe(0);
    expect(await on('page-cutout.png')).toBe(1);
    await expect(page.locator('#drawings .thumb[data-i="1"] + .thumb-add')).toHaveCount(1);
    // Défaire deux fois : la copie revient, puis disparaît de la liste
    await page.evaluate(() => AtelierGribouille.undo());
    expect(await on('page-cutout.png (copie)')).toBe(1);
    await page.evaluate(() => AtelierGribouille.undo());
    expect(await names()).toEqual(['page-cutout.png', 'page-texture.png']);
    // Refaire : elle revient
    await page.evaluate(() => AtelierGribouille.redo());
    expect(await names()).toEqual(['page-cutout.png', 'page-cutout.png (copie)', 'page-texture.png']);
    // une page de fond se duplique aussi : un nouveau dessin, sa page posée sur l'œuvre
    await page.evaluate(() => { const S = AtelierGribouille.state; S.selected = S.comp.bg.find((L) => !L.paper && L.drawing && /page-texture/.test(L.drawing.name)) || S.comp.bg.find((L) => !L.paper); AtelierGribouille.render(); });
    await expect(page.locator('#toolbar [data-act="dup"]')).toBeEnabled();
    await page.locator('#toolbar [data-act="dup"]').click();
    expect(await names()).toEqual(['page-cutout.png', 'page-cutout.png (copie)', 'page-texture.png', 'page-texture.png (copie)']);
    expect(await on('page-texture.png (copie)')).toBe(1);
  });

  test('collage : la taille à vérifier est celle de la feuille d’origine, entière ; ses sujets suivent', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 3 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // une ligne par feuille : page-cutout.png, et page-two.png entière (ses deux sujets)
    const rows = page.locator('#sizes-check .sizes-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).locator('.sizes-name')).toContainText('Dessins 2, 3');
    await expect(rows.nth(1).locator('.sizes-name')).toContainText('feuille entière');
    const cm = () => page.evaluate(() => AtelierGribouille.state.drawings.map((d) => d.sizeCm));
    const before = await cm();
    // la feuille en A3 : ses deux sujets grandissent d'autant, l'autre dessin ne bouge pas
    await rows.nth(1).locator('[data-cm="42"]').click();
    const after = await cm();
    expect(after[0]).toBe(before[0]);
    const k = 42 / 29.7;
    expect(after[1] / before[1]).toBeCloseTo(k, 1);
    expect(after[2] / before[2]).toBeCloseTo(k, 1);
    // la fiche d'un sujet règle aussi la feuille entière
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    await page.locator('#drawings .thumb[data-i="2"]').click();
    await expect(page.locator('#detail')).toContainText('Taille de la feuille d’origine, entière');
    await expect(page.locator('#detail [data-cm="42"]')).toHaveClass(/on/);
    await page.locator('#detail [data-cm="21"]').click();
    const a5 = await cm();
    expect(a5[1] / before[1]).toBeCloseTo(21 / 29.7, 1);
    expect(a5[2] / before[2]).toBeCloseTo(21 / 29.7, 1);
  });
});
