// Tableau imprimé : avec ou sans bordure blanche de 3 cm autour de l'œuvre (affiche seule, ou encadré
// sans passe-partout), dans la mise en scène comme à la commande ; le même choix des deux côtés, mémorisé.
const { test, expect, fixture, openStep } = require('./helpers');

async function start(page) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto('index.html?mode=impression');
  await page.waitForFunction(() => window.AtelierGribouille);
  await page.setInputFiles('#file', [fixture('page-cutout.png')]);
  await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
}
// une empreinte des pixels d'un canevas (attend qu'il soit dessiné et stable)
async function sig(page, id) {
  await page.waitForFunction((id) => { const c = document.getElementById(id); return c.width > 0 && c.height > 0; }, id);
  await page.waitForTimeout(450);
  return page.evaluate((id) => {
    const c = document.getElementById(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007;
    return h;
  }, id);
}

test.describe('Bordure blanche', () => {
  test('mise en scène : Papier montre l’affiche seule, avec ou sans bordure de 3 cm ; encadré sans passe-partout aussi ; la commande reprend le choix', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await start(page);
    const { W, H } = await page.evaluate(() => AtelierGribouille.state.comp);
    const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('fr');
    await page.locator('#scene-open').click();
    await expect(page.locator('#scene-modal')).toBeVisible();
    // encadré par défaut : la finition se choisit en premier, après la pièce ; sans passe-partout (le
    // choix mémorisé des tests), la bordure se propose aussi pour l'encadré
    await expect(page.locator('#scene-finish [data-finish="cadre"]')).toHaveClass(/on/);
    await expect(page.locator('#scene-margin-field')).toBeVisible();
    await expect(page.locator('#scene-margin [data-margin="0"]')).toHaveClass(/on/);
    await expect(page.locator('#scene-frame-pick')).toBeVisible();
    const framedSig = await sig(page, 'scene-canvas');
    await page.locator('#scene-margin [data-margin="1"]').click();
    const borderSig = await sig(page, 'scene-canvas');
    expect(borderSig).not.toBe(framedSig);
    await page.locator('#scene-margin [data-margin="0"]').click();
    expect(await sig(page, 'scene-canvas')).not.toBe(borderSig);
    // papier : plus de cadre ni de passe-partout ; le poster a la taille d'impression du format
    await page.locator('#scene-finish [data-finish="papier"]').click();
    await expect(page.locator('#scene-frame-pick')).toBeHidden();
    await expect(page.locator('#scene-mat-field')).toBeHidden();
    await expect(page.locator('#scene-margin-field')).toBeVisible();
    await expect(page.locator('#scene-margin [data-margin="0"]')).toHaveClass(/on/);
    await expect(page.locator('#scene-size-info')).toHaveText(`Affiche de ${fmt(W)} × ${fmt(H)} cm, sans cadre.`);
    const paperSig = await sig(page, 'scene-canvas');
    expect(paperSig).not.toBe(framedSig);
    // avec bordure : l'œuvre réduite d'un même facteur dans l'affiche, 3 cm de blanc autour
    await page.locator('#scene-margin [data-margin="1"]').click();
    // (l'affiche : l'œuvre mise aux proportions de la zone imprimée, comme à la commande — la bordure fait 3 cm partout)
    expect(await sig(page, 'scene-canvas')).not.toBe(paperSig);
    expect(await page.evaluate(() => [localStorage.getItem('atelier.finition'), localStorage.getItem('atelier.marge')])).toEqual(['papier', '1']);
    // la commande reprend papier + bordure, et le texte le dit
    await page.locator('#scene-order').click();
    await expect(page.locator('#cart-add')).toBeVisible();
    await expect(page.locator('#cart-add [data-finish="papier"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add .cart-margin-field')).toBeVisible();
    await expect(page.locator('#cart-add .cart-margin-field [data-margin="1"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add .cart-dims:not(.cart-hd-dims)')).toContainText('avec une bordure blanche de 3 cm');
    await expect(page.locator('#cart-add .cart-dims:not(.cart-hd-dims)')).toContainText('l’œuvre imprimée en');
    // encadré sans passe-partout : la bordure reste proposée ; avec passe-partout, elle disparaît
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await expect(page.locator('#cart-add .cart-mat-field')).toBeVisible();
    await expect(page.locator('#cart-add [data-mat="0"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add .cart-margin-field')).toBeVisible();
    await expect(page.locator('#cart-add .cart-dims:not(.cart-hd-dims)')).toContainText('à la taille du cadre, avec une bordure blanche de 3 cm');
    await page.locator('#cart-add [data-mat="1"]').click();
    await expect(page.locator('#cart-add .cart-margin-field')).toBeHidden();
    await expect(page.locator('#cart-add .cart-dims:not(.cart-hd-dims)')).not.toContainText('bordure');
    await page.locator('#cart-add [data-mat="0"]').click();
    await page.locator('#cart-add [data-finish="papier"]').click();
    // « sans bordure » : le texte redevient « sans cadre », et la mise en scène change
    const withSig = await sig(page, 'cart-scene');
    await page.locator('#cart-add .cart-margin-field [data-margin="0"]').click();
    await expect(page.locator('#cart-add .cart-dims:not(.cart-hd-dims)')).not.toContainText('bordure');
    expect(await sig(page, 'cart-scene')).not.toBe(withSig);
    await page.locator('#cart-add .cart-margin-field [data-margin="1"]').click();
    // l'article garde la bordure ; le panier la dit
    await page.locator('#cart-add-ok').click();
    await page.waitForFunction(() => document.getElementById('cart-add').hidden || !document.getElementById('cart-add-ok').disabled);
    const it = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /panier/.test(x)); return JSON.parse(localStorage.getItem(k)).slice(-1)[0]; });
    expect(it.finish).toBe('papier');
    expect(it.margin).toBe(true);
    expect(it.frame).toBeUndefined();
    await page.evaluate(() => document.getElementById('cart-add-view').click());
    await expect(page.locator('#cart')).toContainText('avec une bordure blanche de 3 cm');
  });

  test('export d’un tableau imprimé : le choix de la bordure blanche, mémorisé ; l’image exportée porte 3 cm de blanc, le PDF une page à la taille de la feuille', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // (avec une page peinte en fond : les pages qui dépassent de l'œuvre ne doivent pas entamer la bordure)
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png'), fixture('page-texture.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // une page de fond posée en travers, qui déborde de l'œuvre à gauche et en haut ; une autre, au bord
    // gris (le bord d'un scan), posée au ras du bas
    await page.evaluate(() => {
      const c = AtelierGribouille.state.comp; const L = c.bg.find((q) => !q.paper);
      if (L) {
        L.x = 0; L.y = 0; L.rot = 0.4;
        const src = L.src, g = document.createElement('canvas'); g.width = src.width; g.height = src.height;
        const x = g.getContext('2d'); x.drawImage(src, 0, 0); x.fillStyle = '#888'; x.fillRect(0, src.height - 6, src.width, 6);
        c.bg.push(Object.assign({}, L, { src: g, x: c.W / 2, y: c.H - L.h / 2, rot: 0, w: L.w, h: L.h, sx: 0, sy: 0, sw: src.width, sh: src.height }));
      }
    });
    const { W, H } = await page.evaluate(() => AtelierGribouille.state.comp);
    const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('fr');
    await openStep(page, 'export-section');
    // le champ n'existe qu'en tableau imprimé ; « Sans bordure » par défaut (mémoire des tests)
    await expect(page.locator('#export-margin-field')).toBeVisible();
    await expect(page.locator('#export-margin [data-margin="0"]')).toHaveClass(/on/);
    await expect(page.locator('#export-info')).not.toContainText('bordure');
    await page.locator('#export-margin [data-margin="1"]').click();
    await expect(page.locator('#export-info')).toContainText(`tableau imprimé de ${fmt(W)} × ${fmt(H)} cm avec une bordure blanche de 3 cm (l’œuvre imprimée en ${fmt(W - 6)} × ${fmt(H - 6)} cm)`);
    expect(await page.evaluate(() => localStorage.getItem('atelier.marge'))).toBe('1');
    // ce que l'export rend : une copie aux dimensions de la zone imprimée, sur une feuille de la taille de l'œuvre
    const ex = await page.evaluate(() => { const e = AtelierGribouille.exportComp(); return { W: e.W, H: e.H, m: e.m, cw: e.comp.W, ch: e.comp.H, same: e.comp === AtelierGribouille.state.comp }; });
    expect(ex.m).toBe(3); expect(ex.same).toBe(false);
    expect(ex.W).toBeCloseTo(W, 5); expect(ex.cw).toBeCloseTo(W - 6, 5); expect(ex.ch).toBeCloseTo(H - 6, 5);
    // l'image exportée (qualité écran, PNG) : du blanc sur 3 cm à chaque bord, l'œuvre au milieu
    await page.evaluate(() => { AtelierGribouille.state.exportDpi = 150; }); // (fichier réduit pour l'essai : l'export est toujours à 300 dpi)
    await page.locator('#fmt').selectOption('image/png');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    const data = 'data:image/png;base64,' + require('fs').readFileSync(await dl.path()).toString('base64');
    const px = await page.evaluate(async ([data, W, H]) => {
      const img = new Image(); img.src = data; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const k = c.width / W; // px par cm
      const at = (cx, cy) => Array.from(x.getImageData(Math.round(cx * k), Math.round(cy * k), 1, 1).data);
      // la bande blanche : tout le pourtour, tous les 0,5 cm, à 0,5 et 2,5 cm du bord, et à 3,05 cm (la
      // bordure mord de 1 mm sur l'œuvre : pas de liseré au ras) ; l'intérieur : y a-t-il autre chose que du blanc ?
      const band = [];
      for (const d of [0.5, 2.5, 3.05]) {
        for (let t = 0.5; t < W - 0.5; t += 0.5) { band.push(at(t, d)); band.push(at(t, H - d)); }
        for (let t = 0.5; t < H - 0.5; t += 0.5) { band.push(at(d, t)); band.push(at(W - d, t)); }
      }
      let nonWhite = 0;
      for (let cy = 4; cy < H - 4; cy += 0.5) for (let cx = 4; cx < W - 4; cx += 0.5) { const p = at(cx, cy); if (p[0] + p[1] + p[2] < 700) nonWhite++; }
      return { w: c.width, h: c.height, band, nonWhite };
    }, [data, W, H]);
    expect(px.w / px.h).toBeCloseTo(W / H, 1);
    expect(px.band.filter((p) => p[0] < 250 || p[1] < 250 || p[2] < 250).length).toBe(0);
    expect(px.nonWhite).toBeGreaterThan(50);
    // le PDF : une page à la taille de la feuille
    await page.locator('#fmt').selectOption('application/pdf');
    await expect(page.locator('#export-info')).toContainText(`PDF d’une page de ${fmt(W)} × ${fmt(H)} cm avec une bordure blanche de 3 cm`);
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    const buf = require('fs').readFileSync(await pdf.path());
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(buf.toString('latin1'));
    expect(box).not.toBeNull();
    const [pw, ph] = [Number(box[1]), Number(box[2])].map((v) => (v / 72) * 2.54);
    expect(Math.max(pw, ph)).toBeCloseTo(Math.max(W, H), 0);
    expect(Math.min(pw, ph)).toBeCloseTo(Math.min(W, H), 0);
    // « Sans bordure » : l'export rend l'œuvre elle-même ; en collage des originaux, pas de champ
    await page.locator('#export-margin [data-margin="0"]').click();
    expect(await page.evaluate(() => { const e = AtelierGribouille.exportComp(); return e.m === 0 && e.comp === AtelierGribouille.state.comp; })).toBe(true);
    await page.evaluate(() => AtelierGribouille.setMode('toile'));
    await expect(page.locator('#export-margin-field')).toBeHidden();
  });

  test('export avec passe-partout : la feuille fait la taille du cadre, l’œuvre au centre dans la fenêtre ; pas de choix de bordure', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.addInitScript(() => { localStorage.setItem('atelier.passe-partout', '1'); localStorage.setItem('atelier.marge', '1'); });
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('fr');
    const fc = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { W: c.W, H: c.H, mat: localStorage.getItem('atelier.passe-partout') }; });
    expect(fc.mat).toBe('1');
    await openStep(page, 'export-section');
    // avec passe-partout : pas de choix de bordure (même mémorisée « avec ») ; la feuille est le cadre
    await expect(page.locator('#export-margin-field')).toBeHidden();
    const ex = await page.evaluate(() => { const e = AtelierGribouille.exportComp(); return { W: e.W, H: e.H, ox: e.ox, oy: e.oy, mat: !!e.mat, same: e.comp === AtelierGribouille.state.comp }; });
    expect(ex.mat).toBe(true); expect(ex.same).toBe(true);
    expect(ex.W).toBeGreaterThan(fc.W); expect(ex.H).toBeGreaterThan(fc.H);
    expect(ex.ox).toBeCloseTo((ex.W - fc.W) / 2, 5); expect(ex.oy).toBeCloseTo((ex.H - fc.H) / 2, 5);
    await expect(page.locator('#export-info')).toContainText(`pour une feuille de ${fmt(ex.W)} × ${fmt(ex.H)} cm, la taille du cadre : l’œuvre de ${fmt(fc.W)} × ${fmt(fc.H)} cm au centre, dans la fenêtre du passe-partout`);
    // l'image : aux proportions du cadre ; blanc tout autour de la fenêtre, l'œuvre au centre
    await page.evaluate(() => { AtelierGribouille.state.exportDpi = 150; }); // (fichier réduit pour l'essai : l'export est toujours à 300 dpi)
    await page.locator('#fmt').selectOption('image/png');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    const data = 'data:image/png;base64,' + require('fs').readFileSync(await dl.path()).toString('base64');
    const px = await page.evaluate(async ([data, W, H, ox, oy]) => {
      const img = new Image(); img.src = data; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const k = c.width / W;
      const at = (cx, cy) => Array.from(x.getImageData(Math.min(c.width - 1, Math.round(cx * k)), Math.min(c.height - 1, Math.round(cy * k)), 1, 1).data);
      const band = [];
      for (let t = 0.5; t < W - 0.5; t += 0.5) { band.push(at(t, oy - 0.5)); band.push(at(t, H - oy + 0.5)); }
      for (let t = 0.5; t < H - 0.5; t += 0.5) { band.push(at(ox - 0.5, t)); band.push(at(W - ox + 0.5, t)); }
      let nonWhite = 0;
      for (let cy = oy + 1; cy < H - oy - 1; cy += 0.5) for (let cx = ox + 1; cx < W - ox - 1; cx += 0.5) { const p = at(cx, cy); if (p[0] + p[1] + p[2] < 700) nonWhite++; }
      return { w: c.width, h: c.height, bad: band.filter((p) => p[0] < 250 || p[1] < 250 || p[2] < 250).length, nonWhite };
    }, [data, ex.W, ex.H, ex.ox, ex.oy]);
    expect(px.w / px.h).toBeCloseTo(ex.W / ex.H, 1);
    expect(px.bad).toBe(0);
    expect(px.nonWhite).toBeGreaterThan(50);
    // le PDF : une page à la taille du cadre
    await page.locator('#fmt').selectOption('application/pdf');
    await expect(page.locator('#export-info')).toContainText(`PDF d’une page de ${fmt(ex.W)} × ${fmt(ex.H)} cm, la taille du cadre`);
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    const buf = require('fs').readFileSync(await pdf.path());
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(buf.toString('latin1'));
    const [pw, ph] = [Number(box[1]), Number(box[2])].map((v) => (v / 72) * 2.54);
    expect(Math.max(pw, ph)).toBeCloseTo(Math.max(ex.W, ex.H), 0);
    expect(Math.min(pw, ph)).toBeCloseTo(Math.min(ex.W, ex.H), 0);
  });

  test('encadré avec passe-partout : pas de bordure ; sans passe-partout, l’article la porte ; le choix « sans » est mémorisé', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await start(page);
    await page.evaluate(() => { localStorage.setItem('atelier.finition', 'papier'); localStorage.setItem('atelier.marge', '1'); });
    await page.evaluate(() => document.getElementById('add-cart').click());
    await expect(page.locator('#cart-add')).toBeVisible();
    await expect(page.locator('#cart-add .cart-margin-field [data-margin="1"]')).toHaveClass(/on/);
    await page.locator('#cart-add .cart-margin-field [data-margin="0"]').click();
    expect(await page.evaluate(() => localStorage.getItem('atelier.marge'))).toBe('0');
    // encadré avec passe-partout : l'article n'a pas de bordure
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await page.locator('#cart-add [data-mat="1"]').click();
    await page.locator('#cart-add-ok').click();
    await page.waitForFunction(() => document.getElementById('cart-add').hidden || !document.getElementById('cart-add-ok').disabled);
    const last = () => page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /panier/.test(x)); return JSON.parse(localStorage.getItem(k)).slice(-1)[0]; });
    const it = await last();
    expect(it.finish).toBe('cadre');
    expect(it.mat).toBe(true);
    expect(it.margin).toBeUndefined();
    // encadré sans passe-partout, avec bordure : l'article la porte, le panier la dit
    await page.evaluate(() => document.querySelectorAll('.account-modal:not([hidden]) [data-close]').forEach((b) => b.click()));
    await page.evaluate(() => document.getElementById('add-cart').click());
    await expect(page.locator('#cart-add')).toBeVisible();
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await page.locator('#cart-add [data-mat="0"]').click();
    await page.locator('#cart-add .cart-margin-field [data-margin="1"]').click();
    await page.locator('#cart-add-ok').click();
    await page.waitForFunction(() => document.getElementById('cart-add').hidden || !document.getElementById('cart-add-ok').disabled);
    const it2 = await last();
    expect(it2.finish).toBe('cadre');
    expect(it2.mat).toBe(false);
    expect(it2.margin).toBe(true);
    await page.evaluate(() => document.getElementById('cart-add-view').click());
    await expect(page.locator('#cart')).toContainText('sans passe-partout, avec une bordure blanche de 3 cm');
    // la mise en scène rouverte : encadré, comme choisi à la commande
    await page.evaluate(() => document.querySelectorAll('.account-modal:not([hidden]) [data-close]').forEach((b) => b.click()));
    await page.evaluate(() => document.getElementById('scene-open').click());
    await expect(page.locator('#scene-modal')).toBeVisible();
    await expect(page.locator('#scene-finish [data-finish="cadre"]')).toHaveClass(/on/);
  });
});
