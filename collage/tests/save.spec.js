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

test.describe('Retouches de découpe sauvegardées', () => {
  test('une découpe retouchée est rejouée à l’identique à la réouverture', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    const coverage = () => page.evaluate(() => {
      const p = AtelierGribouille.state.drawings[0].analysis.pieces[0];
      const d = p.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.canvas.width, p.canvas.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++;
      return { opaque: n, w: p.canvas.width, h: p.canvas.height, edited: !!p.edited };
    });
    const before = await coverage();
    expect(before.edited).toBe(false);
    // on ouvre l'éditeur sur la première pièce et on gomme une large bande au milieu
    await page.evaluate(() => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[0]));
    await expect(page.locator('#editor')).toBeVisible();
    await page.locator('#ed-size').fill('140');
    const box = await page.locator('#ed-canvas').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.6 * i / 20), y);
    await page.mouse.up();
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    const edited = await coverage();
    expect(edited.edited).toBe(true);
    expect(edited.opaque).toBeLessThan(before.opaque * 0.9);

    await page.locator('#save-comp').click();
    await page.fill('#save-name', 'Avec retouche');
    await page.locator('#save-form button[type=submit]').click();
    await expect(page.locator('#save-status')).toContainText('sauvegardée');
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('1 retouche(s) rejouée(s)', { timeout: 120000 });
    const after = await coverage();
    expect(after.edited).toBe(true);
    expect(after.w).toBe(edited.w);
    expect(after.h).toBe(edited.h);
    expect(Math.abs(after.opaque - edited.opaque) / edited.opaque).toBeLessThan(0.02);
    // la pièce retouchée garde sa retouche à l'export haute définition
    const hd = await page.evaluate(async () => {
      const A = AtelierGribouille; const comp = A.state.comp;
      await A.hydrateHD(comp, 300 / 2.54);
      const L = comp.items.find((x) => x.piece === A.state.drawings[0].analysis.pieces[0]);
      const r = L && L.piece.hd ? { w: L.piece.hd.width, h: L.piece.hd.height } : null;
      A.releaseHD();
      return r;
    });
    if (hd) expect(hd.w / hd.h).toBeCloseTo(after.w / after.h, 1);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});

test.describe('Dessin dupliqué', () => {
  test('la copie a sa propre découpe : la retoucher ne change pas l’originale, et c’est gardé à la réouverture', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    const opaque = (c) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; };
    const state = () => page.evaluate((src) => {
      const opaque = new Function(`return (${src})`)();
      const A = AtelierGribouille, p0 = A.state.drawings[0].analysis.pieces[0];
      const items = A.state.comp.items.filter((L) => (L.piece.copyOf || L.piece) === p0);
      return items.map((L) => ({ copy: !!L.piece.copyOf, opaque: opaque(L.piece.canvas) }));
    }, opaque.toString());
    // sélectionner la pièce sur l'œuvre, la dupliquer
    await page.evaluate(() => {
      const A = AtelierGribouille, p0 = A.state.drawings[0].analysis.pieces[0];
      A.state.selected = A.state.comp.items.find((L) => L.piece === p0); A.render();
    });
    await page.locator('#toolbar [data-act="dup"]').click();
    const s0 = await state();
    expect(s0.map((x) => x.copy)).toEqual([false, true]);
    expect(s0[1].opaque).toBe(s0[0].opaque);
    // retoucher la copie (sélectionnée après la duplication)
    await page.locator('#toolbar [data-act="edit"]').click();
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#editor')).toContainText('copie');
    await page.locator('#ed-size').fill('140');
    const box = await page.locator('#ed-canvas').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.6 * i / 20), y);
    await page.mouse.up();
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    const s1 = await state();
    expect(s1[0].opaque).toBe(s0[0].opaque); // l'originale n'a pas bougé
    expect(s1[1].opaque).toBeLessThan(s0[0].opaque * 0.9);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].analysis.pieces[0].edited)).toBeFalsy();

    await page.locator('#save-comp').click();
    await page.fill('#save-name', 'Avec copie');
    await page.locator('#save-form button[type=submit]').click();
    await expect(page.locator('#save-status')).toContainText('sauvegardée');
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    const s2 = await state();
    expect(s2.map((x) => x.copy)).toEqual([false, true]);
    expect(Math.abs(s2[0].opaque - s0[0].opaque) / s0[0].opaque).toBeLessThan(0.02);
    expect(Math.abs(s2[1].opaque - s1[1].opaque) / s1[1].opaque).toBeLessThan(0.03);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});
