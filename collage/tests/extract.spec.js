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
