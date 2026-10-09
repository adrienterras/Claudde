/*
 * Atelier Gribouille — le livre de dessins.
 *
 * Les dessins importés (PDF de scanner, photos) deviennent les pages d'un livre, comme un album
 * photo : une couverture avec un titre et un dessin, les pages intérieures (un, deux ou quatre
 * dessins par page, avec leur titre et leur date), puis la 4e de couverture. Le nombre de pages
 * est toujours pair. Le livre se télécharge en PDF, une page du PDF par page du livre, en 300 dpi,
 * avec un fond perdu de 3 mm en option.
 *
 * Tout se passe dans le navigateur : les dessins sont gardés en JPEG haute définition (au plus
 * 3600 px de côté) et le livre en cours est enregistré dans IndexedDB pour survivre à un
 * rechargement. La mise en page est calculée une seule fois, en centimètres, et sert à la fois
 * à l'aperçu (SVG) et au PDF (jsPDF) : ce qu'on voit est ce qu'on imprime.
 */
(function () {
  'use strict';

  const tr = window.tr || ((s, ...v) => (typeof s === 'string' ? s : s.reduce((a, p, i) => a + p + (i < v.length ? v[i] : ''), '')));
  const $ = (id) => document.getElementById(id);
  const track = (name, props) => { try { if (window.Atelier && window.Atelier.track) window.Atelier.track(name, props); } catch (e) { /* ignoré */ } };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const fmtNum = (v) => (Math.round(v * 10) / 10).toLocaleString(window.I18n ? I18n.locale : 'fr-FR');
  // Bibliothèques PDF chargées à la demande : la page s'ouvre sans elles (680 Ko de moins)
  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = () => resolve();
        el.onerror = () => { scripts.delete(src); el.remove(); reject(new Error(src)); };
        document.head.appendChild(el);
      }));
    }
    return scripts.get(src);
  }
  async function needPdfJs() {
    if (!window.pdfjsLib) await loadScript('../atelier/vendor/pdf.min.js');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = '../atelier/vendor/pdf.worker.min.js';
  }
  const needJsPdf = async () => { if (!window.jspdf) await loadScript('../atelier/vendor/jspdf.umd.min.js'); };

  const FORMATS = {
    a4p: { w: 21, h: 29.7, name: tr('A4 portrait') },
    a4l: { w: 29.7, h: 21, name: tr('A4 paysage') },
    sq21: { w: 21, h: 21, name: tr('carré 21 × 21 cm') },
    sq30: { w: 30, h: 30, name: tr('grand carré 30 × 30 cm') },
  };
  const PAPERS = [['#ffffff', tr('blanc')], ['#f8f3e8', tr('ivoire')], ['#ece3d1', tr('lin')], ['#2f3a33', tr('vert sapin')]];
  const SERIF = '"Times New Roman", Times, serif';
  const SANS = 'Helvetica, Arial, sans-serif';
  // Les téléphones manquent de mémoire : les dessins y sont gardés un peu plus petits.
  const phone = () => navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900;
  const MAX_LONG = phone() ? 2600 : 3600;

  const state = {
    drawings: [], // { id, name, blob (JPEG), w, h, thumb (URL), caption, date }
    seq: 0,
    settings: { title: '', subtitle: '', format: 'a4p', layout: 1, paper: '#ffffff', captions: true, numbers: true, cover: null, quality: 300, bleed: false },
    busy: false,
  };

  // ---------- Messages ----------

  function notice(text) { const el = $('notice'); el.textContent = text || ''; el.hidden = !text; }
  function status(text) { const el = $('export-status'); el.textContent = text || ''; el.hidden = !text; }
  function setProgress(done, total, label) {
    const p = $('progress');
    p.hidden = done >= total;
    p.querySelector('div').style.width = `${(100 * done) / Math.max(1, total)}%`;
    p.querySelector('span').textContent = label || `${done} / ${total}`;
  }

  // ---------- Images ----------

  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

  async function decode(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* repli ci-dessous */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
  const dims = (img) => [img.width || img.naturalWidth, img.height || img.naturalHeight];

  // Un dessin : l'image haute définition en JPEG et une vignette pour l'aperçu.
  async function fromCanvas(c, name) {
    // fond blanc sous la transparence (PNG détourés) : le JPEG n'en a pas
    const flat = makeCanvas(c.width, c.height);
    const fx = flat.getContext('2d');
    fx.fillStyle = '#ffffff';
    fx.fillRect(0, 0, flat.width, flat.height);
    fx.drawImage(c, 0, 0);
    const blob = await toBlob(flat, 'image/jpeg', 0.9);
    if (!blob) throw new Error('jpeg');
    const d = { id: ++state.seq, name: name || '', blob, w: flat.width, h: flat.height, caption: '', date: '' };
    await makeThumb(d, flat);
    c.width = c.height = 0; flat.width = flat.height = 0;
    return d;
  }
  async function makeThumb(d, src) {
    const k = Math.min(1, 900 / Math.max(d.w, d.h));
    const t = makeCanvas(d.w * k, d.h * k);
    const x = t.getContext('2d');
    x.imageSmoothingQuality = 'high';
    if (src) x.drawImage(src, 0, 0, t.width, t.height);
    else { const img = await decode(d.blob); x.drawImage(img, 0, 0, t.width, t.height); if (img.close) img.close(); }
    const tb = await toBlob(t, 'image/jpeg', 0.82);
    if (d.thumb) URL.revokeObjectURL(d.thumb);
    d.thumb = URL.createObjectURL(tb);
  }

  // Pages d'un fichier : chaque page d'un PDF, ou l'image elle-même.
  async function pagesOf(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const base = file.name.replace(/\.[a-z0-9]+$/i, '');
    if (isPdf) {
      try { await needPdfJs(); } catch (e) { console.warn(e); }
      if (!window.pdfjsLib) throw new Error(tr('lecteur PDF indisponible'));
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
      const out = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        out.push({
          name: pdf.numPages > 1 ? `${base} — p.${i}` : base,
          render: async () => {
            const page = await pdf.getPage(i);
            const vp0 = page.getViewport({ scale: 1 });
            // au plus 300 dpi et MAX_LONG pixels sur le grand côté
            const scale = Math.min(300 / 72, MAX_LONG / Math.max(vp0.width, vp0.height));
            const vp = page.getViewport({ scale });
            const c = makeCanvas(vp.width, vp.height);
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            page.cleanup();
            return c;
          },
          release: i === pdf.numPages ? () => pdf.destroy() : null,
        });
      }
      return out;
    }
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|hei[cf])$/i.test(file.name)) {
      return [{
        name: base,
        render: async () => {
          const img = await decode(file);
          const [w, h] = dims(img);
          const k = Math.min(1, MAX_LONG / Math.max(w, h));
          const c = makeCanvas(w * k, h * k);
          const x = c.getContext('2d');
          x.imageSmoothingQuality = 'high';
          x.drawImage(img, 0, 0, c.width, c.height);
          if (img.close) img.close();
          return c;
        },
      }];
    }
    return [];
  }

  async function importFiles(files, opts) {
    const list = [...files];
    if (!list.length || state.busy) return 0;
    state.busy = true;
    notice('');
    let added = 0;
    try {
      const pages = [];
      setProgress(0, 1, tr('Lecture des fichiers…'));
      for (const f of list) {
        try { pages.push(...await pagesOf(f)); } catch (e) { console.error(e); notice(tr`Le fichier « ${f.name} » n’a pas pu être lu.`); }
      }
      if (!pages.length) {
        setProgress(1, 1);
        notice(tr('Aucun dessin lisible : choisissez des PDF, JPG ou PNG.'));
        return 0;
      }
      for (let i = 0; i < pages.length; i++) {
        setProgress(i, pages.length, tr`Lecture du dessin ${i + 1} / ${pages.length}…`);
        await tick();
        try {
          const c = await pages[i].render();
          const d = await fromCanvas(c, pages[i].name);
          if (opts && opts.caption) d.caption = opts.caption(pages[i].name, i);
          state.drawings.push(d);
          await saveDrawing(d);
          added++;
        } catch (e) {
          console.error(e);
          notice(tr`Le dessin « ${pages[i].name} » n’a pas pu être lu (image trop grande pour cet appareil ?).`);
        }
        if (pages[i].release) { try { pages[i].release(); } catch (e) { /* déjà libéré */ } }
      }
      setProgress(1, 1);
    } finally {
      state.busy = false;
    }
    if (added) {
      if (!(opts && opts.sample)) track('Livre', { etape: 'import', dessins: Math.min(added, 100) });
      changed(true);
    }
    return added;
  }

  async function rotateBlob(blob, keep) {
    const img = await decode(blob);
    const [w, h] = dims(img);
    const c = makeCanvas(h, w);
    const x = c.getContext('2d');
    x.translate(c.width, 0);
    x.rotate(Math.PI / 2);
    x.drawImage(img, 0, 0);
    if (img.close) img.close();
    const out = { blob: await toBlob(c, 'image/jpeg', 0.9), w: c.width, h: c.height, canvas: keep ? c : null };
    if (!keep) c.width = c.height = 0;
    return out;
  }
  async function rotate(d) {
    const r = await rotateBlob(d.blob, true);
    d.blob = r.blob; d.w = r.w; d.h = r.h;
    await makeThumb(d, r.canvas);
    r.canvas.width = r.canvas.height = 0;
    // le scan d'origine tourne avec lui : « dessin d'origine » le rend dans le même sens
    if (d.orig) d.orig = (await rotateBlob(d.orig)).blob;
    await saveDrawing(d);
  }

  // Recadrer ou gommer : l'éditeur rend le dessin retouché ; le scan importé reste gardé à part.
  function edit(d) {
    if (!window.LivreEditor || state.busy) return;
    LivreEditor.open(d, {
      original: d.orig || null,
      onApply: async (blob, w, h) => {
        if (!d.orig) d.orig = d.blob;
        d.blob = blob; d.w = w; d.h = h;
        await makeThumb(d);
        await saveDrawing(d);
        changed(true);
        track('Livre', { etape: 'retouche' });
      },
    }).catch((e) => { console.error(e); notice(tr('Ce dessin n’a pas pu être ouvert pour la retouche sur cet appareil.')); });
  }

  // ---------- Mise en page (en centimètres) ----------

  const fmt = () => FORMATS[state.settings.format] || FORMATS.a4p;
  const isDark = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 110; };

  // Le livre : couverture, pages intérieures, une page blanche si besoin (nombre pair), 4e de couverture.
  function bookPages() {
    const pages = [{ kind: 'cover' }];
    const n = state.settings.layout;
    for (let i = 0; i < state.drawings.length; i += n) pages.push({ kind: 'drawings', items: state.drawings.slice(i, i + n) });
    if (pages.length % 2 === 0) pages.push({ kind: 'blank' });
    pages.push({ kind: 'back' });
    return pages;
  }

  const measureCtx = document.createElement('canvas').getContext('2d');
  // Taille de texte (cm) qui tient dans la largeur donnée, sans descendre sous min.
  function fitText(text, size, maxW, family, italic, min) {
    let s = size;
    for (let k = 0; k < 30; k++) {
      measureCtx.font = `${italic ? 'italic ' : ''}${s * 20}px ${family}`;
      if (measureCtx.measureText(text).width / 20 <= maxW || s <= min) break;
      s *= 0.93;
    }
    return s;
  }
  // Coupe un texte trop long (au mot près) pour qu'il tienne, même à la taille minimale.
  function clipText(text, size, maxW, family, italic) {
    measureCtx.font = `${italic ? 'italic ' : ''}${size * 20}px ${family}`;
    if (measureCtx.measureText(text).width / 20 <= maxW) return text;
    let t = text;
    while (t.length > 1 && measureCtx.measureText(t + '…').width / 20 > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }
  function textEl(text, x, y, size, opt) {
    const family = opt.serif ? SERIF : SANS;
    const s = fitText(text, size, opt.maxW, family, opt.italic, size * 0.55);
    return { t: 'text', text: clipText(text, s, opt.maxW, family, opt.italic), x, y, size: s, serif: !!opt.serif, italic: !!opt.italic, color: opt.color };
  }
  // Une image posée dans une boîte, sans la déformer.
  function fit(d, box) {
    const k = Math.min(box.w / d.w, box.h / d.h);
    const w = d.w * k, h = d.h * k;
    return { t: 'image', d, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }
  // Grille de k cases : on garde la disposition qui laisse les dessins les plus grands.
  function bestGrid(items, box, gap) {
    const k = items.length;
    const options = k === 1 ? [[1, 1]] : k === 2 ? [[1, 2], [2, 1]] : k === 3 ? [[1, 3], [3, 1], [2, 2]] : [[2, 2], [1, 4], [4, 1]];
    let best = null;
    options.forEach(([cols, rows]) => {
      const cw = (box.w - gap * (cols - 1)) / cols, ch = (box.h - gap * (rows - 1)) / rows;
      let area = 0;
      items.forEach((d) => { const s = Math.min(cw / d.w, ch / d.h); area += d.w * s * d.h * s; });
      if (!best || area > best.area) best = { cols, rows, cw, ch, area };
    });
    // la dernière rangée incomplète est centrée
    return items.map((d, i) => {
      const r = Math.floor(i / best.cols), c = i % best.cols;
      const inRow = Math.min(best.cols, items.length - r * best.cols);
      const off = ((best.cols - inRow) * (best.cw + gap)) / 2;
      return { x: box.x + off + c * (best.cw + gap), y: box.y + r * (best.ch + gap), w: best.cw, h: best.ch };
    });
  }

  function layoutPage(page, index, total) {
    const { w: W, h: H } = fmt();
    const st = state.settings;
    const S = Math.min(W, H);
    const m = S * 0.085, gap = S * 0.05;
    const dark = isDark(st.paper);
    const ink = dark ? '#f3eee4' : '#2b2a22', soft = dark ? '#cfc8b8' : '#7a7262';
    const els = [];
    if (page.kind === 'cover') {
      const title = st.title.trim() || tr('Nos plus beaux dessins');
      const ts = S * 0.078;
      const ty = m + ts;
      els.push(textEl(title, W / 2, ty, ts, { serif: true, italic: true, color: ink, maxW: W - 2 * m }));
      let top = ty + S * 0.05;
      if (st.subtitle.trim()) {
        const ss = S * 0.03;
        els.push(textEl(st.subtitle.trim(), W / 2, ty + ss * 2.1, ss, { color: soft, maxW: W - 2 * m }));
        top = ty + ss * 2.1 + S * 0.05;
      }
      const d = state.drawings.find((x) => x.id === st.cover) || state.drawings[0];
      if (d) els.push(fit(d, { x: m * 1.3, y: top, w: W - m * 2.6, h: H - top - m * 1.3 }));
    } else if (page.kind === 'drawings') {
      const scale = page.items.length > 2 ? 0.78 : 1;
      const bottom = st.numbers ? m * 1.15 : m;
      const slots = bestGrid(page.items, { x: m, y: m, w: W - 2 * m, h: H - m - bottom }, gap);
      page.items.forEach((d, i) => {
        const slot = slots[i];
        const lines = [];
        if (st.captions && d.caption.trim()) lines.push({ text: d.caption.trim(), size: S * 0.03 * scale, serif: true, italic: true, color: ink });
        if (st.captions && d.date.trim()) lines.push({ text: d.date.trim(), size: S * 0.021 * scale, color: soft });
        const capH = lines.length ? S * 0.018 + lines.reduce((a, l) => a + l.size * 1.45, 0) : 0;
        const img = fit(d, { x: slot.x, y: slot.y, w: slot.w, h: Math.max(slot.h * 0.4, slot.h - capH) });
        els.push(img);
        let y = img.y + img.h + S * 0.018;
        lines.forEach((l) => { y += l.size * 1.1; els.push(textEl(l.text, slot.x + slot.w / 2, y, l.size, { serif: l.serif, italic: l.italic, color: l.color, maxW: slot.w })); y += l.size * 0.35; });
      });
      if (st.numbers) els.push(textEl(String(index), W / 2, H - m * 0.5, S * 0.02, { color: soft, maxW: W }));
    } else if (page.kind === 'back') {
      const title = st.title.trim();
      if (title) els.push(textEl(title, W / 2, H * 0.46, S * 0.04, { serif: true, italic: true, color: ink, maxW: W - 2 * m }));
      if (st.subtitle.trim()) els.push(textEl(st.subtitle.trim(), W / 2, H * 0.46 + S * 0.05, S * 0.022, { color: soft, maxW: W - 2 * m }));
      els.push(textEl(tr('Fait avec Atelier Gribouille · ateliergribouille.art'), W / 2, H - m * 0.7, S * 0.017, { color: soft, maxW: W - 2 * m }));
    }
    return els;
  }

  // ---------- Aperçu ----------

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    const e = document.createElementNS(SVGNS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, String(v)));
    return e;
  }
  function pageSvg(page, index, total) {
    const { w: W, h: H } = fmt();
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': pageLabel(page, index, total) });
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: state.settings.paper }));
    layoutPage(page, index, total).forEach((e) => {
      if (e.t === 'image') {
        const im = svgEl('image', { x: e.x, y: e.y, width: e.w, height: e.h, preserveAspectRatio: 'none', 'data-id': e.d.id });
        im.setAttribute('href', e.d.thumb);
        svg.appendChild(im);
      } else if (e.t === 'text') {
        const t = svgEl('text', { x: e.x, y: e.y, 'font-size': e.size, 'text-anchor': 'middle', fill: e.color, 'font-family': e.serif ? SERIF : SANS, 'font-style': e.italic ? 'italic' : 'normal' });
        t.textContent = e.text;
        svg.appendChild(t);
      }
    });
    return svg;
  }
  function pageLabel(page, index, total) {
    if (page.kind === 'cover') return tr('Couverture');
    if (page.kind === 'back') return tr('4e de couverture');
    if (page.kind === 'blank') return tr('Page blanche');
    return tr`Page ${index}`;
  }

  let renderTimer = 0;
  function renderSoon() { clearTimeout(renderTimer); renderTimer = setTimeout(renderBook, 120); }
  function renderBook() {
    clearTimeout(renderTimer);
    const box = $('spreads');
    box.innerHTML = '';
    const has = state.drawings.length > 0;
    $('empty').hidden = has;
    $('stage-bar').hidden = !has;
    ['book-section', 'drawings-section', 'export-section', 'restart-offer'].forEach((id) => { $(id).hidden = !has; });
    $('sample-offer').hidden = has;
    if (!has) return;
    const pages = bookPages();
    const total = pages.length;
    box.style.setProperty('--ar', String(fmt().w / fmt().h)); // une double page tient dans la hauteur de l'écran
    // double pages : la couverture seule à droite, puis les pages par deux, la 4e de couverture seule à gauche
    const spreads = [[null, 0]];
    for (let i = 1; i < total - 1; i += 2) spreads.push([i, i + 1]);
    spreads.push([total - 1, null]);
    spreads.forEach(([a, b]) => {
      const sp = document.createElement('div');
      sp.className = 'spread';
      const row = document.createElement('div');
      row.className = 'pages';
      [a, b].forEach((i, side) => {
        const pg = document.createElement('div');
        pg.className = `page ${side ? 'right' : 'left'}`;
        if (i === null) { pg.classList.add('blank-side'); pg.appendChild(pageSvg({ kind: 'blank' }, 0, total)); } else pg.appendChild(pageSvg(pages[i], i, total));
        row.appendChild(pg);
      });
      const label = document.createElement('p');
      label.className = 'label';
      label.textContent = a === null ? tr('Couverture') : b === null ? tr('4e de couverture') : tr`Pages ${a} – ${b}`;
      sp.appendChild(row);
      sp.appendChild(label);
      box.appendChild(sp);
    });
    const F = fmt();
    const title = state.settings.title.trim() || tr('Nos plus beaux dessins');
    $('stage-info').textContent = tr`« ${title} » · ${total} pages · ${F.name} · ${state.drawings.length} dessins`;
    updateExportInfo(pages);
  }

  // un dessin touché dans l'aperçu s'ouvre pour être recadré ou gommé
  $('spreads').addEventListener('click', (e) => {
    const im = e.target.closest('image[data-id]');
    if (!im) return;
    const d = state.drawings.find((x) => String(x.id) === im.getAttribute('data-id'));
    if (d) edit(d);
  });

  // ---------- Liste des dessins ----------

  function icon(id) { return `<svg class="ico"><use href="#${id}"/></svg>`; }
  function renderList() {
    const ol = $('list');
    ol.innerHTML = '';
    const ds = state.drawings;
    const coverId = (ds.find((x) => x.id === state.settings.cover) || ds[0] || {}).id;
    ds.forEach((d, i) => {
      const li = document.createElement('li');
      li.className = 'item';
      li.dataset.id = d.id;
      li.innerHTML = `
        <div class="thumb"><img alt=""><span class="n"></span><span class="cover" hidden></span></div>
        <div class="fields">
          <input type="text" data-f="caption" maxlength="60">
          <input type="text" data-f="date" maxlength="40">
          <div class="actions">
            <button type="button" data-a="edit">${icon('i-edit')}</button>
            <button type="button" data-a="up">${icon('i-up')}</button>
            <button type="button" data-a="down">${icon('i-down')}</button>
            <button type="button" data-a="rotate">${icon('i-rotate')}</button>
            <button type="button" data-a="cover">${icon('i-star')}</button>
            <span class="sp"></span>
            <button type="button" data-a="del">${icon('i-trash')}</button>
          </div>
        </div>`;
      li.querySelector('img').src = d.thumb;
      li.querySelector('.n').textContent = String(i + 1);
      const isCover = d.id === coverId;
      const badge = li.querySelector('.cover');
      badge.hidden = !isCover;
      badge.textContent = tr('couverture');
      const cap = li.querySelector('[data-f="caption"]'), date = li.querySelector('[data-f="date"]');
      cap.value = d.caption; cap.placeholder = tr('Titre du dessin'); cap.setAttribute('aria-label', tr`Titre du dessin ${i + 1}`);
      date.value = d.date; date.placeholder = tr('Date ou âge · mars 2025, 5 ans'); date.setAttribute('aria-label', tr`Date ou âge du dessin ${i + 1}`);
      cap.oninput = () => { d.caption = cap.value; renderSoon(); saveMetaSoon(); };
      date.oninput = () => { d.date = date.value; renderSoon(); saveMetaSoon(); };
      const btn = (a) => li.querySelector(`[data-a="${a}"]`);
      const labels = { edit: tr('Recadrer ou gommer'), up: tr('Avancer d’une place'), down: tr('Reculer d’une place'), rotate: tr('Tourner d’un quart de tour'), cover: tr('Mettre en couverture'), del: tr('Retirer du livre') };
      Object.entries(labels).forEach(([a, l]) => { btn(a).title = l; btn(a).setAttribute('aria-label', l); });
      btn('up').disabled = i === 0;
      btn('down').disabled = i === ds.length - 1;
      btn('cover').classList.toggle('on', isCover);
      btn('cover').setAttribute('aria-pressed', isCover ? 'true' : 'false');
      btn('edit').onclick = () => edit(d);
      const thumb = li.querySelector('.thumb');
      thumb.setAttribute('role', 'button');
      thumb.tabIndex = 0;
      thumb.title = tr('Recadrer ou gommer');
      thumb.onclick = () => edit(d);
      thumb.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(d); } };
      btn('up').onclick = () => move(i, -1);
      btn('down').onclick = () => move(i, 1);
      btn('cover').onclick = () => { state.settings.cover = d.id; changed(); };
      btn('rotate').onclick = async () => {
        btn('rotate').disabled = true;
        try { await rotate(d); } catch (e) { console.error(e); notice(tr('Ce dessin n’a pas pu être tourné sur cet appareil.')); }
        changed(true);
      };
      btn('del').onclick = () => {
        state.drawings.splice(state.drawings.indexOf(d), 1);
        if (d.thumb) URL.revokeObjectURL(d.thumb);
        if (state.settings.cover === d.id) state.settings.cover = null;
        dbDel(`d:${d.id}`).catch(() => {});
        changed(true);
      };
      ol.appendChild(li);
    });
    $('count').textContent = ds.length ? `(${ds.length})` : '';
  }
  function move(i, dir) {
    const j = i + dir, ds = state.drawings;
    if (j < 0 || j >= ds.length) return;
    [ds[i], ds[j]] = [ds[j], ds[i]];
    changed(true);
    const li = document.querySelector(`#list li[data-id="${ds[j].id}"]`);
    if (li) li.querySelector(`[data-a="${dir < 0 ? 'up' : 'down'}"]`).focus({ preventScroll: true });
  }

  // Tout changement : liste (si la structure change), aperçu, brouillon.
  function changed(structure) {
    if (structure !== false) renderList();
    renderBook();
    saveMetaSoon();
  }

  // ---------- Réglages ----------

  function bindSettings() {
    const st = state.settings;
    $('title').oninput = () => { st.title = $('title').value; renderSoon(); saveMetaSoon(); };
    $('subtitle').oninput = () => { st.subtitle = $('subtitle').value; renderSoon(); saveMetaSoon(); };
    $('format').onchange = () => { st.format = $('format').value; changed(false); };
    document.querySelectorAll('#layout button').forEach((b) => {
      b.onclick = () => { st.layout = Number(b.dataset.n); syncSettings(); changed(false); };
    });
    const sw = $('paper');
    sw.innerHTML = '';
    PAPERS.forEach(([hex, name]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = hex;
      b.title = name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', name);
      b.dataset.hex = hex;
      b.onclick = () => { st.paper = hex; syncSettings(); changed(false); };
      sw.appendChild(b);
    });
    $('captions').onchange = () => { st.captions = $('captions').checked; changed(false); };
    $('numbers').onchange = () => { st.numbers = $('numbers').checked; changed(false); };
    $('quality').onchange = () => { st.quality = Number($('quality').value); updateExportInfo(); saveMetaSoon(); };
    $('bleed').onchange = () => { st.bleed = $('bleed').checked; updateExportInfo(); saveMetaSoon(); };
  }
  function syncSettings() {
    const st = state.settings;
    $('title').value = st.title;
    $('subtitle').value = st.subtitle;
    $('format').value = st.format;
    document.querySelectorAll('#layout button').forEach((b) => { const on = Number(b.dataset.n) === st.layout; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    document.querySelectorAll('#paper button').forEach((b) => b.setAttribute('aria-checked', b.dataset.hex === st.paper ? 'true' : 'false'));
    $('captions').checked = st.captions;
    $('numbers').checked = st.numbers;
    $('quality').value = String(st.quality);
    $('bleed').checked = st.bleed;
  }

  // ---------- Export PDF ----------

  function updateExportInfo(pages) {
    if (!state.drawings.length) return;
    pages = pages || bookPages();
    const F = fmt(), st = state.settings;
    const b = st.bleed ? 0.3 : 0;
    // dessins trop petits pour leur place : flous à l'impression (moins de 150 dpi)
    let soft = 0;
    pages.forEach((p, i) => layoutPage(p, i, pages.length).forEach((e) => { if (e.t === 'image' && e.d.w / (e.w / 2.54) < 150) soft++; }));
    $('export-info').textContent = tr`${pages.length} pages de ${fmtNum(F.w + 2 * b)} × ${fmtNum(F.h + 2 * b)} cm${b ? tr(' (fond perdu compris)') : ''}, couverture comprise.`
      + (soft ? ' ' + (soft === 1 ? tr('1 dessin sera un peu flou à cette taille : un scan en 300 dpi sera plus net.') : tr`${soft} dessins seront un peu flous à cette taille : un scan en 300 dpi sera plus net.`) : '');
  }

  // Octets JPEG d'un dessin, à la définition utile pour sa place dans la page.
  const imageCache = new Map();
  async function jpegFor(d, wcm, dpi) {
    const target = Math.round((wcm / 2.54) * dpi);
    const key = `${d.id}@${Math.min(target, d.w)}:${d.blob.size}`;
    if (imageCache.has(key)) return imageCache.get(key);
    let bytes;
    if (d.w <= target * 1.15) bytes = new Uint8Array(await d.blob.arrayBuffer());
    else {
      const img = await decode(d.blob);
      const k = target / d.w;
      const c = makeCanvas(d.w * k, d.h * k);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, c.width, c.height);
      if (img.close) img.close();
      const blob = await toBlob(c, 'image/jpeg', 0.9);
      c.width = c.height = 0;
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
    const entry = { bytes, alias: `img-${key}` };
    imageCache.set(key, entry);
    return entry;
  }
  const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

  async function buildPdf(onPage) {
    const { jsPDF } = window.jspdf;
    const F = fmt(), st = state.settings;
    const b = st.bleed ? 0.3 : 0;
    const PW = F.w + 2 * b, PH = F.h + 2 * b;
    const orient = PW > PH ? 'landscape' : 'portrait';
    const doc = new jsPDF({ unit: 'cm', format: [PW, PH], orientation: orient, compress: true });
    const title = st.title.trim() || tr('Nos plus beaux dessins');
    doc.setProperties({ title, subject: tr('Livre de dessins'), creator: 'Atelier Gribouille' });
    const pages = bookPages();
    imageCache.clear();
    for (let i = 0; i < pages.length; i++) {
      if (onPage) await onPage(i, pages.length);
      if (i) doc.addPage([PW, PH], orient);
      if (st.paper.toLowerCase() !== '#ffffff') { doc.setFillColor(...hexRgb(st.paper)); doc.rect(0, 0, PW, PH, 'F'); }
      for (const e of layoutPage(pages[i], i, pages.length)) {
        if (e.t === 'image') {
          const { bytes, alias } = await jpegFor(e.d, e.w, st.quality);
          doc.addImage(bytes, 'JPEG', e.x + b, e.y + b, e.w, e.h, alias, 'NONE');
        } else if (e.t === 'text') {
          doc.setFont(e.serif ? 'times' : 'helvetica', e.italic ? 'italic' : 'normal');
          doc.setFontSize(e.size / 0.03528);
          doc.setTextColor(...hexRgb(e.color));
          doc.text(e.text, e.x + b, e.y + b, { align: 'center' });
        }
      }
    }
    imageCache.clear();
    return doc.output('blob');
  }

  function fileName() {
    const t = (state.settings.title.trim() || tr('livre de dessins')).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${t || 'livre'}.pdf`;
  }
  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  $('export').onclick = async () => {
    if (!state.drawings.length || state.busy) return;
    state.busy = true; // (un second clic pendant le chargement de la bibliothèque ne relance rien)
    try { await needJsPdf(); } catch (e) { console.warn(e); }
    state.busy = false;
    if (!window.jspdf) { status(tr('La bibliothèque PDF n’a pas pu être chargée. Rechargez la page.')); return; }
    const btn = $('export');
    btn.disabled = true;
    $('export-ready').hidden = true;
    state.busy = true;
    try {
      const blob = await buildPdf(async (i, n) => { status(tr`Mise en page ${i + 1} / ${n}…`); await tick(); });
      const name = fileName();
      // Sur téléphone et tablette, le PDF arrive longtemps après le toucher : Safari ignore alors un
      // téléchargement lancé tout seul. Un second toucher, sur le livre prêt, l'enregistre.
      if (navigator.maxTouchPoints > 0) {
        const ready = $('export-ready');
        ready.hidden = false;
        ready.onclick = () => saveFile(blob, name);
      } else saveFile(blob, name);
      status(tr`Livre prêt : ${name} (${fmtNum(blob.size / 1024 / 1024)} Mo).`);
      track('Livre', { etape: 'export', pages: bookPages().length, qualite: state.settings.quality });
    } catch (e) {
      console.error(e);
      status(tr('Le PDF n’a pas pu être créé sur cet appareil. Choisissez « Fichier léger · 150 dpi » et réessayez.'));
    } finally {
      state.busy = false;
      btn.disabled = false;
    }
  };

  // ---------- Livre en cours (IndexedDB) ----------

  const DB = 'atelier-gribouille-livre', STORE = 'kv';
  let dbp = null;
  function openDb() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  const tx = (mode, fn) => openDb().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
  }));
  const dbGet = (k) => tx('readonly', (s) => s.get(k));
  const dbPut = (k, v) => tx('readwrite', (s) => { s.put(v, k); });
  const dbDel = (k) => tx('readwrite', (s) => { s.delete(k); });
  const dbClear = () => tx('readwrite', (s) => { s.clear(); });

  // Chaque dessin est écrit une fois (octets bruts : Safari relit mal les Blob) ; le reste est léger.
  async function saveDrawing(d) {
    try { await dbPut(`d:${d.id}`, { id: d.id, name: d.name, w: d.w, h: d.h, data: await d.blob.arrayBuffer(), orig: d.orig ? await d.orig.arrayBuffer() : null }); } catch (e) { console.warn('dessin non gardé', e); }
  }
  let metaTimer = 0;
  function saveMetaSoon() { $('export-ready').hidden = true; clearTimeout(metaTimer); metaTimer = setTimeout(saveMeta, 600); }
  async function saveMeta() {
    clearTimeout(metaTimer);
    if (!state.drawings.length) return;
    const meta = { date: new Date().toISOString(), seq: state.seq, settings: state.settings, order: state.drawings.map((d) => ({ id: d.id, caption: d.caption, date: d.date })) };
    try { await dbPut('meta', meta); } catch (e) { console.warn('livre non gardé', e); }
  }
  async function offerDraft() {
    let meta = null;
    try { meta = await dbGet('meta'); } catch (e) { meta = null; }
    if (!meta || !meta.order || !meta.order.length || state.drawings.length) return;
    const when = new Date(meta.date);
    const box = $('draft-offer');
    box.querySelector('span').textContent = tr`Livre en cours retrouvé : ${meta.order.length} dessins, ${when.toLocaleString(window.I18n ? I18n.locale : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}.`;
    box.hidden = false;
    $('empty-resume').hidden = false;
    const resume = async () => {
      box.hidden = true; $('empty-resume').hidden = true;
      setProgress(0, meta.order.length, tr('Réouverture du livre…'));
      Object.assign(state.settings, meta.settings || {});
      state.seq = Math.max(state.seq, meta.seq || 0);
      for (let i = 0; i < meta.order.length; i++) {
        const o = meta.order[i];
        setProgress(i, meta.order.length, tr`Réouverture du livre : ${i + 1} / ${meta.order.length}…`);
        try {
          const r = await dbGet(`d:${o.id}`);
          if (!r || !r.data) continue;
          const d = { id: r.id, name: r.name, w: r.w, h: r.h, blob: new Blob([r.data], { type: 'image/jpeg' }), orig: r.orig ? new Blob([r.orig], { type: 'image/jpeg' }) : null, caption: o.caption || '', date: o.date || '' };
          await makeThumb(d);
          state.drawings.push(d);
        } catch (e) { console.warn('dessin non relu', e); }
      }
      setProgress(1, 1);
      syncSettings();
      changed(true);
    };
    $('draft-resume').onclick = resume;
    $('empty-resume').onclick = resume;
    $('draft-forget').onclick = () => { box.hidden = true; $('empty-resume').hidden = true; dbClear().catch(() => {}); };
  }

  // ---------- Dessins d'exemple ----------

  async function loadSamples() {
    if (state.busy) return;
    try {
      const r = await fetch('../atelier/samples/manifest.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('manifest');
      const m = await r.json();
      const base = new URL(m.base || 'samples/', new URL('../atelier/', location.href));
      // les dessins seulement (les pages peintes servent de fond dans l'atelier)
      const pages = m.pages.filter((p) => !/peint/i.test(p.file));
      setProgress(0, 1, tr('Chargement des dessins d’exemple…'));
      const files = await Promise.all(pages.map(async (p) => {
        const res = await fetch(new URL(p.file, base));
        if (!res.ok) throw new Error(p.file);
        return new File([await res.blob()], p.file, { type: 'image/jpeg' });
      }));
      const names = new Map(pages.map((p) => [p.file.replace(/\.[a-z0-9]+$/i, ''), p.name]));
      const cap = (n) => { const s = tr((names.get(n) || n).replace(/^Exemple\s*[—-]\s*/i, '')); return s.charAt(0).toUpperCase() + s.slice(1); };
      if (!state.settings.title) { state.settings.title = tr('Les dessins de Léa'); state.settings.subtitle = tr('Un exemple, avec des dessins de démonstration'); syncSettings(); }
      const n = await importFiles(files, { sample: true, caption: (name) => cap(name) });
      if (n) track('Livre', { etape: 'exemple' });
    } catch (e) {
      console.error(e);
      setProgress(1, 1);
      notice(tr('Les dessins d’exemple n’ont pas pu être chargés. Importez vos scans ci-dessus.'));
    }
  }

  // ---------- Branchements ----------

  $('file').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await importFiles(files);
  });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
  $('load-sample').onclick = loadSamples;
  $('empty-sample').onclick = loadSamples;
  $('restart').onclick = () => {
    if (!window.confirm(tr('Commencer un nouveau livre ? Les dessins et les légendes de celui-ci seront effacés.'))) return;
    state.drawings.forEach((d) => { if (d.thumb) URL.revokeObjectURL(d.thumb); });
    state.drawings = [];
    state.settings.cover = null;
    state.settings.title = '';
    state.settings.subtitle = '';
    clearTimeout(metaTimer);
    dbClear().catch(() => {});
    syncSettings();
    status('');
    notice('');
    changed(true);
  };

  bindSettings();
  syncSettings();
  renderList();
  renderBook();
  offerDraft();
  if (/[?&]exemple\b/.test(location.search)) loadSamples();

  // accès pour les tests et le débogage
  window.LivreGribouille = { state, bookPages, layoutPage, buildPdf, saveMeta, edit };
})();
