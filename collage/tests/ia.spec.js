// Découpe assistée par IA (js/ai-cut.js) : le réglage dans Importer ; sur une feuille de couleur, le sujet vu
// par le modèle guide la découpe de l'atelier (plis et ombres écartés) ; « Affiner avec l'IA » dans la retouche.
// Le modèle lui-même (214 Mo, WebGPU) n'est pas lancé ici : AICut.mask est remplacé par un sujet calculé
// sur l'image (l'orange et le noir), ce qui éprouve tout le reste du mécanisme.
const { test, expect } = require('./helpers');

// une feuille vert anis froissée (ombres de plis), une carotte orange peinte, des feuilles au crayon noir
const SHEET = () => {
  const c = document.createElement('canvas'); c.width = 1414; c.height = 1000; const x = c.getContext('2d');
  x.fillStyle = 'rgb(196, 226, 74)'; x.fillRect(0, 0, c.width, c.height);
  [[150, 0, 420, 1000], [700, 0, 980, 1000], [0, 620, 1414, 760]].forEach(([x0, y0, x1, y1]) => {
    const g = x0 === 0 && x1 === 1414 ? x.createLinearGradient(0, y0, 0, y1) : x.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(x0, y0, x1 - x0, y1 - y0);
  });
  x.save(); x.translate(760, 480); x.rotate(-0.55);
  x.fillStyle = 'rgb(236, 108, 38)'; x.beginPath(); x.ellipse(0, 0, 330, 70, 0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#222'; x.lineWidth = 9; x.lineCap = 'round';
  for (let k = -2; k <= 2; k++) { x.beginPath(); x.moveTo(-330, 0); x.quadraticCurveTo(-420, k * 30, -470, k * 55); x.stroke(); }
  x.restore();
  // une tache d'ombre grisâtre qui touche la pointe de la carotte (un pli marqué) : de l'encre pour
  // l'atelier seul, qui l'englobe dans la pièce ; du papier dès que l'IA montre le sujet
  x.fillStyle = 'rgb(150, 160, 110)'; x.beginPath(); x.ellipse(1230, 230, 170, 110, 0.3, 0, Math.PI * 2); x.fill();
  return c;
};
// le « modèle » de remplacement : le sujet, c'est l'orange et le noir (pas le vert, même sombre)
const STUB = `window.AICut.mask = async (canvas) => {
  const S = 256, c = document.createElement('canvas'); c.width = S; c.height = Math.round(S * canvas.height / canvas.width);
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(canvas, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, data = new Uint8Array(c.width * c.height);
  for (let p = 0; p < data.length; p++) { const R = d[p * 4], G = d[p * 4 + 1], B = d[p * 4 + 2]; data[p] = (R > 180 && G < 160 && B < 120) || (R + G + B < 200) ? 1 : 0; }
  window.__aiCalls = (window.__aiCalls || 0) + 1;
  return { data, w: c.width, h: c.height };
};`;

async function start(page, withGpu) {
  // WebGPU présent ou non, quel que soit le navigateur du test
  await page.addInitScript((on) => { try { Object.defineProperty(navigator, 'gpu', { value: on ? {} : undefined, configurable: true }); } catch (e) {} }, withGpu);
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto('index.html?mode=impression');
  await page.waitForFunction(() => window.AtelierGribouille && window.AICut);
}
async function importSheet(page) {
  const url = await page.evaluate(`(${SHEET.toString()})().toDataURL('image/png')`);
  await page.setInputFiles('#file', { name: 'carotte.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
  return page.evaluate(() => { const d = AtelierGribouille.state.drawings[0], ps = d.analysis.pieces || []; const m = ps.reduce((a, q) => (!a || q.frac > a.frac ? q : a), null); return { n: AtelierGribouille.state.drawings.length, kind: d.analysis.kind, pieces: ps.length, w: m ? m.src.w / d.analysis.page.width : 0, h: m ? m.src.h / d.analysis.page.height : 0, gate: d.aiGate ? [d.aiGate.w, d.aiGate.h] : null, wants: Extract.wantsAI(d.analysis) }; });
}

test.describe('Découpe assistée par IA — iPhone et iPad', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' });
  test('rien n’est proposé : ni le réglage dans Importer, ni « Affiner avec l’IA »', async ({ page }) => {
    await start(page, true);
    await page.setInputFiles('#file', [require('./helpers').fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await require('./helpers').openStep(page, 'import-section');
    await expect(page.locator('#ai-cut-opt')).toBeHidden();
    expect(await page.evaluate(() => [AICut.supported(), AICut.available(), AICut.enabled()])).toEqual([false, false, false]);
    await page.evaluate(() => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[0]));
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#ed-ai')).toBeHidden();
  });
});

test.describe('Découpe assistée par IA', () => {
  test('le réglage dans Importer : « non disponible » sans WebGPU ; avec, coché par défaut sur ordinateur, mémorisé', async ({ page }) => {
    await start(page, false);
    // (sur ordinateur, l'étape Importer n'apparaît qu'avec un premier dessin)
    await page.setInputFiles('#file', [require('./helpers').fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await require('./helpers').openStep(page, 'import-section');
    await expect(page.locator('#ai-cut-opt')).toBeVisible();
    await expect(page.locator('#ai-cut-on')).toBeDisabled();
    await expect(page.locator('#ai-cut-info')).toContainText('Non disponible sur cet appareil');
    // avec WebGPU
    await start(page, true);
    await page.setInputFiles('#file', [require('./helpers').fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await require('./helpers').openStep(page, 'import-section');
    await expect(page.locator('#ai-cut-on')).toBeEnabled();
    await expect(page.locator('#ai-cut-on')).toBeChecked();
    await expect(page.locator('#ai-cut-info')).toContainText('214 Mo');
    await page.locator('#ai-cut-on').uncheck();
    expect(await page.evaluate(() => localStorage.getItem('atelier.ia-decoupe'))).toBe('0');
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && window.AICut);
    expect(await page.evaluate(() => AICut.enabled())).toBe(false);
    expect(await page.evaluate(() => document.getElementById('ai-cut-on').checked)).toBe(false);
  });

  test('feuille de couleur froissée : sans IA la découpe englobe les plis ; avec, elle suit le sujet, et le sujet vu est gardé avec le dessin', async ({ page }) => {
    test.setTimeout(240000);
    await start(page, true);
    await page.evaluate(STUB);
    await page.evaluate(() => AICut.setEnabled(false));
    const without = await importSheet(page);
    expect(without.kind).toBe('cutout');
    expect(without.wants).toBe(true); // (papier franchement coloré : l'IA vaut la peine)
    expect(without.gate).toBeNull();
    expect(without.w).toBeGreaterThan(0.64); // la tache d'ombre, englobée : la pièce déborde loin de la carotte
    // de nouveau, avec l'IA
    await page.evaluate(() => { document.getElementById('new-work') && document.getElementById('new-work').click(); });
    await start(page, true);
    await page.evaluate(STUB);
    await page.evaluate(() => AICut.setEnabled(true));
    const withAi = await importSheet(page);
    expect(await page.evaluate(() => window.__aiCalls)).toBe(1);
    expect(withAi.kind).toBe('cutout');
    expect(withAi.gate).toEqual([256, 181]);
    expect(withAi.w).toBeLessThan(without.w - 0.06); // la tache d'ombre écartée : la pièce se resserre sur la carotte
    expect(withAi.w).toBeLessThan(0.66);
    // le sujet vu part dans la sauvegarde du dessin (PNG), et en revient
    const rt = await page.evaluate(() => { const d = AtelierGribouille.state.drawings[0]; const url = AICut.toDataURL(d.aiGate); return AICut.fromDataURL(url).then((g) => ({ ok: url.startsWith('data:image/png'), w: g.w, h: g.h, on: Array.from(g.data).filter(Boolean).length > 100 })); });
    expect(rt.ok).toBe(true); expect([rt.w, rt.h]).toEqual([256, 256]); expect(rt.on).toBe(true);
  });

  test('retouche : « Affiner avec l’IA » refait la découpe avec le sujet vu ; absent sans WebGPU', async ({ page }) => {
    test.setTimeout(240000);
    await start(page, true);
    await page.evaluate(STUB);
    await page.evaluate(() => AICut.setEnabled(false));
    const before = await importSheet(page);
    expect(before.w).toBeGreaterThan(0.64);
    // la retouche de la carotte (la plus grande pièce)
    await page.evaluate(() => { const ps = AtelierGribouille.state.drawings[0].analysis.pieces; AtelierGribouille.editPiece(ps.reduce((a, q) => (!a || q.frac > a.frac ? q : a), null)); });
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#ed-ai')).toBeVisible();
    await page.locator('#ed-ai').click();
    await page.waitForFunction(() => window.__aiCalls >= 1 && !document.getElementById('ed-ai').disabled, null, { timeout: 60000 });
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    const after = await page.evaluate(() => { const d = AtelierGribouille.state.drawings[0], ps = d.analysis.pieces; const m = ps.reduce((a, q) => (!a || q.frac > a.frac ? q : a), null); return { w: m.src.w / d.analysis.page.width, gate: !!d.aiGate }; });
    expect(after.gate).toBe(true);
    expect(after.w).toBeLessThan(before.w - 0.06);
    // sans WebGPU : pas de bouton
    await start(page, false);
    await page.evaluate(STUB);
    await importSheet(page);
    await page.evaluate(() => { const ps = AtelierGribouille.state.drawings[0].analysis.pieces; AtelierGribouille.editPiece(ps[0]); });
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#ed-ai')).toBeHidden();
  });
});
