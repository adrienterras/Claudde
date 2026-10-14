/*
 * Collecte des retouches de découpe, sur option (case à cocher à l'import, décochée par défaut) :
 * quand l'utilisateur corrige une découpe à la main, le dessin concerné (recadré autour de la
 * pièce), la découpe automatique et la découpe corrigée sont envoyés, sans compte ni nom de
 * fichier, pour constituer les exemples d'un futur détourage par apprentissage. Rien n'est envoyé
 * sans la case cochée, ni sans réglage Supabase dans config.js (tests, artefact, copie locale).
 * Côté serveur (supabase/schema.sql) : bucket « retouches » et table « retouches », en écriture
 * seule pour le navigateur (aucune lecture possible depuis l'application).
 */
(function () {
  'use strict';

  const cfg = window.ATELIER_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const KEY = 'atelier.partage-decoupes';
  const MAX_PER_SESSION = 30;
  const CROP_MAX = 1200; // grand côté de l'image envoyée
  let sent = 0;

  function consent() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function setConsent(on) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { /* ignoré */ } }

  const headers = (type) => Object.assign({ apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` }, type ? { 'Content-Type': type } : {});
  const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, q));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  // masque 0/255 d'une pièce (alpha de son canevas), posé dans le recadrage
  async function maskBlob(piece, crop, k) {
    const c = document.createElement('canvas');
    c.width = crop.w; c.height = crop.h;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    const m = document.createElement('canvas');
    m.width = crop.w; m.height = crop.h;
    const mx = m.getContext('2d');
    mx.drawImage(piece.canvas, (piece.src.x - crop.x0) * k, (piece.src.y - crop.y0) * k, piece.src.w * k, piece.src.h * k);
    mx.globalCompositeOperation = 'source-in';
    mx.fillStyle = '#fff'; mx.fillRect(0, 0, m.width, m.height);
    x.drawImage(m, 0, 0);
    return toBlob(c, 'image/png');
  }

  async function upload(path, blob) {
    const r = await fetch(`${cfg.supabaseUrl}/storage/v1/object/retouches/${path}`, { method: 'POST', headers: Object.assign(headers(blob.type), { 'x-upsert': 'false' }), body: blob });
    if (!r.ok) throw new Error(`envoi ${path} : ${r.status}`);
  }

  /*
   * page : canevas de la page analysée ; before / after : { canvas, src } (pièce automatique, pièce
   * corrigée, en pixels de page) ; meta : indications sur la page et la découpe (jamais de nom de
   * fichier ni d'identifiant). Envoi en arrière-plan ; un échec est seulement noté dans la console.
   */
  async function sendEdit(page, before, after, meta) {
    if (!enabled || !consent() || sent >= MAX_PER_SESSION) return false;
    sent++;
    const pad = 0.05 * Math.max(page.width, page.height);
    const x0 = Math.max(0, Math.floor(Math.min(before.src.x, after.src.x) - pad)), y0 = Math.max(0, Math.floor(Math.min(before.src.y, after.src.y) - pad));
    const x1 = Math.min(page.width, Math.ceil(Math.max(before.src.x + before.src.w, after.src.x + after.src.w) + pad));
    const y1 = Math.min(page.height, Math.ceil(Math.max(before.src.y + before.src.h, after.src.y + after.src.h) + pad));
    const k = Math.min(1, CROP_MAX / Math.max(x1 - x0, y1 - y0));
    const crop = { x0, y0, w: Math.max(1, Math.round((x1 - x0) * k)), h: Math.max(1, Math.round((y1 - y0) * k)) };
    const c = document.createElement('canvas');
    c.width = crop.w; c.height = crop.h;
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(page, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.w, crop.h);
    const id = uuid();
    const dir = `${new Date().toISOString().slice(0, 7)}/${id}`;
    const info = Object.assign({}, meta, {
      id, at: new Date().toISOString(), lang: (window.I18n && I18n.lang) || 'fr',
      page: { w: page.width, h: page.height }, crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, scale: k },
      auto: { x: before.src.x, y: before.src.y, w: before.src.w, h: before.src.h },
      corrected: { x: after.src.x, y: after.src.y, w: after.src.w, h: after.src.h },
    });
    try {
      const [img, a, b] = await Promise.all([toBlob(c, 'image/jpeg', 0.85), maskBlob(before, crop, k), maskBlob(after, crop, k)]);
      await upload(`${dir}/image.jpg`, img);
      await upload(`${dir}/auto.png`, a);
      await upload(`${dir}/corrige.png`, b);
      await upload(`${dir}/meta.json`, new Blob([JSON.stringify(info)], { type: 'application/json' }));
      const r = await fetch(`${cfg.supabaseUrl}/rest/v1/retouches`, { method: 'POST', headers: Object.assign(headers('application/json'), { Prefer: 'return=minimal' }), body: JSON.stringify({ path: dir, meta: info }) });
      if (!r.ok) throw new Error(`fiche : ${r.status}`);
      if (window.Atelier && window.Atelier.track) window.Atelier.track('Retouche partagée');
      return true;
    } catch (e) {
      console.warn('Retouche non partagée', e);
      return false;
    }
  }

  window.Collect = { enabled, consent, setConsent, sendEdit, count: () => sent };
})();
