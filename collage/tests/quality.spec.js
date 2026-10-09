// Qualité des dessins pour l'impression (js/quality.js) : définition, compression, netteté,
// éclairage, et leur affichage (pastille, fiche du dessin, bandeau, rappel à l'export).
const { test, expect } = require('./helpers');

test.describe('Qualité pour l’impression', () => {
  test('les mesures séparent un dessin net, flou, compressé ou mal éclairé', async ({ app }) => {
    const r = await app.page.evaluate(async () => {
      // un dessin de synthèse : traits noirs et couleurs franches sur papier blanc
      const W = 1200, H = 1600;
      const draw = (x) => {
        x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, W, H);
        x.lineWidth = 9; x.lineCap = 'round';
        for (let i = 0; i < 26; i++) {
          x.strokeStyle = ['#1d1d1b', '#c0392b', '#2471a3', '#1e8449'][i % 4];
          x.beginPath(); x.moveTo(150 + (i * 37) % 900, 200 + (i * 53) % 1100); x.lineTo(250 + (i * 71) % 800, 300 + (i * 97) % 1100); x.stroke();
        }
      };
      const mk = (fn) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); fn(x); return c; };
      const net = mk(draw);
      const flou = mk((x) => { x.filter = 'blur(3px)'; x.drawImage(net, 0, 0); });
      const ombre = mk((x) => { x.drawImage(net, 0, 0); const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)'); x.fillStyle = g; x.fillRect(0, 0, W, H); });
      const jpeg = async (q) => Quality.jpegQuality(await (await new Promise((res) => net.toBlob(res, 'image/jpeg', q))).arrayBuffer());
      return { net: Quality.measure(net), flou: Quality.measure(flou), ombre: Quality.measure(ombre), q95: await jpeg(0.95), q30: await jpeg(0.3), T: { SHARP: Quality.SHARP, LIGHT: Quality.LIGHT, JPEG: Quality.JPEG } };
    });
    expect(r.net.sharp).toBeGreaterThan(r.T.SHARP.warn);
    expect(r.flou.sharp).toBeLessThan(r.T.SHARP.warn);
    expect(r.net.light).toBeLessThan(r.T.LIGHT.warn);
    expect(r.ombre.light).toBeGreaterThan(r.T.LIGHT.warn);
    expect(r.q95).toBeGreaterThan(85);
    expect(r.q30).toBeLessThan(r.T.JPEG.bad);
  });

  test('le verdict suit la définition à la taille réelle', async ({ app }) => {
    const v = await app.page.evaluate(() => [
      Quality.assess({ pxLong: 3508, sizeCm: 29.7, q: {} }).level, // 300 dpi
      Quality.assess({ pxLong: 1754, sizeCm: 29.7, q: {} }).level, // 150 dpi
      Quality.assess({ pxLong: 1400, sizeCm: 29.7, q: {} }).level, // 120 dpi
      Quality.assess({ pxLong: 900, sizeCm: 29.7, q: {} }).level, // 77 dpi
      Quality.assess({ pxLong: 900, sizeCm: 14.8, q: {} }).level, // la même image en A6 : 154 dpi
      Quality.assess({ pxLong: null, sizeCm: 29.7, q: {} }).level, // PDF vectoriel : rien à dire
    ]);
    expect(v).toEqual(['ok', 'ok', 'warn', 'bad', 'ok', 'ok']);
  });

  test('un dessin trop petit est signalé : pastille, bandeau, fiche avec conseil, rappel à l’export', async ({ app }) => {
    const { page } = app;
    // une image de 620 px, posée en A4 : environ 75 dpi ; un vrai scan à 300 dpi à côté
    await app.import(['noscale-small.jpg', 'scan-300dpi.jpg']);
    const small = await page.evaluate(() => AtelierGribouille.state.drawings.findIndex((d) => /noscale-small/.test(d.name)));
    await page.evaluate((i) => { const d = AtelierGribouille.state.drawings[i]; d.sizeCm = 29.7; d.sizeMode = 'manual'; AtelierGribouille.state.current = null; }, small);
    await page.evaluate(() => AtelierGribouille.regenerate());
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector('h2').click(); });
    // une seule pastille rouge, sur le petit dessin
    await expect(page.locator('#drawings .thumb .q.bad')).toHaveCount(1);
    await expect(page.locator('#drawings .thumb').nth(small).locator('.q.bad')).toHaveCount(1);
    // bandeau dans Propositions, et « Voir lesquels » ouvre la fiche du dessin
    await expect(page.locator('#quality-alert')).toBeVisible();
    await expect(page.locator('#quality-alert')).toContainText('flou');
    await page.locator('#quality-alert-go').click();
    await expect(page.locator('#detail .quality.bad')).toBeVisible();
    await expect(page.locator('#detail .quality')).toContainText('dpi');
    await expect(page.locator('#detail .quality')).toContainText('300 dpi');
    // rappel au moment d'exporter
    await expect(page.locator('#export-quality')).toBeVisible();
    // en A6, la même image suffit : plus d'alerte
    await page.evaluate((i) => { const d = AtelierGribouille.state.drawings[i]; d.sizeCm = 14.8; }, small);
    await page.evaluate(() => AtelierGribouille.regenerate());
    await page.locator('#drawings .thumb').first().click();
    await expect(page.locator('#quality-alert')).toBeHidden();
    await expect(page.locator('#export-quality')).toBeHidden();
    expect(app.errors).toEqual([]);
  });

  test('les dessins d’exemple ne déclenchent aucune alerte', async ({ app }) => {
    const { page } = app;
    await page.locator('#load-sample').click();
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 180000 });
    const flagged = await page.evaluate(() => AtelierGribouille.state.drawings.map((d) => [d.name, Quality.assess(d)]).filter(([, q]) => q.level !== 'ok').map(([n, q]) => `${n}: ${q.issues.map((x) => x.code).join(',')}`));
    expect(flagged).toEqual([]);
    await expect(page.locator('#quality-alert')).toBeHidden();
  });
});
