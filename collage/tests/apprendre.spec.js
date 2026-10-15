// Apprentissage de la découpe (tools/apprendre.js) : un jeu d'exemples de synthèse est fabriqué
// avec le module Extract (découpe automatique, puis « corrigée » avec plus de marge de papier),
// et l'outil doit apprendre une marge plus grande sans toucher aux fichiers du dépôt.
const { test, expect, fixture } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('apprend une marge plus grande à partir de retouches élargies', async ({ app }) => {
  test.setTimeout(600000);
  const page = app.page;
  const datas = ['page-cutout.png', 'page-two.png'].map((f) => 'data:image/png;base64,' + fs.readFileSync(fixture(f)).toString('base64'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-apprendre-'));
  const src = path.join(work, 'exemples'), out = path.join(work, 'projet', 'collage');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  // trois exemples : la page, chaque pièce découpée d'office, puis la même pièce élargie de 2,5 % de la page
  const exs = [];
  for (const data of datas) exs.push(...await page.evaluate(async ({ data }) => {
    const img = new Image(); img.src = data; await img.decode();
    const c = Extract.makeCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    Extract.setCutPrefs({});
    const seg = Extract.segment(c);
    const pieces = Extract.cutPieces(c, seg).slice(0, 3);
    const unit = Math.max(c.width, c.height), grow = Math.round(unit * 0.025);
    const out = [];
    pieces.forEach((p) => {
      const pad = Math.round(unit * 0.05);
      const x0 = Math.max(0, p.src.x - grow - pad), y0 = Math.max(0, p.src.y - grow - pad);
      const x1 = Math.min(c.width, p.src.x + p.src.w + grow + pad), y1 = Math.min(c.height, p.src.y + p.src.h + grow + pad);
      const cw = x1 - x0, ch = y1 - y0;
      const crop = Extract.makeCanvas(cw, ch);
      crop.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
      const mask = (dil) => {
        const m = Extract.makeCanvas(cw, ch), x = m.getContext('2d');
        x.fillStyle = '#000'; x.fillRect(0, 0, cw, ch);
        const t = Extract.makeCanvas(cw, ch), tx = t.getContext('2d');
        if (dil) { tx.filter = `blur(${dil}px)`; }
        tx.drawImage(p.canvas, p.src.x - x0, p.src.y - y0, p.src.w, p.src.h);
        // élargissement : le flou étale l'opacité, le seuil bas la fige à la nouvelle distance
        const d = tx.getImageData(0, 0, cw, ch), dd = d.data;
        for (let i = 0; i < dd.length; i += 4) { const on = dd[i + 3] > (dil ? 2 : 127); dd[i] = dd[i + 1] = dd[i + 2] = on ? 255 : 0; dd[i + 3] = 255; }
        x.putImageData(d, 0, 0);
        return m.toDataURL('image/png');
      };
      out.push({
        image: crop.toDataURL('image/jpeg', 0.9), auto: mask(0), corrige: mask(grow),
        meta: { kind: 'cutout', page: { w: c.width, h: c.height }, crop: { x: x0, y: y0, w: cw, h: ch, scale: 1 }, auto: p.src, corrected: { x: p.src.x - grow, y: p.src.y - grow, w: p.src.w + 2 * grow, h: p.src.h + 2 * grow } },
      });
    });
    return out;
  }, { data }));
  expect(exs.length).toBeGreaterThanOrEqual(2);
  exs.forEach((e, i) => {
    const d = path.join(src, `2026-10_exemple-${i}`);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'image.jpg'), Buffer.from(e.image.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(d, 'auto.png'), Buffer.from(e.auto.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(d, 'corrige.png'), Buffer.from(e.corrige.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(e.meta));
  });
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'apprendre.js'), '--source', src, '--out', out, '--min', '2', '--quick', '--port', '8797'], { encoding: 'utf8', env: process.env, timeout: 540000 });
  expect(r.status, r.stdout + r.stderr).toBe(0);
  const js = fs.readFileSync(path.join(out, 'js', 'cut-learned.js'), 'utf8');
  const learned = JSON.parse(js.match(/window\.CUT_LEARNED = (.*);/)[1]);
  expect(learned).not.toBeNull();
  expect(learned.n).toBe(exs.length);
  expect(learned.margin).toBeGreaterThan(0.009);
  expect(learned.iou.learned).toBeGreaterThan(learned.iou.default);
  const md = fs.readFileSync(path.join(work, 'projet', 'docs', 'APPRENTISSAGE.md'), 'utf8');
  expect(md).toContain('réglages appris appliqués');
  // rien n'a été écrit dans le dépôt
  expect(fs.readFileSync(path.join(__dirname, '..', 'js', 'cut-learned.js'), 'utf8')).not.toContain(`"n":${exs.length}`);
  fs.rmSync(work, { recursive: true, force: true });
});
