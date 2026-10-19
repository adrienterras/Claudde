/*
 * Comptes utilisateurs (Supabase Auth + Storage) : inscription et connexion par Google ou
 * e-mail, gestion du compte (nom, e-mail, mot de passe, déconnexion, suppression), et compositions
 * sauvegardées dans le compte. Sans réglage dans config.js, le module reste inactif et l'app
 * fonctionne comme avant (sauvegardes locales).
 */
(function () {
  'use strict';

  const cfg = window.ATELIER_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  let client = null;
  let user = null;
  let recovering = false; // retour d'un lien « mot de passe oublié »
  const listeners = [];

  function notify() { listeners.forEach((fn) => { try { fn(user, { recovering }); } catch (e) { console.error(e); } }); }

  function init() {
    if (!enabled) return false;
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    });
    client.auth.onAuthStateChange((event, session) => {
      user = session ? session.user : null;
      if (event === 'PASSWORD_RECOVERY') recovering = true;
      if (event === 'SIGNED_OUT') recovering = false;
      notify();
    });
    client.auth.getSession().then(({ data }) => { user = data && data.session ? data.session.user : null; notify(); });
    return true;
  }

  const redirectTo = () => location.origin + location.pathname;
  const err = (e) => { if (e) throw new Error(frMessage(e.message || String(e))); };

  // Messages d'erreur Supabase les plus courants, en français
  function frMessage(m) {
    const map = [
      [/Invalid login credentials/i, tr('E-mail ou mot de passe incorrect.')],
      [/Email not confirmed/i, tr('Confirmez d’abord votre e-mail : un lien vous a été envoyé.')],
      [/User already registered/i, tr('Un compte existe déjà avec cet e-mail. Connectez-vous, ou utilisez « mot de passe oublié ».')],
      [/Password should be at least (\d+)/i, tr('Le mot de passe doit faire au moins $1 caractères.')],
      [/rate limit|too many requests/i, tr('Trop de tentatives : patientez une minute.')],
      [/Unable to validate email|invalid format/i, tr('Cette adresse e-mail ne semble pas valide.')],
      [/same password/i, tr('Choisissez un mot de passe différent de l’actuel.')],
      [/Failed to fetch|NetworkError/i, tr('Pas de connexion au service des comptes. Vérifiez votre réseau.')],
    ];
    for (const [re, fr] of map) { const mm = m.match(re); if (mm) return fr.replace('$1', mm[1] || ''); }
    return m;
  }

  // ---------- Règle de mot de passe ----------
  // 10 caractères au moins, trois familles sur quatre (minuscules, majuscules, chiffres, symboles),
  // pas un mot de passe trop courant, pas de répétition d'un seul caractère, sans l'e-mail ni le nom.
  const COMMON = ['password', 'motdepasse', 'azerty', 'qwerty', 'bonjour', 'soleil', 'chocolat', 'marseille', 'doudou', 'loulou', 'gribouille', 'atelier', 'abc', '123', 'iloveyou', 'welcome', 'admin', 'letmein', 'dragon', 'monkey', 'football', 'princesse', 'maman', 'papa'];
  const PASSWORD_MIN = 10;
  function checkPassword(pw, ctx) {
    pw = pw || '';
    const problems = [];
    if (pw.length < PASSWORD_MIN) problems.push(tr`au moins ${PASSWORD_MIN} caractères (${pw.length} pour l’instant)`);
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
    if (classes < 3) problems.push(tr('mélanger au moins trois familles : minuscules, majuscules, chiffres, symboles'));
    const low = pw.toLowerCase();
    if (/^(.)\1+$/.test(pw) || /^(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef)/.test(low)) problems.push(tr('éviter les suites et répétitions'));
    if (COMMON.some((w) => low.includes(w) && w.length >= 4 && pw.length < w.length + 6)) problems.push(tr('éviter les mots de passe trop courants'));
    const parts = [];
    if (ctx && ctx.email) parts.push(ctx.email.split('@')[0]);
    if (ctx && ctx.name) parts.push(...ctx.name.split(/\s+/));
    if (parts.some((p) => p && p.length >= 3 && low.includes(p.toLowerCase()))) problems.push(tr('ne pas contenir votre nom ni votre e-mail'));
    // score indicatif : longueur et variété
    let pool = 0; if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/[0-9]/.test(pw)) pool += 10; if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
    const bits = pw.length ? pw.length * Math.log2(pool || 1) : 0;
    const score = problems.length ? Math.min(1, bits >= 40 ? 1 : 0) : bits >= 80 ? 4 : bits >= 65 ? 3 : 2;
    const labels = ['', tr('Faible'), tr('Correct'), tr('Bon'), tr('Excellent')];
    return { ok: problems.length === 0, problems, score, label: labels[score] || '' };
  }

  // ---------- Authentification ----------
  async function signInWith(provider) {
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
    err(error);
  }
  async function signInEmail(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    err(error);
  }
  async function signUpEmail(email, password, name) {
    const { data, error } = await client.auth.signUp({ email, password, options: { data: { name: name || '' }, emailRedirectTo: redirectTo() } });
    err(error);
    // avec confirmation d'e-mail activée, la session n'existe pas encore
    return { needsConfirm: !(data && data.session) };
  }
  async function magicLink(email) {
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
    err(error);
  }
  async function resetPassword(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
    err(error);
  }
  async function updatePassword(password) {
    const { error } = await client.auth.updateUser({ password });
    err(error);
    recovering = false;
    notify();
  }
  async function updateProfile(fields) {
    const { error } = await client.auth.updateUser({ data: fields });
    err(error);
  }
  async function updateEmail(email) {
    const { error } = await client.auth.updateUser({ email }, { emailRedirectTo: redirectTo() });
    err(error);
  }
  async function signOut() {
    draftFiles = null;
    const { error } = await client.auth.signOut();
    err(error);
  }
  // Tous les fichiers du dossier de l'utilisateur (compositions, masques, exports), sous-dossiers compris.
  async function sweep(prefix, depth) {
    const store = client.storage.from(BUCKET);
    const { data } = await store.list(prefix, { limit: 1000 });
    const files = [];
    for (const f of data || []) {
      const path = `${prefix}/${f.name}`;
      // (un dossier n'a pas d'identifiant : on y descend)
      if (f.id === null && depth < 3) files.push(...await sweep(path, depth + 1));
      else files.push(path);
    }
    return files;
  }
  async function deleteAccount() {
    // Les fichiers d'abord : la base ne peut pas effacer elle-même les fichiers du stockage (bloqué
    // sur les projets Supabase récents) ; sans cela, les dessins resteraient après la suppression.
    for (const c of await cloudList()) await cloudDel(c.id);
    for (const e of await exportsList()) await exportDel(e.id, e.path);
    const rest = await sweep(user.id, 0);
    if (rest.length) { const { error: e2 } = await client.storage.from(BUCKET).remove(rest); err(e2); }
    const { error } = await client.rpc('delete_account');
    err(error);
    try { await client.auth.signOut(); } catch (e) { /* le compte n'existe plus */ }
    user = null;
    notify();
  }

  const displayName = (u) => (u && u.user_metadata && (u.user_metadata.name || u.user_metadata.full_name)) || (u && u.email ? u.email.split('@')[0] : '');
  const providerOf = (u) => (u && u.app_metadata && u.app_metadata.provider) || 'email';

  // ---------- Compositions dans le compte ----------
  const BUCKET = 'drawings';
  const extOf = (type) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg');

  async function cloudList() {
    const { data, error } = await client.from('compositions').select('id, name, created_at, thumb, meta').order('created_at', { ascending: false });
    err(error);
    return (data || []).filter((row) => !(row.meta && (row.meta.draft || row.meta.cart))).map((row) => ({
      id: `cloud:${row.id}`, name: row.name, date: row.created_at, thumb: row.thumb, cloud: true,
      comp: (row.meta && row.meta.comp) || {}, nDrawings: row.meta && row.meta.drawings ? row.meta.drawings.length : 0,
    }));
  }

  async function cloudPut(rec, onProgress) {
    if (!user) throw new Error(tr('Connectez-vous pour sauvegarder dans votre compte.'));
    const id = crypto.randomUUID();
    const base = `${user.id}/${id}`;
    const store = client.storage.from(BUCKET);
    const drawings = [];
    let n = 0;
    const packOf = (d) => (d.saved && d.saved.page && d.saved.page.data ? 1 + (d.saved.atlases || []).length : 0);
    const total = rec.drawings.reduce((a, d) => a + 1 + (d.pieceEdits || []).filter(Boolean).length + packOf(d), 0);
    const put = async (path, bytes, type) => {
      const up = await store.upload(path, new Blob([bytes], { type }), { contentType: type, upsert: true });
      err(up.error);
      onProgress && onProgress(++n, total);
      return path;
    };
    for (let i = 0; i < rec.drawings.length; i++) {
      const d = rec.drawings[i];
      const path = await put(`${base}/d${i}.${extOf(d.type)}`, d.data, d.type || 'image/jpeg');
      // page de travail et planches des découpes (voir savedOf dans app.js) : des fichiers à côté de l'image
      let saved = d.saved || null;
      if (packOf(d)) {
        const atlases = [];
        for (let j = 0; j < (saved.atlases || []).length; j++) atlases.push(Object.assign({}, saved.atlases[j], { data: await put(`${base}/d${i}-decoupe${j}.png`, saved.atlases[j].data, 'image/png') }));
        saved = Object.assign({}, saved, { page: Object.assign({}, saved.page, { data: await put(`${base}/d${i}-page.jpg`, saved.page.data, 'image/jpeg') }), atlases });
      }
      const edits = [];
      for (let j = 0; j < (d.pieceEdits || []).length; j++) {
        const e = d.pieceEdits[j];
        if (!e || !e.mask) { edits.push(null); continue; }
        const mp = `${base}/d${i}-e${j}.png`;
        const u2 = await store.upload(mp, new Blob([e.mask], { type: 'image/png' }), { contentType: 'image/png', upsert: true });
        err(u2.error);
        onProgress && onProgress(++n, total);
        edits.push(Object.assign({}, e, { mask: mp }));
      }
      drawings.push(Object.assign({}, d, { data: undefined, file: path, pieceEdits: edits, saved }));
    }
    const meta = { v: rec.v || null, date: rec.date, settings: rec.settings, comp: rec.comp, drawings };
    if (rec.cart) meta.cart = rec.cart; // article du panier (voir app.js) : pas dans « Mes compositions » tant qu'il n'est pas commandé
    const { error } = await client.from('compositions').insert({ id, name: rec.name, thumb: rec.thumb, meta });
    err(error);
    return `cloud:${id}`;
  }

  async function cloudGet(cloudId, onProgress) {
    const id = cloudId.replace(/^cloud:/, '');
    const { data, error } = await client.from('compositions').select('id, name, created_at, thumb, meta').eq('id', id).single();
    err(error);
    if (!data) return null;
    const store = client.storage.from(BUCKET);
    const meta = data.meta || {};
    const drawings = [];
    const total = (meta.drawings || []).length;
    for (let i = 0; i < total; i++) {
      const d = meta.drawings[i];
      const dl = await store.download(d.file);
      err(dl.error);
      const bytes = await dl.data.arrayBuffer();
      const edits = [];
      for (const e of d.pieceEdits || []) {
        if (!e || !e.mask) { edits.push(null); continue; }
        const m = await store.download(e.mask);
        err(m.error);
        edits.push(Object.assign({}, e, { mask: await m.data.arrayBuffer() }));
      }
      let saved = d.saved || null;
      if (saved && saved.page && typeof saved.page.data === 'string') {
        const get = async (p) => { const r = await store.download(p); err(r.error); return r.data.arrayBuffer(); };
        const atlases = [];
        for (const at of saved.atlases || []) atlases.push(Object.assign({}, at, { data: await get(at.data) }));
        saved = Object.assign({}, saved, { page: Object.assign({}, saved.page, { data: await get(saved.page.data) }), atlases });
      }
      drawings.push(Object.assign({}, d, { data: bytes, pieceEdits: edits, saved }));
      onProgress && onProgress(i + 1, total);
    }
    return { id: cloudId, v: meta.v || undefined, name: data.name, date: data.created_at, thumb: data.thumb, settings: meta.settings, comp: meta.comp, drawings, cloud: true };
  }

  // ---------- L'œuvre en cours dans le compte ----------
  /*
   * Le brouillon (l'œuvre en cours, gardée dans le navigateur) est aussi tenu à jour dans le compte,
   * pour la retrouver sur un autre appareil : une ligne « compositions » marquée draft (une seule par
   * compte, remplacée à chaque envoi) et un dossier fixe de fichiers, où chaque image n'est envoyée
   * qu'une fois (nommée d'après sa clé de brouillon) ; les fichiers qui ne servent plus sont effacés.
   */
  const DRAFT_DIR = 'brouillon';
  let draftFiles = null; // noms des fichiers déjà dans le dossier (relus une fois)
  const safeName = (key) => String(key).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
  async function cloudDraftRows() {
    const { data, error } = await client.from('compositions').select('id, name, created_at, thumb, meta').order('created_at', { ascending: false });
    err(error);
    return (data || []).filter((row) => row.meta && row.meta.draft);
  }
  async function cloudDraft() {
    if (!user) return null;
    const row = (await cloudDraftRows())[0];
    if (!row) return null;
    return { id: `cloud:${row.id}`, date: (row.meta && row.meta.date) || row.created_at, nDrawings: row.meta && row.meta.drawings ? row.meta.drawings.length : 0, thumb: row.thumb };
  }
  // rec : instantané du brouillon (images par clés, voir snapshotComposition avec refs) ;
  // getBytes(ref) rend { data, type } pour une image, { page, atlases } pour une découpe
  async function cloudDraftPut(rec, getBytes, onProgress) {
    if (!user) throw new Error(tr('Connectez-vous pour garder votre œuvre dans votre compte.'));
    const base = `${user.id}/${DRAFT_DIR}`;
    const store = client.storage.from(BUCKET);
    if (!draftFiles) {
      const { data } = await store.list(base, { limit: 1000 });
      draftFiles = new Set((data || []).map((f) => f.name));
    }
    const used = new Set();
    let n = 0;
    const put = async (name, bytes, type) => {
      used.add(name);
      if (draftFiles.has(name)) return `${base}/${name}`;
      const up = await store.upload(`${base}/${name}`, new Blob([bytes], { type }), { contentType: type, upsert: true });
      err(up.error);
      draftFiles.add(name);
      onProgress && onProgress(++n);
      return `${base}/${name}`;
    };
    const drawings = [];
    for (const d of rec.drawings) {
      if (!d.ref) continue;
      const key = safeName(d.ref);
      let file = `${base}/${key}.jpg`;
      if (draftFiles.has(`${key}.jpg`)) used.add(`${key}.jpg`);
      else { const b = await getBytes(d.ref); if (!b || !b.data) continue; file = await put(`${key}.jpg`, b.data, b.type || 'image/jpeg'); }
      let saved = null;
      if (d.saved && d.saved.ref) {
        const k2 = safeName(d.saved.ref);
        const names = [`${k2}-page.jpg`, ...(d.saved.atlases || []).map((a, j) => `${k2}-a${j}.png`)];
        let pk = null;
        if (!names.every((x) => draftFiles.has(x))) pk = await getBytes(d.saved.ref);
        if (pk || names.every((x) => draftFiles.has(x))) {
          const page = pk ? await put(names[0], pk.page, 'image/jpeg') : (used.add(names[0]), `${base}/${names[0]}`);
          const atlases = [];
          for (let j = 0; j < (d.saved.atlases || []).length; j++) atlases.push(Object.assign({}, d.saved.atlases[j], { data: pk ? await put(names[j + 1], pk.atlases[j], 'image/png') : (used.add(names[j + 1]), `${base}/${names[j + 1]}`) }));
          saved = Object.assign({}, d.saved, { ref: undefined, page: Object.assign({}, d.saved.page, { data: page }), atlases });
        }
      }
      drawings.push(Object.assign({}, d, { data: undefined, ref: undefined, file, saved }));
    }
    const meta = { v: rec.v || null, date: rec.date, settings: rec.settings, comp: rec.comp, drawings, draft: true };
    const id = crypto.randomUUID();
    const { error } = await client.from('compositions').insert({ id, name: rec.name, thumb: rec.thumb, meta });
    err(error);
    // l'ancienne ligne, puis les fichiers qui ne servent plus
    const old = (await cloudDraftRows()).filter((r) => r.id !== id);
    for (const r of old) { const { error: e2 } = await client.from('compositions').delete().eq('id', r.id); err(e2); }
    const stale = [...draftFiles].filter((f) => !used.has(f));
    if (stale.length) { const { error: e3 } = await store.remove(stale.map((f) => `${base}/${f}`)); if (!e3) stale.forEach((f) => draftFiles.delete(f)); }
    return `cloud:${id}`;
  }
  async function cloudDraftDel() {
    if (!user) return;
    const base = `${user.id}/${DRAFT_DIR}`;
    const store = client.storage.from(BUCKET);
    const { data: files } = await store.list(base, { limit: 1000 });
    if (files && files.length) await store.remove(files.map((f) => `${base}/${f.name}`));
    draftFiles = new Set();
    for (const r of await cloudDraftRows()) { const { error } = await client.from('compositions').delete().eq('id', r.id); err(error); }
  }

  // ---------- Exports (fichiers téléchargés) dans le compte ----------
  async function exportsList() {
    const { data, error } = await client.from('exports').select('id, name, kind, dpi, width, height, size, thumb, path, comp_name, created_at').order('created_at', { ascending: false });
    err(error);
    return data || [];
  }
  async function exportPut(blob, info) {
    if (!user) throw new Error(tr('Connectez-vous pour enregistrer vos exports.'));
    const id = crypto.randomUUID();
    const ext = info.kind === 'pdf' ? 'pdf' : info.kind === 'png' ? 'png' : 'jpg';
    const path = `${user.id}/exports/${id}.${ext}`;
    const up = await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    err(up.error);
    const row = { id, name: info.name, kind: info.kind, dpi: info.dpi || null, width: info.width || null, height: info.height || null, size: blob.size, thumb: info.thumb || null, path, comp_name: info.compName || null };
    const { error } = await client.from('exports').insert(row);
    err(error);
    return row;
  }
  async function exportUrl(path) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600, { download: true });
    err(error);
    return data.signedUrl;
  }
  async function exportBlob(path) {
    const dl = await client.storage.from(BUCKET).download(path);
    err(dl.error);
    return dl.data;
  }
  async function exportDel(id, path) {
    if (path) await client.storage.from(BUCKET).remove([path]);
    const { error } = await client.from('exports').delete().eq('id', id);
    err(error);
  }

  // ---------- Panier dans le compte ----------
  // Un article du panier est une composition marquée meta.cart (produit, finition, taille, quantité…).
  async function cloudCart() {
    const { data, error } = await client.from('compositions').select('id, name, created_at, thumb, meta').order('created_at', { ascending: false });
    err(error);
    return (data || []).filter((row) => row.meta && row.meta.cart)
      .map((row) => Object.assign({ id: row.id, recId: `cloud:${row.id}`, refs: [], title: row.name, thumb: row.thumb, date: row.created_at }, row.meta.cart))
      .reverse();
  }
  // quantité ou produit changés (cart), ou article commandé (cart : null, avec le nom de la commande) :
  // la composition reste, seule sa fiche change
  async function cloudCartSet(cloudId, cart, name) {
    const id = cloudId.replace(/^cloud:/, '');
    const { data, error } = await client.from('compositions').select('meta').eq('id', id).single();
    err(error);
    const meta = Object.assign({}, data.meta);
    if (cart) meta.cart = cart; else delete meta.cart;
    const { error: e2 } = await client.from('compositions').update(name ? { meta, name } : { meta }).eq('id', id);
    err(e2);
  }

  async function cloudDel(cloudId) {
    const id = cloudId.replace(/^cloud:/, '');
    const store = client.storage.from(BUCKET);
    const base = `${user.id}/${id}`;
    const { data: files } = await store.list(base, { limit: 1000 });
    if (files && files.length) await store.remove(files.map((f) => `${base}/${f.name}`));
    const { error } = await client.from('compositions').delete().eq('id', id);
    err(error);
  }

  window.Account = {
    enabled, init,
    onChange: (fn) => listeners.push(fn),
    user: () => user, displayName, providerOf, isRecovering: () => recovering,
    signInWith, signInEmail, signUpEmail, magicLink, resetPassword, updatePassword, updateProfile, updateEmail, signOut, deleteAccount,
    checkPassword, PASSWORD_MIN,
    cloud: { list: cloudList, put: cloudPut, get: cloudGet, del: cloudDel, draft: cloudDraft, draftPut: cloudDraftPut, draftDel: cloudDraftDel, cart: cloudCart, cartSet: cloudCartSet },
    exports: { list: exportsList, put: exportPut, url: exportUrl, blob: exportBlob, del: exportDel },
    contactEmail: cfg.contactEmail || '',
  };
})();
