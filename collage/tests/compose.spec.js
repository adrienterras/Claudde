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

  test('chaque style se sélectionne et se dessine ; la Galerie et le Pop art n’existent qu’en tableau imprimé', async ({ app }) => {
    const { page } = app;
    // collage : ni Galerie ni Pop art parmi les propositions (le Village n'est plus proposé du tout)
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id))).toEqual(STYLES);
    for (const id of STYLES) {
      await app.select(id);
      await page.waitForTimeout(200);
      const active = await page.evaluate(() => AtelierGribouille.state.comp.style);
      expect(active).toBe(id);
    }
    // tableau imprimé : la Galerie et le Pop art s'ajoutent (plus de boutons agrandir / réduire : la
    // poignée carrée sur l'œuvre suffit)
    await page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id))).toEqual([...STYLES, 'galerie', 'popart']);
    await app.select('galerie');
    await page.waitForTimeout(200);
    await expect(page.locator('#toolbar [data-act="bigger"], #toolbar [data-act="smaller"]')).toHaveCount(0);
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

  test('Galerie sur un cadre imposé : 28 feuilles A4 en 15 cases sur un 30 × 40 gardent des dessins bien visibles', async ({ app }) => {
    const { page } = app;
    // (le cas d'un vrai tableau : la grille « même bord des quatre côtés » donnait des cases de 3,8 cm
    // dans un bord de 8 cm, et une marge de 1,6 cm réduisait chaque dessin à un point)
    const r = await page.evaluate(() => {
      const pieces = Array.from({ length: 28 }, (_, i) => ({ id: 'p' + i, drawing: { id: 'd' + i }, wcm: 21, hcm: 29.7, importance: 1, main: true, enabled: true }));
      const comp = Compose.generate({ style: 'galerie', format: { w: 30, h: 40 }, seed: 7, pieces, textures: [], densityT: 0.43 });
      const side = comp.frames[0].w;
      const minW = Math.min(...comp.items.map((L) => Math.max(L.w, L.h)));
      const left = Math.min(...comp.frames.map((f) => f.x)), right = comp.W - Math.max(...comp.frames.map((f) => f.x + f.w));
      return { n: comp.frames.length, side, minW, left, right, fill: minW / side };
    });
    expect(r.n).toBeGreaterThanOrEqual(12);
    expect(r.side).toBeGreaterThan(5);           // des cases d'au moins 5 cm (et non 3,8)
    expect(r.fill).toBeGreaterThan(0.7);         // le dessin occupe l'essentiel de sa case
    expect(r.left).toBeCloseTo(r.right, 3);      // grille centrée
    expect(r.left).toBeLessThan(6);              // sans bord énorme
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
  test('un dessin retiré de l’œuvre passe dans « Non utilisé », n’y revient pas en recomposant ; Défaire le remet', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    const i = await page.evaluate(() => { const st = AtelierGribouille.state; return st.drawings.indexOf(st.comp.items[0].piece.drawing); });
    const group = (k) => page.evaluate((k) => { const el = document.querySelector(`#drawings .thumb[data-i="${k}"]`); return el && el.closest('.drawings-group').classList[1]; }, i);
    expect(await group()).toBe('cutout');
    // toutes ses découpes retirées, une à une (touche Suppr, comme le bouton Retirer)
    const left = () => page.evaluate((k) => { const st = AtelierGribouille.state; return st.comp.items.filter((L) => L.piece.drawing === st.drawings[k]).length; }, i);
    const n = await left();
    for (let k = 0; k < n; k++) {
      await page.evaluate((k) => { const st = AtelierGribouille.state; st.selected = st.comp.items.find((L) => L.piece.drawing === st.drawings[k]); }, i);
      expect(await group()).toBe('cutout'); // (tant qu'une découpe reste sur l'œuvre, il reste au premier plan)
      await page.keyboard.press('Delete');
    }
    expect(await left()).toBe(0);
    expect(await group()).toBe('off');
    await expect(page.locator('#drawings .drawings-group.off h3')).toContainText('Non utilisé');
    // sa vignette reste bien visible (ni estompée ni grise, comme l'est une pièce retirée)
    expect(await page.evaluate((k) => { const s = getComputedStyle(document.querySelector(`#drawings .thumb[data-i="${k}"] img`)); return [s.opacity, s.filter]; }, i)).toEqual(['1', 'none']);
    // une recomposition (densité) ne le remet pas
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    expect(await left()).toBe(0);
    // Défaire (jusqu'avant le retrait) : il revient sur l'œuvre et au premier plan
    for (let k = 0; k < n + 1; k++) await page.evaluate(() => AtelierGribouille.undo());
    expect(await left()).toBe(n);
    expect(await group()).toBe('cutout');
  });
  test('un dessin de « Non utilisé » remis en Découpe ou en Fond revient sur l’œuvre, le reste ne bouge pas', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    const st = () => page.evaluate(() => { const S = AtelierGribouille.state; return { items: S.comp.items.map((L) => [S.drawings.indexOf(L.piece.drawing), +L.x.toFixed(3), +L.y.toFixed(3)]), pages: S.comp.bg.filter((L) => !L.paper).map((L) => S.drawings.indexOf(L.drawing || null)), style: S.comp.style }; });
    const group = (k) => page.evaluate((k) => { const el = document.querySelector(`#drawings .thumb[data-i="${k}"]`); return el && el.closest('.drawings-group').classList[1]; }, k);
    const retire = async (k) => {
      for (let n = 0; n < 20; n++) {
        const left = await page.evaluate((k) => { const S = AtelierGribouille.state, d = S.drawings[k]; const L = S.comp.items.find((q) => q.piece.drawing === d) || S.comp.bg.find((q) => !q.paper && q.drawing === d); S.selected = L || null; return !!L; }, k);
        if (!left) break;
        await page.keyboard.press('Delete');
      }
    };
    // une découpe
    const k = await page.evaluate(() => { const S = AtelierGribouille.state; return S.drawings.indexOf(S.comp.items[0].piece.drawing); });
    await retire(k);
    expect(await group(k)).toBe('off');
    const before = await st();
    await page.locator(`#drawings .thumb[data-i="${k}"]`).click();
    await page.locator('#detail [data-role="cutout"]').click();
    const after = await st();
    expect(await group(k)).toBe('cutout');
    expect(after.style).toBe(before.style);
    expect(after.items.filter((x) => x[0] === k).length).toBeGreaterThan(0); // revenu sur l'œuvre
    expect(after.items.filter((x) => x[0] !== k)).toEqual(before.items); // rien d'autre n'a bougé
    expect(await page.evaluate((k) => { const S = AtelierGribouille.state; return !!S.selected && S.selected.piece.drawing === S.drawings[k]; }, k)).toBe(true);
    // une page de fond
    const t = await page.evaluate(() => { const S = AtelierGribouille.state; const L = S.comp.bg.find((q) => !q.paper && q.drawing); return L ? S.drawings.indexOf(L.drawing) : -1; });
    expect(t).toBeGreaterThanOrEqual(0);
    await retire(t);
    expect(await group(t)).toBe('off');
    const b2 = await st();
    await page.locator(`#drawings .thumb[data-i="${t}"]`).click();
    await page.locator('#detail [data-role="texture"]').click();
    const a2 = await st();
    expect(await group(t)).toBe('texture');
    expect(a2.pages.filter((x) => x === t).length).toBe(1);
    expect(a2.items).toEqual(b2.items);
    // Défaire : le dessin repart dans « Non utilisé »
    await page.evaluate(() => AtelierGribouille.undo());
    expect(await group(t)).toBe('off');
    expect((await st()).pages.filter((x) => x === t).length).toBe(0);
  });
  test('« + » sur un dessin de « Non utilisé » le remet sur l’œuvre, dans son rôle d’avant ; une vignette ne se glisse pas', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    const st = () => page.evaluate(() => { const S = AtelierGribouille.state; return { items: S.comp.items.map((L) => [S.drawings.indexOf(L.piece.drawing), +L.x.toFixed(3), +L.y.toFixed(3)]), pages: S.comp.bg.filter((L) => !L.paper).map((L) => S.drawings.indexOf(L.drawing || null)) }; });
    const group = (k) => page.evaluate((k) => { const el = document.querySelector(`#drawings .thumb[data-i="${k}"]`); return el && el.closest('.drawings-group').classList[1]; }, k);
    const retire = async (k) => {
      for (let n = 0; n < 20; n++) {
        const left = await page.evaluate((k) => { const S = AtelierGribouille.state, d = S.drawings[k]; const L = S.comp.items.find((q) => q.piece.drawing === d) || S.comp.bg.find((q) => !q.paper && q.drawing === d); S.selected = L || null; return !!L; }, k);
        if (!left) break;
        await page.keyboard.press('Delete');
      }
    };
    // pas de « + » hors de « Non utilisé »
    await expect(page.locator('#drawings .thumb-add')).toHaveCount(0);
    // une découpe retirée, puis remise par son « + »
    const k = await page.evaluate(() => { const S = AtelierGribouille.state; return S.drawings.indexOf(S.comp.items[0].piece.drawing); });
    await retire(k);
    expect(await group(k)).toBe('off');
    await expect(page.locator('#drawings .thumb-add')).toHaveCount(1);
    const before = await st();
    await page.locator(`#drawings .thumb[data-i="${k}"] + .thumb-add`).click();
    expect(await group(k)).toBe('cutout');
    const after = await st();
    expect(after.items.filter((x) => x[0] === k).length).toBeGreaterThan(0);
    expect(after.items.filter((x) => x[0] !== k)).toEqual(before.items); // rien d'autre n'a bougé
    // Défaire : il repart dans « Non utilisé »
    await page.evaluate(() => AtelierGribouille.undo());
    expect(await group(k)).toBe('off');
    // une page de fond revient en page de fond
    const t = await page.evaluate(() => { const S = AtelierGribouille.state; const L = S.comp.bg.find((q) => !q.paper && q.drawing); return L ? S.drawings.indexOf(L.drawing) : -1; });
    expect(t).toBeGreaterThanOrEqual(0);
    await retire(t);
    expect(await group(t)).toBe('off');
    await page.locator(`#drawings .thumb[data-i="${t}"] + .thumb-add`).click();
    expect(await group(t)).toBe('texture');
    expect((await st()).pages.filter((x) => x === t).length).toBe(1);
    // les vignettes (et leurs images) ne se glissent pas vers la zone d'édition
    const prevented = await page.evaluate(() => [document.querySelector('#drawings .thumb img'), document.querySelector('#drawings .thumb')].map((el) => { const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; }));
    expect(prevented).toEqual([true, true]);
  });
  test('la poubelle, au coin haut gauche du dessin sélectionné, le retire de l’œuvre ; Défaire le remet', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    const pick = async (kind) => {
      // le dessin sélectionné, et la place de sa poubelle à l'écran
      return page.evaluate((kind) => {
        const A = AtelierGribouille, S = A.state, L = kind === 'bg' ? S.comp.bg.find((q) => !q.paper) : S.comp.items[0];
        S.selected = L; A.render();
        const v = A.view, r = document.getElementById('canvas').getBoundingClientRect();
        const c = Math.cos(L.rot), sn = Math.sin(L.rot), hx = -L.w / 2, hy = -L.h / 2;
        const X = L.x + hx * c - hy * sn, Y = L.y + hx * sn + hy * c;
        return { x: r.left + (v.ox + X * v.s) / v.dpr, y: r.top + (v.oy + Y * v.s) / v.dpr, n: S.comp.items.length, nb: S.comp.bg.length };
      }, kind);
    };
    const count = () => page.evaluate(() => [AtelierGribouille.state.comp.items.length, AtelierGribouille.state.comp.bg.length, !!AtelierGribouille.state.selected]);
    // une découpe
    let at = await pick('item');
    await page.waitForTimeout(100);
    await page.mouse.click(at.x, at.y);
    expect(await count()).toEqual([at.n - 1, at.nb, false]);
    await page.evaluate(() => AtelierGribouille.undo());
    expect((await count())[0]).toBe(at.n);
    // une page de fond
    at = await pick('bg');
    await page.waitForTimeout(100);
    await page.mouse.click(at.x, at.y);
    expect(await count()).toEqual([at.n, at.nb - 1, false]);
  });
});
