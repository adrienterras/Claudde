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
    // tableau imprimé : les alertes d'impression ont un sens
    await page.evaluate(() => document.querySelector('#mode-pick [data-mode="impression"]').click());
    // une image de 620 px, posée en A4 : environ 75 dpi ; un vrai scan à 300 dpi à côté
    await app.import(['noscale-small.jpg', 'scan-300dpi.jpg']);
    const small = await page.evaluate(() => AtelierGribouille.state.drawings.findIndex((d) => /noscale-small/.test(d.name)));
    await page.evaluate((i) => { const d = AtelierGribouille.state.drawings[i]; d.sizeCm = 29.7; d.sizeMode = 'manual'; AtelierGribouille.state.current = null; }, small);
    await page.evaluate(() => AtelierGribouille.regenerate());
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector('h2').click(); });
    // une seule pastille rouge, sur le petit dessin
    await expect(page.locator('#drawings .thumb .q.bad')).toHaveCount(1);
    await expect(page.locator(`#drawings .thumb[data-i="${small}"]`).locator('.q.bad')).toHaveCount(1);
    // bandeau dans Propositions, et « Voir lesquels » ouvre la fiche du dessin
    await expect(page.locator('#quality-alert')).toBeVisible();
    await expect(page.locator('#quality-alert')).toContainText('flou');
    await page.locator('#quality-alert-go').click();
    await expect(page.locator('#detail .quality.bad')).toBeVisible();
    // la fiche ne montre que les titres ; le détail (dpi, conseil) est en infobulle
    await expect(page.locator('#detail .quality')).toContainText('Définition trop faible pour l’impression');
    await expect(page.locator('#detail .quality')).not.toContainText('dpi');
    expect(await page.locator('#detail .quality p').first().getAttribute('title')).toContain('300 dpi');
    // rappel au moment d'exporter (l'étape Exporter, repliée après l'import, s'ouvre par son titre)
    await page.evaluate(() => { const s = document.getElementById('export-section'); if (s.classList.contains('collapsed')) s.querySelector('h2').click(); });
    await expect(page.locator('#export-quality')).toBeVisible();
    // collage avec les originaux : rien n'est imprimé, aucune alerte ; elles reviennent en tableau imprimé
    await page.evaluate(() => { AtelierGribouille.setMode('toile'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    await expect(page.locator('#drawings .thumb .q')).toHaveCount(0);
    await expect(page.locator('#quality-alert')).toBeHidden();
    await expect(page.locator('#export-quality')).toBeHidden();
    await expect(page.locator('#detail .quality')).toHaveCount(0);
    await page.evaluate(() => { AtelierGribouille.setMode('impression'); AtelierGribouille.state.pinned = null; AtelierGribouille.regenerate(); });
    await expect(page.locator('#quality-alert')).toBeVisible();
    await expect(page.locator('#drawings .thumb .q.bad')).toHaveCount(1);
    // en A6, la même image suffit : plus d'alerte
    await page.evaluate((i) => { const d = AtelierGribouille.state.drawings[i]; d.sizeCm = 14.8; }, small);
    await page.evaluate(() => AtelierGribouille.regenerate());
    await page.locator('#drawings .thumb[data-i="0"]').click();
    await expect(page.locator('#quality-alert')).toBeHidden();
    await expect(page.locator('#export-quality')).toBeHidden();
    expect(app.errors).toEqual([]);
  });

  test('« Importer une meilleure version » : le nouveau fichier remplace le dessin, à la même place sur l’œuvre', async ({ app }) => {
    const { page } = app;
    const { fixture } = require('./helpers');
    await page.evaluate(() => document.querySelector('#mode-pick [data-mode="impression"]').click());
    await app.import(['noscale-small.jpg', 'scan-300dpi.jpg']);
    const i = await page.evaluate(() => AtelierGribouille.state.drawings.findIndex((d) => /noscale-small/.test(d.name)));
    await page.evaluate((i) => { const d = AtelierGribouille.state.drawings[i]; d.sizeCm = 29.7; d.sizeMode = 'manual'; AtelierGribouille.state.current = null; }, i);
    await page.evaluate(() => AtelierGribouille.regenerate());
    // une découpe déplacée et tournée à la main : la remplaçante prend sa place exacte
    const placed = () => page.evaluate((i) => {
      const A = AtelierGribouille, d = A.state.drawings[i];
      return { name: d.name, cm: d.sizeCm, items: A.state.comp.items.filter((L) => L.piece.drawing === d).map((L) => ({ x: L.x, y: L.y, rot: L.rot, w: L.w, h: L.h })), n: A.state.drawings.length };
    }, i);
    await page.evaluate((i) => { const A = AtelierGribouille, L = A.state.comp.items.find((x) => x.piece.drawing === A.state.drawings[i]); L.x += 2; L.rot = 0.4; A.state.pinned = A.state.comp; }, i);
    const before = await placed();
    expect(before.items.length).toBeGreaterThan(0);
    // la fiche du dessin trop petit : le bouton est sous l'alerte
    await page.locator('#quality-alert-go').click();
    await expect(page.locator('#detail .quality.bad')).toBeVisible();
    const btn = page.locator('#detail .quality [data-replace]');
    await expect(btn).toHaveText('Importer une meilleure version');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn.click()]);
    await chooser.setFiles(fixture('noscale-large.jpg'));
    await page.waitForFunction((i) => /noscale-large/.test(AtelierGribouille.state.drawings[i].name) && document.getElementById('progress').hidden, i, { timeout: 120000 });
    const after = await placed();
    expect(after.n).toBe(2);
    expect(after.cm).toBe(29.7); // même taille réelle
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.some((d) => /noscale-small/.test(d.name)))).toBe(false);
    // mêmes places, mêmes inclinaisons, même taille sur l'œuvre (à la découpe près)
    expect(after.items.length).toBe(before.items.length);
    after.items.forEach((L, k) => {
      const b = before.items[k];
      expect(L.x).toBeCloseTo(b.x, 6); expect(L.y).toBeCloseTo(b.y, 6); expect(L.rot).toBeCloseTo(b.rot, 6);
      expect(Math.abs(L.w / b.w - 1)).toBeLessThan(0.06); expect(Math.abs(L.h / b.h - 1)).toBeLessThan(0.06);
    });
    await expect(page.locator('#save-status')).toContainText('remplace');
    // la fiche montre le nouveau dessin, sans l'alerte rouge
    await expect(page.locator('#detail .quality.bad')).toHaveCount(0);
    expect(app.errors).toEqual([]);
  });

  test('les dessins d’exemple ne déclenchent aucune alerte', async ({ app }) => {
    const { page } = app;
    await page.locator('#empty-sample').click();
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 180000 });
    const flagged = await page.evaluate(() => AtelierGribouille.state.drawings.map((d) => [d.name, Quality.assess(d)]).filter(([, q]) => q.level !== 'ok').map(([n, q]) => `${n}: ${q.issues.map((x) => x.code).join(',')}`));
    expect(flagged).toEqual([]);
    await expect(page.locator('#quality-alert')).toBeHidden();
  });
});
