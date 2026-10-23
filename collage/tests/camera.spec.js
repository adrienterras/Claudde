// Prise de photo dans l'atelier : jugement des images (feuille, cadrage, netteté, lumière) et
// parcours complet avec une caméra factice de Chromium qui joue une scène de synthèse (feuille
// blanche dessinée posée sur un parquet).
const { test, expect, fixture } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- scène de synthèse : un fichier Y4M (YUV 4:2:0) joué en boucle par la caméra factice
const VW = 640, VH = 480;
function scene() {
  const rgb = new Uint8Array(VW * VH * 3);
  const put = (x, y, r, g, b) => { const i = (y * VW + x) * 3; rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b; };
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // parquet : lames verticales, grain léger
  for (let x = 0; x < VW; x++) {
    const lame = Math.floor(x / 52);
    const t = [[150, 100, 60], [135, 90, 52], [160, 108, 66], [142, 95, 55]][lame % 4];
    for (let y = 0; y < VH; y++) { const g = (rnd() - 0.5) * 10; put(x, y, t[0] + g, t[1] + g, t[2] + g); }
  }
  // feuille blanche, 30 % de l'image, une marge tout autour
  const sx = 150, sy = 110, sw = 350, sh = 260;
  for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) put(x, y, 250, 249, 244);
  // un bonhomme au feutre noir : tête, corps, bras, jambes ; un soleil
  const ink = (x, y) => { if (x >= sx && x < sx + sw && y >= sy && y < sy + sh) put(x, y, 20, 20, 25); };
  const seg = (x0, y0, x1, y1, wd) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; for (let dy = -wd; dy <= wd; dy++) for (let dx = -wd; dx <= wd; dx++) if (dx * dx + dy * dy <= wd * wd) ink(Math.round(x + dx), Math.round(y + dy)); }
  };
  const circle = (cx, cy, r, wd) => { for (let a = 0; a < 360; a += 2) seg(cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180), cx + r * Math.cos(((a + 2) * Math.PI) / 180), cy + r * Math.sin(((a + 2) * Math.PI) / 180), wd); };
  const cx = sx + 170, cy = sy + 80;
  circle(cx, cy, 28, 3);
  seg(cx, cy + 28, cx, cy + 120, 4);
  seg(cx, cy + 55, cx - 55, cy + 95, 3); seg(cx, cy + 55, cx + 55, cy + 95, 3);
  seg(cx, cy + 120, cx - 40, cy + 185, 4); seg(cx, cy + 120, cx + 40, cy + 185, 4);
  circle(sx + 60, sy + 50, 22, 3);
  for (let a = 0; a < 360; a += 45) seg(sx + 60 + 30 * Math.cos((a * Math.PI) / 180), sy + 50 + 30 * Math.sin((a * Math.PI) / 180), sx + 60 + 45 * Math.cos((a * Math.PI) / 180), sy + 50 + 45 * Math.sin((a * Math.PI) / 180), 2);
  // tête et bras bleus et rouges : un peu de couleur
  for (let y = cy - 20; y < cy + 20; y++) for (let x = cx - 20; x < cx + 20; x++) if ((x - cx) ** 2 + (y - cy) ** 2 < 400) put(x, y, 240, 200, 150);
  return rgb;
}
function y4m(rgb, frames) {
  const Y = Buffer.alloc(VW * VH), U = Buffer.alloc((VW / 2) * (VH / 2)), V = Buffer.alloc((VW / 2) * (VH / 2));
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    const i = (y * VW + x) * 3, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    Y[y * VW + x] = Math.max(16, Math.min(235, Math.round(16 + 0.257 * r + 0.504 * g + 0.098 * b)));
    if (!(x & 1) && !(y & 1)) {
      const j = (y / 2) * (VW / 2) + x / 2;
      U[j] = Math.max(16, Math.min(240, Math.round(128 - 0.148 * r - 0.291 * g + 0.439 * b)));
      V[j] = Math.max(16, Math.min(240, Math.round(128 + 0.439 * r - 0.368 * g - 0.071 * b)));
    }
  }
  const parts = [Buffer.from(`YUV4MPEG2 W${VW} H${VH} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < frames; f++) parts.push(Buffer.from('FRAME\n'), Y, U, V);
  return Buffer.concat(parts);
}
const Y4M = path.join(os.tmpdir(), 'atelier-camera-scene.y4m');
fs.writeFileSync(Y4M, y4m(scene(), 10));

test.use({
  permissions: ['camera'],
  launchOptions: {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
  },
});

// Jugement d'une image par Camera.check, directement dans la page
async function judge(page, name, transform) {
  const data = 'data:image/png;base64,' + fs.readFileSync(fixture(name)).toString('base64');
  return page.evaluate(async ({ data, transform }) => {
    const img = new Image(); img.src = data; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d');
    if (transform === 'blur') x.filter = 'blur(5px)';
    if (transform === 'full') { x.drawImage(img, 350, 280, 900, 640, 0, 0, c.width, c.height); } else x.drawImage(img, 0, 0);
    if (transform === 'dark') { x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, 0, c.width, c.height); }
    if (transform === 'wood') { x.fillStyle = '#9a6a3c'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#8a5c32'; for (let i = 0; i < c.width; i += 130) x.fillRect(i, 0, 60, c.height); }
    const v = Camera.check(c, { full: true, k: 2 });
    return { level: v.level, title: v.title, found: v.found, quad: !!v.quad, points: v.points.map((p) => [p.code, p.level]) };
  }, { data, transform });
}
const lvl = (r, code) => (r.points.find((p) => p[0] === code) || [])[1];

test.describe('Photographier un dessin', () => {
  test('jugement : feuille nette sur parquet optimale ; floue, sombre, sans feuille ou coupée signalées', async ({ app }) => {
    const good = await judge(app.page, 'photo-wood.png');
    expect(good.found).toBe(true);
    expect(good.quad).toBe(true);
    expect(good.level).toBe('ok');
    expect(good.title).toBe('Photo optimale');
    for (const code of ['feuille', 'cadre', 'plat', 'nettete', 'lumiere', 'expo', 'definition']) expect(lvl(good, code)).toBe('ok');
    const blur = await judge(app.page, 'photo-wood.png', 'blur');
    expect(blur.level).toBe('bad');
    expect(lvl(blur, 'nettete')).toBe('bad');
    const dark = await judge(app.page, 'photo-wood.png', 'dark');
    expect(dark.level).toBe('bad');
    expect(lvl(dark, 'expo')).toBe('bad');
    const wood = await judge(app.page, 'photo-wood.png', 'wood');
    expect(wood.found).toBe(false);
    expect(lvl(wood, 'feuille')).toBe('bad');
    const full = await judge(app.page, 'photo-wood.png', 'full');
    expect(full.found).toBe(false);
    expect(lvl(full, 'cadre')).toBe('bad');
  });

  test('visée simple (une consigne), photo bonne gardée d’office (« Annuler »), photo à reprendre montrée avec sa raison, puis importée', async ({ app }) => {
    const page = app.page;
    await page.setViewportSize({ width: 390, height: 844 }); // le bouton n'est là que sur téléphone
    await expect(page.locator('#camera-open')).toBeVisible();
    await page.locator('#camera-open').click();
    await expect(page.locator('#camera')).toBeVisible();
    await page.waitForFunction(() => document.getElementById('camera-video').videoWidth > 0);
    // la scène de synthèse est une bonne photo : une seule consigne, « Prêt », et le cadre de la feuille tracé
    await expect(page.locator('#camera-verdict')).toHaveText('Prêt : prenez la photo', { timeout: 20000 });
    await expect(page.locator('#camera-verdict')).toHaveClass(/ok/);
    await expect(page.locator('#camera-points')).toHaveCount(0); // (plus de liste de contrôles)
    expect(await page.evaluate(() => { const g = document.getElementById('camera-guide'); const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })).toBeGreaterThan(100);
    await expect(page.locator('#camera-done')).toHaveText('Fermer');
    await expect(page.locator('#camera-last')).toBeHidden();
    // la photo prise est jugée en pleine définition (640 px : trop faible pour un tirage) : montrée, avec la raison
    await page.locator('#camera-shoot').click();
    await expect(page.locator('#camera-review')).toBeVisible();
    await expect(page.locator('#camera-verdict')).toHaveText('Photo à reprendre : définition trop faible');
    await expect(page.locator('#camera-tip')).toContainText('Rapprochez-vous');
    await expect(page.locator('#camera-shoot')).toBeHidden();
    await page.locator('#camera-retake').click();
    await expect(page.locator('#camera-review')).toBeHidden();
    await expect(page.locator('#camera-shoot')).toBeVisible();
    // un bon appareil (seuils abaissés) : la photo est gardée d'office, la visée continue ; « Annuler » la retire
    await page.evaluate(() => { Camera.PX.bad = 100; Camera.PX.warn = 200; });
    await page.locator('#camera-shoot').click();
    await expect(page.locator('#camera-toast')).toBeVisible();
    await expect(page.locator('#camera-toast')).toContainText('Photo gardée');
    await expect(page.locator('#camera-review')).toBeHidden();
    await expect(page.locator('#camera-count')).toHaveText('1');
    await expect(page.locator('#camera-done')).toHaveText('Importer (1)');
    await page.locator('#camera-undo').click();
    await expect(page.locator('#camera-last')).toBeHidden();
    await expect(page.locator('#camera-done')).toHaveText('Fermer');
    // une photo à reprendre peut être gardée quand même
    await page.evaluate(() => { Camera.PX.bad = 1170; Camera.PX.warn = 1640; });
    await page.locator('#camera-shoot').click();
    await page.locator('#camera-keep').click();
    await expect(page.locator('#camera-review')).toBeHidden();
    await expect(page.locator('#camera-count')).toHaveText('1');
    await page.locator('#camera-done').click();
    await expect(page.locator('#camera')).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('camera-video').srcObject)).toBeNull();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const ds = await app.drawings();
    expect(ds).toHaveLength(1);
    expect(ds[0].name).toBe('photo-1.jpg');
    expect(ds[0].photo).toBeTruthy();
  });

  test('vidéo qui ne démarre pas (iPhone en économie d’énergie) : message, relance, et l’appareil du téléphone en secours', async ({ app }) => {
    const page = app.page;
    // la lecture est refusée et aucune image n'arrive
    await page.evaluate(() => {
      window.__plays = 0;
      HTMLMediaElement.prototype.play = function () { window.__plays++; return Promise.reject(Object.assign(new Error('nope'), { name: 'NotAllowedError' })); };
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 0, configurable: true });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#camera-open').click();
    await expect(page.locator('#camera')).toBeVisible();
    await expect(page.locator('#camera-error')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#camera-error')).toContainText('L’image de l’appareil photo n’arrive pas (NotAllowedError)');
    await expect(page.locator('#camera-error button', { hasText: 'Relancer la vidéo' })).toBeVisible();
    await expect(page.locator('#camera-native-open')).toBeVisible();
    // « Relancer » retente la lecture (toujours refusée ici) : le message reste
    await page.locator('#camera-error button', { hasText: 'Relancer la vidéo' }).click();
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => window.__plays)).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#camera-error')).toBeVisible();
    // l'appareil du téléphone : le champ de fichier avec capture, dont la photo est gardée et importée
    expect(await page.evaluate(() => { const i = document.getElementById('camera-native'); return [i.getAttribute('capture'), i.accept]; })).toEqual(['environment', 'image/*']);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#camera-native-open').click()]);
    await chooser.setFiles(fixture('page-cutout.png'));
    await expect(page.locator('#camera')).toBeHidden();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const ds = await app.drawings();
    expect(ds).toHaveLength(1);
    expect(ds[0].name).toBe('photo-1.jpg');
  });

  test('fermer sans photo n’importe rien ; Échap ferme', async ({ app }) => {
    const page = app.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#camera-open').click();
    await page.waitForFunction(() => document.getElementById('camera-video').videoWidth > 0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#camera')).toBeHidden();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
  });
  test('iPad (écran tactile, mise en page d’ordinateur) : le bouton « Photographier un dessin » est proposé ; pas sur un ordinateur sans tactile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, permissions: ['camera'] });
    const page = await ctx.newPage();
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    expect(await page.evaluate(() => navigator.maxTouchPoints > 0)).toBe(true);
    await expect(page.locator('#empty-camera')).toBeVisible();
    // la visée s'ouvre, avec l'image de la caméra en grand
    await page.locator('#empty-camera').click();
    await expect(page.locator('#camera')).toBeVisible();
    await page.waitForFunction(() => document.getElementById('camera-video').videoWidth > 0);
    const stage = await page.locator('.camera-stage').boundingBox();
    expect(stage.height).toBeGreaterThan(400);
    expect(stage.width).toBeGreaterThan(500);
    await ctx.close();
    const desk = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const dp = await desk.newPage();
    await dp.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await dp.goto('index.html?mode=impression');
    await dp.waitForFunction(() => window.AtelierGribouille);
    await expect(dp.locator('#empty-camera')).toBeHidden();
    await desk.close();
  });
});
