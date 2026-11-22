/*
 * Prise de photo des dessins depuis l'atelier.
 *
 * L'appareil photo du téléphone (ou la webcam) s'ouvre dans l'atelier ; pendant la visée, chaque
 * image est analysée sur un seul point : l'éclairage (lumière égale, sans ombre ni lampe, papier
 * assez clair, sans reflets) ; l'écran ne donne qu'une consigne à la fois, avec le contour de la
 * feuille en vert, orange ou rouge quand elle est trouvée ; tant que la consigne est rouge, le déclencheur
 * est grisé (pas de photo). La photo prise est jugée de la même façon :
 * bonne ou correcte, elle est gardée d'office (« Annuler » la retire) ; à reprendre, elle s'affiche
 * avec la raison, « Reprendre » ou « Garder quand même ». « Importer » fait entrer les photos gardées
 * dans l'atelier comme des fichiers importés. Rien ne quitte l'appareil.
 *
 * Les mesures sont celles de l'atelier : `Extract.findSheet` (la feuille, pour mesurer la lumière
 * sur le papier plutôt que sur la table) et `Quality.lighting` (mêmes seuils qu'à l'import).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const tr = window.tr || ((s) => s);
  const LIVE_MAX = 960;   // définition de l'image analysée pendant la visée
  const CHECK_MAX = 2000; // définition de l'image analysée après la prise
  // le cadre en pointillé de la visée : 12 % de marge de chaque côté de l'image de la vidéo ; rien de
  // ce qui en sort n'est gardé — la visée n'analyse que l'intérieur, et la photo y est recadrée
  const FRAME_INSET = 0.12;

  let S = null; // séance en cours : { stream, facing, shots, timer, busy, review, onDone, onError }

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;

  // ---------- Jugement d'une image ----------

  // rect : la partie de la source à prendre (toute l'image sans lui)
  function canvasOf(src, maxSide, rect) {
    const r = rect || { x: 0, y: 0, w: src.width || src.videoWidth, h: src.height || src.videoHeight };
    const k = Math.min(1, maxSide / Math.max(r.w, r.h));
    const w = Math.max(1, Math.round(r.w * k)), h = Math.max(1, Math.round(r.h * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, w, h);
    return c;
  }
  // L'intérieur du cadre en pointillé dans une image w × h. La photo de l'appareil (ImageCapture) peut
  // avoir d'autres proportions que la vidéo (le capteur entier) : la vidéo en est la partie centrale,
  // aux proportions vw × vh, et le cadre est pris dans cette partie.
  function frameRect(w, h, vw, vh) {
    let bx = 0, by = 0, bw = w, bh = h;
    if (vw && vh && Math.abs(w / h - vw / vh) > 0.01) {
      if (w / h > vw / vh) { bw = h * (vw / vh); bx = (w - bw) / 2; } else { bh = w * (vh / vw); by = (h - bh) / 2; }
    }
    const x = Math.round(bx + bw * FRAME_INSET), y = Math.round(by + bh * FRAME_INSET);
    return { x, y, w: Math.max(1, Math.round(bw * (1 - 2 * FRAME_INSET))), h: Math.max(1, Math.round(bh * (1 - 2 * FRAME_INSET))) };
  }
  const release = (c) => { if (c && c.width) { c.width = 0; c.height = 0; } };

  /*
   * Juge une image (canevas) sur son éclairage seulement : lumière égale (ni ombre ni lampe) et
   * exposition (papier assez clair, sans reflets), mesurées sur la feuille quand elle est trouvée,
   * sinon sur toute l'image. Rend { level: 'ok' | 'warn' | 'bad', title, points: [{ code, level,
   * text, tip }], quad, found }.
   */
  function check(canvas) {
    const points = [];
    // text : le constat ; tip : le conseil ; say : la consigne courte, affichée seule pendant la visée
    const add = (code, level, text, tip, say) => points.push({ code, level, text, tip: tip || '', say: say || text });
    let sheet = null;
    Extract.findSheet.debug = null;
    try { sheet = Extract.findSheet(canvas); } catch (e) { sheet = null; }
    // pas de feuille blanche : une feuille peinte jusqu'aux bords (posée sur un sol gris), ou un dessin
    // découpé posé sur une surface que l'import sait retirer (métal, moquette, table bordeaux, parquet) ;
    // l'un ou l'autre est « repéré » : pas de « Trop d'objets », la photo est bonne à prendre
    let painted = null, lying = null;
    if (!sheet) {
      try { painted = Extract.paintedSheet ? Extract.paintedSheet(canvas, true) : null; } catch (e) { painted = null; }
      // (sur une image réduite : la visée doit rester fluide)
      if (!painted && Extract.removeSurface) { const sm = Extract.scaleTo(canvas, 360); try { lying = Extract.removeSurface(sm, false, true); } catch (e) { lying = null; } if (sm !== canvas) release(sm); }
    }
    const found = !!(sheet || painted || lying);
    const quad = sheet && sheet.kind === 'sheet' ? sheet.quad : painted ? painted.quad : null;
    // feuille non repérée (fond aussi clair qu'elle, feuille coupée par le cadre) : la découpe
    // risque de prendre la table pour du papier ; on le dit plutôt que « Prêt »
    // (une feuille qui remplit l'image, comme un scan, n'a rien à repérer : la découpe la prend entière)
    const pageFills = (Extract.findSheet.attempts || []).some((a) => a.area >= 0.9);
    // feuille non repérée parce que des objets l'entourent (jouets, trousse, tasse…) : la découpe les
    // prendrait pour des dessins, le résultat ne sera pas bon : pas de photo (rouge, déclencheur grisé).
    // Feuille repérée, les objets autour ne gênent pas : la photo est recadrée sur la feuille
    if (!found && !pageFills && clutter(canvas)) add('objets', 'bad', tr('Trop d’objets autour du dessin'), tr('Dégagez la table : seul le dessin dans le cadre, posé à plat sur une surface unie.'), tr('Trop d’objets : dégagez la table autour du dessin'));
    else if (!found && !pageFills) add('feuille', 'warn', tr('Feuille non repérée'), tr('Posez la feuille entière dans le cadre, à plat, sur une surface plus foncée qu’elle (bois, nappe), sans ombre dessus.'), tr('Feuille non repérée : entière dans le cadre, sur un fond plus foncé'));
    // la lumière se juge sur la feuille ; à défaut, au centre de l'image, là où elle devrait être
    // (pas sur la table autour, souvent mieux éclairée que la feuille sous le téléphone)
    // (un dessin découpé repéré sur la surface : toute l'image, la lumière jugée sur sa silhouette seule)
    const onObject = !quad && lying && lying.mask;
    const region = sheet && sheet.kind === 'sheet' ? sheet.canvas : onObject ? canvas : centreOf(canvas);
    let img = null;
    try { img = Quality.gray(region, 1000); } catch (e) { img = null; }
    // un dessin posé sur une surface grise (métal brossé, moquette, béton) : la lumière se juge sur le
    // papier seul, nettement plus clair que la surface — pas sur la surface, grise comme une ombre
    if (img && lying) {
      const sL = Extract.lum(lying.surface.color);
      for (let i = 0; i < img.g.length; i++) if (img.g[i] < sL + 30) img.neutral[i] = 0;
      // hors de la silhouette du dessin (la table, ses reflets, le sol au bord) : ne compte pas
      if (onObject) {
        const m = lying.mask, mw = lying.w, mh = lying.h;
        for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
          const i = y * img.w + x;
          if (img.neutral[i] && !m[Math.min(mh - 1, Math.floor((y * mh) / img.h)) * mw + Math.min(mw - 1, Math.floor((x * mw) / img.w))]) img.neutral[i] = 0;
        }
      }
    }
    if (img) {
      const l = Quality.lighting(img);
      if (l > Quality.LIGHT.bad) add('lumiere', 'bad', tr('Ombre ou lampe sur la feuille'), tr('Lumière du jour, sans flash ; ne vous placez pas entre la lumière et le dessin.'), tr('Ombre sur la feuille : placez-vous face à la fenêtre'));
      else if (l > Quality.LIGHT.warn) add('lumiere', 'warn', tr('Lumière un peu inégale'), tr('Tournez le dessin vers la fenêtre, éloignez la lampe.'), tr('Lumière inégale : tournez le dessin vers la fenêtre'));
      else if (l === l) add('lumiere', 'ok', tr('Lumière égale'));
      // une ombre locale (la main, le téléphone, une lampe) : une partie de la feuille bien plus sombre.
      // Jugée aussi au centre de l'image entière : une ombre franche coupe la feuille repérée (la
      // partie à l'ombre n'en fait plus partie), le centre de l'image la voit encore
      let sh = Quality.shading(img, onObject ? 0.9 : 0.5);
      if (quad) { const cc = centreOf(canvas); try { sh = Math.max(sh, Quality.shading(Quality.gray(cc, 1000))); } catch (e) { /* ignoré */ } release(cc); }
      if (sh > Quality.SHADE.bad) add('ombre', 'bad', tr('Ombre portée sur la feuille'), tr('Votre main ou le téléphone fait de l’ombre : reculez un peu, ne vous placez pas entre la lumière et le dessin.'), tr('Ombre sur la feuille : reculez, ne cachez pas la lumière'));
      else if (sh > Quality.SHADE.warn) add('ombre', 'warn', tr('Une ombre sur une partie de la feuille'), tr('Reculez un peu, ne vous placez pas entre la lumière et le dessin.'), tr('Ombre sur un coin : reculez un peu'));
      // exposition : clarté du papier, reflets (quand assez de papier est visible)
      const vals = [];
      let clipped = 0;
      for (let i = 0; i < img.g.length; i += 2) if (img.neutral[i]) { vals.push(img.g[i]); if (img.g[i] >= 252) clipped++; }
      if (vals.length > 50) {
        vals.sort((a, b) => a - b);
        const pL = vals[vals.length >> 1], clip = clipped / vals.length;
        if (pL < 140) add('expo', 'bad', tr('Trop sombre'), tr('Plus de lumière : près d’une fenêtre, en journée.'), tr('Trop sombre : plus de lumière, près d’une fenêtre'));
        else if (pL < 175) add('expo', 'warn', tr('Un peu sombre'), tr('Rapprochez le dessin d’une fenêtre.'), tr('Un peu sombre : rapprochez-vous d’une fenêtre'));
        else if (clip > 0.15) add('expo', 'warn', tr('Reflets ou surexposition'), tr('Éloignez la lampe, pas de flash ; évitez les feuilles brillantes face à la fenêtre.'), tr('Reflets : pas de flash, éloignez la lampe'));
        else add('expo', 'ok', tr('Bien exposée'));
      } else if (quad) {
        // une feuille trouvée mais si sombre qu'aucun pixel n'y ressemble à du papier
        add('expo', 'bad', tr('Trop sombre'), tr('Plus de lumière : près d’une fenêtre, en journée.'), tr('Trop sombre : plus de lumière, près d’une fenêtre'));
      }
    }
    if (region !== canvas) release(region);
    const v = verdict(points, quad, found);
    // une découpe repérée sur la surface : sa silhouette, tracée en vert comme le contour d'une feuille
    if (!quad && lying && lying.shape) v.outline = { mask: lying.shape, w: lying.w, h: lying.h };
    else if (sheet && sheet.kind === 'object' && sheet.mask) v.outline = { mask: sheet.mask, w: sheet.w, h: sheet.h };
    return v;
  }
  /*
   * Des objets autour du dessin ? Sur une image réduite (200 px), dans la couronne hors du centre
   * (20 à 80 %) : les plages pleines (pas les traits fins d'un dessin, effacés par une érosion) ni
   * papier (clair et peu saturé) ni de la couleur de la surface (médiane du bord de l'image). Trois
   * objets d'une certaine taille, ou un quart de la couronne couvert, c'est trop.
   */
  function clutter(canvas) {
    const k = Math.min(1, 200 / Math.max(canvas.width, canvas.height));
    const w = Math.max(16, Math.round(canvas.width * k)), h = Math.max(16, Math.round(canvas.height * k)), n = w * h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    release(c);
    // la surface : médiane de chaque couleur sur une bande de 6 % au bord de l'image
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06)), R = [], G = [], B = [];
    for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) {
      if (X >= band && X < w - band && y >= band && y < h - band) continue;
      const i = (y * w + X) * 4; R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]);
    }
    const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    const sR = med(R), sG = med(G), sB = med(B);
    const foreign = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = 0.299 * r + 0.587 * g + 0.114 * b;
      const paper = L > 170 && (mx ? (mx - mn) / mx : 0) < 0.2;
      if (!paper && Math.hypot(r - sR, g - sG, b - sB) > 48) foreign[p] = 1;
    }
    // érosion (rayon 2) : il ne reste que les plages pleines
    const solid = new Uint8Array(n);
    for (let y = 2; y < h - 2; y++) for (let X = 2; X < w - 2; X++) {
      let all = 1;
      for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!foreign[(y + dy) * w + X + dx]) { all = 0; break; }
      solid[y * w + X] = all;
    }
    const inRing = (X, y) => X < w * 0.2 || X >= w * 0.8 || y < h * 0.2 || y >= h * 0.8;
    let ring = 0, covered = 0, objects = 0;
    const seen = new Uint8Array(n), stack = [];
    for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) {
      if (!inRing(X, y)) continue;
      ring++;
      const p = y * w + X;
      if (!solid[p]) continue;
      covered++;
      if (seen[p]) continue;
      // une plage : sa taille (sur toute l'image)
      let area = 0;
      seen[p] = 1; stack.push(p);
      while (stack.length) {
        const q = stack.pop(); area++;
        const qx = q % w, qy = (q - qx) / w;
        if (qx > 0 && solid[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
        if (qx < w - 1 && solid[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
        if (qy > 0 && solid[q - w] && !seen[q - w]) { seen[q - w] = 1; stack.push(q - w); }
        if (qy < h - 1 && solid[q + w] && !seen[q + w]) { seen[q + w] = 1; stack.push(q + w); }
      }
      if (area >= n * 0.004) objects++;
    }
    return objects >= 3 || (ring && covered / ring > 0.25);
  }
  // le centre de l'image (de 15 à 85 % sur chaque axe)
  function centreOf(canvas) {
    const w = canvas.width, h = canvas.height, x0 = Math.round(w * 0.15), y0 = Math.round(h * 0.15), cw = Math.round(w * 0.7), ch = Math.round(h * 0.7);
    const c = document.createElement('canvas');
    c.width = Math.max(8, cw); c.height = Math.max(8, ch);
    c.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, c.width, c.height);
    return c;
  }
  function verdict(points, quad, found) {
    const level = points.some((p) => p.level === 'bad') ? 'bad' : points.some((p) => p.level === 'warn') ? 'warn' : 'ok';
    const title = level === 'ok' ? tr('Photo optimale') : level === 'warn' ? tr('Photo correcte, peut mieux faire') : tr('Photo à reprendre');
    const worst = points.find((p) => p.level === 'bad') || points.find((p) => p.level === 'warn') || null;
    return { level, title, points, quad, found, worst };
  }

  // ---------- Interface ----------

  // une seule consigne à la fois pendant la visée : la plus importante, ou « Prêt »
  function showLive(v) {
    const box = $('camera-verdict');
    box.className = 'camera-verdict ' + v.level;
    box.textContent = v.worst ? v.worst.say : tr('Prêt : prenez la photo');
    box.title = v.worst ? v.worst.tip : '';
  }
  // une photo à reprendre : la raison et le conseil
  function showReview(v) {
    const box = $('camera-verdict');
    box.className = 'camera-verdict ' + v.level;
    box.textContent = v.worst ? `${v.title} : ${v.worst.text.charAt(0).toLowerCase()}${v.worst.text.slice(1)}` : v.title;
    $('camera-tip').textContent = v.worst ? v.worst.tip : '';
  }

  // le cadre en pointillé (toujours là : seul son intérieur est gardé) et le quadrilatère de la feuille
  // quand elle est trouvée, dessinés par-dessus la vidéo (object-fit: contain)
  function drawGuide(v, work, rect) {
    const video = $('camera-video'), g = $('camera-guide');
    const bw = g.clientWidth, bh = g.clientHeight;
    if (!bw || !bh) return;
    if (g.width !== bw || g.height !== bh) { g.width = bw; g.height = bh; }
    const ctx = g.getContext('2d');
    ctx.clearRect(0, 0, bw, bh);
    const vw = video.videoWidth || work.width, vh = video.videoHeight || work.height;
    const k = Math.min(bw / vw, bh / vh), ox = (bw - vw * k) / 2, oy = (bh - vh * k) / 2;
    const r = rect || { x: 0, y: 0, w: vw, h: vh };
    const kw = r.w / work.width; // image analysée (l'intérieur du cadre) → pixels vidéo
    // le cadre : où poser la feuille ; ce qui en sort ne sera pas sur la photo
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + r.x * k, oy + r.y * k, r.w * k, r.h * k);
    ctx.setLineDash([]);
    if (v.quad) {
      ctx.strokeStyle = v.level === 'ok' ? '#3fb66b' : v.level === 'warn' ? '#e0a21a' : '#e04b3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      v.quad.forEach(([x, y], i) => { const X = ox + (r.x + x * kw) * k, Y = oy + (r.y + y * kw) * k; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.closePath();
      ctx.stroke();
    } else if (v.outline) {
      // le bord de la silhouette (pixels du masque qui touchent la surface), point par point
      const { mask: m, w: mw, h: mh } = v.outline;
      const sx = (work.width / mw) * kw * k, sy = (work.height / mh) * kw * k, dot = Math.max(2.5, Math.min(sx, sy) * 1.3);
      ctx.fillStyle = v.level === 'ok' ? '#3fb66b' : v.level === 'warn' ? '#e0a21a' : '#e04b3a';
      for (let y = 1; y < mh - 1; y++) for (let x = 1; x < mw - 1; x++) {
        const p = y * mw + x;
        if (m[p] && (!m[p - 1] || !m[p + 1] || !m[p - mw] || !m[p + mw])) ctx.fillRect(ox + r.x * k + x * sx - dot / 2, oy + r.y * k + y * sy - dot / 2, dot, dot);
      }
    }
  }

  function setMode(review) {
    $('camera-video').hidden = review;
    $('camera-guide').hidden = review;
    $('camera-review').hidden = !review;
    $('camera').classList.toggle('reviewing', review);
    $('camera-tip').textContent = '';
    hideToast();
  }
  // la dernière photo gardée, avec le nombre ; « Importer » quand il y en a
  function updateCount() {
    const n = S ? S.shots.length : 0;
    const last = $('camera-last');
    last.hidden = !n;
    $('camera-count').textContent = String(n);
    const img = last.querySelector('img');
    if (img.src) { URL.revokeObjectURL(img.src); img.removeAttribute('src'); }
    if (n) img.src = URL.createObjectURL(S.shots[n - 1]);
    $('camera-done').textContent = n ? tr`Importer (${n})` : tr('Fermer');
    $('camera-done').title = n ? (n === 1 ? tr('Importer la photo dans l’atelier') : tr`Importer les ${n} photos dans l’atelier`) : '';
    $('camera-done').classList.toggle('btn-primary', n > 0);
  }
  // « ✓ Photo gardée », un instant, avec « Annuler » (la photo gardée d'office est retirée)
  let toastTimer = 0;
  function toast(text) {
    const t = $('camera-toast');
    t.querySelector('span').textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }
  function hideToast() { clearTimeout(toastTimer); if ($('camera-toast')) $('camera-toast').hidden = true; }

  // l'autorisation qui n'arrive jamais (navigateur intégré à une application, demande restée sans
  // réponse) : on n'attend pas sans fin
  const OPEN_WAIT = 20000, FRAME_WAIT = 6000;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms))]);
  // l'image arrive-t-elle ? (readyState et videoWidth restent à zéro tant que la vidéo ne joue pas)
  const waitFrames = (video, ms) => new Promise((res) => { const t0 = Date.now(); (function poll() { if (video.readyState >= 2 && video.videoWidth) return res(true); if (Date.now() - t0 > ms) return res(false); setTimeout(poll, 100); })(); });
  async function startStream() {
    if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
    // téléphone et tablette : 5 Mpx suffisent pour un A4 net (150 dpi) et ménagent la mémoire (4K
    // sur iPhone : images lourdes à chaque analyse de la visée) ; ordinateur : la webcam donne ce qu'elle a
    const phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const want = { video: { facingMode: { ideal: S.facing }, width: { ideal: phone ? 2560 : 3840 }, height: { ideal: phone ? 1920 : 2160 } }, audio: false };
    let stream;
    try { stream = await withTimeout(navigator.mediaDevices.getUserMedia(want), OPEN_WAIT); } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'TimeoutError')) throw e;
      stream = await withTimeout(navigator.mediaDevices.getUserMedia({ video: true, audio: false }), OPEN_WAIT);
    }
    if (!S) { stream.getTracks().forEach((t) => t.stop()); return; }
    S.stream = stream;
    const video = $('camera-video');
    video.srcObject = stream;
    // iPhone : la lecture peut être refusée hors d'un geste (mode économie d'énergie, autorisation
    // demandée plus tôt) ; on le note, et on proposera de la relancer d'un appui
    S.playError = null;
    try { await video.play(); } catch (e) { S.playError = (e && e.name) || 'play'; }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      $('camera-switch').hidden = devs.filter((d) => d.kind === 'videoinput').length < 2;
    } catch (e) { /* ignoré */ }
    await syncFlash();
  }

  // Le flash (la lampe de l'appareil, allumée pendant la visée et la photo) : proposé quand la caméra le
  // permet (torch dans ses capacités : Android ; pas Safari sur iPhone, où l'appareil du téléphone en
  // secours a le sien) ; le choix est mémorisé, et s'éteint avec la caméra
  const flashWanted = () => { try { return localStorage.getItem('atelier.flash') === '1'; } catch (e) { return false; } };
  const flashTrack = () => { const t = S && S.stream && S.stream.getVideoTracks()[0]; if (!t) return null; try { return t.getCapabilities && t.getCapabilities().torch ? t : null; } catch (e) { return null; } };
  async function applyFlash(on) {
    const t = flashTrack();
    if (!t) return false;
    try { await t.applyConstraints({ advanced: [{ torch: !!on }] }); } catch (e) { return false; }
    const b = $('camera-flash');
    b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    return true;
  }
  async function syncFlash() {
    const b = $('camera-flash'), t = flashTrack();
    b.hidden = !t;
    b.classList.remove('on'); b.setAttribute('aria-pressed', 'false');
    if (t && flashWanted()) await applyFlash(true);
  }

  // la visée : une image analysée après l'autre, sans monopoliser l'appareil
  function tick() {
    if (!S || S.review) return;
    const video = $('camera-video');
    if (video.readyState >= 2 && video.videoWidth) {
      const rect = frameRect(video.videoWidth, video.videoHeight);
      const work = canvasOf(video, LIVE_MAX, rect); // (l'intérieur du cadre seulement)
      const v = check(work);
      S.last = v;
      showLive(v);
      setBlocked(v);
      drawGuide(v, work, rect);
      release(work);
    }
    S.timer = setTimeout(tick, 150);
  }

  // Consigne rouge (ombre, lampe, trop sombre) : pas de photo, le déclencheur est grisé ; il revient
  // dès que deux images de suite ne sont plus rouges (pour qu'il ne clignote pas à la limite)
  function setBlocked(v) {
    if (v.level === 'bad') { S.blocked = true; S.okRun = 0; } else if (S.blocked && ++S.okRun >= 2) S.blocked = false;
    const b = $('camera-shoot');
    b.disabled = S.blocked || S.busy;
    b.classList.toggle('blocked', S.blocked);
    const why = v.worst ? v.worst.text.charAt(0).toLowerCase() + v.worst.text.slice(1) : '';
    b.title = S.blocked && why ? tr`Corrigez d’abord : ${why}` : tr('Prendre la photo');
  }

  async function grab() {
    const video = $('camera-video');
    const track = S.stream && S.stream.getVideoTracks()[0];
    // flash allumé : l'image de la vidéo, éclairée par la lampe — la prise de photo de l'appareil
    // (ImageCapture) passe en mode photo et éteint la lampe : la photo sortirait sombre
    const lit = $('camera-flash').getAttribute('aria-pressed') === 'true';
    if (track && window.ImageCapture && !lit) {
      try {
        const blob = await new ImageCapture(track).takePhoto();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        if (c.width >= video.videoWidth) return c;
        release(c);
      } catch (e) { /* appareil sans prise de photo : l'image de la vidéo */ }
    }
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  }

  async function shoot() {
    if (!S || S.busy || S.blocked) return;
    S.busy = true;
    $('camera-shoot').disabled = true;
    try {
      const grabbed = await grab();
      if (!S) { release(grabbed); return; }
      // recadrée sur le cadre en pointillé, à pleine définition : rien de ce qui en sort n'est gardé
      const video = $('camera-video');
      const full = canvasOf(grabbed, Infinity, frameRect(grabbed.width, grabbed.height, video.videoWidth, video.videoHeight));
      release(grabbed);
      const small = canvasOf(full, CHECK_MAX);
      const v = check(small);
      // feuille trouvée (le contour vert) : la photo est la feuille seule, redressée à pleine définition —
      // rien de ce qui dépasse du contour vert n'est gardé ; sinon, l'intérieur du cadre en pointillé
      let shot = full;
      if (v.quad && Extract.warpQuad) {
        const k = full.width / small.width, q = v.quad.map(([x, y]) => [x * k, y * k]);
        const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        let w = Math.max(len(q[0], q[1]), len(q[3], q[2])), h = Math.max(len(q[0], q[3]), len(q[1], q[2]));
        const sc = Math.min(1, Math.max(full.width, full.height) / Math.max(w, h));
        w = Math.max(8, Math.round(w * sc)); h = Math.max(8, Math.round(h * sc));
        try { shot = Extract.warpQuad(full, q, w, h); } catch (e) { shot = full; }
      }
      const blob = await new Promise((res) => shot.toBlob(res, 'image/jpeg', 0.94));
      release(small); release(full); if (shot !== full) release(shot);
      // bonne ou correcte : gardée d'office, la visée continue ; à reprendre : on la montre, avec la raison
      if (v.level !== 'bad') { addShot(blob, v); flash(); toast(v.worst ? tr`✓ Photo gardée — ${v.worst.text.toLowerCase()}` : tr('✓ Photo gardée')); return; }
      S.review = { blob, verdict: v };
      clearTimeout(S.timer);
      const img = $('camera-shot');
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
      setMode(true);
      showReview(v);
    } catch (e) {
      console.error(e);
      if (S && S.onError) S.onError(tr('La photo n’a pas pu être prise. Réessayez, ou importez-la depuis la galerie.'));
    } finally {
      if (S) { S.busy = false; $('camera-shoot').disabled = !!S.blocked; }
    }
  }
  function addShot(blob, v) {
    const n = S.shots.length + 1;
    S.shots.push(new File([blob], `photo-${n}.jpg`, { type: 'image/jpeg' }));
    if (window.Atelier && window.Atelier.track) window.Atelier.track('Photo', { verdict: v.level });
    updateCount();
  }
  // « Garder quand même » une photo à reprendre
  function keep() {
    if (!S || !S.review) return;
    addShot(S.review.blob, S.review.verdict);
    retake();
  }
  function undoLast() {
    if (!S || !S.shots.length) return;
    S.shots.pop();
    updateCount();
    hideToast();
  }
  // un éclair blanc : la photo est prise
  function flash() {
    const st = document.querySelector('.camera-stage');
    st.classList.remove('flash');
    void st.offsetWidth;
    st.classList.add('flash');
  }
  function retake() {
    if (!S) return;
    S.review = null;
    setMode(false);
    tick();
  }

  // Un message dans la visée, avec toujours l'issue de secours : l'appareil photo du téléphone
  // lui-même (champ de fichier avec capture), qui marche partout
  function showError(text, opts) {
    const err = $('camera-error');
    err.hidden = false;
    err.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    err.appendChild(p);
    if (opts && opts.retry) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = tr('Relancer la vidéo');
      b.onclick = async () => {
        if (!S) return;
        const video = $('camera-video');
        try { await video.play(); S.playError = null; } catch (e) { S.playError = (e && e.name) || 'play'; }
        if (await waitFrames(video, 3000)) { err.hidden = true; if (S) tick(); } else showError(noFramesText(), { retry: true });
      };
      err.appendChild(b);
    }
    const n = document.createElement('button');
    n.type = 'button'; n.className = 'btn btn-primary'; n.id = 'camera-native-open';
    n.innerHTML = '<svg class="ico"><use href="#i-camera"/></svg><span></span>';
    n.querySelector('span').textContent = tr('Prendre la photo avec l’appareil du téléphone');
    n.onclick = () => $('camera-native').click();
    err.appendChild(n);
  }
  const noFramesText = () => tr`L’image de l’appareil photo n’arrive pas${S && S.playError ? ` (${S.playError})` : ''}. Sur iPhone, cela arrive en mode économie d’énergie, ou quand la caméra est déjà utilisée par une autre application.`;

  async function open(opts) {
    if (S) return;
    S = { stream: null, facing: 'environment', shots: [], timer: null, busy: false, blocked: false, okRun: 0, review: null, last: null, onDone: opts && opts.onDone, onError: opts && opts.onError };
    const root = $('camera');
    root.hidden = false;
    $('camera-error').hidden = true;
    $('camera-tip').textContent = '';
    $('camera-verdict').className = 'camera-verdict';
    $('camera-verdict').textContent = tr('Ouverture de l’appareil photo…');
    setMode(false);
    updateCount();
    try {
      await startStream();
      if (S) tick();
      // la caméra est ouverte mais rien ne s'affiche : on le dit, avec de quoi s'en sortir
      if (S && !(await waitFrames($('camera-video'), FRAME_WAIT)) && S && !S.review) { $('camera-verdict').textContent = ''; showError(noFramesText(), { retry: true }); }
    } catch (e) {
      console.error(e);
      if (!S) return;
      $('camera-verdict').textContent = '';
      showError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? tr('L’accès à l’appareil photo a été refusé. Autorisez-le dans les réglages du navigateur, ou importez des photos depuis la galerie.')
        : e && e.name === 'TimeoutError'
          ? tr('L’appareil photo ne répond pas (l’autorisation n’a pas été donnée ?). Vous pouvez prendre la photo avec l’appareil du téléphone, ou l’importer depuis la galerie.')
          : tr('Aucun appareil photo disponible. Importez des photos depuis la galerie.'));
    }
  }
  function close() {
    if (!S) return;
    const s = S;
    S = null;
    clearTimeout(s.timer);
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    const video = $('camera-video');
    video.pause();
    video.srcObject = null;
    const img = $('camera-shot');
    if (img.src) { URL.revokeObjectURL(img.src); img.removeAttribute('src'); }
    const th = $('camera-last').querySelector('img');
    if (th.src) { URL.revokeObjectURL(th.src); th.removeAttribute('src'); }
    hideToast();
    $('camera').hidden = true;
    if (s.onDone) s.onDone(s.shots);
  }

  function init() {
    if (!$('camera')) return;
    $('camera-shoot').addEventListener('click', shoot);
    $('camera-keep').addEventListener('click', keep);
    $('camera-retake').addEventListener('click', retake);
    $('camera-done').addEventListener('click', close);
    $('camera-undo').addEventListener('click', undoLast);
    // l'appareil photo du téléphone (hors navigateur) : les photos prises sont gardées et importées
    $('camera-native').addEventListener('change', () => {
      const files = [...$('camera-native').files];
      $('camera-native').value = '';
      if (!S || !files.length) return;
      files.forEach((f) => S.shots.push(new File([f], `photo-${S.shots.length + 1}.jpg`, { type: f.type || 'image/jpeg' })));
      close();
    });
    $('camera-flash').addEventListener('click', async () => {
      if (!S) return;
      const on = $('camera-flash').getAttribute('aria-pressed') !== 'true';
      if (await applyFlash(on)) { try { localStorage.setItem('atelier.flash', on ? '1' : '0'); } catch (e) { /* ignoré */ } }
    });
    $('camera-switch').addEventListener('click', async () => {
      if (!S) return;
      S.facing = S.facing === 'environment' ? 'user' : 'environment';
      try { await startStream(); } catch (e) { /* on garde la caméra en cours */ }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S && !$('camera').hidden) close(); });
    window.addEventListener('pagehide', () => { if (S) { const s = S; S = null; clearTimeout(s.timer); if (s.stream) s.stream.getTracks().forEach((t) => t.stop()); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Camera = { supported, open, close, check, frameRect, shots: () => (S ? S.shots.length : 0) };
})();
