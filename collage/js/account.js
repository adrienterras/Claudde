/*
 * Comptes utilisateurs (Supabase Auth + Storage) : inscription et connexion par Google, Facebook ou
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
      [/Invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
      [/Email not confirmed/i, 'Confirmez d’abord votre e-mail : un lien vous a été envoyé.'],
      [/User already registered/i, 'Un compte existe déjà avec cet e-mail. Connectez-vous, ou utilisez « mot de passe oublié ».'],
      [/Password should be at least (\d+)/i, 'Le mot de passe doit faire au moins $1 caractères.'],
      [/rate limit|too many requests/i, 'Trop de tentatives : patientez une minute.'],
      [/Unable to validate email|invalid format/i, 'Cette adresse e-mail ne semble pas valide.'],
      [/same password/i, 'Choisissez un mot de passe différent de l’actuel.'],
      [/Failed to fetch|NetworkError/i, 'Pas de connexion au service des comptes. Vérifiez votre réseau.'],
    ];
    for (const [re, fr] of map) if (re.test(m)) return m.replace(re, fr).replace(/^.*?(E-mail|Confirmez|Un compte|Le mot|Trop|Cette|Choisissez|Pas de)/, '$1');
    return m;
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
    const { error } = await client.auth.signOut();
    err(error);
  }
  async function deleteAccount() {
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
    return (data || []).map((row) => ({
      id: `cloud:${row.id}`, name: row.name, date: row.created_at, thumb: row.thumb, cloud: true,
      comp: (row.meta && row.meta.comp) || {}, nDrawings: row.meta && row.meta.drawings ? row.meta.drawings.length : 0,
    }));
  }

  async function cloudPut(rec, onProgress) {
    if (!user) throw new Error('Connectez-vous pour sauvegarder dans votre compte.');
    const id = crypto.randomUUID();
    const base = `${user.id}/${id}`;
    const store = client.storage.from(BUCKET);
    const drawings = [];
    let n = 0;
    const total = rec.drawings.reduce((a, d) => a + 1 + (d.pieceEdits || []).filter(Boolean).length, 0);
    for (let i = 0; i < rec.drawings.length; i++) {
      const d = rec.drawings[i];
      const path = `${base}/d${i}.${extOf(d.type)}`;
      const up = await store.upload(path, new Blob([d.data], { type: d.type || 'image/jpeg' }), { contentType: d.type || 'image/jpeg', upsert: true });
      err(up.error);
      onProgress && onProgress(++n, total);
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
      drawings.push(Object.assign({}, d, { data: undefined, file: path, pieceEdits: edits }));
    }
    const meta = { date: rec.date, settings: rec.settings, comp: rec.comp, drawings };
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
      drawings.push(Object.assign({}, d, { data: bytes, pieceEdits: edits }));
      onProgress && onProgress(i + 1, total);
    }
    return { id: cloudId, name: data.name, date: data.created_at, thumb: data.thumb, settings: meta.settings, comp: meta.comp, drawings, cloud: true };
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
    cloud: { list: cloudList, put: cloudPut, get: cloudGet, del: cloudDel },
    contactEmail: cfg.contactEmail || '',
  };
})();
