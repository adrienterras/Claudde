/*
 * Découpe assistée par IA. Un modèle de segmentation (BiRefNet lite, ONNX, ≈ 214 Mo) tourne dans le
 * navigateur (onnxruntime-web, WebGPU) et dit où est le sujet d'une page. Il ne remplace pas la découpe
 * de l'atelier : il la guide (Extract, opts.aiMask) — hors du sujet, l'ombre d'un pli ou le dégradé
 * d'une feuille de couleur ne passent plus pour du dessin ; les traits, eux, sont gardés partout.
 * Le modèle est téléchargé une fois (cache du navigateur) ; rien ne sort de l'appareil.
 *
 * AICut.available()      WebGPU présent (sans lui, le modèle serait trop lent : quelques minutes par page)
 * AICut.enabled()        le réglage (mémorisé) ; par défaut : oui sur ordinateur avec WebGPU, non sur téléphone
 * AICut.mask(canvas, onProgress) → { data: Uint8Array 0/1, w, h }  le sujet, à la résolution du modèle
 * AICut.toDataURL(mask) / AICut.fromDataURL(url)  pour garder le sujet avec le dessin sauvegardé
 */
(() => {
  const SIZE = 1024, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  const KEY = 'atelier.ia-decoupe', CACHE = 'atelier-ia-v1';
  const cfg = () => window.ATELIER_CONFIG || {};
  // (adresse absolue : onnxruntime-web charge son module WebAssembly par import(), qui exige une URL complète)
  const ortBase = () => new URL(cfg().ortBase || 'vendor/ort/', document.baseURI).href;
  // le modèle : une adresse, ou plusieurs morceaux à mettre bout à bout (un fichier de plus de 100 Mo ne
  // tient pas dans un dépôt GitHub) ; même origine ou hôte autorisé par la CSP (connect-src)
  const modelUrls = () => { const m = cfg().aiModelUrl; return Array.isArray(m) ? m : m ? [m] : ['modeles/birefnet-lite.onnx.part0', 'modeles/birefnet-lite.onnx.part1', 'modeles/birefnet-lite.onnx.part2']; };
  const phone = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  let broken = null; // le modèle n'a pas pu être chargé (fichier absent, mémoire…) : plus proposé jusqu'au rechargement
  // iPhone et iPad : Safari n'a pas la mémoire du modèle (l'onglet se recharge) ; la découpe assistée n'y est
  // pas proposée du tout (l'iPad se présente comme un Mac tactile)
  const ios = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const supported = () => !ios();
  const available = () => supported() && !broken && !!(navigator.gpu && window.WebAssembly);
  const problem = () => broken;
  function enabled() {
    let v = null;
    try { v = localStorage.getItem(KEY); } catch (e) { /* ignoré */ }
    if (v === null) return available() && !phone();
    return v === '1' && available();
  }
  function setEnabled(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignoré */ } }
  const tr = (s) => (typeof window.tr === 'function' ? window.tr(s) : s);

  let ortLoading = null, sessionP = null;
  function loadOrt() {
    if (window.ort) return Promise.resolve(window.ort);
    if (ortLoading) return ortLoading;
    ortLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = ortBase() + 'ort.webgpu.min.js';
      s.onload = () => {
        if (!window.ort) { rej(new Error('ort absent')); return; }
        // le module WebAssembly sous un nom en .js (un serveur ne connaît pas toujours .mjs) et son binaire
        window.ort.env.wasm.wasmPaths = { mjs: ortBase() + 'ort-wasm-simd-threaded.jsep.js', wasm: ortBase() + 'ort-wasm-simd-threaded.jsep.wasm' };
        window.ort.env.wasm.numThreads = 1;
        res(window.ort);
      };
      s.onerror = () => rej(new Error('onnxruntime-web introuvable'));
      document.head.appendChild(s);
    });
    return ortLoading;
  }
  // le modèle, du cache du navigateur ou téléchargé (avec l'avancement), puis mis en cache
  async function fetchModel(onProgress) {
    const urls = modelUrls(), key = urls[0] + '#modele';
    let cache = null;
    try { cache = window.caches ? await caches.open(CACHE) : null; } catch (e) { cache = null; }
    if (cache) {
      const hit = await cache.match(key).catch(() => null);
      if (hit) { onProgress && onProgress({ stage: 'cache' }); return await hit.arrayBuffer(); }
    }
    const parts = [];
    let total = 0, got = 0;
    for (const u of urls) {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`modèle introuvable (${r.status}) : ${u}`);
      total += Number(r.headers.get('content-length') || 0);
      if (!r.body || !r.body.getReader) { const b = new Uint8Array(await r.arrayBuffer()); parts.push(b); got += b.length; continue; }
      const reader = r.body.getReader(), chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress && onProgress({ stage: 'download', got, total });
      }
      let n = 0; chunks.forEach((c) => { n += c.length; });
      const b = new Uint8Array(n); let o = 0; chunks.forEach((c) => { b.set(c, o); o += c.length; });
      parts.push(b);
    }
    let n = 0; parts.forEach((p) => { n += p.length; });
    const all = new Uint8Array(n); let o = 0; parts.forEach((p) => { all.set(p, o); o += p.length; });
    if (cache) { try { await cache.put(key, new Response(all, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* quota : on s'en passe */ } }
    return all.buffer;
  }
  let modelBuf = null, onCpu = false; // le modèle lu une fois ; la session tourne sur GPU, ou sur processeur (repli)
  function session(onProgress, cpu) {
    if (sessionP && (!cpu || onCpu)) return sessionP;
    onCpu = !!cpu || !!cfg().aiCpu;
    sessionP = (async () => {
      const ort = await loadOrt();
      if (!modelBuf) modelBuf = await fetchModel(onProgress);
      onProgress && onProgress({ stage: 'compile' });
      if (!onCpu) {
        try { return await ort.InferenceSession.create(modelBuf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); } catch (e) { console.warn('WebGPU indisponible pour le modèle, repli processeur (lent)', e); onCpu = true; }
      }
      return await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] });
    })();
    sessionP.catch((e) => { sessionP = null; broken = (e && e.message) || 'modèle indisponible'; });
    return sessionP;
  }
  // l'image, telle que le modèle l'attend : 1024 × 1024 (étirée, comme à l'entraînement), valeurs
  // ramenées au maximum de l'image, centrées-réduites par canal, en plans (NCHW)
  function prepare(canvas) {
    const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, SIZE, SIZE);
    const d = x.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE;
    let mx = 1;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > mx) mx = d[i]; if (d[i + 1] > mx) mx = d[i + 1]; if (d[i + 2] > mx) mx = d[i + 2]; }
    const f = new Float32Array(3 * n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      f[p] = (d[i] / mx - MEAN[0]) / STD[0];
      f[n + p] = (d[i + 1] / mx - MEAN[1]) / STD[1];
      f[2 * n + p] = (d[i + 2] / mx - MEAN[2]) / STD[2];
    }
    return f;
  }
  async function mask(canvas, onProgress) {
    let s = await session(onProgress);
    onProgress && onProgress({ stage: 'run' });
    const ort = window.ort;
    const input = new ort.Tensor('float32', prepare(canvas), [1, 3, SIZE, SIZE]);
    const feeds = {}; feeds[s.inputNames[0]] = input;
    let out;
    try { out = await s.run(feeds); } catch (e) {
      if (onCpu) throw e;
      // le GPU n'a pas pu exécuter le modèle (limites du pilote) : la même page, sur processeur
      console.warn('Exécution WebGPU en échec, repli processeur (lent)', e);
      try { s.release && s.release(); } catch (e2) { /* ignoré */ }
      s = await session(onProgress, true);
      const f2 = {}; f2[s.inputNames[0]] = input;
      out = await s.run(f2);
    }
    const logits = out[s.outputNames[0]].data, n = SIZE * SIZE;
    // sigmoïde, puis étirée entre son minimum et son maximum (comme rembg) ; le sujet : au-dessus de 0,5
    let mn = Infinity, mxv = -Infinity;
    const pr = new Float32Array(n);
    for (let p = 0; p < n; p++) { const v = 1 / (1 + Math.exp(-logits[p])); pr[p] = v; if (v < mn) mn = v; if (v > mxv) mxv = v; }
    const data = new Uint8Array(n), span = mxv - mn || 1;
    for (let p = 0; p < n; p++) data[p] = (pr[p] - mn) / span > 0.5 ? 1 : 0;
    return { data, w: SIZE, h: SIZE };
  }
  // le sujet gardé avec le dessin (PNG gris, 256 px de côté : quelques Ko)
  function toDataURL(m) {
    if (!m || !m.data) return null;
    const S = 256, c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d'), im = x.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
      // un pixel est sujet si l'un des pixels qu'il résume l'est (on ne perd pas un sujet fin)
      let on = 0;
      const y0 = Math.floor(y * m.h / S), y1 = Math.max(y0 + 1, Math.floor((y + 1) * m.h / S)), x0 = Math.floor(xx * m.w / S), x1 = Math.max(x0 + 1, Math.floor((xx + 1) * m.w / S));
      for (let yy = y0; yy < y1 && !on; yy++) for (let xq = x0; xq < x1; xq++) if (m.data[yy * m.w + xq]) { on = 1; break; }
      const i = (y * S + xx) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = on ? 255 : 0; im.data[i + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    return c.toDataURL('image/png');
  }
  function fromDataURL(url) {
    return new Promise((res) => {
      if (!url) { res(null); return; }
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data, data = new Uint8Array(c.width * c.height);
        for (let p = 0; p < data.length; p++) data[p] = d[p * 4] > 127 ? 1 : 0;
        res({ data, w: c.width, h: c.height });
      };
      im.onerror = () => res(null);
      im.src = url;
    });
  }
  // texte d'avancement, pour la barre de progression de l'atelier
  function progressText(ev) {
    if (!ev) return '';
    if (ev.stage === 'download') return ev.total ? tr('Téléchargement du modèle de découpe') + ` (${Math.round(ev.got / ev.total * 100)} %)…` : tr('Téléchargement du modèle de découpe') + '…';
    if (ev.stage === 'compile') return tr('Préparation du modèle de découpe…');
    if (ev.stage === 'run' || ev.stage === 'cache') return tr('Découpe assistée par IA…');
    return '';
  }
  window.AICut = { available, supported, enabled, setEnabled, problem, mask, toDataURL, fromDataURL, progressText, modelUrls, KEY };
})();
