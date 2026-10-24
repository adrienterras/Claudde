const { test, expect, fixture, openStep } = require('./helpers');

// Deux ateliers : Impression (cadres standard du marché, dessins réduits pour y tenir, tirages et
// fichier HD) et Toile (taille réelle, toiles du commerce, guide et kit DIY).
test.describe('Atelier Impression et atelier Toile', () => {
  test('sans choix : les deux cartes au milieu de l’atelier vide ; un clic ou ?mode= choisit, et c’est mémorisé ; plus de bascule ensuite', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-pick')).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('#mode-pick button.on').length)).toBe(0);
    await page.locator('#mode-pick [data-mode="impression"]').click();
    // le type choisi : les cartes (et l'exemple) laissent la place aux boutons d'import, au milieu
    await expect(page.locator('#mode-pick')).toBeHidden();
    await expect(page.locator('#empty-sample')).toBeHidden();
    await expect(page.locator('#empty-import')).toBeVisible();
    await expect(page.locator('#empty-import-title')).toHaveText('Création imprimée à partir de vos dessins');
    await expect(page.locator('#empty-drop')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('atelier.mode'))).toBe('impression');
    // « changer de type » ramène les cartes, aucune présélectionnée
    await page.locator('#empty-change').click();
    await expect(page.locator('#mode-pick')).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('#mode-pick button.on').length)).toBe(0);
    await expect(page.locator('#empty-import')).toBeHidden();
    // rechargée sans paramètre : les cartes, aucune présélectionnée (le dernier type reste le réglage
    // interne : « Cadre ») ; ?mode=toile choisit d'office
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-pick')).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('#mode-pick button.on').length)).toBe(0);
    await expect(page.locator('#format-label')).toHaveText('Cadre');
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#mode-pick')).toBeHidden();
    await expect(page.locator('#empty-import-title')).toHaveText('Collage avec les dessins originaux');
    await expect(page.locator('#format-label')).toHaveText('Toile');
    // le type d'œuvre ne se change plus dans la colonne une fois l'œuvre commencée
    expect(await page.evaluate(() => !document.getElementById('mode-switch'))).toBe(true);
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#mode-pick')).toBeHidden();
  });

  test('Impression : changer de cadre garde l’œuvre telle quelle (à l’échelle) ; changer d’orientation la tourne d’un quart de tour', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#canvas-orient [data-orient="port"]')).toHaveClass(/on/); // toute nouvelle création part en portrait
    await page.evaluate(() => document.querySelector('#canvas-orient [data-orient="land"]').click()); // ce test suit une œuvre en paysage
    await page.evaluate(() => { document.getElementById('format').value = 'cadre:30x40'; AtelierGribouille.state.formatManual = true; }); // (partant d'un 30 × 40 ; le choix est encore replié)
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const snap = () => page.evaluate(() => { const c = AtelierGribouille.state.comp; return { W: c.W, H: c.H, style: c.style, key: c.frameKey, items: c.items.map((L) => [L.x / c.W, L.y / c.H, L.w, L.h, L.rot]), bg: c.bg.filter((L) => !L.paper).length }; });
    const a = await snap();
    expect(a.W).toBe(40); expect(a.H).toBe(30);
    // un cadre plus grand : l'œuvre reste identique — mêmes places en proportion, tous les dessins
    // agrandis d'un même facteur (même au-delà de leur taille réelle), même style
    await page.selectOption('#format', 'cadre:50x70');
    await page.waitForTimeout(400);
    const b = await snap();
    expect([b.W, b.H, b.key, b.style, b.bg]).toEqual([70, 50, '50x70', a.style, a.bg]);
    expect(b.items.length).toBe(a.items.length);
    const km = Math.sqrt((70 / 40) * (50 / 30));
    a.items.forEach(([x, y, w, h, rot], i) => {
      expect(b.items[i][0]).toBeCloseTo(x, 3); expect(b.items[i][1]).toBeCloseTo(y, 3);
      expect(b.items[i][2] / w).toBeCloseTo(km, 3); expect(b.items[i][3] / h).toBeCloseTo(km, 3);
      expect(b.items[i][4]).toBeCloseTo(rot, 6);
    });
    // un cadre plus petit : tout est réduit d'un même facteur
    await page.selectOption('#format', 'cadre:21x30');
    await page.waitForTimeout(400);
    const b2 = await snap();
    expect([b2.W, b2.H]).toEqual([29.7, 21]);
    const km2 = Math.sqrt((29.7 / 70) * (21 / 50));
    b.items.forEach(([x, y, w, h, rot], i) => { expect(b2.items[i][0]).toBeCloseTo(x, 3); expect(b2.items[i][2] / w).toBeCloseTo(km2, 3); expect(b2.items[i][4]).toBeCloseTo(rot, 6); });
    await page.selectOption('#format', 'cadre:50x70');
    await page.waitForTimeout(400);
    // portrait : l'œuvre tourne d'un quart de tour (places et inclinaisons tournées, tailles gardées)
    await page.locator('#canvas-orient [data-orient="port"]').click();
    await page.waitForTimeout(400);
    const c = await snap();
    expect([c.W, c.H, c.style]).toEqual([50, 70, a.style]);
    b.items.forEach(([x, y, w, h, rot], i) => {
      expect(c.items[i][2]).toBeCloseTo(w, 3); expect(c.items[i][3]).toBeCloseTo(h, 3);
      expect(Math.abs(c.items[i][4] - rot)).toBeCloseTo(Math.PI / 2, 6);
    });
    // retour en paysage : tout revient
    await page.locator('#canvas-orient [data-orient="land"]').click();
    await page.waitForTimeout(400);
    const d = await snap();
    expect([d.W, d.H]).toEqual([70, 50]);
    b.items.forEach(([x, y, w, h, rot], i) => { expect(d.items[i][0]).toBeCloseTo(x, 3); expect(d.items[i][1]).toBeCloseTo(y, 3); expect(d.items[i][4]).toBeCloseTo(rot, 6); });
    // les autres propositions, elles, sont refaites au nouveau cadre
    const sizes = await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => [p.comp.W, p.comp.H]));
    sizes.forEach(([W, H]) => expect([W, H]).toEqual([70, 50]));
  });

  test('Impression : le curseur de densité est linéaire, pages de fond comprises (à mi-course, la moitié des dessins)', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    // (une découpe par dessin, de poids décroissant)
    const c = (n, t, pages, per = 1) => page.evaluate(([n, t, pages, per]) => {
      const pieces = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < per; j++) pieces.push({ drawing: 'd' + i, wcm: 30 - i * 0.5, hcm: 30 - i * 0.5, colorful: 0.5, importance: 1 });
      return AtelierGribouille.printCount(pieces, t, pages);
    }, [n, t, pages, per]);
    // 28 dessins : 5 pages de fond et 23 découpes
    expect(await c(23, 0, 5)).toBe(1);        // en bas : les pages et une découpe (6 sur 28)
    expect(await c(23, 1, 5)).toBe(23);       // en haut : tout
    expect(5 + await c(23, 0.5, 5)).toBe(17); // à mi-course : 17 sur 28 (la moitié entre 6 et 28)
    expect(5 + await c(23, 0.25, 5)).toBe(12);
    // sans page de fond : 1 en bas, la moitié au milieu, tout en haut ; jamais moins d'une découpe
    expect(await c(10, 0, 0)).toBe(1);
    expect(await c(10, 0.5, 0)).toBe(6);
    expect(await c(10, 1, 0)).toBe(10);
    expect(await c(1, 0, 4)).toBe(1);
    // plusieurs découpes par dessin : ce sont les dessins qui comptent (3 découpes chacun, 10 dessins)
    expect(await c(10, 0.5, 0, 3)).toBe(18); // 6 dessins, chacun avec toutes ses découpes
    expect(await c(10, 1, 0, 3)).toBe(30);
    // monotone
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) { const v = await c(23, t, 5); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });

  test('Impression : cadres standard seulement, œuvre à la taille du cadre, dessins réduits, produits impression', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#canvas-orient [data-orient="port"]')).toHaveClass(/on/); // toute nouvelle création part en portrait
    await page.evaluate(() => document.querySelector('#canvas-orient [data-orient="land"]').click()); // ce test suit une œuvre en paysage
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png', 'photo-wood.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const opts = await page.evaluate(() => [...document.getElementById('format').options].filter((o) => !o.hidden && !o.disabled).map((o) => o.value));
    // cinq cadres du commerce, rien d'autre ; 50 × 70 pour ces cinq dessins (page-two.png en donne
    // deux ; 30 × 40 jusqu'à 4)
    expect(opts).toEqual(['cadre:21x30', 'cadre:30x40', 'cadre:40x50', 'cadre:50x70', 'cadre:70x100']);
    expect(await page.evaluate(() => document.getElementById('format').value)).toBe('cadre:50x70');
    await expect(page.locator('#guide-box')).toBeHidden();
    await expect(page.locator('#sizes-hint')).toBeHidden();
    // pas de vérification des tailles en tableau imprimé (la photo importée serait « à vérifier » en collage),
    // ni de pastille de taille sur les vignettes
    await expect(page.locator('#sizes-alert')).toBeHidden();
    await expect(page.locator('#sizes-check')).toBeHidden();
    await expect(page.locator('#drawings .thumb')).toHaveCount(5);
    await expect(page.locator('#drawings .thumb .size')).toHaveCount(0);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.some((d) => d.uncertain))).toBe(true);
    // le cadre 21 × 30 sans passe-partout : l'œuvre fait exactement un A4 (29,7 × 21, paysage), tous
    // les dessins (curseur au maximum) sont réduits pour y tenir
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    await page.selectOption('#format', 'cadre:21x30');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const A = AtelierGribouille, c = A.state.comp;
      const d = A.state.drawings[0], p = c.items.find((L) => L.piece.drawing === d);
      return { W: c.W, H: c.H, k: A.scale(), all: A.state.proposals.every((pr) => Math.abs(pr.comp.W - 29.7) < 1e-6 && Math.abs(pr.comp.H - 21) < 1e-6), pieceCm: p ? Math.max(p.w, p.h) : null, sheetCm: d.sizeCm, fits: c.items.every((L) => Math.max(L.w, L.h) <= 30.01) };
    });
    expect(r.W).toBe(29.7); expect(r.H).toBe(21);
    expect(r.all).toBe(true);
    // jamais agrandis ; réduits seulement si nécessaire (les pièces d'essai, petites, tiennent presque)
    expect(r.k).toBeGreaterThan(0.05); expect(r.k).toBeLessThanOrEqual(1);
    expect(r.fits).toBe(true);
    if (r.pieceCm) expect(r.pieceCm).toBeLessThan(r.sheetCm);
    await expect(page.locator('#scale-info')).toHaveText('Impression de 29,7 × 21 cm, à la taille du cadre.');
    // fond uni : aucune page de fond, un aplat de couleur sur chaque proposition (blanc fixe en Galerie),
    // la page peinte importée est devenue une découpe, et le rôle « fond » n'est plus proposé
    const flat = await page.evaluate(() => AtelierGribouille.state.proposals.map((p) => ({ style: p.style.id, bg: p.comp.bg.length, ground: p.comp.ground, paint: p.comp.paint, grain: p.comp.grain })));
    expect(flat.every((p) => !!p.ground)).toBe(true);
    // un aplat parfaitement uni : pas de coups de brosse
    expect(flat.every((p) => p.paint === false)).toBe(true);
    // les pixels du fond sont tous de la même couleur
    const uni = await page.evaluate(() => { const c = document.createElement('canvas'); const comp = AtelierGribouille.state.comp; c.width = 200; c.height = 200; const x = c.getContext('2d'); Compose.renderGround(x, comp, 200 / comp.W); const d = x.getImageData(0, 0, 200, Math.floor(200 * comp.H / comp.W)).data; let diff = 0; for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) diff++; return diff; });
    expect(uni).toBe(0);
    // rôles : la page peinte en larges aplats colorés se colle en fond d'office, la page au fond
    // blanc reste une découpe ; le rôle « fond » se choisit aussi à la main
    const roles = await page.evaluate(() => Object.fromEntries(AtelierGribouille.state.drawings.map((d) => [d.name, d.role === 'auto' ? d.auto : d.role])));
    expect(roles['page-texture.png']).toBe('texture');
    expect(roles['page-cutout.png']).toBe('cutout');
    expect(roles['page-two — 1']).toBe('cutout');
    expect(roles['page-two — 2']).toBe('cutout');
    await page.evaluate(() => { const sec = document.getElementById('drawings-section'); if (sec.classList.contains('collapsed')) sec.querySelector('h2').click(); });
    await page.locator('#drawings .thumb[data-i="0"]').click();
    await expect(page.locator('#detail [data-role="texture"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelector('#ground button[data-hex=""]').hidden)).toBe(true);
    // « Sans couleur » : un fond blanc pur, proposé seulement en Impression
    expect(await page.evaluate(() => document.querySelector('#ground button[data-hex="#ffffff"]').hidden)).toBe(false);
    await page.evaluate(() => document.querySelector('#ground button[data-hex="#ffffff"]').click());
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.filter((p) => p.style.id !== 'galerie').every((p) => p.comp.ground === '#ffffff'))).toBe(true);
    expect(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 20; c.height = 20; const x = c.getContext('2d'); Compose.renderGround(x, AtelierGribouille.state.comp, 20 / AtelierGribouille.state.comp.W); return Array.from(x.getImageData(5, 5, 1, 1).data); })).toEqual([255, 255, 255, 255]);
    expect(await page.evaluate(() => document.getElementById('ground-name').textContent)).toBe('sans couleur (blanc)');
    await page.evaluate(() => document.querySelector('#ground button[data-hex="auto"]').click());
    await page.waitForTimeout(400);
    await expect(page.locator('#export-info')).toContainText('tableau imprimé de 29,7 × 21 cm');
    // chaque dessin s'agrandit ou se réduit à la main : touches + et − (10 %), puis poignée carrée (plus de
    // boutons dans la barre d'outils)
    await page.evaluate(() => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[0]; A.render(); });
    await expect(page.locator('#toolbar [data-act="bigger"]')).toHaveCount(0);
    const w0 = await page.evaluate(() => AtelierGribouille.state.selected.w);
    await page.keyboard.press('=');
    expect(await page.evaluate(() => AtelierGribouille.state.selected.w)).toBeCloseTo(w0 * 1.1, 4);
    await page.keyboard.press('-');
    expect(await page.evaluate(() => AtelierGribouille.state.selected.w)).toBeCloseTo(w0, 4);
    // une page de fond agrandie : son contour déchiré grandit avec elle (rien de la page n'est masqué)
    const ext = () => page.evaluate(() => { const L = AtelierGribouille.state.selected; const xs = L.clip.map((q) => q[0]), ys = L.clip.map((q) => q[1]); return { w: L.w, h: L.h, cw: Math.max(...xs) - Math.min(...xs), ch: Math.max(...ys) - Math.min(...ys) }; });
    const hasClip = await page.evaluate(() => { const A = AtelierGribouille, L = A.state.comp.bg.find((q) => q.clip && q.panel); if (!L) return false; A.state.selected = L; A.render(); return true; });
    expect(hasClip).toBe(true);
    const e0 = await ext();
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    const e1 = await ext();
    expect(e1.w).toBeGreaterThan(e0.w * 1.3);
    expect(e1.cw / e1.w).toBeCloseTo(e0.cw / e0.w, 3);
    expect(e1.ch / e1.h).toBeCloseTo(e0.ch / e0.h, 3);
    // la page redimensionnée passe devant les autres pages : sinon, agrandie sous elles, on ne la verrait pas
    expect(await page.evaluate(() => { const c = AtelierGribouille.state.comp; return c.bg.indexOf(AtelierGribouille.state.selected) === c.bg.length - 1; })).toBe(true);
    // le curseur de densité refait la composition : la page agrandie (et déplacée) garde sa taille et sa place,
    // les autres pages suivent la nouvelle proposition
    const before = await page.evaluate(() => { const A = AtelierGribouille, L = A.state.selected; L.x = 7; L.y = 5; L.manual = true; return { w: L.w, i: A.state.comp.bg.indexOf(L), other: A.state.comp.bg.filter((q) => !q.paper && q !== L).map((q) => q.w) }; });
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = String(Number(d.value) - 0.3); d.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const after = await page.evaluate((i) => { const A = AtelierGribouille, L = A.state.comp.bg[i]; A.state.selected = L; A.render(); return { w: L.w, x: L.x, y: L.y, sized: !!L.sized, n: A.state.comp.bg.length }; }, before.i);
    expect(after.w).toBeCloseTo(before.w, 3);
    expect([after.x, after.y]).toEqual([7, 5]);
    expect(after.sized).toBe(true);
    // la même page, non retouchée, aurait repris la taille de la proposition (plus petite)
    expect(before.other.every((w) => w < before.w)).toBe(true);
    for (let i = 0; i < 4; i++) await page.keyboard.press('-');
    await page.evaluate(() => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[0]; A.render(); });
    const h = await page.evaluate(() => {
      const A = AtelierGribouille, L = A.state.selected, v = A.view, r = document.getElementById('canvas').getBoundingClientRect();
      const c = Math.cos(L.rot), s = Math.sin(L.rot), hx = L.w / 2, hy = -L.h / 2;
      const X = L.x + hx * c - hy * s, Y = L.y + hx * s + hy * c;
      const cx = r.left + (v.ox + L.x * v.s) / v.dpr, cy = r.top + (v.oy + L.y * v.s) / v.dpr;
      return { x: r.left + (v.ox + X * v.s) / v.dpr, y: r.top + (v.oy + Y * v.s) / v.dpr, cx, cy };
    });
    // (la composition a été refaite par le curseur de densité : la pièce n'a plus la taille d'avant)
    const wd = await page.evaluate(() => AtelierGribouille.state.selected.w);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    // on s'éloigne du centre de 50 % : la pièce grandit d'autant
    await page.mouse.move(h.cx + (h.x - h.cx) * 1.25, h.cy + (h.y - h.cy) * 1.25);
    await page.mouse.move(h.cx + (h.x - h.cx) * 1.5, h.cy + (h.y - h.cy) * 1.5);
    await page.mouse.up();
    const w1 = await page.evaluate(() => AtelierGribouille.state.selected.w);
    expect(w1 / wd).toBeGreaterThan(1.3); expect(w1 / wd).toBeLessThan(1.7);
    await page.evaluate(() => { AtelierGribouille.undo(); });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items[0].w)).toBeCloseTo(wd, 4);
    await page.evaluate(() => { AtelierGribouille.state.selected = null; AtelierGribouille.render(); });
    // portrait : 21 × 29,7
    await page.locator('#canvas-orient [data-orient="port"]').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual([21, 29.7]);
    // panier : tirages et fichier HD seulement (l'étape Exporter, repliée après l'import, s'ouvre par son titre)
    await page.evaluate(() => { const s = document.getElementById('export-section'); if (s.classList.contains('collapsed')) s.querySelector('h2').click(); });
    await page.locator('#add-cart').click();
    await expect(page.locator('#cart-add')).toBeVisible();
    await expect(page.locator('#cart-add input[value="print"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="hd"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="kit"]')).toBeHidden();
    await expect(page.locator('.cart-what-size')).toContainText('tableau imprimé de 21 × 29,7 cm');
    // la taille proposée est le cadre choisi ; les quatre tailles, avec leur prix
    await expect(page.locator('#cart-add [data-size="21x30"]')).toHaveClass(/on/);
    expect(await page.evaluate(() => [...document.querySelectorAll('#cart-add [data-size]')].map((b) => b.dataset.size))).toEqual(['21x30', '30x40', '40x50', '50x70', '70x100']);
    await expect(page.locator('.cart-fit')).toBeHidden(); // l'œuvre fait exactement la taille du cadre
    await page.locator('#cart-add [data-close]').first().click();
    // avec passe-partout : l'impression prend la taille en dessous (13 × 18 dans le 21 × 30), même cadre.
    // Sur ordinateur, la section Tailles n'a plus le choix du passe-partout : il se fait dans la mise en
    // scène, ouverte par le bouton sous l'orientation
    await expect(page.locator('#print-mat-field')).toBeHidden();
    await openStep(page, 'sizes-section');
    await expect(page.locator('#scene-open-side')).toBeVisible();
    await page.locator('#scene-open-side').click();
    await expect(page.locator('#scene-modal')).toBeVisible();
    await page.locator('#scene-mat [data-mat="1"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#scene-modal')).toBeHidden();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual([13, 18]);
    await expect(page.locator('#scale-info')).toHaveText('Impression de 13 × 18 cm avec passe-partout, dans un cadre de 21 × 30 cm.');
    await expect(page.locator('#scene-mat [data-mat="1"]')).toHaveClass(/on/); // même choix dans la mise en scène
    await page.locator('#add-cart').click();
    // encadré avec passe-partout : pas de 21 × 30 à la commande, le 30 × 40 le remplace
    await expect(page.locator('#cart-add [data-size="21x30"]')).toBeHidden();
    await expect(page.locator('#cart-add [data-size="30x40"]')).toHaveClass(/on/);
    // papier d'art ou encadré : pas d'impression sur toile
    await expect(page.locator('#cart-add [data-finish="toile"]')).toHaveCount(0);
    expect(await page.evaluate(() => [...document.querySelectorAll('#cart-add [data-finish]')].map((b) => b.dataset.finish))).toEqual(['papier', 'cadre']);
    // papier : la taille d'impression, sans cadre ni passe-partout
    await page.locator('#cart-add [data-finish="papier"]').click();
    await expect(page.locator('#cart-add .cart-frame-field')).toBeHidden();
    await expect(page.locator('#cart-add [data-size="21x30"]')).toBeVisible(); // (sur papier, le 21 × 30 revient)
    await page.locator('#cart-add [data-size="21x30"]').click();
    await expect(page.locator('#cart-add .cart-dims')).toHaveText('Impression 21 × 29,7 cm sur papier d’art, sans cadre');
    // encadré : la couleur du cadre et le passe-partout (celui de l'œuvre par défaut), les deux tailles en clair
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await expect(page.locator('#cart-add .cart-frame-field')).toBeVisible();
    // le choix du passe-partout vient juste sous Papier / Encadré
    await expect(page.locator('#cart-add .cart-mat-field')).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('#cart-add .cart-finish').nextElementSibling.classList.contains('cart-mat-field'))).toBe(true);
    expect(await page.evaluate(() => [...document.querySelectorAll('#cart-add [data-frame-kind]')].map((b) => b.dataset.frameKind))).toEqual(['bois-clair', 'bois-fonce', 'bois-noir', 'bois-blanc', 'metal']);
    await expect(page.locator('#cart-add [data-frame-kind].on')).toHaveCount(1);
    await expect(page.locator('#cart-add [data-mat="1"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add [data-size="21x30"]')).toBeHidden();
    await expect(page.locator('#cart-add .cart-dims')).toHaveText('Cadre 30 × 40 cm · impression 21 × 29,7 cm, entourée d’un passe-partout blanc');
    await expect(page.locator('.cart-fit')).toBeHidden(); // (presque les mêmes proportions)
    // sans passe-partout : le 21 × 30 revient
    await page.locator('#cart-add [data-mat="0"]').click();
    await expect(page.locator('#cart-add [data-size="21x30"]')).toBeVisible();
    await page.locator('#cart-add [data-size="21x30"]').click();
    await expect(page.locator('#cart-add .cart-dims')).toHaveText('Cadre 21 × 30 cm · impression 21 × 29,7 cm, à la taille du cadre');
    // avec passe-partout sur un 21 × 30 choisi : il passe au 30 × 40
    await page.locator('#cart-add [data-mat="1"]').click();
    await expect(page.locator('#cart-add [data-size="30x40"]')).toHaveClass(/on/);
    await page.locator('#cart-add [data-mat="0"]').click();
    await page.locator('#cart-add [data-size="21x30"]').click();
    await page.locator('#cart-add [data-frame-kind="bois-noir"]').click();
    await expect(page.locator('#cart-add .cart-frame-name')).toHaveText('Bois noir');
    await expect(page.locator('#cart-add [data-frame-kind="bois-noir"]')).toHaveClass(/on/);
    // dans le panier, l'article dit le cadre, le passe-partout et les deux tailles
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item small').first()).toHaveText('Tableau imprimé encadré : cadre bois noir 21 × 30 cm, sans passe-partout, impression 21 × 29,7 cm');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-gribouille:panier')).map((it) => [it.frame, it.mat]))).toEqual([['bois-noir', false]]);
    await page.locator('#cart [data-close]').first().click();
    // sauvegardée puis rouverte : le mode et le cadre reviennent
    // l'œuvre s'enregistre d'elle-même : « nouvelle œuvre » la range dans Mes œuvres
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await page.goto('index.html?mode=toile&nouveau');
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await openStep(page, 'saved-section');
    await expect(page.locator('#saved-list .saved .saved-meta').first()).toContainText('Création imprimée'); // le type d'œuvre
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.mode)).toBe('impression');
    // (cadre, orientation et passe-partout reviennent)
    expect(await page.evaluate(() => [document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual(['cadre:21x30', 13, 18]);
    await expect(page.locator('#print-mat [data-mat="1"]')).toHaveClass(/on/);
    await page.evaluate(() => document.querySelector('#print-mat [data-mat="0"]').click()); // (caché sur ordinateur)
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual([21, 29.7]);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });

  test('Affiche : le nombre de dessins posés grandit pas à pas avec le curseur de densité', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#canvas-orient [data-orient="port"]')).toHaveClass(/on/); // toute nouvelle création part en portrait
    await page.evaluate(() => document.querySelector('#canvas-orient [data-orient="land"]').click()); // ce test suit une œuvre en paysage
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'photo-wood.png', 'noscale-small.jpg', 'noscale-medium.jpg'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => { const f = document.getElementById('format'); f.value = 'cadre:21x30'; f.dispatchEvent(new Event('change')); });
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
    // (feuilles déclarées de 120 cm : les sujets demandent bien plus que le cadre 21 × 30)
    await page.evaluate(() => { AtelierGribouille.state.drawings.forEach((d) => { d.sizeCm = 120; }); const f = document.getElementById('format'); f.value = 'cadre:21x30'; f.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const sp = await page.evaluate(() => { const c = AtelierGribouille.state.proposals[0].comp; const ys = c.items.map((L) => L.y / c.H), xs = c.items.map((L) => L.x / c.W); return { k: AtelierGribouille.scale(), n: c.items.length, dy: Math.max(...ys) - Math.min(...ys), dx: Math.max(...xs) - Math.min(...xs) }; });
    expect(sp.k).toBeLessThan(0.6);
    expect(sp.n).toBe(n);
    expect(sp.dy).toBeGreaterThan(0.45);
    expect(sp.dx).toBeGreaterThan(0.45);
  });

  test('Impression : « Nouvelles propositions » garde la taille des découpes agrandies ou réduites à la main', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'photo-wood.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // une découpe agrandie de 21 % (deux fois +), une autre réduite ; une troisième laissée telle quelle
    const pick = (i) => page.evaluate((i) => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[i]; A.render(); return { w: A.state.selected.w, id: A.state.selected.piece.id }; }, i);
    const a0 = await pick(0);
    await page.keyboard.press('='); await page.keyboard.press('=');
    const b0 = await pick(1);
    await page.keyboard.press('-');
    const c0 = await pick(2);
    const before = await page.evaluate(() => AtelierGribouille.state.comp.items.map((L) => [L.piece.id, L.w, L.x, L.y]));
    await page.locator('#generate').click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ style: AtelierGribouille.state.comp.style, items: AtelierGribouille.state.comp.items.map((L) => [L.piece.id, L.w, L.x, L.y, !!L.sized]) }));
    const wOf = (list, id) => list.find((x) => x[0] === id);
    // les deux tailles choisies sont gardées, la troisième suit la nouvelle proposition
    expect(wOf(after.items, a0.id)[1]).toBeCloseTo(a0.w * 1.21, 3);
    expect(wOf(after.items, b0.id)[1]).toBeCloseTo(b0.w / 1.1, 3);
    expect(wOf(after.items, a0.id)[4]).toBe(true);
    expect(wOf(after.items, c0.id)[4]).toBe(false);
    // et c'est bien une nouvelle mise en place
    expect(after.items.map((x) => [x[2], x[3]])).not.toEqual(before.map((x) => [x[2], x[3]]));
    // les découpes redimensionnées restent dans le cadre
    const out = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return c.items.filter((L) => L.sized && !(L.x - L.w / 2 >= -0.01 && L.x + L.w / 2 <= c.W + 0.01 && L.y - L.h / 2 >= -0.01 && L.y + L.h / 2 <= c.H + 0.01)).map((L) => [L.piece.id, L.x, L.y, L.w, L.h, c.W, c.H]); });
    expect(out).toEqual([]);
  });

  test('Affiche : un plus grand cadre agrandit l’œuvre affichée à l’identique, et les nouvelles propositions dans la même proportion', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#canvas-orient [data-orient="port"]')).toHaveClass(/on/); // toute nouvelle création part en portrait
    await page.evaluate(() => document.querySelector('#canvas-orient [data-orient="land"]').click()); // ce test suit une œuvre en paysage
    // un scan A4 à 300 dpi, seul, dans le cadre 70 × 50 : il garderait de la place, mais reste à sa taille
    await page.setInputFiles('#file', [fixture('scan-300dpi.jpg')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.min; d.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { W: c.W, H: c.H, k: AtelierGribouille.scale(), items: c.items.map((L) => [L.x / c.W, L.y / c.H, L.w / c.W]) }; });
    expect(before.W * before.H).toBeCloseTo(1200, 0); // (le 30 × 40, cadre de départ)
    await page.evaluate(() => { const f = document.getElementById('format'); f.value = 'cadre:50x70'; f.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    // les dessins grandissent avec le cadre (la racine du rapport des surfaces) : les propositions
    // refaites ressemblent à celles du 30 × 40, en plus grand
    const grow = Math.sqrt(3500 / 1200);
    expect(await page.evaluate(() => AtelierGribouille.scale())).toBeCloseTo(before.k * grow, 3);
    // l'œuvre affichée est agrandie à l'identique (mêmes places et tailles relatives)
    const after = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { W: c.W, items: c.items.map((L) => [L.x / c.W, L.y / c.H, L.w / c.W]) }; });
    expect(after.W).toBe(70);
    expect(after.items.length).toBe(before.items.length);
    before.items.forEach(([x, y, w], i) => { expect(after.items[i][0]).toBeCloseTo(x, 3); expect(after.items[i][1]).toBeCloseTo(y, 3); expect(after.items[i][2]).toBeCloseTo((w * before.W * Math.sqrt((70 / before.W) * (50 / before.H))) / 70, 3); });
    // les autres propositions, recomposées pour ce cadre : au plus ce même agrandissement
    const over = await page.evaluate(() => { const S = AtelierGribouille.state; return S.proposals.filter((p) => p.comp !== S.comp).flatMap((p) => p.comp.items.map((L) => { const c = L.piece.drawing.sizeCm / L.piece.drawing.srcLong; return Math.max(L.w / (L.piece.canvas.width * c), L.h / (L.piece.canvas.height * c)); })); });
    expect(over.length).toBeGreaterThan(0);
    for (const r of over) expect(r).toBeLessThanOrEqual(grow + 0.001);
    // « Nouvelles propositions » : les dessins gardent la taille qu'ils ont sur l'œuvre agrandie
    await page.locator('#generate').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => AtelierGribouille.scale())).toBeCloseTo(before.k * grow, 3);
    const rel = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return Math.max(...c.items.map((L) => L.w / c.W)); });
    expect(rel).toBeGreaterThan(0.6 * Math.max(...before.items.map((it) => it[2])));
    await expect(page.locator('#scale-info')).toHaveText('Impression de 70 × 50 cm, à la taille du cadre.');
  });

  test('Toile : le curseur règle le nombre de dessins, et la toile conseillée suit (moins de dessins, plus petite)', async ({ page }) => {
    test.setTimeout(240000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=toile&exemple');
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.proposals && document.getElementById('progress').hidden && AtelierGribouille.state.drawings.length > 2, null, { timeout: 180000 });
    const at = async (v) => {
      await page.evaluate((v) => { const d = document.getElementById('density'); d.value = v; d.dispatchEvent(new Event('change')); }, v);
      await page.waitForTimeout(400);
      return page.evaluate(() => ({ note: document.getElementById('density-note').textContent, area: AtelierGribouille.state.comp.W * AtelierGribouille.state.comp.H, label: document.getElementById('label-meta').textContent }));
    };
    const rows = [];
    for (const v of ['1.8', '1.4', '1.1', '0.8', '0.5']) rows.push(await at(v));
    const used = rows.map((r) => Number(r.note.split(' ')[0]));
    for (let i = 1; i < rows.length; i++) {
      expect(used[i], JSON.stringify(rows)).toBeLessThanOrEqual(used[i - 1]);
      expect(rows[i].area, JSON.stringify(rows)).toBeLessThanOrEqual(rows[i - 1].area);
    }
    expect(used[4]).toBeLessThan(used[0]);
    // le cartel, petit, dit le type de proposition et la taille de l'impression
    rows.forEach((r) => expect(r.label).toMatch(/^\S.* · (impression|toile) [\d,]+ × [\d,]+ cm$/));
  });

  test('Toile : taille réelle et toiles du commerce, guide et kit DIY (plus d’Atelier Signature) ; la bascule recompose', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#canvas-orient [data-orient="port"]')).toHaveClass(/on/); // toute nouvelle création part en portrait
    await page.evaluate(() => document.querySelector('#canvas-orient [data-orient="land"]').click()); // ce test suit une œuvre en paysage
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
    // taille réelle : pas d'agrandissement à la main (sauf en Galerie)
    await page.evaluate(() => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[0]; A.render(); });
    if ((await page.evaluate(() => AtelierGribouille.state.comp.style)) !== 'galerie') {
      const w = await page.evaluate(() => AtelierGribouille.state.selected.w);
      await page.keyboard.press('=');
      expect(await page.evaluate(() => AtelierGribouille.state.selected.w)).toBeCloseTo(w, 6);
    }
    await page.evaluate(() => { AtelierGribouille.state.selected = null; AtelierGribouille.render(); });
    await page.evaluate(() => { const s = document.getElementById('export-section'); if (s.classList.contains('collapsed')) s.querySelector('h2').click(); });
    await expect(page.locator('#guide-box')).toBeVisible();
    // toile : les pages peintes restent des pages de fond, la toile nue reste proposée
    expect(await page.evaluate(() => AtelierGribouille.state.proposals.some((p) => p.comp.bg.some((L) => !L.paper)))).toBe(true);
    expect(await page.evaluate(() => document.querySelector('#ground button[data-hex=""]').hidden)).toBe(false);
    expect(await page.evaluate(() => document.querySelector('#ground button[data-hex="#ffffff"]').hidden)).toBe(true); // « sans couleur » : Impression seulement
    await page.locator('#add-cart').click();
    await expect(page.locator('#cart-add input[value="guide"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="kit"]')).toBeVisible();
    await expect(page.locator('#cart-add input[value="signature"]')).toHaveCount(0); // l'offre Atelier Signature n'existe plus
    await expect(page.locator('#cart-add input[value="print"]')).toBeHidden();
    await expect(page.locator('#cart-add .cart-print')).toBeHidden();
    // kit DIY, à l'unité : une base (guide imprimé et gabarits, 45 €) et trois options cochées d'office,
    // chacune avec son prix ; la toile est tarifée selon la taille de l'œuvre
    await page.locator('#cart-add input[value="kit"]').check();
    await expect(page.locator('#cart-add .cart-kit')).toBeVisible();
    await expect(page.locator('#cart-add .cart-qty-row')).toBeHidden();
    const euro = (t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
    const total = async () => euro(await page.locator('.cart-add-total').textContent());
    const opt = async (k) => euro(await page.locator(`#cart-add .cart-opt:has([data-kit="${k}"]) em`).textContent());
    for (const k of ['toile', 'colle', 'pinceau']) await expect(page.locator(`#cart-add [data-kit="${k}"]`)).toBeChecked();
    const [pt, pc, pp] = [await opt('toile'), await opt('colle'), await opt('pinceau')];
    expect(pc).toBe(11); expect(pp).toBe(6); expect(pt).toBeGreaterThanOrEqual(17);
    expect(await total()).toBeCloseTo(45 + pt + pc + pp, 2);
    await expect(page.locator('#cart-add [data-price="kit"]')).toHaveText(await page.locator('.cart-add-total').textContent());
    // sans toile ni pinceaux : le prix suit
    await page.locator('#cart-add [data-kit="toile"]').uncheck();
    await page.locator('#cart-add [data-kit="pinceau"]').uncheck();
    expect(await total()).toBeCloseTo(45 + pc, 2);
    await page.locator('#cart-add [data-kit="toile"]').check();
    expect(await total()).toBeCloseTo(45 + pt + pc, 2);
    // le kit complet en 50 × 70 reste à 89 €
    expect(await page.evaluate(() => AtelierGribouille.kitPrice({ W: 70, H: 50 }))).toBe(89);
    await expect(page.locator('#cart-add input[value="kit"]').locator('xpath=..').locator('b')).toHaveText(await page.evaluate(() => `Kit DIY ${AtelierGribouille.state.comp.W} × ${AtelierGribouille.state.comp.H}`));
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await expect(page.locator('#cart .cart-item')).toContainText('Kit DIY');
    // la toile annoncée est celle de la composition, à sa taille
    const dims = await page.evaluate(() => `${AtelierGribouille.state.comp.W} × ${AtelierGribouille.state.comp.H}`);
    await expect(page.locator('#cart .cart-item small')).toContainText(`toile ${dims} cm`);
    // l'article garde ses options : sans pinceaux, avec colle et vernis
    await expect(page.locator('#cart .cart-item small')).toContainText('colle et vernis');
    await expect(page.locator('#cart .cart-item small')).not.toContainText('pinceaux');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-gribouille:panier'))[0].kit)).toEqual({ toile: true, colle: true, pinceau: false });
    // une œuvre faite avec les originaux n'existe qu'en un exemplaire : pas de quantité
    await expect(page.locator('#cart .cart-item .cart-qty')).toHaveCount(0);
    await page.locator('#cart [data-close]').first().click();
    // passage en Impression (par le code : plus de bascule dans l'interface) : cadre par défaut, œuvre recomposée à sa taille
    await page.evaluate((m) => { AtelierGribouille.setMode(m); AtelierGribouille.state.formatManual = false; AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); }, 'impression');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => [document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H])).toEqual(['cadre:50x70', 70, 50]);
    await page.evaluate((m) => { AtelierGribouille.setMode(m); AtelierGribouille.state.formatManual = false; AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); }, 'toile');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => /^\d+x\d+$/.test(document.getElementById('format').value))).toBe(true);
    expect(await page.evaluate(() => AtelierGribouille.state.formatManual)).toBeFalsy();
  });
  test('Impression : le cadre d’une nouvelle œuvre suit le nombre de dessins (30 × 40 jusqu’à 4, 50 × 70 au-delà), puis ne change plus de lui-même', async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    const frame = () => page.evaluate(() => [document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H]);
    // trois dessins (page-two.png en donne deux) : 30 × 40
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await frame()).toEqual(['cadre:30x40', 30, 40]);
    // trois de plus : l'œuvre garde son cadre (il ne change plus de lui-même)
    await page.setInputFiles('#file', ['page-texture.png', 'scan-300dpi.jpg', 'photo-wood.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 6 && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await frame()).toEqual(['cadre:30x40', 30, 40]);
    // une nouvelle œuvre de cinq dessins (même après une œuvre en 30 × 40) : 50 × 70
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await page.locator('#mode-pick button[data-mode="impression"]').click();
    await page.setInputFiles('#file', ['page-cutout.png', 'page-texture.png', 'scan-300dpi.jpg', 'photo-wood.png', 'scan-150dpi.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 5 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await frame()).toEqual(['cadre:50x70', 50, 70]);
  });
});
