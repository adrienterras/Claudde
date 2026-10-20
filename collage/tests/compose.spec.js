const { test, expect } = require('./helpers');

// (la Galerie n'est proposée qu'en tableau imprimé)
const STYLES = ['paysage', 'frise', 'nuage', 'tournesol', 'courtepointe', 'cabinet'];

test.describe('Compositions', () => {
  test.beforeEach(async ({ app }) => {
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png', 'photo-wood.png']);
  });

  test('six propositions en collage (sept en tableau imprimé), Paysage en premier, chacune avec du contenu', async ({ app }) => {
    const ps = await app.proposals();
    expect(ps.map((p) => p.style)).toEqual(STYLES);
    for (const p of ps) {
      expect(p.items + p.bg, p.style).toBeGreaterThan(0);
      expect(p.W).toBeGreaterThan(10);
      expect(p.H).toBeGreaterThan(10);
    }
    expect(await app.page.locator('#proposals .proposal').count()).toBe(STYLES.length);
    await expect(app.page.locator('#proposals .proposal.on')).toContainText('Paysage');
  });

  test('chaque style se sélectionne et se dessine ; la Galerie n’existe qu’en tableau imprimé, avec ses boutons', async ({ app }) => {
    const { page } = app;
    // collage : pas de Galerie parmi les propositions
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id))).toEqual(STYLES);
    for (const id of STYLES) {
      await app.select(id);
      await page.waitForTimeout(200);
      const active = await page.evaluate(() => AtelierGribouille.state.comp.style);
      expect(active).toBe(id);
      await expect(page.locator('[data-act="bigger"]')).toBeHidden();
    }
    // tableau imprimé : la Galerie s'ajoute, avec ses boutons agrandir / réduire
    await page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id))).toEqual([...STYLES, 'galerie']);
    await app.select('galerie');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-act="bigger"]')).toBeVisible();
    // retour au collage : la Galerie disparaît, la proposition affichée reste valable
    await page.evaluate(() => { AtelierGribouille.setMode('toile'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.some((p) => p.style.id === 'galerie'))).toBe(false);
    expect(STYLES).toContain(await page.evaluate(() => AtelierGribouille.state.comp.style));
  });

  test('la Galerie, densité au maximum, montre tous les dessins sans chevauchement', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
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

  test('Galerie : cases carrées et même bord des quatre côtés, le nombre de cases s’adapte au cadre', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    for (const fmt of ['cadre:21x30', 'cadre:30x40', 'cadre:50x70']) {
      await page.selectOption('#format', fmt);
      // (en tableau imprimé, changer de cadre étire l'œuvre affichée sans la recomposer : on repart d'une grille fraîche)
      await page.evaluate(() => { AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
      await page.waitForTimeout(300);
      await app.select('galerie');
      const r = await page.evaluate(() => {
        const c = AtelierGribouille.state.comp, F = c.frames;
        const xs = [...new Set(F.map((f) => f.x.toFixed(3)))].map(Number).sort((a, b) => a - b);
        const ys = [...new Set(F.map((f) => f.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
        return {
          n: F.length, kept: c.kept, total: c.total,
          left: Math.min(...F.map((f) => f.x)), top: Math.min(...F.map((f) => f.y)),
          right: c.W - Math.max(...F.map((f) => f.x + f.w)), bottom: c.H - Math.max(...F.map((f) => f.y + f.h)),
          square: F.every((f) => Math.abs(f.w - f.h) < 1e-6),
          gapX: xs.length > 1 ? xs[1] - (xs[0] + F[0].w) : null, gapY: ys.length > 1 ? ys[1] - (ys[0] + F[0].h) : null,
          inside: c.items.every((L) => { const f = F[L.frame]; return L.w <= f.w + 1e-6 && L.h <= f.h + 1e-6; }),
        };
      });
      expect(r.n).toBeGreaterThan(0);
      expect(r.square).toBe(true);
      // le cadre est imposé : la grille de cases carrées est centrée (marges égales gauche/droite et haut/bas)
      expect(r.right, `${fmt} right`).toBeCloseTo(r.left, 3);
      expect(r.bottom, `${fmt} bottom`).toBeCloseTo(r.top, 3);
      expect(Math.min(r.left, r.top)).toBeGreaterThanOrEqual(1.5);
      if (r.gapX !== null && r.gapY !== null) expect(r.gapX).toBeCloseTo(r.gapY, 3);
      expect(r.inside).toBe(true);
      expect(r.kept).toBeLessThanOrEqual(r.total);
    }
  });

  test('Galerie : une pièce retirée puis remise revient dans son cadre', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
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
    await page.locator('#density').fill('1.1'); // (au maximum par défaut : tous les dessins)
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
    expect(r.W / r.H).toBeGreaterThanOrEqual(2); // toile panoramique Cultura (120 × 40, 100 × 50, 80 × 40)
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

  test('Courtepointe sans page de fond (atelier Impression) : les découpes en rangées pleine largeur, toute la toile couverte', async ({ app }) => {
    // la page peinte serait collée en fond : ici on la veut en découpe, pour une œuvre sans page de fond
    await app.page.evaluate(() => { const sec = document.getElementById('drawings-section'); if (sec.classList.contains('collapsed')) sec.querySelector('h2').click(); });
    await app.page.locator('#drawings .thumb[data-i="2"]').click();
    await app.page.locator('#detail [data-role="cutout"]').click();
    await app.page.waitForTimeout(300);
    // tous les dessins (curseur au maximum)
    await app.page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    // passage en Impression (par le code : le type d'œuvre ne se change plus une fois l'œuvre commencée)
    await app.page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.state.formatManual = false; AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    await app.page.waitForTimeout(400);
    await app.select('courtepointe');
    const r = await app.page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      return { W: c.W, H: c.H, bg: c.bg.length, items: c.items.map((L) => ({ x: L.x, y: L.y, w: L.w, h: L.h, scale: L.scale, rot: L.rot })) };
    });
    expect(r.bg).toBe(0);
    expect(r.items.length).toBeGreaterThan(2);
    // les pièces s'étendent sur toute la toile (pas entassées en bas ni au centre), aucune agrandie
    const x0 = Math.min(...r.items.map((it) => it.x - it.w / 2)), x1 = Math.max(...r.items.map((it) => it.x + it.w / 2));
    const y0 = Math.min(...r.items.map((it) => it.y - it.h / 2)), y1 = Math.max(...r.items.map((it) => it.y + it.h / 2));
    // (les pièces d'essai sont petites : elles ne couvrent pas tout, mais s'étalent et restent centrées)
    expect(x1 - x0).toBeGreaterThan(0.55 * r.W);
    expect(Math.abs((x0 + x1) / 2 - r.W / 2)).toBeLessThan(0.1 * r.W);
    expect(Math.abs((y0 + y1) / 2 - r.H / 2)).toBeLessThan(0.1 * r.H);
    expect(x0).toBeGreaterThan(-0.01 * r.W);
    expect(y0).toBeGreaterThan(-0.01 * r.H);
    for (const it of r.items) expect(it.scale || 1).toBeLessThanOrEqual(1.0001);
    for (const it of r.items) expect(Math.abs(it.rot)).toBeLessThan(0.05);
    await app.page.evaluate(() => { AtelierGribouille.setMode('toile'); AtelierGribouille.state.formatManual = false; AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    await app.page.waitForTimeout(400);
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
