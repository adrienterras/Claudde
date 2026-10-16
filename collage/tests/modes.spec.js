const { test, expect, fixture } = require('./helpers');

// Deux ateliers : Impression (cadres standard du marché, dessins réduits pour y tenir, tirages et
// fichier HD) et Toile (taille réelle, toiles du commerce, guide, kit et Atelier Signature).
test.describe('Atelier Impression et atelier Toile', () => {
  test('sans choix : les deux cartes sont proposées ; ?mode= choisit, et c’est mémorisé', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-pick')).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('#mode-switch button.on').length)).toBe(0);
    await page.locator('#mode-pick [data-mode="impression"]').click();
    await expect(page.locator('#mode-pick')).toBeHidden();
    await expect(page.locator('#mode-switch [data-mode="impression"]')).toHaveClass(/on/);
    expect(await page.evaluate(() => localStorage.getItem('atelier.mode'))).toBe('impression');
    // rechargée sans paramètre : le choix revient ; ?mode=toile le remplace
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-pick')).toBeHidden();
    await expect(page.locator('#format-label')).toHaveText('Cadre');
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-switch [data-mode="toile"]')).toHaveClass(/on/);
    await expect(page.locator('#format-label')).toHaveText('Toile');
  });

  test('Impression : cadres standard seulement, œuvre à la taille du cadre, dessins réduits, produits impression', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png', 'photo-wood.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const opts = await page.evaluate(() => [...document.getElementById('format').options].filter((o) => !o.hidden && !o.disabled).map((o) => o.value));
    expect(opts.length).toBeGreaterThan(10);
    expect(opts.every((v) => v.startsWith('cadre:'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('format').value)).toBe('cadre:42x29.7');
    expect(await page.evaluate(() => document.getElementById('grain').checked)).toBe(false);
    await expect(page.locator('#guide-box')).toBeHidden();
    // le cadre 18 × 24 : l'œuvre fait exactement 24 × 18 (paysage), tous les dessins (curseur au
    // maximum) sont réduits pour y tenir
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    await page.selectOption('#format', 'cadre:24x18');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const A = AtelierGribouille, c = A.state.comp;
      const d = A.state.drawings[0], p = c.items.find((L) => L.piece.drawing === d);
      return { W: c.W, H: c.H, k: A.scale(), all: A.state.proposals.every((pr) => Math.abs(pr.comp.W - 24) < 1e-6 && Math.abs(pr.comp.H - 18) < 1e-6), pieceCm: p ? Math.max(p.w, p.h) : null, sheetCm: d.sizeCm, fits: c.items.every((L) => Math.max(L.w, L.h) <= 30.01) };
    });
    expect(r.W).toBe(24); expect(r.H).toBe(18);
    expect(r.all).toBe(true);
    // jamais agrandis ; réduits seulement si nécessaire (les pièces d'essai, petites, tiennent presque)
    expect(r.k).toBeGreaterThan(0.05); expect(r.k).toBeLessThanOrEqual(1);
    expect(r.fits).toBe(true);
    if (r.pieceCm) expect(r.pieceCm).toBeLessThan(r.sheetCm);
    await expect(page.locator('#scale-info')).toContainText('Tableau imprimé de 24 × 18 cm');
    // fond uni : aucune page de fond, un aplat de couleur sur chaque proposition (blanc fixe en Galerie),
    // la page peinte importée est devenue une découpe, et le rôle « fond » n'est plus proposé
    const flat = await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => ({ style: p.style.id, bg: p.comp.bg.length, ground: p.comp.ground, paint: p.comp.paint, grain: p.comp.grain })));
    expect(flat.every((p) => !!p.ground)).toBe(true);
    // un aplat parfaitement uni : ni coups de brosse ni grain de toile, et le réglage « finition toile » caché
    expect(flat.every((p) => p.paint === false && !p.grain)).toBe(true);
    expect(await page.locator('#grain').isVisible()).toBe(false);
    // les pixels du fond sont tous de la même couleur
    const uni = await page.evaluate(() => { const c = document.createElement('canvas'); const comp = AtelierGribouille.state.comp; c.width = 200; c.height = 200; const x = c.getContext('2d'); Compose.renderGround(x, comp, 200 / comp.W); const d = x.getImageData(0, 0, 200, Math.floor(200 * comp.H / comp.W)).data; let diff = 0; for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) diff++; return diff; });
    expect(uni).toBe(0);
    // rôles : la page peinte en larges aplats colorés se colle en fond d'office, la page au fond
    // blanc reste une découpe ; le rôle « fond » se choisit aussi à la main
    const roles = await page.evaluate(() => Object.fromEntries(AtelierGribouille.state.drawings.map((d) => [d.name, d.role === 'auto' ? d.auto : d.role])));
    expect(roles['page-texture.png']).toBe('texture');
    expect(roles['page-cutout.png']).toBe('cutout');
    expect(roles['page-two.png']).toBe('cutout');
    await page.evaluate(() => { const sec = document.getElementById('drawings-section'); if (sec.classList.contains('collapsed')) sec.querySelector('h2').click(); });
    await page.locator('#drawings .thumb').first().click();
    await expect(page.locator('#detail [data-role="texture"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelector('#ground button[data-hex=""]').hidden)).toBe(true);
    await expect(page.locator('#export-info')).toContainText('tableau imprimé de 24 × 18 cm');
    // chaque dessin s'agrandit ou se réduit à la main : boutons (10 %), puis poignée carrée
    await page.evaluate(() => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[0]; A.render(); });
    await expect(page.locator('#toolbar [data-act="bigger"]')).toBeVisible();
    const w0 = await page.evaluate(() => AtelierGribouille.state.selected.w);
    await page.locator('#toolbar [data-act="bigger"]').click();
    expect(await page.evaluate(() => AtelierGribouille.state.selected.w)).toBeCloseTo(w0 * 1.1, 4);
    await page.locator('#toolbar [data-act="smaller"]').click();
    expect(await page.evaluate(() => AtelierGribouille.state.selected.w)).toBeCloseTo(w0, 4);
    // une page de fond agrandie : son contour déchiré grandit avec elle (rien de la page n'est masqué)
    const ext = () => page.evaluate(() => { const L = AtelierGribouille.state.selected; const xs = L.clip.map((q) => q[0]), ys = L.clip.map((q) => q[1]); return { w: L.w, h: L.h, cw: Math.max(...xs) - Math.min(...xs), ch: Math.max(...ys) - Math.min(...ys) }; });
    const hasClip = await page.evaluate(() => { const A = AtelierGribouille, L = A.state.comp.bg.find((q) => q.clip && q.panel); if (!L) return false; A.state.selected = L; A.render(); return true; });
    expect(hasClip).toBe(true);
    const e0 = await ext();
    for (let i = 0; i < 4; i++) await page.locator('#toolbar [data-act="bigger"]').click();
    const e1 = await ext();
    expect(e1.w).toBeGreaterThan(e0.w * 1.3);
    expect(e1.cw / e1.w).toBeCloseTo(e0.cw / e0.w, 3);
    expect(e1.ch / e1.h).toBeCloseTo(e0.ch / e0.h, 3);
    for (let i = 0; i < 4; i++) await page.locator('#toolbar [data-act="smaller"]').click();
    await page.evaluate(() => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[0]; A.render(); });
    const h = await page.evaluate(() => {
      const A = AtelierGribouille, L = A.state.selected, v = A.view, r = document.getElementById('canvas').getBoundingClientRect();
      const c = Math.cos(L.rot), s = Math.sin(L.rot), hx = L.w / 2, hy = -L.h / 2;
      const X = L.x + hx * c - hy * s, Y = L.y + hx * s + hy * c;
      const cx = r.left + (v.ox + L.x * v.s) / v.dpr, cy = r.top + (v.oy + L.y * v.s) / v.dpr;
      return { x: r.left + (v.ox + X * v.s) / v.dpr, y: r.top + (v.oy + Y * v.s) / v.dpr, cx, cy };
    });
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    // on s'éloigne du centre de 50 % : la pièce grandit d'autant
    await page.mouse.move(h.cx + (h.x - h.cx) * 1.25, h.cy + (h.y - h.cy) * 1.25);
    await page.mouse.move(h.cx + (h.x - h.cx) * 1.5, h.cy + (h.y - h.cy) * 1.5);
    await page.mouse.up();
    const w1 = await page.evaluate(() => AtelierGribouille.state.selected.w);
    expect(w1 / w0).toBeGreaterThan(1.3); expect(w1 / w0).toBeLessThan(1.7);
    await expect(page.locator('#label-meta')).toContainText('réduits');
    await page.evaluate(() => { AtelierGribouille.undo(); });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items[0].w)).toBeCloseTo(w0, 4);
    await page.evaluate(() => { AtelierGribouille.state.selected = null; AtelierGribouille.render(); });
    // portrait : 18 × 24
    await page.locator('#canvas-orient [data-orient="port"]').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual([18, 24]);
    // panier : tirages et fichier HD seulement
    await page.locator('#add-cart').click();
    await expect(page.locator('#cart-add')).toBeVisible();
    await expect(page.locator('#cart-add input[value="print"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="hd"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="kit"]')).toBeHidden();
    await expect(page.locator('#cart-add input[value="signature"]')).toBeHidden();
    await expect(page.locator('.cart-what-size')).toContainText('tableau imprimé de 18 × 24 cm');
    await page.locator('#cart-add [data-close]').first().click();
    // sauvegardée puis rouverte : le mode et le cadre reviennent
    await page.locator('#save-comp').click();
    await page.fill('#save-name', 'Cadre 18x24');
    await page.locator('#save-form button[type=submit]').click();
    await expect(page.locator('#save-status')).toContainText('sauvegardée');
    await page.goto('index.html?mode=toile&nouveau');
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('« Cadre 18x24 » rouverte', { timeout: 120000 });
    await expect(page.locator('#mode-switch [data-mode="impression"]')).toHaveClass(/on/);
    expect(await page.evaluate(() => [document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual(['cadre:24x18', 18, 24]);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });

  test('Affiche : le nombre de dessins posés grandit pas à pas avec le curseur de densité', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'photo-wood.png', 'noscale-small.jpg', 'noscale-medium.jpg'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => { const f = document.getElementById('format'); f.value = 'cadre:29.7x21'; f.dispatchEvent(new Event('change')); });
    const counts = [], scales = [];
    for (const v of ['0.5', '0.8', '1.1', '1.4', '1.8']) {
      await page.evaluate((v) => { const d = document.getElementById('density'); d.value = v; d.dispatchEvent(new Event('change')); }, v);
      await page.waitForTimeout(300);
      counts.push(await page.evaluate(() => AtelierGribouille.state.proposals[0].comp.items.length));
      scales.push(await page.evaluate(() => AtelierGribouille.scale()));
    }
    const n = await page.evaluate(() => AtelierGribouille.state.drawings.reduce((s, d) => s + (d.analysis.pieces || []).filter((p) => p.enabled).length, 0));
    // jamais moins de dessins en montant le curseur, et au moins deux paliers avant « tout »
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(new Set(counts.slice(0, 4)).size).toBeGreaterThanOrEqual(2);
    expect(counts[0]).toBeLessThan(counts[4]);
    expect(counts[4]).toBe(n);
    // plus on en demande, plus les dessins sont réduits
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThanOrEqual(scales[i - 1] + 1e-9);
    // peu de dessins : en Nuage, ils se répartissent sur toute l'affiche (pas groupés au centre)
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = '0.8'; d.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const nu = await page.evaluate(() => { const c = AtelierGribouille.state.proposals.find((p) => p.style.id === 'nuage').comp; const x0 = Math.min(...c.items.map((L) => L.x - L.w / 2)), x1 = Math.max(...c.items.map((L) => L.x + L.w / 2)), y0 = Math.min(...c.items.map((L) => L.y - L.h / 2)), y1 = Math.max(...c.items.map((L) => L.y + L.h / 2)); return { n: c.items.length, fx: (x1 - x0) / c.W, fy: (y1 - y0) / c.H }; });
    if (nu.n >= 2) { expect(nu.fx).toBeGreaterThan(0.8); expect(nu.fy).toBeGreaterThan(0.6); }
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    // dessins très réduits dans un petit cadre, au maximum : Paysage les répartit sur toute l'affiche
    // (feuilles déclarées de 120 cm : les sujets demandent bien plus que le cadre 24 × 18)
    await page.evaluate(() => { AtelierGribouille.state.drawings.forEach((d) => { d.sizeCm = 120; }); const f = document.getElementById('format'); f.value = 'cadre:24x18'; f.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const sp = await page.evaluate(() => { const c = AtelierGribouille.state.proposals[0].comp; const ys = c.items.map((L) => L.y / c.H), xs = c.items.map((L) => L.x / c.W); return { k: AtelierGribouille.scale(), n: c.items.length, dy: Math.max(...ys) - Math.min(...ys), dx: Math.max(...xs) - Math.min(...xs) }; });
    expect(sp.k).toBeLessThan(0.6);
    expect(sp.n).toBe(n);
    expect(sp.dy).toBeGreaterThan(0.45);
    expect(sp.dx).toBeGreaterThan(0.45);
  });

  test('Affiche : peu de dessins dans un grand cadre, jamais agrandis au-delà de leur taille réelle', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    // un scan A4 à 300 dpi, seul, dans le cadre 100 × 70 : il garderait de la place, mais reste à sa taille
    await page.setInputFiles('#file', [fixture('scan-300dpi.jpg')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.min; d.dispatchEvent(new Event('change')); const f = document.getElementById('format'); f.value = 'cadre:100x70'; f.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => AtelierGribouille.scale())).toBeLessThanOrEqual(1.0001);
    const over = await page.evaluate(() => AtelierGribouille.state.proposals.flatMap((p) => p.comp.items.map((L) => { const c = L.piece.drawing.sizeCm / L.piece.drawing.srcLong; return Math.max(L.w / (L.piece.canvas.width * c), L.h / (L.piece.canvas.height * c)); })));
    for (const r of over) expect(r).toBeLessThanOrEqual(1.001);
    await expect(page.locator('#scale-info')).not.toContainText('agrandis');
  });

  test('Toile : taille réelle et toiles du commerce, guide, kit et Atelier Signature ; la bascule recompose', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // seulement les toiles Cultura, et une toile conseillée d'office pour ces dessins
    const opts = await page.evaluate(() => [...document.getElementById('format').options].filter((o) => !o.hidden && !o.disabled).map((o) => o.value));
    expect(opts.length).toBeGreaterThan(15);
    expect(opts.every((v) => /^\d+x\d+$/.test(v))).toBe(true);
    expect(opts.some((v) => v === '70x50')).toBe(true);
    const picked = await page.evaluate(() => document.getElementById('format').value);
    expect(opts).toContain(picked);
    expect(await page.evaluate(() => AtelierGribouille.state.formatManual)).toBeFalsy();
    await expect(page.locator('#scale-info')).toContainText('Toile Cultura conseillée');
    expect(await page.evaluate(() => { const c = AtelierGribouille.state.comp, [a, b] = document.getElementById('format').value.split('x').map(Number); return c.W === Math.max(a, b) && c.H === Math.min(a, b); })).toBe(true);
    // le client choisit une autre toile : son choix est gardé, même après un autre réglage
    const other = opts.find((v) => v !== picked && v !== '30x30');
    await page.selectOption('#format', other);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => AtelierGribouille.state.formatManual)).toBe(true);
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = String(Number(d.value) + 0.2); d.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getElementById('format').value)).toBe(other);
    await expect(page.locator('#scale-info')).not.toContainText('conseillée');
    expect(await page.evaluate(() => AtelierGribouille.scale())).toBe(1);
    expect(await page.evaluate(() => document.getElementById('grain').checked)).toBe(true);
    // taille réelle : pas d'agrandissement à la main (sauf en Galerie)
    await page.evaluate(() => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[0]; A.render(); });
    if ((await page.evaluate(() => AtelierGribouille.state.comp.style)) !== 'galerie') await expect(page.locator('#toolbar [data-act="bigger"]')).toBeHidden();
    await page.evaluate(() => { AtelierGribouille.state.selected = null; AtelierGribouille.render(); });
    await expect(page.locator('#guide-box')).toBeVisible();
    // toile : les pages peintes restent des pages de fond, la toile nue reste proposée
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.some((p) => p.comp.bg.some((L) => !L.paper)))).toBe(true);
    expect(await page.evaluate(() => document.querySelector('#ground button[data-hex=""]').hidden)).toBe(false);
    await page.locator('#add-cart').click();
    await expect(page.locator('#cart-add input[value="guide"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="kit"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="signature"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="print"]')).toBeHidden();
    await expect(page.locator('#cart-add .cart-print')).toBeHidden();
    // Atelier Signature : 490 € jusqu'à 75 cm, 690 € au-delà
    const long = await page.evaluate(() => Math.max(AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H));
    await page.locator('#cart-add input[value="signature"]').check();
    await expect(page.locator('.cart-add-total')).toContainText(long > 75 ? '690' : '490');
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await expect(page.locator('#cart .cart-item')).toContainText('Atelier Signature');
    await page.locator('#cart [data-close]').first().click();
    // bascule vers Impression : cadre par défaut, œuvre recomposée à sa taille
    await page.locator('#mode-switch [data-mode="impression"]').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => [document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual(['cadre:42x29.7', 42, 29.7]);
    await page.locator('#mode-switch [data-mode="toile"]').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => /^\d+x\d+$/.test(document.getElementById('format').value))).toBe(true);
    expect(await page.evaluate(() => AtelierGribouille.state.formatManual)).toBeFalsy();
  });
});
