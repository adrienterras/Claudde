// Village (atelier Impression) : un patchwork des grandes zones de couleur des dessins, sombre et
// terreux en bas, clair en haut, et devant une scène de village (sujets debout sur trois lignes de sol).
const path = require('path');
const { test, expect, openStep } = require('./helpers');

const sample = (n) => path.join(__dirname, '..', 'samples', `${n}.jpg`);

test.describe('Village', () => {
  test('zones de couleur : un aplat de coloriage est trouvé sans traverser un contour ; ordre du bas (terre) vers le haut (ciel)', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 400;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400);
      // un coloriage bleu au crayon (des traits, du papier entre eux), coupé par un trait noir à x = 300
      x.strokeStyle = '#3d7fd6'; x.lineWidth = 3;
      for (let i = -400; i < 600; i += 7) { x.beginPath(); x.moveTo(40 + i, 360); x.lineTo(40 + i + 320, 40); x.stroke(); }
      x.fillStyle = '#fff'; x.fillRect(0, 0, 40, 400); x.fillRect(560, 0, 40, 400); x.fillRect(0, 0, 600, 40); x.fillRect(0, 360, 600, 40);
      x.fillStyle = '#111'; x.fillRect(298, 40, 5, 320);
      const found = Compose.colorPatches(c, 80);
      const S = (rgb) => Compose.skyness(rgb);
      return {
        n: found.length,
        crossing: found.filter((p) => p.x < 296 && p.x + p.w > 305).length,
        blue: found.every((p) => p.ink[2] > p.ink[0] + 60),
        order: [S([240, 200, 30]) > S([150, 200, 240]), S([150, 200, 240]) > S([35, 80, 170]), S([150, 200, 240]) > S([140, 85, 40]), S([240, 200, 30]) > S([40, 110, 50]), S([240, 200, 30]) > S([200, 40, 30]), S([20, 20, 20]) < S([140, 85, 40])],
      };
    });
    expect(r.n).toBeGreaterThanOrEqual(2); // de part et d'autre du trait
    expect(r.crossing).toBe(0);
    expect(r.blue).toBe(true);
    expect(r.order).toEqual([true, true, true, true, true, true]);
  });

  test('en tableau imprimé seulement ; patchwork bord à bord, foncés en bas, clairs en haut ; scène debout ; rouvert à l’identique', async ({ page }) => {
    test.setTimeout(240000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    // un 30 × 40 : les dessins d'exemple, jamais agrandis au-delà de leur taille réelle, y sont assez
    // grands pour s'entremêler (sur le 50 × 70 par défaut, ils restent à leur taille)
    await page.evaluate(() => { document.getElementById('format').value = 'cadre:30x40'; }); // (le choix est encore replié)
    await page.setInputFiles('#file', ['maison', 'arbre', 'oiseau', 'voiture', 'soleil', 'chat', 'herbe-peinte', 'ciel-peint', 'terre-peinte', 'rayures-peintes'].map(sample));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 180000 });
    const ids = await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id));
    expect(ids[ids.length - 1]).toBe('village');
    await page.locator('#proposals .proposal').last().click();
    await expect(page.locator('#label')).toContainText(/village/i);
    const v = await page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      const P = c.bg.filter((L) => L.patch);
      // toute la toile est couverte par les carreaux
      let holes = 0;
      for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
        const x = ((i + 0.5) * c.W) / 24, y = ((j + 0.5) * c.H) / 24;
        if (!P.some((L) => Math.abs(x - L.x) <= L.w / 2 && Math.abs(y - L.y) <= L.h / 2)) holes++;
      }
      const mean = (a) => a.reduce((s, L) => s + L.sky, 0) / Math.max(1, a.length);
      const sun = c.items.find((L) => /soleil/.test(L.piece.drawing.name));
      const standing = c.items.filter((L) => L !== sun);
      return {
        style: c.style, patches: P.length, holes,
        bottom: mean(P.filter((L) => L.y > c.H * 0.75)), top: mean(P.filter((L) => L.y < c.H * 0.25)),
        drawings: new Set(P.map((L) => L.drawing.name)).size,
        sunY: sun ? sun.y / c.H : null,
        feet: standing.map((L) => (L.y + L.h / 2) / c.H),
        inside: c.items.every((L) => L.x >= 0 && L.x <= c.W),
        // grands et entremêlés : des sujets se chevauchent, mais chacun reste visible au moins à moitié
        overlaps: standing.filter((L, i) => standing.some((M, j) => j !== i && Math.abs(L.x - M.x) < (L.w + M.w) / 2 && Math.abs(L.y - M.y) < (L.h + M.h) / 2)).length,
        minSeen: Math.min(...c.items.map((L, i) => {
          const at = (M, x, y) => { const u = (x - M.x) / M.w + 0.5, v = (y - M.y) / M.h + 0.5; if (u < 0 || u >= 1 || v < 0 || v >= 1) return false; const h = M.piece.hit; return !h || !!h.data[Math.floor(v * h.h) * h.w + Math.floor(u * h.w)]; };
          let own = 0, seen = 0;
          for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) { const x = L.x + ((a + 0.5) / 20 - 0.5) * L.w, y = L.y + ((b + 0.5) / 20 - 0.5) * L.h; if (!at(L, x, y)) continue; own++; if (!c.items.some((M, j) => j > i && at(M, x, y))) seen++; }
          return own ? seen / own : 1;
        })),
        n: c.items.length, bg: c.bg.length, first: [P[0].sx, P[0].sy, P[0].x, P[0].y],
      };
    });
    expect(v.style).toBe('village');
    expect(v.patches).toBeGreaterThanOrEqual(8);
    expect(v.patches).toBeLessThanOrEqual(20); // peu de grands carreaux
    expect(v.holes).toBe(0);
    expect(v.drawings).toBeGreaterThanOrEqual(4); // pages peintes et coloriages des sujets
    expect(v.bottom).toBeLessThan(v.top - 40);
    expect(v.sunY).toBeLessThan(0.45); // le soleil au ciel
    for (const f of v.feet) { expect(f).toBeGreaterThan(0.55); expect(f).toBeLessThanOrEqual(1.02); }
    expect(v.inside).toBe(true);
    expect(v.overlaps).toBeGreaterThanOrEqual(3);
    expect(v.minSeen).toBeGreaterThan(0.4);

    // rangée puis rouverte : mêmes carreaux, au même endroit (pris dans les pages des dessins découpés aussi)
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1, { timeout: 30000 });
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await openStep(page, 'saved-section');
    await page.locator('#saved-list .saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 180000 });
    const w = await page.evaluate(() => { const c = AtelierGribouille.state.comp; const P = c.bg.filter((L) => L.patch); return { style: c.style, n: c.items.length, bg: c.bg.length, first: [P[0].sx, P[0].sy, P[0].x, P[0].y] }; });
    expect(w.style).toBe('village');
    expect(w.n).toBe(v.n);
    expect(w.bg).toBe(v.bg);
    w.first.forEach((x, i) => expect(x).toBeCloseTo(v.first[i], 2));

    // l'image haute définition se rend (carreaux pris dans les pages en pleine résolution)
    await openStep(page, 'export-section');
    await page.locator('#dpi').selectOption('150');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#export').click()]);
    const buf = require('fs').readFileSync(await download.path());
    expect(buf.length).toBeGreaterThan(100000);
    expect(buf[0]).toBe(0xff);
  });

  test('pas de Village en collage des originaux (les originaux ne peuvent pas fournir aussi les carreaux)', async ({ app }) => {
    await app.import(['page-cutout.png', 'page-texture.png']);
    const ids = await app.page.evaluate(() => AtelierGribouille.state.proposals.map((p) => p.style.id));
    expect(ids).not.toContain('village');
  });
});
