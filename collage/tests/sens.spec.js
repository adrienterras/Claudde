// Sens des dessins à l'import : un paysage couché ou tête en bas (ciel bleu sur un côté, sol vert ou
// brun sur le côté opposé) est remis droit ; sans ces deux indices à la fois, rien ne bouge.
const { test, expect, openStep } = require('./helpers');

// une image de synthèse dessinée dans la page, rendue en PNG (octets) : paysage, plage ou arbre sur papier blanc
async function synth(page, kind, deg) {
  const b64 = await page.evaluate(({ kind, deg }) => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, 800, 600);
    if (kind === 'paysage') {
      x.fillStyle = '#6fa8dc'; x.fillRect(0, 0, 800, 240); // ciel
      x.fillStyle = '#4f9a3c'; x.fillRect(0, 420, 800, 180); // herbe
      x.fillStyle = '#f2c230'; x.beginPath(); x.arc(660, 110, 60, 0, 7); x.fill(); // soleil
      x.fillStyle = '#d0402f'; x.fillRect(260, 280, 180, 140); // maison
      x.fillStyle = '#7a3b22'; x.beginPath(); x.moveTo(240, 280); x.lineTo(350, 190); x.lineTo(460, 280); x.fill();
    } else if (kind === 'plage') {
      x.fillStyle = '#f6d65a'; x.fillRect(0, 0, 800, 260); // ciel jaune
      x.fillStyle = '#2f6fd0'; x.fillRect(0, 380, 800, 220); // mer en bas
    } else {
      x.fillStyle = '#3f9a3a'; x.beginPath(); x.arc(400, 220, 140, 0, 7); x.fill(); // feuillage
      x.fillStyle = '#7a4a24'; x.fillRect(370, 330, 60, 220); // tronc
    }
    let out = c;
    if (deg) out = Extract.rotateCanvas(c, deg);
    return out.toDataURL('image/png').split(',')[1];
  }, { kind, deg });
  return Buffer.from(b64, 'base64');
}

test.describe('Sens des dessins', () => {
  test('repérage : le paysage est remis droit dans les quatre sens ; une plage (mer en bas) ou un arbre sur papier blanc ne bougent pas', async ({ app }) => {
    const { page } = app;
    const turnOf = (b) => page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); return Extract.uprightTurn(im); }, b.toString('base64'));
    // l'image tournée de deg (sens horaire) est remise droite par le quart de tour complémentaire
    for (const [deg, want] of [[0, 0], [90, 270], [180, 180], [270, 90]]) expect(await turnOf(await synth(page, 'paysage', deg))).toBe(want);
    for (const deg of [0, 90, 180, 270]) {
      expect(await turnOf(await synth(page, 'plage', deg))).toBe(0);
      expect(await turnOf(await synth(page, 'arbre', deg))).toBe(0);
    }
  });

  test('import : un paysage couché arrive droit (page tournée, vignette comprise) ; un paysage droit ne bouge pas', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => AtelierGribouille.setMode('impression'));
    const couche = await synth(page, 'paysage', 90), droit = await synth(page, 'paysage', 0);
    await page.setInputFiles('#file', [{ name: 'couche.png', mimeType: 'image/png', buffer: couche }, { name: 'droit.png', mimeType: 'image/png', buffer: droit }]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 2 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const ds = await page.evaluate(() => AtelierGribouille.state.drawings.map((d) => ({ name: d.name, turn: d.autoTurn, deg: d.orientDeg, w: d.analysis.page.width, h: d.analysis.page.height, baseW: d.base.page.width, baseH: d.base.page.height })));
    const c = ds.find((d) => d.name === 'couche.png'), dr = ds.find((d) => d.name === 'droit.png');
    // le fichier est en portrait (paysage couché) : la page de travail revient en paysage, la base reste telle que scannée
    expect(c).toMatchObject({ turn: 270, deg: 270 });
    expect(c.w).toBeGreaterThan(c.h);
    expect(c.baseW).toBeLessThan(c.baseH);
    expect(dr).toMatchObject({ turn: 0, deg: 0 });
    expect(dr.w).toBeGreaterThan(dr.h);
    // une nouvelle proposition ne la recouche pas
    await page.evaluate(() => AtelierGribouille.regenerate());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => { const d = AtelierGribouille.state.drawings.find((x) => x.name === 'couche.png'); return [d.orientDeg, d.analysis.page.width > d.analysis.page.height]; })).toEqual([270, true]);
    // enregistrée puis rouverte : le dessin revient droit (le sens repéré est gardé avec l'œuvre)
    await openStep(page, 'compose-section');
    await page.locator('#save-comp').click();
    await expect(page.locator('#freeze-status')).toContainText('enregistrée dans Mes œuvres');
    await openStep(page, 'saved-section');
    await page.locator('#saved-list .saved:not(.current)').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    await page.waitForFunction(() => AtelierGribouille.state.comp && AtelierGribouille.state.drawings.length === 2 && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => AtelierGribouille.regenerate());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => { const d = AtelierGribouille.state.drawings.find((x) => x.name === 'couche.png'); return [d.autoTurn, d.orientDeg, d.analysis.page.width > d.analysis.page.height]; })).toEqual([270, 270, true]);
  });

  test('écriture : un dessin couché ou tête en bas dont on lit les mots est remis droit ; un dessin sans écriture ne bouge pas', async ({ app }) => {
    const { page } = app;
    await page.evaluate(() => { window.__lecture = true; AtelierGribouille.setMode('impression'); });
    const make = (deg, words) => page.evaluate(({ deg, words }) => {
      const c = document.createElement('canvas'); c.width = 1400; c.height = 1000;
      const x = c.getContext('2d');
      x.fillStyle = '#fbfaf5'; x.fillRect(0, 0, 1400, 1000);
      // un soleil et un bonhomme, au feutre
      x.lineWidth = 8; x.strokeStyle = '#e8a21a'; x.beginPath(); x.arc(1150, 220, 90, 0, 7); x.stroke();
      x.strokeStyle = '#2a2a30'; x.beginPath(); x.arc(300, 600, 60, 0, 7); x.moveTo(300, 660); x.lineTo(300, 840); x.moveTo(200, 720); x.lineTo(400, 720); x.stroke();
      // l'écriture, en capitales
      x.fillStyle = '#1d3f9a'; x.font = 'bold 96px sans-serif';
      words.forEach((t, i) => x.fillText(t, 110, 190 + i * 140));
      const r = deg ? Extract.rotateCanvas(c, deg) : c;
      return r.toDataURL('image/png').split(',')[1];
    }, { deg, words });
    const ecrit = Buffer.from(await make(90, ['JOYEUX', 'ANNIVERSAIRE']), 'base64');
    const envers = Buffer.from(await make(180, ['JE T’AIME', 'MAMAN']), 'base64');
    const muet = Buffer.from(await make(90, []), 'base64');
    await page.setInputFiles('#file', [{ name: 'ecrit.png', mimeType: 'image/png', buffer: ecrit }, { name: 'envers.png', mimeType: 'image/png', buffer: envers }, { name: 'muet.png', mimeType: 'image/png', buffer: muet }]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 3 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // (une feuille à plusieurs sujets devient un dessin par sujet : « ecrit — 1 », « ecrit — 2 »… ; tous du même sens)
    const turns = await page.evaluate(() => Object.fromEntries(AtelierGribouille.state.drawings.map((d) => [d.name.replace(/ — \d+$/, '').replace(/\.png$/, ''), d.autoTurn])));
    expect(turns.ecrit).toBe(270);
    expect(turns.envers).toBe(180);
    expect(turns.muet).toBe(0);
  });
});
