// Livre de dessins (dossier livre/) : vérifie que chaque texte français (index.html et appels tr()
// de js/book.js) a sa traduction anglaise dans livre/js/i18n.js, et signale les traductions qui ne correspondent plus à rien.
// Usage : node tests/livre-i18n-check.js   (code de sortie 1 s'il manque des clés)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..', 'livre');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// --- dictionnaire : exécute i18n.js dans un contexte minimal
const ctx = { window: {}, document: { addEventListener() {} }, navigator: { language: 'en' }, location: { search: '', href: 'http://localhost/' }, URLSearchParams, console };
vm.createContext(ctx);
vm.runInContext(read('js/i18n.js'), ctx);
const dict = ctx.window.I18n.dict;

// --- littéraux des modules JS (chaînes, gabarits, imbrication) précédés de tr( ou tr
function literals(src) {
  const out = [];
  const isRegexStart = (i) => { let k = i - 1; while (k >= 0 && /\s/.test(src[k])) k--; return k < 0 || !/[A-Za-z0-9_$)\]]/.test(src[k]); };
  function scan(i, stop) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (stop && c === '{') depth++;
      if (stop && c === '}') { if (depth === 0) return i + 1; depth--; }
      if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
      if (c === '/' && isRegexStart(i)) {
        let j = i + 1, cls = false;
        while (j < src.length) { const ch = src[j]; if (ch === '\\') { j += 2; continue; } if (ch === '[') cls = true; else if (ch === ']') cls = false; else if ((ch === '/' && !cls) || ch === '\n') break; j++; }
        i = j + 1; while (i < src.length && /[a-z]/.test(src[i])) i++; continue;
      }
      if (c === '\'' || c === '"') {
        let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
        out.push({ a: i, b: j + 1, kind: 'str' }); i = j + 1; continue;
      }
      if (c === '`') {
        const a = i; let j = i + 1;
        while (j < src.length) { const ch = src[j]; if (ch === '\\') { j += 2; continue; } if (ch === '`') break; if (ch === '$' && src[j + 1] === '{') { j = scan(j + 2, true); continue; } j++; }
        out.push({ a, b: j + 1, kind: 'tpl' }); i = j + 1; continue;
      }
      i++;
    }
    return i;
  }
  scan(0, false);
  return out;
}
function cookedKey(lit) {
  if (lit[0] !== '`') return lit.slice(1, -1).replace(/\\(.)/g, '$1');
  const body = lit.slice(1, -1); let out = '', idx = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') { out += body[++i]; continue; }
    if (body.startsWith('${', i)) {
      let depth = 1, k = i + 2;
      while (k < body.length && depth) {
        const ch = body[k];
        if (ch === '{') depth++; else if (ch === '}') depth--;
        else if (ch === '\'' || ch === '"') { k++; while (body[k] !== ch) { if (body[k] === '\\') k++; k++; } }
        else if (ch === '`') { k++; let d2 = 0; while (k < body.length && !(body[k] === '`' && d2 === 0)) { if (body[k] === '\\') k++; else if (body.startsWith('${', k)) d2++; else if (body[k] === '}' && d2) d2--; k++; } }
        k++;
      }
      out += `{${idx++}}`; i = k - 1; continue;
    }
    out += body[i];
  }
  return out;
}
const keys = new Map(); // clé -> provenance
for (const f of ['book.js', 'editor.js']) {
  const src = read('js/' + f);
  for (const { a, b, kind } of literals(src)) {
    const before = src.slice(Math.max(0, a - 3), a);
    if ((kind === 'tpl' && before.endsWith('tr')) || (kind === 'str' && before.endsWith('tr('))) {
      const k = cookedKey(src.slice(a, b));
      if (!keys.has(k)) keys.set(k, `${f}:${src.slice(0, a).split('\n').length}`);
    }
  }
}
// clés passées à tr() dynamiquement : noms des dessins d'exemple (samples/manifest.json de l'atelier)
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', 'manifest.json'), 'utf8'));
manifest.pages.filter((p) => !/peint/i.test(p.file)).forEach((p) => keys.set(p.name.replace(/^Exemple\s*[—-]\s*/i, ''), 'samples'));

// --- textes de index.html : nœuds de texte (hors script/style/svg) et attributs traduits
const html = read('index.html');
const SKIP = /^(Atelier|Gribouille|Atelier Gribouille|JPEG|PNG|PDF|IKEA|Google|Facebook|FR|EN|Langue \/ Language|Orientation|Excellent|A[0-9]|cm|dpi|×|·|px|\d[\d\s%,.]*)$/;
const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
for (const m of body.matchAll(/>([^<]+)</g)) {
  const k = decode(m[1]).replace(/\s+/g, ' ').trim();
  if (k && /[A-Za-zÀ-ÿ]{2}/.test(k) && !SKIP.test(k) && !keys.has(k)) keys.set(k, 'index.html');
}
for (const m of body.matchAll(/\s(?:title|placeholder|aria-label|alt)="([^"]+)"/g)) {
  const k = decode(m[1]);
  if (k && /[A-Za-zÀ-ÿ]{2}/.test(k) && !SKIP.test(k) && !keys.has(k)) keys.set(k, 'index.html@attr');
}
const metaDesc = body.match(/<meta name="description" content="([^"]+)"/);
if (metaDesc) keys.set(decode(metaDesc[1]), 'index.html@meta');

const missing = [...keys].filter(([k]) => dict[k] === undefined && !/^Changer de langue/.test(k));
const unused = Object.keys(dict).filter((k) => !keys.has(k) && !/^Changer de langue/.test(k));
if (missing.length) { console.log(`${missing.length} texte(s) sans traduction anglaise :`); missing.forEach(([k, w]) => console.log(`  ${w}  ${JSON.stringify(k)}`)); }
if (unused.length) { console.log(`${unused.length} traduction(s) sans texte source (à retirer ou clé modifiée) :`); unused.forEach((k) => console.log(`  ${JSON.stringify(k)}`)); }
console.log(`${keys.size} textes, ${Object.keys(dict).length} traductions.`);
process.exit(missing.length ? 1 : 0);
