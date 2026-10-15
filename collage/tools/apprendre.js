#!/usr/bin/env node
/*
 * Apprentissage de la découpe à partir des retouches partagées.
 *
 * Les retouches de découpe envoyées par les utilisateurs (option « Aider à améliorer le
 * détourage ») sont des exemples : pour chaque pièce, le dessin recadré, la découpe automatique et
 * la découpe corrigée à la main. Ce script les télécharge (clé service de Supabase, jamais dans le
 * dépôt), rejoue la découpe de l'atelier (le vrai module js/extract.js, dans Chromium) sur chaque
 * exemple avec différents réglages de découpe (marge de papier, rayon de liaison des traits,
 * lissage, sensibilité aux traits pâles), et retient les réglages qui rapprochent le plus les
 * découpes automatiques des découpes corrigées (recouvrement moyen, mesure IoU). Le résultat est
 * écrit dans js/cut-learned.js (réglages d'office de l'atelier) et le rapport dans
 * docs/APPRENTISSAGE.md. Les exemples eux-mêmes ne sont jamais écrits dans le dépôt.
 *
 * Usage :
 *   SUPABASE_SERVICE_ROLE_KEY=… node tools/apprendre.js            (télécharge puis apprend)
 *   node tools/apprendre.js --source <dossier>                      (exemples déjà sur disque)
 * Options : --data <dossier> (où télécharger), --min <n> (exemples requis, 20), --out <dossier
 * racine du projet>, --port <port>, --limit <n> (n premiers exemples), --quick (grille réduite).
 * Le dossier d'exemples contient un sous-dossier par retouche : image.jpg, auto.png, corrige.png,
 * meta.json (voir js/collect.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const flag = (name) => args.includes(name);
const SOURCE = opt('--source', null);
const DATA = path.resolve(opt('--data', path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'atelier-retouches')));
const OUT = path.resolve(opt('--out', ROOT));
const PORT = Number(opt('--port', 8791));
const MIN_N = Number(opt('--min', 20));
const LIMIT = Number(opt('--limit', 0));
const QUICK = flag('--quick');
const MIN_GAIN = 0.005; // gain d'IoU moyen requis pour changer les réglages d'office

const DEFAULT = { margin: 0.009, close: 0.03, smooth: 0.008, ink: 1 };
const GRID = QUICK
  ? { margin: [0.006, 0.009, 0.013, 0.018], close: [0.02, 0.03, 0.045], smooth: [0.008], ink: [0.85, 1, 1.2] }
  : { margin: [0.004, 0.006, 0.009, 0.012, 0.015, 0.02, 0.025], close: [0.015, 0.02, 0.025, 0.03, 0.04, 0.05], smooth: [0.004, 0.008, 0.012, 0.016], ink: [0.7, 0.85, 1, 1.15, 1.3, 1.5] };

const log = (...a) => console.log(...a);

// ---------- téléchargement ----------

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || (fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8').match(/supabaseUrl:\s*'([^']+)'/) || [])[1];
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY (et SUPABASE_URL, ou config.js) requis pour télécharger ; ou --source <dossier>');
  return { url: url.replace(/\/$/, ''), key };
}
async function download() {
  const { url, key } = supabaseConfig();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  fs.mkdirSync(DATA, { recursive: true });
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/retouches?select=path,meta,created_at&order=created_at.asc`, { headers: Object.assign({ Range: `${from}-${from + 999}` }, headers) });
    if (!r.ok && r.status !== 206) throw new Error(`liste des retouches : ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  log(`${rows.length} retouches dans la table`);
  let got = 0, skipped = 0;
  for (const row of rows) {
    if (!/^[0-9]{4}-[0-9]{2}\/[0-9a-f-]{8,40}$/.test(row.path)) { skipped++; continue; }
    const dir = path.join(DATA, row.path.replace('/', '_'));
    if (fs.existsSync(path.join(dir, 'meta.json'))) { got++; continue; }
    fs.mkdirSync(dir, { recursive: true });
    let ok = true;
    for (const f of ['image.jpg', 'auto.png', 'corrige.png', 'meta.json']) {
      const r = await fetch(`${url}/storage/v1/object/retouches/${row.path}/${f}`, { headers });
      if (!r.ok) { ok = false; break; }
      fs.writeFileSync(path.join(dir, f), Buffer.from(await r.arrayBuffer()));
    }
    if (ok) got++; else { skipped++; fs.rmSync(dir, { recursive: true, force: true }); }
  }
  log(`${got} exemples sur disque (${skipped} incomplets ou ignorés)`);
  return DATA;
}

function examples(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const d = path.join(dir, name);
    if (!fs.statSync(d).isDirectory()) continue;
    const files = ['image.jpg', 'auto.png', 'corrige.png', 'meta.json'].map((f) => path.join(d, f));
    if (!files.every((f) => fs.existsSync(f))) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(files[3], 'utf8')); } catch (e) { continue; }
    if (!meta.page || !meta.crop) continue;
    out.push({ name, dir: d, meta });
  }
  return LIMIT ? out.slice(0, LIMIT) : out;
}

// ---------- serveur statique + Chromium ----------

function serve() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'tests', 'serve.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', () => resolve(p));
    p.on('error', reject);
    setTimeout(() => resolve(p), 1500);
  });
}

// Dans la page : reconstruit la feuille (papier uni, le recadrage à sa place), rejoue la découpe
// avec des réglages donnés et mesure le recouvrement avec la découpe corrigée.
const PAGE_SCRIPT = `
(() => {
  const EX = {};
  const b64img = (data) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = data; });
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const maskOf = (img, w, h) => { const c = mk(w, h); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0; c.width = 0; return m; };
  const iou = (a, b) => { let i = 0, u = 0; for (let p = 0; p < a.length; p++) { if (a[p] && b[p]) i++; if (a[p] || b[p]) u++; } return u ? i / u : 1; };
  window.Apprendre = {
    async load(id, image, auto, corrige, meta) {
      const [im, am, cm] = await Promise.all([b64img(image), b64img(auto), b64img(corrige)]);
      const k = meta.crop.scale || 1;
      const cw = im.naturalWidth, ch = im.naturalHeight;
      // couleur du papier : médiane des pixels clairs et peu colorés du recadrage
      const sm = mk(Math.min(200, cw), Math.min(200, ch));
      sm.getContext('2d').drawImage(im, 0, 0, sm.width, sm.height);
      const sd = sm.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sm.width, sm.height).data;
      const cand = [];
      for (let i = 0; i < sd.length; i += 4) { const r = sd[i], g = sd[i + 1], b = sd[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 150 && mx - mn < 40) cand.push([r, g, b]); }
      sm.width = 0;
      let paper = [250, 249, 244];
      if (cand.length > 20) { cand.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2])); paper = cand[Math.floor(cand.length * 0.6)]; }
      const page = mk(meta.page.w * k, meta.page.h * k);
      const x = page.getContext('2d');
      x.fillStyle = 'rgb(' + paper.join(',') + ')'; x.fillRect(0, 0, page.width, page.height);
      const ox = meta.crop.x * k, oy = meta.crop.y * k;
      x.drawImage(im, ox, oy, cw, ch);
      EX[id] = { page, ox, oy, cw, ch, auto: maskOf(am, cw, ch), corr: maskOf(cm, cw, ch) };
      return { w: cw, h: ch, iouAuto: iou(EX[id].auto, EX[id].corr) };
    },
    run(id, prefs) {
      const e = EX[id];
      Extract.setCutPrefs(prefs);
      const seg = Extract.segment(e.page);
      const pieces = Extract.cutPieces(e.page, seg);
      // union des pièces qui recouvrent la découpe corrigée (au moins 30 % de leur surface), sinon la meilleure
      const masks = pieces.map((p) => { const c = mk(e.cw, e.ch); const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(p.canvas, p.src.x - e.ox, p.src.y - e.oy, p.src.w, p.src.h); const d = cx.getImageData(0, 0, e.cw, e.ch).data; const m = new Uint8Array(e.cw * e.ch); let area = 0, inter = 0; for (let i = 0; i < m.length; i++) { if (d[i * 4 + 3] > 127) { m[i] = 1; area++; if (e.corr[i]) inter++; } } c.width = 0; return { m, area, inter }; });
      pieces.forEach((p) => Extract.release(p.canvas));
      const keep = masks.filter((q) => q.area && q.inter / q.area >= 0.3);
      const set = keep.length ? keep : masks.filter((q) => q.area).sort((a, b) => b.inter - a.inter).slice(0, 1);
      const u = new Uint8Array(e.cw * e.ch);
      set.forEach((q) => { for (let i = 0; i < u.length; i++) if (q.m[i]) u[i] = 1; });
      return iou(u, e.corr);
    },
    unload(id) { const e = EX[id]; if (e) { e.page.width = 0; delete EX[id]; } },
  };
})();`;

const key = (p) => ['margin', 'close', 'smooth', 'ink'].map((k) => `${k}=${p[k]}`).join(' ');
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const r3 = (v) => Math.round(v * 1000) / 1000;

async function learn(dir) {
  const exs = examples(dir);
  log(`${exs.length} exemples exploitables dans ${dir}`);
  const report = { n: exs.length, at: new Date().toISOString(), kinds: {}, byMonth: {} };
  exs.forEach((e) => { const k = e.meta.kind || '?'; report.kinds[k] = (report.kinds[k] || 0) + 1; const m = e.name.slice(0, 7); report.byMonth[m] = (report.byMonth[m] || 0) + 1; });
  let learned = null, cache = new Map(), iouAuto = [];
  if (exs.length) {
    const { chromium } = require('playwright');
    const server = await serve();
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    try {
      const page = await browser.newPage();
      await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
      await page.goto(`http://localhost:${PORT}/index.html`);
      await page.waitForFunction(() => window.Extract);
      await page.evaluate(PAGE_SCRIPT);
      const b64 = (f, type) => `data:${type};base64,${fs.readFileSync(f).toString('base64')}`;
      // les exemples sont chargés une fois, dans la page
      const ids = [];
      for (const e of exs) {
        const r = await page.evaluate(({ id, image, auto, corrige, meta }) => Apprendre.load(id, image, auto, corrige, meta), {
          id: e.name, image: b64(path.join(e.dir, 'image.jpg'), 'image/jpeg'), auto: b64(path.join(e.dir, 'auto.png'), 'image/png'), corrige: b64(path.join(e.dir, 'corrige.png'), 'image/png'), meta: e.meta,
        });
        ids.push(e.name);
        iouAuto.push(r.iouAuto);
      }
      // évaluation d'un réglage sur tous les exemples (mémorisée)
      const evalPrefs = async (p) => {
        const k = key(p);
        if (cache.has(k)) return cache.get(k);
        const vals = [];
        for (const id of ids) vals.push(await page.evaluate(({ id, p }) => Apprendre.run(id, p), { id, p }));
        cache.set(k, vals);
        log(`  ${k} → IoU moyen ${r3(mean(vals))}`);
        return vals;
      };
      // descente par coordonnées : chaque réglage à son tour sur sa grille, deux passes
      let best = Object.assign({}, DEFAULT);
      let bestScore = mean(await evalPrefs(best));
      const baseline = bestScore;
      for (let pass = 0; pass < 2; pass++) {
        for (const name of ['margin', 'ink', 'close', 'smooth']) {
          for (const v of GRID[name]) {
            const cand = Object.assign({}, best, { [name]: v });
            const s = mean(await evalPrefs(cand));
            if (s > bestScore + 1e-6) { best = cand; bestScore = s; }
          }
        }
      }
      // validation : pour chaque exemple, le meilleur réglage choisi sans lui, puis son IoU sur lui
      const loo = [];
      const combos = [...cache.entries()];
      ids.forEach((id, i) => {
        let bk = null, bs = -1;
        combos.forEach(([k, vals]) => { const s = mean(vals.filter((v, j) => j !== i)); if (s > bs) { bs = s; bk = k; } });
        loo.push(cache.get(bk)[i]);
      });
      report.iou = { auto: r3(mean(iouAuto)), default: r3(baseline), learned: r3(bestScore), loo: r3(mean(loo)) };
      report.best = best;
      report.gain = r3(bestScore - baseline);
      report.curves = {};
      for (const name of Object.keys(GRID)) report.curves[name] = GRID[name].map((v) => { const k = key(Object.assign({}, best, { [name]: v })); return [v, cache.has(k) ? r3(mean(cache.get(k))) : null]; });
      const enough = exs.length >= MIN_N;
      const changed = Object.keys(DEFAULT).some((k) => Math.abs(best[k] - DEFAULT[k]) > 1e-9);
      report.applied = enough && changed && report.gain >= MIN_GAIN && mean(loo) >= baseline;
      report.reason = !enough ? `moins de ${MIN_N} exemples` : !changed ? 'les réglages d’office restent les meilleurs' : report.gain < MIN_GAIN ? `gain trop faible (${report.gain})` : mean(loo) < baseline ? 'gain non confirmé en validation croisée' : 'gain confirmé';
      if (report.applied) learned = Object.assign({}, best, { n: exs.length, at: report.at, iou: report.iou });
      for (const id of ids) await page.evaluate((id) => Apprendre.unload(id), id);
    } finally {
      await browser.close();
      server.kill();
    }
  } else {
    report.applied = false;
    report.reason = 'aucun exemple';
  }
  write(report, learned);
  return report;
}

function write(report, learned) {
  const jsPath = path.join(OUT, 'js', 'cut-learned.js');
  const prev = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
  const prevVal = (prev.match(/window\.CUT_LEARNED = (.*);/) || [])[1];
  let js;
  if (learned) {
    js = `// Généré par tools/apprendre.js (${report.at}) : réglages de découpe appris de ${report.n} retouches partagées\n// (IoU moyen : découpe d'origine ${report.iou.auto}, réglages d'office ${report.iou.default}, appris ${report.iou.learned}). Ne pas modifier à la main.\nwindow.CUT_LEARNED = ${JSON.stringify(learned)};\n`;
  } else if (prevVal && prevVal !== 'null') {
    // l'apprentissage précédent reste en vigueur tant qu'un nouveau ne le remplace pas
    js = prev.replace(/\/\/ Dernier passage.*\n/, '') + `// Dernier passage (${report.at}) : ${report.n} exemples, ${report.reason} ; réglages conservés.\n`;
  } else {
    js = `// Généré par tools/apprendre.js (${report.at}) : ${report.n} exemples, ${report.reason}.\n// Tant qu'il n'y a pas assez de retouches partagées, l'atelier garde ses réglages de découpe d'office.\nwindow.CUT_LEARNED = null;\n`;
  }
  fs.mkdirSync(path.dirname(jsPath), { recursive: true });
  fs.writeFileSync(jsPath, js);
  const md = [];
  md.push('# Apprentissage de la découpe', '');
  md.push(`Dernier passage : ${report.at}. Rapport généré par \`collage/tools/apprendre.js\` (workflow « Apprentissage de la découpe »), à partir des retouches de découpe partagées par les utilisateurs (voir docs/COMPTES.md). Les exemples ne sont jamais copiés dans le dépôt.`, '');
  md.push(`- Exemples exploitables : **${report.n}**` + (Object.keys(report.kinds).length ? ` (${Object.entries(report.kinds).map(([k, v]) => `${k} : ${v}`).join(', ')})` : ''));
  if (Object.keys(report.byMonth).length) md.push(`- Par mois : ${Object.entries(report.byMonth).map(([k, v]) => `${k} : ${v}`).join(', ')}`);
  md.push(`- Décision : **${report.applied ? 'réglages appris appliqués' : 'réglages d’office conservés'}** (${report.reason})`, '');
  if (report.iou) {
    md.push('## Recouvrement avec les découpes corrigées (IoU moyen)', '');
    md.push('| Découpe | IoU |', '|---|---|');
    md.push(`| Automatique au moment de la retouche | ${report.iou.auto} |`);
    md.push(`| Rejouée avec les réglages d’office | ${report.iou.default} |`);
    md.push(`| Rejouée avec les réglages appris | ${report.iou.learned} |`);
    md.push(`| Réglages appris, validation croisée (chaque exemple jugé par les réglages appris sans lui) | ${report.iou.loo} |`, '');
    md.push('## Réglages', '');
    md.push('| Réglage | D’office | Appris |', '|---|---|---|');
    for (const k of Object.keys(DEFAULT)) md.push(`| ${k} | ${DEFAULT[k]} | ${report.best[k]} |`);
    md.push('', 'Fractions du grand côté de la page (marge de papier gardée autour de l’encre, rayon de liaison des traits, lissage du contour) ; ink : sensibilité aux traits pâles (1 = normale, < 1 : plus sensible).', '');
    md.push('## Courbes (IoU moyen selon chaque réglage, les autres aux valeurs apprises)', '');
    for (const [name, pts] of Object.entries(report.curves)) md.push(`- ${name} : ${pts.map(([v, s]) => `${v} → ${s === null ? '–' : s}`).join(' · ')}`);
    md.push('');
  }
  md.push('## Méthode', '');
  md.push('Pour chaque retouche partagée, la feuille est reconstituée (papier uni, le recadrage à sa place), puis la découpe de l’atelier (`Extract.segment` + `Extract.cutPieces`, le même code que dans le navigateur) est rejouée avec différents réglages ; les pièces qui recouvrent la découpe corrigée sont réunies et comparées à elle (IoU). Les réglages sont cherchés par descente par coordonnées sur une grille (deux passes) ; ils ne remplacent les réglages d’office que s’il y a au moins ' + MIN_N + ' exemples, un gain d’IoU moyen d’au moins ' + MIN_GAIN + ' et un gain confirmé en validation croisée. Les réglages appris deviennent les réglages d’office de l’atelier (`js/cut-learned.js`) ; les retouches de chaque utilisateur continuent de les affiner localement (`Extract.learnCut`), et les œuvres sauvegardées gardent les réglages figés à l’analyse de chaque dessin.', '');
  md.push('Étape suivante, quand les exemples seront quelques centaines : entraîner un petit modèle de segmentation (image recadrée → masque corrigé) et l’embarquer dans l’atelier.');
  fs.mkdirSync(path.join(OUT, '..', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(OUT, '..', 'docs', 'APPRENTISSAGE.md'), md.join('\n') + '\n');
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'rapport.json'), JSON.stringify(report, null, 1)); } catch (e) { /* facultatif */ }
  log(`\n${report.applied ? 'Réglages appris appliqués' : 'Réglages d’office conservés'} : ${report.reason}`);
  if (report.iou) log(`IoU moyen : origine ${report.iou.auto}, d'office ${report.iou.default}, appris ${report.iou.learned}, validation ${report.iou.loo}`);
}

(async () => {
  try {
    const dir = SOURCE ? path.resolve(SOURCE) : await download();
    await learn(dir);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();
