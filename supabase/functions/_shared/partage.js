/*
 * Partager une œuvre (fonction « partage », et ses tests) : ce qui ne dépend ni de la base ni du réseau.
 *
 * Le lien de partage est gardé dans la fiche de l'œuvre de celui qui partage (meta.share : { token,
 * expires, at }) : pas de table à part. La personne qui ouvre le lien reçoit sa propre copie de l'œuvre,
 * dans son compte (ses fichiers copiés dans son dossier) : elle la modifie librement, l'œuvre d'origine
 * ne change pas. Elle garde la trace du lien (meta.sharedFrom) : un deuxième clic rouvre la même copie.
 */
export const SHARE_DAYS = 30;
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DAY = 86400e3;

// le jeton d'un nouveau lien : 144 bits tirés au hasard par le serveur (jamais par le navigateur)
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// un nouveau lien, valable SHARE_DAYS jours
export const newShare = (now = Date.now()) => ({ token: newToken(), at: new Date(now).toISOString(), expires: new Date(now + SHARE_DAYS * DAY).toISOString() });

// le lien est-il encore valable ? (et jamais plus de SHARE_DAYS jours devant lui : une date plus lointaine,
// écrite à la main dans la fiche, ne fait pas un lien sans fin)
export const shareValid = (share, now = Date.now()) => {
  if (!share || !TOKEN_RE.test(String(share.token || '')) || share.revoked) return false;
  const end = new Date(share.expires).getTime();
  return end > now && end <= now + (SHARE_DAYS + 1) * DAY;
};
// le lien en cours peut-il resservir (encore plus d'un jour) ?
export const shareReusable = (share, now = Date.now()) => shareValid(share, now) && new Date(share.expires).getTime() > now + DAY;

// les fichiers d'une fiche (image, retouches, page de travail et planches des découpes)
export function pathsOf(meta) {
  const out = [];
  ((meta && meta.drawings) || []).forEach((d) => {
    if (typeof d.file === 'string') out.push(d.file);
    (d.pieceEdits || []).forEach((e) => { if (e && typeof e.mask === 'string') out.push(e.mask); });
    const s = d.saved;
    if (s && s.page && typeof s.page.data === 'string') { out.push(s.page.data); (s.atlases || []).forEach((a) => { if (typeof a.data === 'string') out.push(a.data); }); }
  });
  return out;
}

// La copie reçue : où va chaque fichier (dans le dossier de la personne, sous le même nom — les noms des
// fichiers d'une œuvre sont les clés de ses images : l'atelier les reconnaît et n'en renvoie aucun), et sa
// fiche, chemins remplacés, sans rien de ce qui ne concerne que l'œuvre d'origine (son lien, sa commande,
// son panier, l'œuvre d'où elle venait).
export function receivedCopy(meta, owner, uid, newId, token, now = new Date()) {
  const base = `${uid}/${newId}`;
  const map = new Map(), used = new Set();
  for (const src of pathsOf(meta)) {
    if (map.has(src) || typeof src !== 'string' || !src.startsWith(`${owner}/`) || src.includes('..')) continue;
    let name = src.split('/').pop().replace(/[^A-Za-z0-9_.-]+/g, '_') || 'f';
    if (used.has(name)) { let i = 2; while (used.has(`${i}-${name}`)) i++; name = `${i}-${name}`; }
    used.add(name);
    map.set(src, `${base}/${name}`);
  }
  const fix = (p) => (typeof p === 'string' ? map.get(p) || null : p);
  const drawings = ((meta && meta.drawings) || []).map((d) => {
    const out = Object.assign({}, d, { file: fix(d.file) });
    if (Array.isArray(d.pieceEdits)) out.pieceEdits = d.pieceEdits.map((e) => (e && typeof e.mask === 'string' ? Object.assign({}, e, { mask: fix(e.mask) }) : e));
    const s = d.saved;
    if (s && s.page && typeof s.page.data === 'string') out.saved = Object.assign({}, s, { page: Object.assign({}, s.page, { data: fix(s.page.data) }), atlases: (s.atlases || []).map((a) => Object.assign({}, a, { data: fix(a.data) })) });
    return out;
  });
  const out = Object.assign({}, meta, { drawings, work: true, date: now.toISOString(), sharedFrom: token });
  ['share', 'cart', 'ordered', 'order', 'fromWork', 'frozen', 'draft', 'device'].forEach((k) => { delete out[k]; });
  return { copies: [...map.entries()], meta: out };
}
