/*
 * Guide de création imprimable (PDF) pour réaliser l'œuvre à la main :
 *  - couverture, plan de pose quadrillé, étapes de collage dans l'ordre (du fond vers le dessus) ;
 *  - fiches de découpe : chaque dessin original avec ses traits de coupe magenta, numérotés,
 *    et leurs cotes en cm (les dessins sont collés à leur taille réelle, rien n'est imprimé à l'échelle).
 * Chaque page est dessinée sur un canvas à 150 dpi puis placée dans le PDF.
 */
(function () {
  'use strict';

  const DPI = 150;
  const PX = DPI / 25.4; // pixels par millimètre
  // Charte Atelier Gribouille ; le trait de coupe reste magenta, pour être visible sur tous les dessins.
  const C = { ink: '#3b3a2a', muted: '#847e6e', line: '#e3d9ca', accent: '#c26f56', olive: '#6b6f4e', cut: '#e5007d', soft: '#f1ebe1', craie: '#f8f5ef' };
  const F = {
    display: '"Playfair Display", Georgia, "Times New Roman", serif',
    body: 'Montserrat, "Helvetica Neue", Arial, sans-serif',
    mono: 'Montserrat, "Helvetica Neue", Arial, sans-serif',
  };
  const A4 = [210, 297], A3 = [297, 420];
  const MARGIN = 12;

  const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(I18n.locale);
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---------- Outils de page (on dessine en millimètres) ----------

  function newPage(w, h) {
    const c = Extract.makeCanvas(w * PX, h * PX);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(PX, PX);
    ctx.textBaseline = 'alphabetic';
    return { c, ctx, w, h };
  }

  function text(ctx, s, x, y, size, opts = {}) {
    ctx.font = `${opts.weight || ''} ${size}px ${opts.font || F.body}`.trim();
    ctx.fillStyle = opts.color || C.ink;
    ctx.textAlign = opts.align || 'left';
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }

  function wrap(ctx, s, x, y, maxW, size, lineH, opts = {}) {
    ctx.font = `${opts.weight || ''} ${size}px ${opts.font || F.body}`.trim();
    const words = s.split(' ');
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) {
        text(ctx, line, x, y, size, opts);
        y += lineH;
        line = w;
      } else line = t;
    }
    if (line) { text(ctx, line, x, y, size, opts); y += lineH; }
    return y;
  }

  // Texte en capitales espacées, centré (style des étiquettes de la charte).
  function spaced(ctx, s, cx, y, size, spacing, font, color) {
    ctx.font = `${size}px ${font}`;
    const widths = [...s].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (s.length - 1);
    let x = cx - total / 2;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    [...s].forEach((ch, i) => { ctx.fillText(ch, x, y); x += widths[i] + spacing; });
  }

  function tinted(img, color) {
    const c = Extract.makeCanvas(img.width, img.height);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = src;
    });
  }

  function chrome(pg, section, n, total) {
    const { ctx, w, h } = pg;
    if (chrome.logo) ctx.drawImage(chrome.logo, MARGIN, 4.6, 7, (7 * chrome.logo.height) / chrome.logo.width);
    text(ctx, tr('ATELIER GRIBOUILLE · GUIDE DE CRÉATION'), MARGIN + 9, 9, 2.2, { font: F.body, color: C.muted });
    text(ctx, section.toUpperCase(), w - MARGIN, 9, 2.4, { font: F.mono, color: C.muted, align: 'right' });
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 0.25;
    ctx.beginPath(); ctx.moveTo(MARGIN, 11.5); ctx.lineTo(w - MARGIN, 11.5); ctx.stroke();
    text(ctx, `${n} / ${total}`, w - MARGIN, h - 6, 2.4, { font: F.mono, color: C.muted, align: 'right' });
  }

  function badge(ctx, n, x, y, r, color) {
    ctx.fillStyle = color || C.ink;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 ${r * 1.05}px ${F.body}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + r * 0.05);
    ctx.textBaseline = 'alphabetic';
  }

  // Petit pictogramme de ciseaux, dessiné (pas de dépendance à une police).
  function scissors(ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.12;
    ctx.beginPath(); ctx.arc(-s * 0.35, -s * 0.28, s * 0.18, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-s * 0.35, s * 0.28, s * 0.18, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.18); ctx.lineTo(s * 0.5, s * 0.22);
    ctx.moveTo(-s * 0.2, s * 0.18); ctx.lineTo(s * 0.5, -s * 0.22);
    ctx.stroke();
    ctx.restore();
  }


  // ---------- Éléments à découper ----------




  // ---------- Construction ----------

  /*
   * opts : { drawings, nameOf(d), numberOf(d), title, styleName, scale, onProgress(text) }
   */
  async function build(comp, opts) {
    const { jsPDF } = window.jspdf;
    if (document.fonts && document.fonts.load) {
      await Promise.all(['400 10px "Playfair Display"', 'italic 400 10px "Playfair Display"', '400 10px Montserrat', '600 10px Montserrat']
        .map((f) => document.fonts.load(f).catch(() => {})));
    }
    const logo = await loadImage('assets/logo-mark@4x.png');
    chrome.logo = logo ? tinted(logo, C.muted) : null;
    const texOwner = new Map();
    opts.drawings.forEach((d) => { if (d.analysis.texture) texOwner.set(d.analysis.texture.canvas, d); });
    const ownerOf = (L) => (L.kind === 'piece' ? L.piece.drawing : texOwner.get(L.src));

    // Étapes dans l'ordre de collage : lambeaux, grandes pages, puis découpes (ordre des calques).
    const scraps = comp.bg.filter((L) => L.scrap);
    const panels = comp.bg.filter((L) => L.panel);
    const steps = [];
    if (scraps.length) steps.push({ kind: 'scraps', layers: scraps });
    panels.forEach((L) => steps.push({ kind: 'panel', layer: L }));
    comp.items.forEach((L) => steps.push({ kind: 'piece', layer: L }));
    steps.forEach((st, i) => { st.n = i + 1; });


    // ---- Fiches de découpe : une par dessin original, avec les traits de coupe et les cotes ----
    opts.onProgress && opts.onProgress(tr('Préparation des fiches de découpe…'));
    const fiches = []; // { d, layers: [{ st, L }] }
    const ficheOf = new Map();
    steps.forEach((st) => {
      if (st.kind === 'scraps') return;
      const d = ownerOf(st.layer);
      if (!d) return;
      if (!ficheOf.has(d)) { ficheOf.set(d, { d, layers: [] }); fiches.push(ficheOf.get(d)); }
      ficheOf.get(d).layers.push({ st, L: st.layer });
    });
    fiches.sort((x, y) => opts.numberOf(x.d) - opts.numberOf(y.d));
    fiches.forEach((f, i) => { f.n = i + 1; f.layers.forEach(({ st }) => { st.sheet = i + 1; }); });
    const sheets = fiches;

    // ---- Pages ----
    const pages = [];
    const baseThumb = (() => {
      const s = 6; // px par cm pour la miniature
      const c = Extract.makeCanvas(comp.W * s, comp.H * s);
      const x2 = c.getContext('2d');
      Compose.renderBg(x2, comp, s, false);
      Compose.renderItems(x2, comp, s, false);
      return c;
    })();

    // Couverture
    {
      const pg = newPage(...A4);
      const { ctx } = pg;
      const mid = A4[0] / 2;
      ctx.fillStyle = C.craie;
      ctx.fillRect(0, 0, A4[0], A4[1]);
      // logo complet de la charte
      if (logo) {
        const lw = 30, lh = (lw * logo.height) / logo.width;
        ctx.drawImage(tinted(logo, C.ink), mid - lw / 2, 15, lw, lh);
      }
      spaced(ctx, 'ATELIER', mid, 48, 3.4, 2.2, F.body, C.ink);
      text(ctx, 'Gribouille', mid, 61, 14, { font: F.display, align: 'center' });
      spaced(ctx, tr('LES DESSINS D’ENFANTS DEVIENNENT DES ŒUVRES D’ART'), mid, 68, 2.1, 0.9, F.body, C.ink);
      ctx.fillStyle = C.ink;
      ctx.fillRect(mid - 6, 73, 12, 0.25);
      text(ctx, tr('Guide de création'), mid, 84, 8, { font: F.display, weight: 'italic', align: 'center' });
      if (opts.title) text(ctx, `« ${opts.title} »`, mid, 92, 4.6, { font: F.display, weight: 'italic', align: 'center', color: C.accent });
      const iw = Math.min(128, (88 * comp.W) / comp.H), ih = iw * comp.H / comp.W;
      ctx.save();
      ctx.shadowColor = 'rgba(59,58,42,0.3)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.2;
      ctx.drawImage(baseThumb, mid - iw / 2, 98, iw, ih);
      ctx.restore();
      let yy = 98 + ih + 10;
      const nPieces = comp.items.length, nPanels = panels.length;
      const facts = [
        tr`${opts.styleName} · toile de ${fmt(comp.W)} × ${fmt(comp.H)} cm`,
        tr`${opts.drawings.length} dessins originaux, à taille réelle · ${nPanels} pages de fond · ${nPieces} découpes${scraps.length ? tr` · ${scraps.length} lambeaux` : ''}`,
        tr`${sheets.length} fiches de découpe · ${steps.length} étapes de collage`,
      ];
      if (opts.aside && opts.aside.length) facts.push(tr`${opts.aside.length} feuille${opts.aside.length > 1 ? 's' : ''} pâle${opts.aside.length > 1 ? 's' : ''} mise${opts.aside.length > 1 ? 's' : ''} de côté, non utilisée${opts.aside.length > 1 ? 's' : ''} : dessins n° ${opts.aside.join(', ')}`);
      facts.forEach((f) => { text(ctx, f, mid, yy, 3.1, { font: F.body, color: C.ink, align: 'center' }); yy += 5; });
      yy += 6;
      const colW = (A4[0] - 2 * MARGIN - 10) / 2;
      text(ctx, tr('Matériel'), MARGIN, yy, 5, { font: F.display });
      text(ctx, tr('Mode d’emploi'), MARGIN + colW + 10, yy, 5, { font: F.display });
      let y1 = yy + 7, y2 = yy + 7;
      [
        tr`Une toile ou un carton de ${fmt(comp.W)} × ${fmt(comp.H)} cm`,
        tr('Les dessins originaux, et ce guide imprimé (format libre)'),
        tr('Ciseaux fins et cutter, tapis de coupe'),
        tr('Colle vinylique ou vernis-colle (type Mod Podge), pinceau plat'),
        tr('Crayon à papier, règle d’un mètre, gomme'),
        tr('Vernis mat pour protéger l’œuvre (facultatif)'),
      ].forEach((m) => { y1 = wrap(ctx, '·  ' + m, MARGIN, y1, colW, 3, 4.2); y1 += 0.8; });
      [
        comp.lead ? tr('1. Peignez toute la toile en noir (acrylique), laissez sécher, puis tracez légèrement la grille de 10 cm du plan de pose au crayon blanc.')
          : comp.groundName ? tr`1. Peignez toute la toile en aplat, acrylique « ${comp.groundName} » (deux couches, rouleau mousse ou brosse large), laissez sécher, puis tracez légèrement la grille de 10 cm du plan de pose au crayon.`
          : tr('1. Tracez légèrement au crayon la grille de 10 cm du plan de pose sur la toile. Si un peu de toile reste nue sur le plan, peignez-la d’abord d’une couleur unie.'),
        tr('2. Pour chaque dessin, reportez sur l’original le trait magenta de sa fiche, à l’aide des cotes en cm, puis découpez ; gardez chaque morceau avec son numéro.'),
        scraps.length ? tr('3. Déchirez les chutes des pages de fond trop grandes en lambeaux, sans rien jeter.') : panels.length ? tr('3. Les pages de fond se collent entières, sans découpe : elles se chevauchent, et ce qui dépasse se rogne une fois collé.') : tr('3. Cette œuvre ne comporte pas de page de fond : la toile reste blanche entre les découpes.'),
        tr('4. Collez dans l’ordre des étapes : d’abord le fond, puis les découpes, du numéro 1 au dernier. Un papier qui dépasse de la toile se replie sur la tranche ou se rogne au cutter.'),
        comp.lead ? tr`5. Une fois les pages de fond collées et sèches, peignez un trait noir de ${fmt(comp.lead * 10)} mm le long des bords de chaque page (le plomb du vitrail), avant de coller les découpes.` : null,
        comp.frames ? tr`5. Tracez au feutre noir fin (ou à la peinture, au pinceau fin) le cadre carré de chaque case, ${fmt((comp.frameWidth || 0.3) * 10)} mm d’épaisseur, d’après le plan de pose, avant de coller les découpes au centre des cases.` : null,
        (comp.lead || comp.frames ? '6' : '5') + tr('. Laissez sécher sous un poids, puis passez une couche de vernis.'),
      ].filter(Boolean).forEach((m) => { y2 = wrap(ctx, m, MARGIN + colW + 10, y2, colW, 3, 4.2); y2 += 0.8; });
      let y3 = Math.max(y1, y2) + 4;
      y3 = wrap(ctx, comp.reduced
        ? tr`Galerie : cette œuvre est destinée à l’impression. Les dessins sont réduits pour tenir dans leurs cases (jamais agrandis) ; les cotes des fiches de découpe correspondent aux originaux, pas à l’impression. Imprimez l’œuvre (PDF ou image) à ${fmt(comp.W)} × ${fmt(comp.H)} cm.`
        : tr`L’œuvre est composée avec les dessins à leur taille réelle : rien n’est réduit ni agrandi, et chaque dessin n’est utilisé qu’une fois. Les fiches de découpe montrent chaque original avec son trait de coupe et ses cotes ; la toile de ${fmt(comp.W)} × ${fmt(comp.H)} cm est dimensionnée d’après le papier disponible.`, MARGIN, y3, A4[0] - 2 * MARGIN, 2.8, 3.9, { color: C.muted });
      pages.push({ pg, section: 'Couverture' });
    }

    // Plan de pose
    {
      const pg = newPage(A4[1], A4[0]); // paysage
      const { ctx, w, h } = pg;
      text(ctx, tr('Plan de pose'), MARGIN, 22, 7, { font: F.display });
      text(ctx, tr('Tracez cette grille de 10 cm au crayon sur la toile. Chaque numéro indique le centre d’un élément et son ordre de collage.'), MARGIN, 29, 3, { color: C.muted });
      const top = 38, left = MARGIN + 6;
      const sc = Math.min((w - left - MARGIN) / comp.W, (h - top - 14) / comp.H); // mm par cm
      const iw = comp.W * sc, ih = comp.H * sc;
      ctx.drawImage(baseThumb, left, top, iw, ih);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(left, top, iw, ih);
      ctx.strokeStyle = 'rgba(28,26,33,0.55)';
      ctx.lineWidth = 0.25;
      for (let gx = 0; gx <= comp.W + 0.01; gx += 10) {
        ctx.beginPath(); ctx.moveTo(left + gx * sc, top); ctx.lineTo(left + gx * sc, top + ih); ctx.stroke();
        if (gx < comp.W) text(ctx, String.fromCharCode(65 + gx / 10), left + (gx + 5) * sc, top - 2, 2.6, { font: F.mono, align: 'center', color: C.muted });
      }
      for (let gy = 0; gy <= comp.H + 0.01; gy += 10) {
        ctx.beginPath(); ctx.moveTo(left, top + gy * sc); ctx.lineTo(left + iw, top + gy * sc); ctx.stroke();
        if (gy < comp.H) text(ctx, String(gy / 10 + 1), left - 2.5, top + (gy + 5) * sc + 1, 2.6, { font: F.mono, align: 'right', color: C.muted });
      }
      steps.forEach((st) => {
        if (st.kind === 'scraps') return;
        const L = st.layer;
        badge(ctx, st.n, left + L.x * sc, top + L.y * sc, 2.1, st.kind === 'panel' ? C.olive : C.accent);
      });
      text(ctx, tr('● pages de fond   ● découpes'), MARGIN, h - 7, 2.6, { font: F.mono, color: C.muted });
      pages.push({ pg, section: tr('Plan de pose') });
    }

    // Étapes de collage : 6 cartes par page
    const cellName = (cx, cy) => `${String.fromCharCode(65 + Math.floor(cx / 10))}${Math.floor(cy / 10) + 1}`;
    for (let i = 0; i < steps.length; i += 6) {
      const pg = newPage(...A4);
      const { ctx } = pg;
      text(ctx, tr('Étapes de collage'), MARGIN, 22, 7, { font: F.display });
      text(ctx, tr('Du fond vers le dessus. Chaque carte montre où poser l’élément (en couleur) sur l’œuvre.'), MARGIN, 29, 3, { color: C.muted });
      steps.slice(i, i + 6).forEach((st, j) => {
        const cw = (A4[0] - 2 * MARGIN - 8) / 2, ch = 82;
        const x0 = MARGIN + (j % 2) * (cw + 8), y0 = 35 + Math.floor(j / 2) * (ch + 4);
        ctx.strokeStyle = C.line; ctx.lineWidth = 0.3;
        ctx.strokeRect(x0, y0, cw, ch);
        // mini-carte : l'œuvre estompée, l'élément de l'étape en couleur
        const mw = cw - 8, mh = Math.min(mw * comp.H / comp.W, 54);
        const s = 8;
        const map = Extract.makeCanvas(comp.W * s, comp.H * s);
        const mx = map.getContext('2d');
        mx.drawImage(baseThumb, 0, 0, map.width, map.height);
        mx.fillStyle = 'rgba(255,255,255,0.72)';
        mx.fillRect(0, 0, map.width, map.height);
        const layers = st.kind === 'scraps' ? st.layers : [st.layer];
        layers.forEach((L) => Compose.drawLayer(mx, L, s, false));
        if (st.kind !== 'scraps') {
          const L = st.layer;
          mx.save();
          mx.translate(L.x * s, L.y * s); mx.rotate(L.rot);
          mx.strokeStyle = C.cut; mx.lineWidth = 3; mx.setLineDash([8, 5]);
          mx.strokeRect((-L.w / 2) * s - 3, (-L.h / 2) * s - 3, L.w * s + 6, L.h * s + 6);
          mx.restore();
        }
        const dw = mh * comp.W / comp.H, dx = x0 + (cw - dw) / 2;
        ctx.drawImage(map, dx, y0 + 4, dw, mh);
        ctx.strokeStyle = C.line; ctx.strokeRect(dx, y0 + 4, dw, mh);
        let ty = y0 + 4 + mh + 6;
        badge(ctx, st.n, x0 + 7.5, ty - 1.2, 3, st.kind === 'piece' ? C.accent : C.olive);
        if (st.kind === 'scraps') {
          text(ctx, tr('Lambeaux de fond'), x0 + 13, ty, 3.8, { weight: '600' });
          const srcs = [...new Set(st.layers.map((L) => ownerOf(L)).filter(Boolean))].map((d) => opts.numberOf(d));
          ty += 5;
          ty = wrap(ctx, tr`Après avoir découpé les grands morceaux des pages de fond (étapes ${steps.filter((q) => q.kind === 'panel').map((q) => q.n).slice(0, 1)} à ${steps.filter((q) => q.kind === 'panel').map((q) => q.n).slice(-1)}), déchirez leurs chutes hachurées en morceaux de 3 à 7 cm et collez-les dans les zones en couleur ci-dessus (${st.layers.length} lambeaux, dessins ${srcs.join(', ')}). Pas besoin de précision : ce fond sera en partie recouvert.`, x0 + 4, ty, cw - 8, 2.8, 3.8, { color: C.ink });
          return;
        }
        const L = st.layer;
        const d = ownerOf(L);
        const name = d ? opts.nameOf(d) : tr('Élément');
        text(ctx, name.length > 34 ? name.slice(0, 33) + '…' : name, x0 + 13, ty, 3.8, { weight: '600' });
        ty += 5;
        const where = `fiche ${st.sheet}`;
        text(ctx, tr`${st.kind === 'panel' ? tr('Page de fond') : tr('Découpe')} · dessin ${d ? opts.numberOf(d) : '?'} · ${where}`, x0 + 4, ty, 2.8, { color: C.muted });
        ty += 4.4;
        text(ctx, tr`Case ${cellName(L.x, L.y)} · centre à ${fmt(L.x)} cm de la gauche,`, x0 + 4, ty, 2.7, { font: F.mono });
        ty += 3.9;
        text(ctx, tr`${fmt(L.y)} cm du haut`, x0 + 4, ty, 2.7, { font: F.mono });
        ty += 3.9;
        const deg = Math.round((L.rot * 180) / Math.PI);
        const rot = Math.abs(deg) < 1 ? tr('Bien droit') : tr`Tourné de ${Math.abs(deg)}° vers la ${deg > 0 ? tr('droite') : tr('gauche')}`;
        text(ctx, rot + (L.flip ? tr(' · en miroir') : ''), x0 + 4, ty, 2.7, { font: F.mono });
      });
      pages.push({ pg, section: tr('Étapes de collage') });
      opts.onProgress && opts.onProgress(tr`Étapes de collage… ${Math.min(i + 6, steps.length)} / ${steps.length}`);
      await tick();
    }

    // Fiches de découpe : l'original avec ses traits de coupe et ses cotes en cm
    for (let fi = 0; fi < fiches.length; fi++) {
      const f = fiches[fi];
      const d = f.d;
      const page = d.analysis.page;
      const cmPx = d.sizeCm / d.srcLong; // cm par pixel de page
      const pw = page.width * cmPx, ph = page.height * cmPx; // taille réelle de la feuille
      const land = pw > ph * 1.15;
      const pg = newPage(land ? A4[1] : A4[0], land ? A4[0] : A4[1]);
      const { ctx, w, h } = pg;
      text(ctx, `Fiche ${f.n}`, MARGIN, 19, 5, { font: F.display });
      scissors(ctx, MARGIN + 24, 17.5, 5, C.cut);
      const turned = d.orientDeg ? tr` · original tourné de ${d.orientDeg}° (le haut du scan est ${d.orientDeg === 90 ? tr('à droite') : d.orientDeg === 180 ? tr('en bas') : tr('à gauche')})` : '';
      text(ctx, tr`${opts.nameOf(d)} · dessin ${opts.numberOf(d)} · feuille de ${fmt(pw)} × ${fmt(ph)} cm${turned}${d.original && d.photoMode === 'auto' ? tr(' · photo détourée (sol ou table retiré)') : ''}`, MARGIN + 30, 19, 2.8, { color: C.muted });
      // l'original, ajusté à la page (ce n'est pas à l'échelle : les cotes font foi)
      const top = 26, bottom = h - 34;
      const sc = Math.min((w - 2 * MARGIN - 14) / pw, (bottom - top) / ph); // mm par cm
      const ox = MARGIN + 10, oy = top;
      ctx.drawImage(page, ox, oy, pw * sc, ph * sc);
      ctx.strokeStyle = C.line; ctx.lineWidth = 0.25;
      ctx.strokeRect(ox, oy, pw * sc, ph * sc);
      // règle de la feuille : graduations tous les 5 cm sur le bord gauche et le haut
      ctx.strokeStyle = C.muted; ctx.lineWidth = 0.2;
      for (let g = 0; g <= pw + 0.01; g += 5) {
        ctx.beginPath(); ctx.moveTo(ox + g * sc, oy - 1.5); ctx.lineTo(ox + g * sc, oy - (g % 10 === 0 ? 3.5 : 2.2)); ctx.stroke();
        if (g % 10 === 0) text(ctx, String(g), ox + g * sc, oy - 4.2, 2, { align: 'center', color: C.muted });
      }
      for (let g = 0; g <= ph + 0.01; g += 5) {
        ctx.beginPath(); ctx.moveTo(ox - 1.5, oy + g * sc); ctx.lineTo(ox - (g % 10 === 0 ? 3.5 : 2.2), oy + g * sc); ctx.stroke();
        if (g % 10 === 0) text(ctx, String(g), ox - 4.5, oy + g * sc + 0.7, 2, { align: 'right', color: C.muted });
      }
      // traits de coupe, avec numéro d'étape et cotes
      const notes = [];
      f.layers.forEach(({ st, L }) => {
        const isPanel = st.kind === 'panel';
        let path, box;
        if (isPanel && L.whole) {
          // page collée entière : aucun trait de coupe, juste un liseré olive discret
          box = { x: L.sx * cmPx, y: L.sy * cmPx, w: L.sw * cmPx, h: L.sh * cmPx };
          ctx.save(); ctx.setLineDash([2, 2]); ctx.strokeStyle = C.olive; ctx.lineWidth = 0.8;
          ctx.strokeRect(ox + box.x * sc + 0.6, oy + box.y * sc + 0.6, box.w * sc - 1.2, box.h * sc - 1.2); ctx.restore();
        } else if (isPanel) {
          const cx = ox + (L.sx + L.sw / 2) * cmPx * sc, cy = oy + (L.sy + L.sh / 2) * cmPx * sc;
          path = (L.clip || [[-L.w / 2, -L.h / 2], [L.w / 2, -L.h / 2], [L.w / 2, L.h / 2], [-L.w / 2, L.h / 2]]).map(([px, py]) => [cx + px * sc, cy + py * sc]);
          box = { x: L.sx * cmPx, y: L.sy * cmPx, w: L.sw * cmPx, h: L.sh * cmPx };
        } else {
          const src = L.piece.src;
          box = { x: src.x * cmPx, y: src.y * cmPx, w: src.w * cmPx, h: src.h * cmPx };
          // contour de la découpe : silhouette de la pièce, tracée à partir de son masque
          const hm = L.piece.hit;
          const sil = Extract.makeCanvas(hm.w, hm.h);
          const sd = sil.getContext('2d').createImageData(hm.w, hm.h);
          for (let i = 0; i < hm.data.length; i++) sd.data[i * 4 + 3] = hm.data[i] ? 255 : 0;
          sil.getContext('2d').putImageData(sd, 0, 0);
          const dw = box.w * sc, dh = box.h * sc;
          const off = Extract.makeCanvas(Math.ceil(dw * PX) + 12, Math.ceil(dh * PX) + 12);
          const oc = off.getContext('2d');
          oc.imageSmoothingEnabled = false;
          // liseré : la silhouette décalée dans toutes les directions, en magenta, puis évidée
          for (let kk = 0; kk < 24; kk++) {
            const a2 = (kk / 24) * Math.PI * 2;
            oc.drawImage(sil, 6 + Math.cos(a2) * 4, 6 + Math.sin(a2) * 4, dw * PX, dh * PX);
          }
          oc.globalCompositeOperation = 'source-in'; oc.fillStyle = C.cut; oc.fillRect(0, 0, off.width, off.height);
          oc.globalCompositeOperation = 'destination-out'; oc.drawImage(sil, 6, 6, dw * PX, dh * PX);
          ctx.drawImage(off, ox + box.x * sc - 6 / PX, oy + box.y * sc - 6 / PX, off.width / PX, off.height / PX);
        }
        if (path) {
          ctx.lineJoin = 'round';
          [['#ffffff', 2.2], [C.cut, 1.1]].forEach(([col, lw]) => {
            ctx.beginPath(); path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
            ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
          });
        }
        badge(ctx, st.n, ox + box.x * sc + 3.5, oy + box.y * sc + 3.5, 2.8, isPanel ? C.olive : C.accent);
        const dims = tr`${fmt(box.w)} × ${fmt(box.h)} cm, à ${fmt(box.x)} cm du bord gauche et ${fmt(box.y)} cm du haut`;
        notes.push(`${st.n}  ${isPanel ? (L.whole ? tr('Page de fond entière, sans découpe') : tr('Grand morceau de fond')) : tr('Découpe')} : ${dims}${isPanel && !L.whole ? tr(' — le reste de la feuille est déchiré en lambeaux (étape 1)') : ''}.`);
      });
      let ny = bottom + 5;
      notes.forEach((n) => { ny = wrap(ctx, n, MARGIN, ny, w - 2 * MARGIN, 2.7, 3.7); });
      pages.push({ pg, section: tr('Fiches de découpe') });
      if (fi % 3 === 2) { opts.onProgress && opts.onProgress(tr`Fiches de découpe… ${fi + 1} / ${fiches.length}`); await tick(); }
    }

    // ---- PDF ----
    opts.onProgress && opts.onProgress(tr('Assemblage du PDF…'));
    let doc = null;
    for (let i = 0; i < pages.length; i++) {
      const { pg, section } = pages[i];
      chrome(pg, section, i + 1, pages.length);
      const land = pg.w > pg.h;
      const size = [pg.w, pg.h];
      if (!doc) doc = new jsPDF({ unit: 'mm', format: size, orientation: land ? 'landscape' : 'portrait', compress: true });
      else doc.addPage(size, land ? 'landscape' : 'portrait');
      doc.addImage(pg.c.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, pg.w, pg.h, undefined, 'FAST');
      if (i % 4 === 3) await tick();
    }
    doc.setProperties({ title: tr`Guide de création${opts.title ? ` — ${opts.title}` : ''}`, creator: 'Atelier Gribouille' });
    return { blob: doc.output('blob'), pages: pages.length, sheets: sheets.length, steps: steps.length };
  }

  window.Guide = { build };
})();
