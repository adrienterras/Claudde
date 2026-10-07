const { test, expect } = require('./helpers');

const STYLES = ['paysage', 'frise', 'nuage', 'tournesol', 'courtepointe', 'cabinet', 'galerie'];

test.describe('Compositions', () => {
  test.beforeEach(async ({ app }) => {
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png', 'photo-wood.png']);
  });

  test('sept propositions, Paysage en premier, chacune avec du contenu', async ({ app }) => {
    const ps = await app.proposals();
    expect(ps.map((p) => p.style)).toEqual(STYLES);
    for (const p of ps) {
      expect(p.items + p.bg, p.style).toBeGreaterThan(0);
      expect(p.W).toBeGreaterThan(10);
      expect(p.H).toBeGreaterThan(10);
    }
    expect(await app.page.locator('#proposals .proposal').count()).toBe(7);
    await expect(app.page.locator('#proposals .proposal.on')).toContainText('Paysage');
  });

  test('chaque style se sélectionne et se dessine, les boutons de la Galerie n’apparaissent qu’en Galerie', async ({ app }) => {
    const { page } = app;
    for (const id of STYLES) {
      await app.select(id);
      await page.waitForTimeout(200);
      const active = await page.evaluate(() => AtelierGribouille.state.comp.style);
      expect(active).toBe(id);
      const galleryBtn = page.locator('[data-act="bigger"]');
      if (id === 'galerie') await expect(galleryBtn).toBeVisible(); else await expect(galleryBtn).toBeHidden();
    }
  });

  test('la Galerie, densité au maximum, montre tous les dessins sans chevauchement', async ({ app }) => {
    await app.page.locator('#density').fill('1.8');
    await app.page.waitForTimeout(300);
    await app.select('galerie');
    const g = await app.page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      const boxes = c.items.map((L) => [L.x - L.w / 2, L.y - L.h / 2, L.x + L.w / 2, L.y + L.h / 2]);
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        if (ox > 0.3 && oy > 0.3) overlaps++;
      }
      return { kept: c.kept, total: c.total, items: c.items.length, bg: c.bg.length, overlaps, reduced: !!c.reduced };
    });
    expect(g.kept).toBe(g.total);
    expect(g.items + g.bg).toBe(4);
    expect(g.overlaps).toBe(0);
  });

  test('Galerie : une pièce retirée puis remise revient dans son cadre', async ({ app }) => {
    const { page } = app;
    await app.page.locator('#density').fill('1.8');
    await app.page.waitForTimeout(300);
    await app.select('galerie');
    await page.locator('#drawings-section > h2').click();
    const before = await page.evaluate(() => { const L = AtelierGribouille.state.comp.items[0]; return { id: L.piece.id, x: L.x, y: L.y, w: L.w, frame: L.frame }; });
    expect(before.frame).toBeDefined();
    const thumb = page.locator('#pieces .thumb').nth(await page.evaluate((id) => AtelierGribouille.state.drawings.flatMap((d) => d.analysis.pieces || []).findIndex((p) => p.id === id), before.id));
    // on retire la pièce, puis on la remet
    await thumb.click();
    await page.waitForTimeout(200);
    expect(await page.evaluate((id) => AtelierGribouille.state.comp.items.some((L) => L.piece.id === id), before.id)).toBe(false);
    await thumb.click();
    await page.waitForTimeout(200);
    const after = await page.evaluate((id) => { const L = AtelierGribouille.state.comp.items.find((x) => x.piece.id === id); return L && { x: L.x, y: L.y, w: L.w, frame: L.frame }; }, before.id);
    expect(after).not.toBeNull();
    expect(after.frame).toBe(before.frame);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(after.w).toBeCloseTo(before.w, 3);
  });

  test('« Nouvelles propositions » change la mise en place, la densité aussi', async ({ app }) => {
    const { page } = app;
    const sig = () => page.evaluate(() => AtelierGribouille.state.proposals[0].comp.items.map((L) => [L.x.toFixed(1), L.y.toFixed(1)].join(',')).join(';'));
    const a = await sig();
    await page.locator('#generate').click();
    await page.waitForTimeout(300);
    const b = await sig();
    expect(b).not.toBe(a);
    await page.locator('#density').fill('1.8');
    await page.waitForTimeout(300);
    const c = await sig();
    expect(c).not.toBe(b);
  });

  test('Frise : toile panoramique, sujets droits et dans la toile', async ({ app }) => {
    await app.select('frise');
    const r = await app.page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      return { W: c.W, H: c.H, items: c.items.map((L) => ({ x: L.x, y: L.y, w: L.w, h: L.h, rot: L.rot })) };
    });
    expect(r.W / r.H).toBeGreaterThan(2);
    expect(r.items.length).toBeGreaterThan(0);
    // chaque page peinte n'est posée qu'une fois dans la bande
    const srcs = await app.page.evaluate(() => AtelierGribouille.state.comp.bg.filter((L) => L.panel).map((L) => L.src));
    expect(new Set(srcs).size).toBe(srcs.length);
    for (const it of r.items) {
      expect(Math.abs(it.rot)).toBeLessThan(0.1);
      expect(it.x).toBeGreaterThan(-it.w / 2);
      expect(it.x).toBeLessThan(r.W + it.w / 2);
      expect(it.y).toBeGreaterThan(-it.h / 2);
      expect(it.y).toBeLessThan(r.H + it.h / 2);
    }
  });

  test('Nuage : fond uni sans page peinte, sujets droits et espacés', async ({ app }) => {
    await app.select('nuage');
    const r = await app.page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      return { bg: c.bg.filter((L) => !L.paper).length, items: c.items.map((L) => ({ x: L.x, y: L.y, w: L.w, h: L.h, rot: L.rot })) };
    });
    expect(r.bg).toBe(0);
    expect(r.items.length).toBeGreaterThan(1);
    for (const it of r.items) expect(Math.abs(it.rot)).toBeLessThan(0.1);
    for (let i = 0; i < r.items.length; i++) for (let j = i + 1; j < r.items.length; j++) {
      const a = r.items[i], b = r.items[j];
      const ox = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
      const oy = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
      expect(ox * oy / Math.min(a.w * a.h, b.w * b.h)).toBeLessThan(0.5);
    }
  });

  test('sélectionner une pièce sur la toile ouvre la fiche de son dessin', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      AtelierGribouille.state.selected = c.items[0];
    });
    // on simule le clic réel au centre de la première pièce
    const pt = await page.evaluate(() => {
      const c = AtelierGribouille.state.comp; const L = c.items[0];
      const canvas = document.getElementById('canvas'); const r = canvas.getBoundingClientRect();
      const fit = Math.min((r.width - 72) / c.W, (r.height - 72) / c.H);
      const ox = (r.width - c.W * fit) / 2, oy = (r.height - c.H * fit) / 2;
      return { x: r.left + ox + L.x * fit, y: r.top + oy + L.y * fit };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300);
    await expect(page.locator('#drawings-section')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#detail')).toBeVisible();
  });
});
