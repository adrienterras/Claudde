// Les métadonnées des photos importées (position GPS, date, appareil, commentaire) ne sont jamais
// enregistrées, ni sur l'appareil ni dans le compte ; l'orientation et la résolution sont gardées.
const fs = require('fs');
const { test, expect, fixture } = require('./helpers');

// Une photo « de téléphone » synthétique : un JPEG de test auquel on ajoute un EXIF (TIFF gros-boutiste)
// avec orientation 6, 200 dpi, fabricant, modèle, date, position GPS, et un commentaire JPEG.
function phoneJpeg() {
  const jpg = fs.readFileSync(fixture('noscale-small.jpg'));
  const ascii = (s) => Buffer.from(s + '\0', 'latin1');
  const make = ascii('Fabricant-Test'), model = ascii('Telephone-Test'), date = ascii('2026:11:16 10:00:00');
  const ifd0 = [[0x010f, 2, make], [0x0110, 2, model], [0x0112, 3, 6], [0x011a, 5, [200, 1]], [0x011b, 5, [200, 1]], [0x0128, 3, 2], [0x0132, 2, date], [0x8825, 4, 'gps']];
  const gps = [[0x0001, 2, Buffer.from('N\0')], [0x0002, 5, [[48, 1], [51, 1], [24, 1]]], [0x0003, 2, Buffer.from('E\0')], [0x0004, 5, [[2, 1], [21, 1], [3, 1]]]];
  const tiff = Buffer.alloc(1024);
  tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
  let data = 8 + 2 + ifd0.length * 12 + 4;
  const gpsAt = data; data += 2 + gps.length * 12 + 4;
  const writeIfd = (at, entries) => {
    tiff.writeUInt16BE(entries.length, at);
    entries.forEach(([tag, type, v], i) => {
      const e = at + 2 + i * 12;
      tiff.writeUInt16BE(tag, e); tiff.writeUInt16BE(type, e + 2);
      if (type === 3) { tiff.writeUInt32BE(1, e + 4); tiff.writeUInt16BE(v, e + 8); }
      else if (type === 4) { tiff.writeUInt32BE(1, e + 4); tiff.writeUInt32BE(gpsAt, e + 8); }
      else if (type === 2) { tiff.writeUInt32BE(v.length, e + 4); if (v.length <= 4) v.copy(tiff, e + 8); else { tiff.writeUInt32BE(data, e + 8); v.copy(tiff, data); data += v.length + (v.length & 1); } }
      else { const rs = Array.isArray(v[0]) ? v : [v]; tiff.writeUInt32BE(rs.length, e + 4); tiff.writeUInt32BE(data, e + 8); rs.forEach(([a, b]) => { tiff.writeUInt32BE(a, data); tiff.writeUInt32BE(b, data + 4); data += 8; }); }
    });
    tiff.writeUInt32BE(0, at + 2 + entries.length * 12);
  };
  writeIfd(8, ifd0);
  writeIfd(gpsAt, gps);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff.subarray(0, data)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 18]), Buffer.from('Commentaire-Test', 'latin1')]);
  const app0End = 4 + jpg.readUInt16BE(4); // (le JPEG de test commence par JFIF)
  return Buffer.concat([jpg.subarray(0, app0End), app1, com, jpg.subarray(app0End)]);
}

// les images enregistrées dans le navigateur (magasin des images des œuvres), en octets
const storedImages = (page) => page.evaluate(() => new Promise((res) => {
  const q = indexedDB.open('atelier-gribouille');
  q.onsuccess = () => {
    const db = q.result;
    try {
      const g = db.transaction('brouillon-images').objectStore('brouillon-images').getAll();
      g.onsuccess = () => { db.close(); res(g.result.filter((v) => v && v.data).map((v) => Array.from(new Uint8Array(v.data)))); };
      g.onerror = () => { db.close(); res([]); };
    } catch (e) { db.close(); res([]); }
  };
  q.onerror = () => res([]);
}));

test('photo de téléphone : sans GPS, date, appareil ni commentaire une fois enregistrée ; orientation et 200 dpi gardés', async ({ app }) => {
  test.setTimeout(150000);
  const { page } = app;
  const src = phoneJpeg();
  expect(src.includes(Buffer.from('Telephone-Test'))).toBe(true);
  await page.setInputFiles('#file', { name: 'photo-telephone.jpg', mimeType: 'image/jpeg', buffer: src });
  await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
  // l'orientation est appliquée (portrait, 620 × 877 tourné → paysage) et la résolution lue
  const d = await page.evaluate(() => { const d = AtelierGribouille.state.drawings[0]; return { w: d.origLong, src: d.physSource }; });
  expect(d.src).toBe('200 dpi');
  let imgs = [];
  for (let i = 0; i < 60 && !imgs.length; i++) { await page.waitForTimeout(500); imgs = await storedImages(page); }
  expect(imgs.length).toBeGreaterThan(0);
  const saved = Buffer.from(imgs.find((b) => b[0] === 0xff && b[1] === 0xd8));
  for (const s of ['Telephone-Test', 'Fabricant-Test', '2026:11:16', 'Commentaire-Test']) expect(saved.includes(Buffer.from(s)), s).toBe(false);
  // le reste de l'image (les données compressées) est identique, sans recompression
  const sos = (b) => b.indexOf(Buffer.from([0xff, 0xda]));
  expect(saved.subarray(sos(saved)).equals(src.subarray(sos(src)))).toBe(true);
  // un EXIF minimal : orientation 6 et 200 dpi, rien d'autre (ni GPS)
  const e = saved.indexOf(Buffer.from('Exif\0\0', 'latin1'));
  expect(e).toBeGreaterThan(0);
  const t = e + 6, le = saved.readUInt16BE(t) === 0x4949;
  const u16 = (o) => (le ? saved.readUInt16LE(o) : saved.readUInt16BE(o)), u32 = (o) => (le ? saved.readUInt32LE(o) : saved.readUInt32BE(o));
  const ifd = t + u32(t + 4), tags = {};
  for (let i = 0; i < u16(ifd); i++) { const x = ifd + 2 + i * 12; tags[u16(x)] = u16(x + 2) === 3 ? u16(x + 8) : u32(t + u32(x + 8)) / u32(t + u32(x + 8) + 4); }
  expect(tags).toEqual({ 0x0112: 6, 0x011a: 200, 0x011b: 200, 0x0128: 2 });
  // rouverte depuis l'enregistrement, la photo garde son sens et sa taille réelle
  await page.reload();
  await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 1 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
  expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].origLong)).toBe(d.w);
});
