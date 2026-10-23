// Recadrer une page de fond : « Recadrer la page » dans la fiche du dessin. La page posée sur l'œuvre
// suit le nouveau cadre à la même échelle ; Défaire et Refaire ; le cadrage est gardé à la réouverture.
const { test, expect, openStep } = require('./helpers');

// le dessin en page de fond posé sur l'œuvre (page-texture.png mis en Fond s'il ne l'est pas)
async function pageOnArt(page) {
  await openStep(page, 'drawings-section');
  const k = await page.evaluate(() => AtelierGribouille.state.drawings.findIndex((d) => /page-texture/.test(d.name)));
  await page.locator(`#drawings .thumb[data-i="${k}"]`).click();
  const fond = page.locator('#detail [data-role="texture"]');
  if (!(await fond.evaluate((b) => b.classList.contains('on')))) {
    await fond.click();
    await page.waitForFunction((k) => { const S = AtelierGribouille.state, t = S.drawings[k].analysis.texture; return S.comp && t && S.comp.bg.some((L) => L.src === t.canvas); }, k, { timeout: 60000 });
  }
  return k;
}
const layerOf = (page, k) => page.evaluate((k) => {
  const S = AtelierGribouille.state, d = S.drawings[k], t = d.analysis.texture;
  const L = S.comp.bg.find((x) => x.src === t.canvas);
  return { crop: AtelierGribouille.cropOf(d), raw: d.crop || null, deg: d.orientDeg || 0, tw: t.canvas.width, th: t.canvas.height, pw: d.analysis.page.width, ph: d.analysis.page.height, w: L && L.w, h: L && L.h, x: L && L.x, sw: L && L.sw, whole: L && L.sx <= 1 && L.sw >= t.canvas.width - 1 };
}, k);

test.describe('Recadrer une page de fond', () => {
  test('« Recadrer la page » : la page posée suit le cadre, à la même échelle ; vignette ; Défaire et Refaire', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    const k = await pageOnArt(page);
    const a = await layerOf(page, k);
    expect(a.crop).toBeNull();
    expect(a.w).toBeGreaterThan(0);
    // pas de bouton « Recadrer » pour une découpe
    const cut = await page.evaluate(() => AtelierGribouille.state.drawings.findIndex((d) => /page-cutout/.test(d.name)));
    await page.locator(`#drawings .thumb[data-i="${cut}"]`).click();
    await expect(page.locator('#detail [data-crop]')).toHaveCount(0);
    await page.locator(`#drawings .thumb[data-i="${k}"]`).click();

    await page.locator('#detail [data-crop]').click();
    await expect(page.locator('#crop')).toBeVisible();
    await expect(page.locator('#crop-canvas')).toBeFocused();
    await expect(page.locator('#crop-reset')).toBeHidden();
    // au clavier : 20 % de moins en largeur et en hauteur, puis 5 % vers la droite
    for (let i = 0; i < 20; i++) { await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowUp'); }
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('#crop-reset')).toBeVisible();
    await page.locator('#crop-apply').click();
    await expect(page.locator('#crop')).toBeHidden();

    const b = await layerOf(page, k);
    expect(b.crop.x).toBeCloseTo(0.065, 3);
    expect(b.crop.y).toBeCloseTo(0.015, 3);
    expect(b.crop.w).toBeCloseTo(0.77, 3);
    expect(b.crop.h).toBeCloseTo(0.77, 3);
    expect(Math.abs(b.tw - b.pw * 0.77)).toBeLessThan(2);
    // même échelle : la page posée perd ce que le cadre a retiré
    expect(b.w / a.w).toBeCloseTo(0.77 / 0.97, 2);
    expect(b.h / a.h).toBeCloseTo(0.77 / 0.97, 2);
    if (a.whole) expect(b.whole).toBe(true);
    // la fiche et la vignette montrent la page recadrée
    const thumbs = await page.evaluate((k) => { const d = AtelierGribouille.state.drawings[k]; return [d.cropThumb, document.querySelector('#detail > img').src, document.querySelector(`#drawings .thumb[data-i="${k}"] img`).src]; }, k);
    expect(thumbs[0]).toBeTruthy();
    expect(thumbs[1]).toBe(thumbs[0]);
    expect(thumbs[2]).toBe(thumbs[0]);

    // l'export haute définition relit la page recadrée de la même façon
    const hd = await page.evaluate(async (k) => {
      const A = AtelierGribouille, t = A.state.drawings[k].analysis.texture;
      await A.hydrateHD(A.state.comp, 300 / 2.54);
      const r = t.canvas.hd ? { w: t.canvas.hd.width, h: t.canvas.hd.height } : null;
      A.releaseHD();
      return r;
    }, k);
    if (hd) expect(hd.w / hd.h).toBeCloseTo(b.tw / b.th, 1);

    // Défaire : la page d'origine revient sur l'œuvre ; Refaire : le cadrage revient
    await page.evaluate(() => AtelierGribouille.undo());
    const c = await layerOf(page, k);
    expect(c.crop).toBeNull();
    expect(c.tw).toBe(a.tw);
    expect(c.w).toBeCloseTo(a.w, 5);
    expect(c.x).toBeCloseTo(a.x, 5);
    await page.evaluate(() => AtelierGribouille.redo());
    const d = await layerOf(page, k);
    expect(d.crop.w).toBeCloseTo(0.77, 3);
    expect(d.w).toBeCloseTo(b.w, 5);

    // « Toute la page » puis Annuler : rien ne change
    await page.locator('#detail [data-crop]').click();
    await page.locator('#crop-all').click();
    await page.locator('#crop [data-close]').last().click();
    expect((await layerOf(page, k)).crop.w).toBeCloseTo(0.77, 3);
    // « Rétablir » : le cadrage d'origine
    await page.locator('#detail [data-crop]').click();
    await page.locator('#crop-reset').click();
    await page.locator('#crop-apply').click();
    const e = await layerOf(page, k);
    expect(e.crop).toBeNull();
    expect(e.w).toBeCloseTo(a.w, 4);
  });

  test('cadre tiré à la souris ; le cadrage est gardé à la réouverture de l’œuvre', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    const k = await pageOnArt(page);
    await page.locator('#detail [data-crop]').click();
    await expect(page.locator('#crop')).toBeVisible();
    // le coin haut gauche du cadre, tiré vers l'intérieur (une fois la fenêtre arrivée)
    await page.locator('.crop-card').evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
    const box = await page.locator('#crop-canvas').boundingBox();
    const { pw, ph } = await layerOf(page, k);
    const s = Math.min((box.width - 32) / pw, (box.height - 32) / ph);
    const ox = box.x + (box.width - pw * s) / 2, oy = box.y + (box.height - ph * s) / 2;
    const hx = ox + 0.015 * pw * s, hy = oy + 0.015 * ph * s;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + pw * s * 0.2, hy + ph * s * 0.1, { steps: 5 });
    await page.mouse.up();
    await page.locator('#crop-apply').click();
    const a = await layerOf(page, k);
    expect(a.crop.x).toBeCloseTo(0.215, 2);
    expect(a.crop.y).toBeCloseTo(0.115, 2);
    expect(a.crop.x + a.crop.w).toBeCloseTo(0.985, 3); // (le coin opposé n'a pas bougé)

    // l'œuvre rangée, la page rechargée, l'œuvre rouverte : même cadrage, même page posée
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1, { timeout: 30000 });
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await openStep(page, 'saved-section');
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    const b = await layerOf(page, k);
    expect(b.raw).toEqual(a.raw);
    expect(b.crop).toEqual(a.crop);
    expect(b.tw).toBe(a.tw);
    expect(b.w).toBeCloseTo(a.w, 3);
    expect(b.sw).toBeCloseTo(a.sw, 3);
  });
});
