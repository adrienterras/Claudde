/*
 * Prise de photo des dessins depuis l'atelier.
 *
 * L'appareil photo du téléphone (ou la webcam) s'ouvre dans l'atelier ; pendant la visée, chaque
 * image est analysée et l'écran dit si la photo sera bonne : feuille trouvée et bien cadrée,
 * téléphone parallèle à la feuille, netteté, lumière égale et suffisante. La photo prise est
 * jugée de la même façon, en pleine définition ; on la garde ou on la reprend, puis les photos
 * gardées entrent dans l'atelier comme des fichiers importés. Rien ne quitte l'appareil.
 *
 * Les mesures sont celles de l'atelier : `Extract.findSheet` (la feuille et son quadrilatère),
 * `Quality.sharpness` et `Quality.lighting` (netteté et éclairage, mêmes seuils qu'à l'import).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const tr = window.tr || ((s) => s);
  const LIVE_MAX = 960;   // définition de l'image analysée pendant la visée
  const CHECK_MAX = 2000; // définition de l'image analysée après la prise
  const PX_WARN = 1640;   // grand côté de la feuille en pixels : 140 dpi pour une feuille A4
  const PX_BAD = 1170;    // 100 dpi

  let S = null; // séance en cours : { stream, facing, shots, timer, busy, review, onDone, onError }

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;

  // ---------- Jugement d'une image ----------

  function canvasOf(src, maxSide) {
    const k = Math.min(1, maxSide / Math.max(src.width || src.videoWidth, src.height || src.videoHeight));
    const w = Math.max(1, Math.round((src.width || src.videoWidth) * k)), h = Math.max(1, Math.round((src.height || src.videoHeight) * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    return c;
  }
  const release = (c) => { if (c && c.width) { c.width = 0; c.height = 0; } };

  /*
   * Juge une image (canevas). opts.k : facteur entre l'image jugée et la photo réelle (définition).
   * Rend { level: 'ok' | 'warn' | 'bad', title, points: [{ code, level, text, tip }], quad, found }.
   */
  function check(canvas, opts) {
    const o = opts || {};
    const points = [];
    const add = (code, level, text, tip) => points.push({ code, level, text, tip: tip || '' });
    const W = canvas.width, H = canvas.height, n = W * H;
    let sheet = null;
    Extract.findSheet.debug = null;
    try { sheet = Extract.findSheet(canvas); } catch (e) { sheet = null; }
    const dbg = Extract.findSheet.debug || {};
    if (!sheet) {
      if (dbg.area > 0.9 || dbg.nearCorner >= 3) add('cadre', 'bad', tr('Feuille coupée par le bord'), tr('Reculez un peu : laissez une marge de fond tout autour de la feuille.'));
      else add('feuille', 'bad', tr('Feuille non trouvée'), tr('Posez le dessin à plat sur un fond uni (table, parquet, drap foncé) qui contraste avec le papier, et éclairez-le.'));
      return verdict(points, null, false);
    }
    let quad = null, region = canvas;
    if (sheet.kind === 'sheet') {
      quad = sheet.quad;
      region = sheet.canvas;
      add('feuille', 'ok', tr('Feuille trouvée'));
      // cadrage : la feuille assez grande dans l'image, sans toucher le bord
      const area = polyArea(quad) / n;
      const m = 0.015 * Math.max(W, H);
      const edge = quad.some(([x, y]) => x < m || y < m || x > W - m || y > H - m);
      if (edge) add('cadre', 'warn', tr('Feuille au bord de l’image'), tr('Laissez une marge de fond tout autour de la feuille.'));
      else if (area < 0.12) add('cadre', 'bad', tr('Feuille trop petite dans l’image'), tr('Rapprochez-vous : la feuille doit remplir une bonne partie de l’écran.'));
      else if (area < 0.22) add('cadre', 'warn', tr('Rapprochez-vous un peu'), tr('Plus la feuille remplit l’écran, plus le dessin sera net.'));
      else add('cadre', 'ok', tr('Bien cadrée'));
      // à plat : côtés opposés de même longueur, angles droits
      const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const r1 = len(quad[0], quad[1]) / Math.max(1e-6, len(quad[3], quad[2])), r2 = len(quad[0], quad[3]) / Math.max(1e-6, len(quad[1], quad[2]));
      const dev = Math.max(Math.abs(Math.log(r1)), Math.abs(Math.log(r2)));
      let ang = 0;
      for (let i = 0; i < 4; i++) {
        const p = quad[(i + 3) % 4], c = quad[i], q = quad[(i + 1) % 4];
        const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]), a2 = Math.atan2(q[1] - c[1], q[0] - c[0]);
        let d = Math.abs(a1 - a2) * 180 / Math.PI; if (d > 180) d = 360 - d;
        ang = Math.max(ang, Math.abs(d - 90));
      }
      if (dev > 0.18 || ang > 12) add('plat', 'bad', tr('Téléphone incliné'), tr('Tenez le téléphone bien parallèle à la feuille, juste au-dessus du dessin.'));
      else if (dev > 0.08 || ang > 6) add('plat', 'warn', tr('Un peu de perspective'), tr('Redressez le téléphone pour qu’il soit parallèle à la feuille.'));
      else add('plat', 'ok', tr('À plat, bien parallèle'));
    } else {
      add('feuille', 'ok', tr('Dessin trouvé'));
    }
    // netteté, lumière et exposition, mesurées sur la feuille redressée
    let img = null;
    try { img = Quality.gray(region, 1000); } catch (e) { img = null; }
    if (img) {
      // netteté sur la feuille ; si elle offre trop peu de contours francs (petit dessin), sur l'image entière
      let s = Quality.sharpness(img);
      if (!(s === s) && region !== canvas) { try { s = Quality.sharpness(Quality.gray(canvas, 1000)); } catch (e) { s = NaN; } }
      if (s < Quality.SHARP.bad) add('nettete', 'bad', tr('Photo floue'), tr('Touchez le dessin sur l’écran pour faire la mise au point, et tenez le téléphone immobile.'));
      else if (s < Quality.SHARP.warn) add('nettete', 'warn', tr('Netteté moyenne'), tr('Touchez le dessin sur l’écran pour faire la mise au point, essuyez l’objectif.'));
      else if (s === s) add('nettete', 'ok', tr('Nette'));
      const l = Quality.lighting(img);
      if (l > Quality.LIGHT.bad) add('lumiere', 'bad', tr('Ombre ou lampe sur la feuille'), tr('Lumière du jour, sans flash ; ne vous placez pas entre la lumière et le dessin.'));
      else if (l > Quality.LIGHT.warn) add('lumiere', 'warn', tr('Lumière un peu inégale'), tr('Tournez le dessin vers la fenêtre, éloignez la lampe.'));
      else if (l === l) add('lumiere', 'ok', tr('Lumière égale'));
      // exposition : clarté du papier, reflets
      const vals = [];
      let clipped = 0;
      for (let i = 0; i < img.g.length; i += 2) if (img.neutral[i]) { vals.push(img.g[i]); if (img.g[i] >= 252) clipped++; }
      if (vals.length > 50) {
        vals.sort((a, b) => a - b);
        const pL = vals[vals.length >> 1], clip = clipped / vals.length;
        if (pL < 140) add('expo', 'bad', tr('Trop sombre'), tr('Plus de lumière : près d’une fenêtre, en journée.'));
        else if (pL < 175) add('expo', 'warn', tr('Un peu sombre'), tr('Rapprochez le dessin d’une fenêtre.'));
        else if (clip > 0.15) add('expo', 'warn', tr('Reflets ou surexposition'), tr('Éloignez la lampe, pas de flash ; évitez les feuilles brillantes face à la fenêtre.'));
        else add('expo', 'ok', tr('Bien exposée'));
      } else if (img.neutral.length) {
        add('expo', 'bad', tr('Trop sombre'), tr('Plus de lumière : près d’une fenêtre, en journée.'));
      }
    }
    // définition de la photo prise : pixels du grand côté de la feuille, rapportés à la photo réelle
    if (o.full && sheet.kind === 'sheet') {
      const px = Math.max(region.width, region.height) * (o.k || 1);
      if (px < PX_BAD) add('definition', 'bad', tr('Définition trop faible'), tr('Rapprochez-vous, ou utilisez l’appareil photo arrière du téléphone.'));
      else if (px < PX_WARN) add('definition', 'warn', tr('Définition juste'), tr('Rapprochez-vous un peu pour un tirage plus net.'));
      else add('definition', 'ok', tr('Bonne définition'));
    }
    if (region !== canvas) release(region);
    return verdict(points, quad, true);
  }
  function polyArea(q) { let a = 0; for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += p[0] * r[1] - r[0] * p[1]; } return Math.abs(a) / 2; }
  function verdict(points, quad, found) {
    const level = points.some((p) => p.level === 'bad') ? 'bad' : points.some((p) => p.level === 'warn') ? 'warn' : 'ok';
    const title = level === 'ok' ? tr('Photo optimale') : level === 'warn' ? tr('Photo correcte, peut mieux faire') : tr('Photo à reprendre');
    return { level, title, points, quad, found };
  }

  // ---------- Interface ----------

  function showVerdict(v, live) {
    const box = $('camera-verdict'), list = $('camera-points');
    box.className = 'camera-verdict ' + v.level;
    box.textContent = live && v.level === 'ok' ? tr('Tout est bon : prenez la photo') : v.title;
    list.innerHTML = '';
    v.points.forEach((p) => {
      const li = document.createElement('li');
      li.className = p.level;
      li.textContent = p.text;
      li.title = p.tip;
      list.appendChild(li);
    });
    const worst = v.points.find((p) => p.level === 'bad') || v.points.find((p) => p.level === 'warn');
    $('camera-tip').textContent = worst ? worst.tip : '';
  }

  // le quadrilatère de la feuille, dessiné par-dessus la vidéo (object-fit: contain)
  function drawGuide(v, work) {
    const video = $('camera-video'), g = $('camera-guide');
    const bw = g.clientWidth, bh = g.clientHeight;
    if (!bw || !bh) return;
    if (g.width !== bw || g.height !== bh) { g.width = bw; g.height = bh; }
    const ctx = g.getContext('2d');
    ctx.clearRect(0, 0, bw, bh);
    const vw = video.videoWidth || work.width, vh = video.videoHeight || work.height;
    const k = Math.min(bw / vw, bh / vh), ox = (bw - vw * k) / 2, oy = (bh - vh * k) / 2;
    const kw = vw / work.width; // image analysée → pixels vidéo
    if (v.quad) {
      ctx.strokeStyle = v.level === 'ok' ? '#3fb66b' : v.level === 'warn' ? '#e0a21a' : '#e04b3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      v.quad.forEach(([x, y], i) => { const X = ox + x * kw * k, Y = oy + y * kw * k; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.closePath();
      ctx.stroke();
    } else {
      // repère : où poser la feuille
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + vw * k * 0.12, oy + vh * k * 0.12, vw * k * 0.76, vh * k * 0.76);
      ctx.setLineDash([]);
    }
  }

  function setMode(review) {
    $('camera-video').hidden = review;
    $('camera-guide').hidden = review;
    $('camera-review').hidden = !review;
    $('camera-shoot').hidden = review;
    $('camera-keep').hidden = !review;
    $('camera-retake').hidden = !review;
  }
  function updateCount() {
    const n = S ? S.shots.length : 0;
    $('camera-count').hidden = !n;
    $('camera-count').textContent = n === 1 ? tr('1 photo gardée') : tr`${n} photos gardées`;
    $('camera-done').textContent = n ? (n === 1 ? tr('Terminer et importer la photo') : tr`Terminer et importer les ${n} photos`) : tr('Fermer');
  }

  async function startStream() {
    if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
    const want = { video: { facingMode: { ideal: S.facing }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(want); } catch (e) { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
    if (!S) { stream.getTracks().forEach((t) => t.stop()); return; }
    S.stream = stream;
    const video = $('camera-video');
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* lecture déjà lancée */ }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      $('camera-switch').hidden = devs.filter((d) => d.kind === 'videoinput').length < 2;
    } catch (e) { /* ignoré */ }
  }

  // la visée : une image analysée après l'autre, sans monopoliser l'appareil
  function tick() {
    if (!S || S.review) return;
    const video = $('camera-video');
    if (video.readyState >= 2 && video.videoWidth) {
      const work = canvasOf(video, LIVE_MAX);
      const v = check(work);
      S.last = v;
      showVerdict(v, true);
      drawGuide(v, work);
      release(work);
    }
    S.timer = setTimeout(tick, 150);
  }

  async function grab() {
    const video = $('camera-video');
    const track = S.stream && S.stream.getVideoTracks()[0];
    if (track && window.ImageCapture) {
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
    if (!S || S.busy) return;
    S.busy = true;
    $('camera-shoot').disabled = true;
    try {
      const full = await grab();
      if (!S) { release(full); return; }
      const blob = await new Promise((res) => full.toBlob(res, 'image/jpeg', 0.94));
      const small = canvasOf(full, CHECK_MAX);
      const v = check(small, { full: true, k: full.width / small.width });
      release(small); release(full);
      S.review = { blob, verdict: v };
      clearTimeout(S.timer);
      const img = $('camera-shot');
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(blob);
      setMode(true);
      showVerdict(v, false);
    } catch (e) {
      console.error(e);
      if (S && S.onError) S.onError(tr('La photo n’a pas pu être prise. Réessayez, ou importez-la depuis la galerie.'));
    } finally {
      if (S) { S.busy = false; $('camera-shoot').disabled = false; }
    }
  }
  function keep() {
    if (!S || !S.review) return;
    const n = S.shots.length + 1;
    S.shots.push(new File([S.review.blob], `photo-${n}.jpg`, { type: 'image/jpeg' }));
    if (window.Atelier && window.Atelier.track) window.Atelier.track('Photo', { verdict: S.review.verdict.level });
    retake();
    updateCount();
  }
  function retake() {
    if (!S) return;
    S.review = null;
    setMode(false);
    tick();
  }

  async function open(opts) {
    if (S) return;
    S = { stream: null, facing: 'environment', shots: [], timer: null, busy: false, review: null, last: null, onDone: opts && opts.onDone, onError: opts && opts.onError };
    const root = $('camera');
    root.hidden = false;
    $('camera-error').hidden = true;
    $('camera-tip').textContent = '';
    $('camera-points').innerHTML = '';
    $('camera-verdict').className = 'camera-verdict';
    $('camera-verdict').textContent = tr('Ouverture de l’appareil photo…');
    setMode(false);
    updateCount();
    try {
      await startStream();
      if (S) tick();
    } catch (e) {
      console.error(e);
      if (!S) return;
      $('camera-verdict').textContent = '';
      const err = $('camera-error');
      err.hidden = false;
      err.textContent = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? tr('L’accès à l’appareil photo a été refusé. Autorisez-le dans les réglages du navigateur, ou importez des photos depuis la galerie.')
        : tr('Aucun appareil photo disponible. Importez des photos depuis la galerie.');
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
    $('camera').hidden = true;
    if (s.onDone) s.onDone(s.shots);
  }

  function init() {
    if (!$('camera')) return;
    $('camera-shoot').addEventListener('click', shoot);
    $('camera-keep').addEventListener('click', keep);
    $('camera-retake').addEventListener('click', retake);
    $('camera-done').addEventListener('click', close);
    $('camera-switch').addEventListener('click', async () => {
      if (!S) return;
      S.facing = S.facing === 'environment' ? 'user' : 'environment';
      try { await startStream(); } catch (e) { /* on garde la caméra en cours */ }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S && !$('camera').hidden) close(); });
    window.addEventListener('pagehide', () => { if (S) { const s = S; S = null; clearTimeout(s.timer); if (s.stream) s.stream.getTracks().forEach((t) => t.stop()); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Camera = { supported, open, close, check, shots: () => (S ? S.shots.length : 0) };
})();
