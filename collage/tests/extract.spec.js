const { test, expect, fixture } = require('./helpers');
const fs = require('fs');

// Analyse d'une image par le module Extract, directement dans la page.
async function analyze(page, name, opts) {
  const data = 'data:image/png;base64,' + fs.readFileSync(fixture(name)).toString('base64');
  return page.evaluate(async ({ data, opts }) => {
    const img = new Image(); img.src = data; await img.decode();
    const c = Extract.makeCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    const r = Extract.analyze(c, 0, opts || { photo: true });
    return {
      kind: r.kind, photo: r.photo ? r.photo.kind : null, paperFrac: r.paperFrac,
      pieces: (r.pieces || []).map((p) => ({ frac: p.frac, colorful: p.colorful, w: p.canvas.width, h: p.canvas.height, src: p.src })),
      page: [r.page.width, r.page.height], textOnly: Extract.textOnly(r.page),
    };
  }, { data, opts });
}

test.describe('Analyse des pages (Extract)', () => {
  test('une feuille blanche avec un sujet donne une découpe, une seule pièce', async ({ app }) => {
    const r = await analyze(app.page, 'page-cutout.png');
    expect(r.kind).toBe('cutout');
    expect(r.photo).toBeNull();
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].frac).toBeGreaterThan(0.03);
    expect(r.pieces[0].colorful).toBeGreaterThan(0.2);
    // la découpe garde une marge de papier mais ne prend pas toute la page
    expect(r.pieces[0].w).toBeLessThan(r.page[0] * 0.6);
    expect(r.textOnly).toBe(false);
  });

  test('deux sujets séparés donnent deux pièces, la plus grande en premier', async ({ app }) => {
    const r = await analyze(app.page, 'page-two.png');
    expect(r.kind).toBe('cutout');
    expect(r.pieces).toHaveLength(2);
    expect(r.pieces[0].frac).toBeGreaterThan(r.pieces[1].frac);
  });

  test('une page entièrement peinte est un fond', async ({ app }) => {
    const r = await analyze(app.page, 'page-texture.png');
    expect(r.kind).toBe('texture');
    expect(r.paperFrac).toBeLessThan(0.38);
  });

  test('des lignes de crayon gris forment une page pâle, reconnue comme du texte', async ({ app }) => {
    const r = await analyze(app.page, 'page-pale.png');
    expect(r.kind).toBe('cutout');
    expect(r.pieces.every((p) => p.colorful < 0.1)).toBe(true);
    expect(r.textOnly).toBe(true);
  });

  test('une feuille photographiée sur un parquet est détourée (surface bois retirée)', async ({ app }) => {
    const r = await analyze(app.page, 'photo-wood.png');
    expect(r.photo).toBe('bois');
    expect(r.kind).toBe('cutout');
    expect(r.pieces).toHaveLength(1);
    // la page nettoyée est la feuille, bien plus petite que la photo
    expect(r.page[0]).toBeLessThan(1600 * 0.75);
    // sans détection de photo, la même image n'est pas détourée
    const plain = await analyze(app.page, 'photo-wood.png', {});
    expect(plain.photo).toBeNull();
  });

  test('une feuille blanche n’est jamais prise pour une photo sur une surface', async ({ app }) => {
    for (const name of ['page-cutout.png', 'page-two.png', 'page-pale.png']) {
      const r = await analyze(app.page, name);
      expect(r.photo, name).toBeNull();
    }
  });
});

test.describe('Précision de la découpe', () => {
  test('l’ombre d’un pli et un bord ombré sont corrigés ; un aplat noir et une feutrine bleue restent', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const c = Extract.makeCanvas(1000, 1400), x = c.getContext('2d');
      x.fillStyle = 'rgb(246,244,238)'; x.fillRect(0, 0, 1000, 1400);
      // sujets : un rond rouge, un aplat noir, une feutrine bleu pâle
      x.fillStyle = '#d23'; x.beginPath(); x.arc(220, 300, 110, 0, 7); x.fill();
      x.fillStyle = '#111'; x.fillRect(700, 250, 160, 160);
      x.fillStyle = 'rgb(190,215,235)'; x.fillRect(150, 900, 220, 160);
      // ombre chaude d'un pli (bande verticale) et bord droit ombré
      const g = x.getImageData(0, 0, 1000, 1400), d = g.data;
      for (let y = 0; y < 1400; y++) for (let xx = 0; xx < 1000; xx++) {
        let k = 1;
        const t = Math.abs(xx - 500) / 60; if (t < 1) k *= 0.72 + 0.28 * t;
        if (xx > 880) k *= 1 - (xx - 880) / 120 * 0.3;
        const i = (y * 1000 + xx) * 4; d[i] *= k; d[i + 1] *= k * 0.96; d[i + 2] *= k * 0.9;
      }
      x.putImageData(g, 0, 0);
      const f = Extract.flatten(c), fd = f.getContext('2d').getImageData(0, 0, 1000, 1400).data;
      const at = (px, py) => { const i = (py * 1000 + px) * 4; return [fd[i], fd[i + 1], fd[i + 2]]; };
      const lum = (v) => 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
      // (chemin d'un scan : feuille posée sur la vitre)
      const a = Extract.analyze(c, 0, {});
      return {
        fold: lum(at(500, 650)), edge: lum(at(985, 650)), black: lum(at(780, 330)), felt: at(260, 980),
        pieces: a.pieces.map((p) => ({ h: p.src.h / a.page.height, x: p.src.x / a.page.width, w: p.src.w / a.page.width })),
      };
    });
    // (moins de 30 sous le papier à 250 : plus assez sombre pour passer pour un trait)
    expect(r.fold).toBeGreaterThan(221);
    expect(r.edge).toBeGreaterThan(221);
    expect(r.black).toBeLessThan(60);
    expect(r.felt[2] - r.felt[0]).toBeGreaterThan(25); // la feutrine reste bleue
    // trois sujets, et aucune pièce ne file le long du pli
    expect(r.pieces).toHaveLength(3);
    expect(r.pieces.every((p) => p.h < 0.4)).toBe(true);
  });

  test('une découpe photographiée sur un parquet devient une pièce à sa silhouette, papier blanc compris', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const W = 1200, H = 1600, c = Extract.makeCanvas(W, H), x = c.getContext('2d');
      // parquet : lames brunes, veines et joints sombres
      for (let k = 0; k < 8; k++) {
        x.fillStyle = `rgb(${165 + (k % 3) * 12},${108 + (k % 2) * 8},${58 + (k % 3) * 5})`;
        x.fillRect(k * 150, 0, 150, H);
        x.fillStyle = 'rgb(60,38,20)'; x.fillRect(k * 150, 0, 3, H);
        for (let v = 0; v < 30; v++) { x.fillStyle = 'rgba(120,70,30,.25)'; x.fillRect(k * 150 + 10 + ((v * 37) % 130), (v * 53) % H, 2, 120); }
      }
      // un cœur en papier blanc découpé, avec un dessin
      const heart = new Path2D('M600 520 C 600 360, 300 340, 300 600 C 300 820, 520 960, 600 1120 C 680 960, 900 820, 900 600 C 900 340, 600 360, 600 520 Z');
      x.fillStyle = 'rgb(245,243,238)'; x.fill(heart);
      x.fillStyle = '#d22'; x.beginPath(); x.arc(560, 700, 70, 0, 7); x.fill();
      x.strokeStyle = '#2255cc'; x.lineWidth = 8; x.beginPath(); x.moveTo(450, 850); x.lineTo(760, 820); x.stroke();
      // surface du cœur (vérité terrain)
      const m = Extract.makeCanvas(W, H), mx = m.getContext('2d'); mx.fill(heart);
      const md = mx.getImageData(0, 0, W, H).data; let truth = 0; for (let i = 3; i < md.length; i += 4) if (md[i] > 127) truth++;
      const a = Extract.analyze(c, 0, { photo: true });
      const p = a.pieces[0];
      const pd = p.canvas.getContext('2d').getImageData(0, 0, p.canvas.width, p.canvas.height).data;
      let opaque = 0; for (let i = 3; i < pd.length; i += 4) if (pd[i] > 127) opaque++;
      // tournée d'un quart de tour (orientation), la pièce garde sa silhouette
      const r90 = Extract.rotated(a, 90), q = r90.pieces[0];
      const qd = q.canvas.getContext('2d').getImageData(0, 0, q.canvas.width, q.canvas.height).data;
      let opaque90 = 0; for (let i = 3; i < qd.length; i += 4) if (qd[i] > 127) opaque90++;
      return { photo: a.photo && a.photo.kind, n: a.pieces.length, object: !!p.object, ratio: opaque / truth, auto: Extract.recut(a).length, n90: r90.pieces.length, ratio90: opaque90 / truth, swapped: r90.page.width === a.page.height };
    });
    expect(r.photo).toBe('bois');
    expect(r.n).toBe(1);
    expect(r.object).toBe(true);
    // la pièce a la surface du cœur entier (papier blanc compris), à quelques pour cent près
    expect(r.ratio).toBeGreaterThan(0.93);
    expect(r.ratio).toBeLessThan(1.07);
    expect(r.auto).toBe(1);
    expect(r.swapped).toBe(true);
    expect(r.n90).toBe(1);
    expect(Math.abs(r.ratio90 - r.ratio)).toBeLessThan(0.02);
  });
});
