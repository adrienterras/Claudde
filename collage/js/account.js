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
      if (event === 'SIGNED_IN') cleanAuthUrl();
      // hors du rappel de Supabase (sa recommandation) : un appel au serveur lancé pendant ce rappel
      // (liste des œuvres, « Toutes les œuvres »…) peut rester bloqué sur le verrou de la session
      setTimeout(notify, 0);
    });
    client.auth.getSession().then(({ data }) => { user = data && data.session ? data.session.user : null; cleanAuthUrl(); notify(); });
    return true;
  }
  // Retour d'une connexion Google : le code à usage unique (?code=…) quitte l'adresse une fois lu,
  // pour qu'un rechargement (ou une page rouverte par Safari après un plantage) reparte d'une
  // adresse propre, sans retenter l'échange
  function cleanAuthUrl() {
    try {
      const u = new URL(location.href);
      if (!u.searchParams.has('code') && !u.searchParams.has('error_description')) return;
      ['code', 'state', 'error', 'error_code', 'error_description'].forEach((k) => u.searchParams.delete(k));
      history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) { /* ignoré */ }
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
      [/captcha/i, tr('Vérification anti-robot refusée : réessayez.')],
      [/Invalid TOTP|invalid.*code|code.*(invalid|expired)/i, tr('Code incorrect ou expiré : saisissez le code affiché maintenant par votre application.')],
      [/reauthentication|reauthenticate|recent(ly)? log/i, tr('Pour des raisons de sécurité, reconnectez-vous (déconnexion puis connexion) avant de changer votre mot de passe.')],
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

  // ---------- Vérification anti-robot (Cloudflare Turnstile, option) ----------
  /*
   * Avec captchaSiteKey dans config.js (clé publique du widget Turnstile) et la protection activée
   * dans Supabase (Authentication → Attack Protection, avec la clé secrète), chaque inscription,
   * connexion par mot de passe, lien de connexion et mot de passe oublié porte un jeton à usage
   * unique : un script ne peut plus créer de comptes en masse ni épuiser le quota d'e-mails. Le
   * script de Cloudflare n'est chargé qu'à ce moment-là (jamais sans clé). Sans clé : rien ne change.
   */
  const captchaKey = typeof cfg.captchaSiteKey === 'string' ? cfg.captchaSiteKey : '';
  let captchaLoad = null;
  function loadCaptcha() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!captchaLoad) {
      captchaLoad = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = () => res(window.turnstile);
        s.onerror = () => { captchaLoad = null; rej(new Error(tr('La vérification anti-robot n’a pas pu se charger : vérifiez votre réseau, puis réessayez.'))); };
        document.head.appendChild(s);
      });
    }
    return captchaLoad;
  }
  // un jeton pour une seule demande (undefined sans clé) ; le widget ne se montre que s'il faut cliquer
  async function captchaToken() {
    if (!captchaKey) return undefined;
    const ts = await loadCaptcha();
    const box = document.getElementById('auth-captcha');
    if (!box || !ts) throw new Error(tr('La vérification anti-robot n’a pas pu se charger : vérifiez votre réseau, puis réessayez.'));
    if (box._wid != null) { try { ts.remove(box._wid); } catch (e) { /* ignoré */ } box._wid = null; }
    box.hidden = false;
    return new Promise((res, rej) => {
      box._wid = ts.render(box, {
        sitekey: captchaKey, appearance: 'interaction-only', size: 'flexible',
        language: (window.I18n && window.I18n.lang) || 'fr',
        callback: (t) => { box.hidden = true; res(t); },
        'error-callback': () => { rej(new Error(tr('Vérification anti-robot échouée : réessayez.'))); },
        'expired-callback': () => { rej(new Error(tr('Vérification anti-robot expirée : réessayez.'))); },
      });
    });
  }

  // ---------- Authentification ----------
  async function signInWith(provider) {
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
    err(error);
  }
  async function signInEmail(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password, options: { captchaToken: await captchaToken() } });
    err(error);
  }
  async function signUpEmail(email, password, name) {
    const { data, error } = await client.auth.signUp({ email, password, options: { data: { name: name || '' }, emailRedirectTo: redirectTo(), captchaToken: await captchaToken() } });
    err(error);
    // avec confirmation d'e-mail activée, la session n'existe pas encore
    return { needsConfirm: !(data && data.session) };
  }
  // (sans créer de compte : on s'inscrit avec le formulaire ou Google ; une adresse inconnue reçoit la
  // même réponse qu'une adresse connue, pour ne pas révéler quels comptes existent)
  async function magicLink(email) {
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: false, captchaToken: await captchaToken() } });
    if (error && /signups? not allowed|otp_disabled|user not found/i.test(`${error.message} ${error.code || ''}`)) return;
    err(error);
  }
  // redirect : la page où revenir choisir le mot de passe (depuis le site : l'atelier, qui a le formulaire)
  async function resetPassword(email, redirect) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirect || redirectTo(), captchaToken: await captchaToken() });
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
    workFiles.clear();
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

  // Mes œuvres : toutes les compositions du compte sauf les articles du panier (écartés côté serveur).
  // Seulement ce qu'il faut pour la liste (date, style, taille, nombre de dessins) : la fiche complète
  // de chaque œuvre ne transite qu'à sa réouverture.
  const ORDER_NAME = /^AG-\d{6}-[A-Z0-9]{4} · /;
  // from, count : une page de la liste, des plus récentes aux plus anciennes (sans count : toute la liste)
  // Chaque compte garde au plus WORK_MAX œuvres (Mes œuvres : œuvres en cours et figées ; ni les
  // articles du panier ni les œuvres commandées ne comptent), pendant WORK_KEEP_DAYS jours après leur
  // dernier changement : au-delà, elles sont effacées à la lecture suivante de la liste (cloudPrune),
  // sauf les œuvres commandées, gardées.
  const WORK_MAX = 15, WORK_KEEP_DAYS = 60;
  async function cloudPrune() {
    if (!user) return 0;
    const { data, error } = await client.from('compositions').select('id, name, created_at, date:meta->>date, ordered:meta->>ordered').eq('user_id', user.id).is('meta->>cart', null);
    err(error);
    const limit = Date.now() - WORK_KEEP_DAYS * 86400e3;
    // (jamais une œuvre commandée : elle doit rester jusqu'à l'impression et au-delà, pour le suivi)
    const old = (data || []).filter((row) => !(row.ordered || (row.meta && row.meta.ordered)) && !ORDER_NAME.test(row.name || '') && new Date(row.date || row.created_at).getTime() < limit);
    for (const row of old) await cloudDel(`cloud:${row.id}`);
    return old.length;
  }
  // (toujours limitées au compte connecté : les règles du serveur ouvrent aussi à l'administrateur la
  // lecture des œuvres des autres comptes ; sans ce filtre, elles se mêlaient à ses propres œuvres,
  // à son panier et au ménage des œuvres anciennes, et leur suppression échouait sans message)
  async function cloudList(from, count) {
    if (!user) return [];
    let q = client.from('compositions').select(LIST_COLS).eq('user_id', user.id).is('meta->>cart', null).order('created_at', { ascending: false });
    if (count) q = q.range(from || 0, (from || 0) + count - 1);
    const { data, error } = await q;
    err(error);
    return (data || []).map(entryOf);
  }
  const LIST_COLS = 'id, name, created_at, thumb, date:meta->>date, style:meta->comp->>style, W:meta->comp->>W, H:meta->comp->>H, n:meta->>n, ordered:meta->>ordered, frozen:meta->>frozen, draft:meta->>draft, device:meta->>device, mode:meta->settings->>mode, format:meta->settings->>format';
  // une ligne de la liste → la fiche courte d'une œuvre
  function entryOf(row) {
    const m = row.meta || {}, c = m.comp || {}; // (sans sélection de colonnes : la fiche entière)
    const n = row.n != null ? Number(row.n) : m.drawings ? m.drawings.length : m.n != null ? m.n : null;
    return {
      id: `cloud:${row.id}`, workId: row.id, name: row.name, date: row.date || m.date || row.created_at, thumb: row.thumb, cloud: true,
      comp: { style: row.style || c.style, W: Number(row.W || c.W) || 0, H: Number(row.H || c.H) || 0 }, nDrawings: n,
      ordered: !!(row.ordered || m.ordered) || ORDER_NAME.test(row.name || ''), frozen: !!(row.frozen || m.frozen), legacyDraft: !!(row.draft || m.draft), device: row.device || m.device || null,
      settings: { mode: row.mode || (m.settings && m.settings.mode) || null, format: row.format || (m.settings && m.settings.format) || null },
    };
  }

  // ---------- Administration ----------
  /*
   * Le compte administrateur (voir supabase/schema.sql : is_admin, admin_works, admin_open) lit les
   * œuvres des autres comptes, en lecture seule : il les rouvre en copie dans son propre compte, sans
   * rien changer ni effacer chez les autres. Il est désigné par un rôle dans app_metadata
   * (atelier_role = admin), que seul le serveur peut écrire, et le serveur exige en plus la double
   * authentification (jeton de niveau aal2) : la vue la demande d'abord (mfaState, mfaEnroll,
   * mfaVerify). Chaque œuvre ouverte est inscrite au journal du serveur (admin_log), qui n'ouvre ses
   * fichiers que pendant l'heure qui suit. Côté navigateur, le rôle ne sert qu'à montrer la vue : ce
   * sont les règles du serveur qui donnent, ou non, les lignes et les fichiers.
   */
  const isAdmin = () => !!(user && user.app_metadata && user.app_metadata.atelier_role === 'admin');
  // le tableau de bord du site : l'administrateur, ou un compte au rôle « tableau » (lecture seule de cette
  // page ; le serveur le vérifie, avec la double authentification)
  const canDashboard = () => isAdmin() || !!(user && user.app_metadata && user.app_metadata.atelier_role === 'tableau');
  // 'none' : pas administrateur ; 'enroll' : double authentification à activer ; 'verify' : code à
  // saisir pour cette connexion ; 'ok' : connecté avec la double authentification
  async function mfaState() {
    if (!canDashboard()) return 'none';
    const { data: lvl, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    err(error);
    if (lvl && lvl.currentLevel === 'aal2') return 'ok';
    const { data: f, error: e2 } = await client.auth.mfa.listFactors();
    err(e2);
    return ((f && f.totp) || []).some((x) => x.status === 'verified') ? 'verify' : 'enroll';
  }
  // une nouvelle application d'authentification : le code à scanner (image SVG) et la clé à saisir à la main
  async function mfaEnroll() {
    const { data: f } = await client.auth.mfa.listFactors();
    for (const x of (f && f.all) || []) if (x.status !== 'verified') await client.auth.mfa.unenroll({ factorId: x.id });
    const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Atelier Gribouille' });
    err(error);
    const qr = data && data.totp && typeof data.totp.qr_code === 'string' && data.totp.qr_code.startsWith('data:image/svg+xml') ? data.totp.qr_code : '';
    return { factorId: data.id, qr, secret: (data.totp && data.totp.secret) || '' };
  }
  // le code à 6 chiffres : active l'application (factorId de mfaEnroll) ou valide cette connexion
  async function mfaVerify(code, factorId) {
    code = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error(tr('Saisissez les 6 chiffres affichés par votre application.'));
    if (!factorId) {
      const { data: f, error } = await client.auth.mfa.listFactors();
      err(error);
      const v = ((f && f.totp) || []).find((x) => x.status === 'verified');
      if (!v) throw new Error(tr('Aucune application d’authentification n’est activée sur ce compte.'));
      factorId = v.id;
    }
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
    err(error);
  }
  // les œuvres des autres comptes (sans le panier ni l'ancien brouillon unique), des plus récentes
  // aux plus anciennes, par pages, avec l'e-mail de leur propriétaire
  const adminOpenable = new Set(); // œuvres d'autres comptes : rouvertes par admin_open (inscrite au journal)
  const ADMIN_PAGE = 60;
  async function adminList(from) {
    if (!isAdmin()) return [];
    const { data, error } = await client.rpc('admin_works', { p_from: from || 0, p_count: ADMIN_PAGE });
    if (error && /admin_works|function|schema cache/i.test(error.message || '') && !/réservé/.test(error.message || '')) {
      throw new Error(tr('les règles d’administration ne sont pas à jour sur le serveur : exécutez supabase/schema.sql dans l’éditeur SQL de Supabase'));
    }
    err(error);
    return (data || []).map((row) => { adminOpenable.add(row.id); return Object.assign(entryOf(row), { owner: row.user_id, email: row.email || '' }); });
  }

  // Envoi des fichiers d'une composition : quatre à la fois (une œuvre de 25 dessins, c'est des dizaines
  // de fichiers : un par un en 4G, plusieurs minutes), chacun abandonné après 2 minutes sans réponse
  // (réseau mobile qui décroche : une erreur, qu'on peut relancer, plutôt qu'une attente sans fin)
  const UPLOAD_PARALLEL = 4, UPLOAD_TIMEOUT = 120000;
  const withTimeout = (p, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(tr('pas de réponse du serveur : vérifiez la connexion et réessayez'))), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
  // (load : l'image lue sur l'appareil au moment de l'envoyer seulement, une à une — voir cartRecForCloud)
  async function uploadAll(jobs, onProgress) {
    const store = client.storage.from(BUCKET);
    let next = 0, done = 0;
    onProgress && onProgress(0, jobs.length);
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        if (j.bytes == null && j.load) { const r = await j.load().catch(() => null); if (r) { j.bytes = r.bytes; if (r.type) j.type = r.type; } }
        if (j.bytes == null) throw new Error(tr('fichier introuvable'));
        const up = await withTimeout(store.upload(j.path, new Blob([j.bytes], { type: j.type }), { contentType: j.type, upsert: true }), UPLOAD_TIMEOUT);
        err(up.error);
        onProgress && onProgress(++done, jobs.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, jobs.length) }, worker));
  }
  // Fichiers partagés : un article du panier (ou une commande) fait d'une œuvre du compte reprend les
  // fichiers de son dossier tels quels, sans copie (meta.fromWork). Un fichier du dossier d'une œuvre
  // n'est donc effacé que si plus rien ne s'en sert : ni l'œuvre (sa version actuelle), ni les articles
  // et commandes faits d'elle. sharedRefs : les fichiers dont se servent ces fiches, sauf except.
  async function sharedRefs(workId, except) {
    const cols = 'id, drawings:meta->drawings';
    const [a, b] = await Promise.all([
      client.from('compositions').select(cols).eq('user_id', user.id).eq('id', workId),
      client.from('compositions').select(cols).eq('user_id', user.id).eq('meta->>fromWork', workId),
    ]);
    err(a.error); err(b.error);
    const keep = new Set();
    [...(a.data || []), ...(b.data || [])].forEach((r) => { if (r.id !== except) pathsOf(r.meta || { drawings: r.drawings }).forEach((x) => keep.add(x)); });
    return keep;
  }
  async function cloudPut(rec, onProgress) {
    if (!user) throw new Error(tr('Connectez-vous pour sauvegarder dans votre compte.'));
    const id = crypto.randomUUID();
    const base = `${user.id}/${id}`;
    const store = client.storage.from(BUCKET);
    const drawings = [];
    const jobs = [];
    // rec.fromWork : l'œuvre du compte d'où vient la composition (article du panier) ; ses fichiers
    // portent les clés des images (workPut), que la composition donne (workRef, workSavedRef)
    let have = new Set(), wbase = '';
    if (rec.fromWork) {
      wbase = `${user.id}/${rec.fromWork}`;
      have = workFiles.get(rec.fromWork) || await withTimeout(store.list(wbase, { limit: 1000 }), 30000).then(({ data }) => new Set((data || []).map((f) => f.name))).catch(() => new Set());
    }
    const from = (name) => (name && have.has(name) ? `${wbase}/${name}` : null);
    // src : le fichier de l'œuvre, déjà dans le compte, repris tel quel (rien n'est copié ni envoyé) ;
    // sinon, envoyé (load : l'image lue sur l'appareil à ce moment-là seulement)
    const shared = new Map(); // fichier de l'œuvre repris → de quoi l'envoyer s'il venait à manquer
    const put = (path, bytes, type, src, load) => {
      if (src) { shared.set(src, { path, bytes, type, load }); return src; }
      jobs.push({ path, bytes, type, load });
      return path;
    };
    const packOf = (d) => (d.saved && d.saved.page && (d.saved.page.data || d.workSavedRef) ? 1 + (d.saved.atlases || []).length : 0);
    for (let i = 0; i < rec.drawings.length; i++) {
      const d = rec.drawings[i];
      const wk = d.workRef ? safeName(d.workRef) : null, ws = d.workSavedRef ? safeName(d.workSavedRef) : null;
      const path = put(`${base}/d${i}.${extOf(d.type)}`, d.data, d.type || 'image/jpeg', from(wk && `${wk}.jpg`), d.loadImage);
      const pack = d.loadPack ? (pick) => () => d.loadPack().then((p) => (p ? pick(p) : null)) : () => undefined;
      // page de travail et planches des découpes (voir savedOf dans app.js) : des fichiers à côté de l'image
      let saved = d.saved || null;
      if (packOf(d)) {
        const atlases = (saved.atlases || []).map((a, j) => Object.assign({}, a, { data: put(`${base}/d${i}-decoupe${j}.png`, a.data, 'image/png', from(ws && `${ws}-a${j}.png`), pack((p) => (p.atlases && p.atlases[j] ? { bytes: p.atlases[j], type: 'image/png' } : null))) }));
        saved = Object.assign({}, saved, { page: Object.assign({}, saved.page, { data: put(`${base}/d${i}-page.jpg`, saved.page.data, 'image/jpeg', from(ws && `${ws}-page.jpg`), pack((p) => (p.page ? { bytes: p.page, type: 'image/jpeg' } : null))) }), atlases });
      }
      const edits = (d.pieceEdits || []).map((e, j) => (e && e.mask ? Object.assign({}, e, { mask: put(`${base}/d${i}-e${j}.png`, e.mask, 'image/png') }) : null));
      drawings.push(Object.assign({}, d, { data: undefined, file: path, pieceEdits: edits, saved, workRef: undefined, workSavedRef: undefined, loadImage: undefined, loadPack: undefined }));
    }
    await uploadAll(jobs, onProgress);
    const meta = { v: rec.v || null, date: rec.date, settings: rec.settings, comp: rec.comp, drawings, n: drawings.length };
    if (rec.cart) meta.cart = rec.cart; // article du panier (voir app.js) : pas dans « Mes œuvres » tant qu'il n'est pas commandé
    if (rec.ordered) meta.ordered = true; // composition commandée : figée, rouverte en copie
    if (rec.order) meta.order = rec.order; // le détail de la commande (référence, produit, quantité, prix)
    if (rec.fromWork) meta.fromWork = rec.fromWork; // (ses fichiers repris : gardés tant qu'elle s'en sert)
    const { error } = await withTimeout(client.from('compositions').insert({ id, name: rec.name, thumb: rec.thumb, meta }), 45000);
    err(error);
    // un fichier repris a pu disparaître entre-temps (l'œuvre retouchée au même moment, sur un autre
    // appareil) : envoyé dans le dossier de l'article, qui le prend à sa place
    if (shared.size) {
      const now = await withTimeout(store.list(wbase, { limit: 1000 }), 30000).then(({ data }) => new Set((data || []).map((f) => f.name))).catch(() => null);
      const gone = now ? [...shared.keys()].filter((p) => !now.has(p.slice(wbase.length + 1))) : [];
      if (gone.length) {
        const swap = new Map(gone.map((p) => [p, shared.get(p).path]));
        await uploadAll(gone.map((p) => shared.get(p)));
        const fix = (p) => swap.get(p) || p;
        meta.drawings = meta.drawings.map((d) => {
          const out = Object.assign({}, d, { file: fix(d.file) });
          if (d.saved && d.saved.page && typeof d.saved.page.data === 'string') out.saved = Object.assign({}, d.saved, { page: Object.assign({}, d.saved.page, { data: fix(d.saved.page.data) }), atlases: (d.saved.atlases || []).map((a) => Object.assign({}, a, { data: fix(a.data) })) });
          return out;
        });
        const { error: e2 } = await withTimeout(client.from('compositions').update({ meta }).eq('id', id), 45000);
        err(e2);
      }
    }
    return `cloud:${id}`;
  }

  async function cloudGet(cloudId, onProgress) {
    const id = cloudId.replace(/^cloud:/, '');
    // (l'œuvre d'un autre compte, pour l'administrateur : par admin_open, qui l'inscrit au journal et
    // lui ouvre ses fichiers pour une heure)
    const { data, error } = adminOpenable.has(id)
      ? await client.rpc('admin_open', { p_id: id }).then((r) => ({ data: r.data && r.data[0], error: r.error || (r.data && r.data.length ? null : { message: tr('œuvre introuvable') }) }))
      : await client.from('compositions').select('id, name, created_at, thumb, meta').eq('id', id).maybeSingle();
    err(error);
    // (aucune ligne : l'œuvre a été supprimée, ou n'est pas dans ce compte — et non l'erreur technique de la base)
    if (!data) throw new Error(tr('cette œuvre n’est plus dans votre compte (supprimée, ou enregistrée avec un autre compte)'));
    const store = client.storage.from(BUCKET);
    const meta = data.meta || {};
    const drawings = [];
    const total = (meta.drawings || []).length;
    // (les sujets d'une même feuille partagent son image : téléchargée une fois)
    const files = new Map();
    for (let i = 0; i < total; i++) {
      const d = meta.drawings[i];
      if (!files.has(d.file)) {
        const dl = await store.download(d.file);
        err(dl.error);
        files.set(d.file, await dl.data.arrayBuffer());
      }
      const bytes = files.get(d.file);
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
    return { id: cloudId, v: meta.v || undefined, name: data.name, date: meta.date || data.created_at, thumb: data.thumb, settings: meta.settings, comp: meta.comp, drawings, cloud: true, workName: meta.workName || null, print: meta.print || null, fromWork: typeof meta.fromWork === 'string' ? meta.fromWork : null };
  }

  // ---------- Mes œuvres dans le compte ----------
  /*
   * Chaque œuvre est tenue à jour d'elle-même dans le compte : une ligne « compositions » (même
   * identifiant que l'œuvre, meta.work) et un dossier <utilisateur>/<œuvre>/ où chaque image (et chaque
   * planche de découpes) n'est envoyée qu'une fois, nommée d'après sa clé ; les fichiers qui ne
   * servent plus sont effacés (y compris ceux d'une ancienne sauvegarde ou de l'ancien brouillon unique).
   */
  const workFiles = new Map(); // œuvre → noms des fichiers déjà dans son dossier (relus une fois)
  const safeName = (key) => String(key).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
  // les fichiers d'une fiche (image, page de travail et planches, anciennes retouches)
  const pathsOf = (meta) => {
    const out = [];
    ((meta && meta.drawings) || []).forEach((d) => {
      if (typeof d.file === 'string') out.push(d.file);
      (d.pieceEdits || []).forEach((e) => { if (e && typeof e.mask === 'string') out.push(e.mask); });
      const s = d.saved;
      if (s && s.page && typeof s.page.data === 'string') { out.push(s.page.data); (s.atlases || []).forEach((a) => { if (typeof a.data === 'string') out.push(a.data); }); }
    });
    return out;
  };
  // la date de la version d'une œuvre dans le compte, sans rien d'autre (null : pas dans le compte)
  async function workInfo(workId) {
    if (!user) return null;
    const { data, error } = await client.from('compositions').select('id, date:meta->>date, device:meta->>device').eq('id', workId);
    err(error);
    const row = (data || [])[0], m = (row && row.meta) || {};
    return row ? { date: row.date || m.date || null, device: row.device || m.device || null } : null;
  }
  // rec : instantané d'une œuvre (images par clés, voir snapshotComposition avec refs) ;
  // getBytes(ref) rend { data, type } pour une image, { page, atlases } pour une découpe
  // (onProgress(n, total) : les dessins envoyés ; plusieurs dessins à la fois, comme uploadAll, mais pas
  // tous : la mémoire du téléphone ne garde que quelques images à la fois)
  async function workPut(rec, getBytes, onProgress) {
    if (!user) throw new Error(tr('Connectez-vous pour garder votre œuvre dans votre compte.'));
    const id = rec.workId, base = `${user.id}/${id}`;
    const store = client.storage.from(BUCKET);
    let names = workFiles.get(id);
    if (!names) {
      const { data } = await store.list(base, { limit: 1000 });
      names = new Set((data || []).map((f) => f.name));
      workFiles.set(id, names);
    }
    const used = new Set();
    // (plusieurs dessins à la fois : un fichier commun à deux dessins — les sujets d'une même feuille —
    // n'est envoyé qu'une fois, l'autre attend le même envoi)
    const sending = new Map();
    const put = async (name, bytes, type) => {
      const path = `${base}/${name}`;
      used.add(path);
      if (names.has(name)) return path;
      if (sending.has(name)) { await sending.get(name); return path; }
      const job = (async () => {
        const up = await store.upload(path, new Blob([bytes], { type }), { contentType: type, upsert: true });
        err(up.error);
        names.add(name);
      })();
      sending.set(name, job);
      try { await job; } finally { sending.delete(name); }
      return path;
    };
    const have = (name) => { if (!names.has(name) && !sending.has(name)) return false; used.add(`${base}/${name}`); return true; };
    const list = rec.drawings.filter((d) => d.ref);
    const out = new Array(list.length);
    const one = async (d) => {
      const key = safeName(d.ref);
      let file = `${base}/${key}.jpg`;
      if (sending.has(`${key}.jpg`)) { used.add(file); await sending.get(`${key}.jpg`).catch(() => {}); }
      if (!have(`${key}.jpg`)) { const b = await getBytes(d.ref); if (!b || !b.data) return null; file = await put(`${key}.jpg`, b.data, b.type || 'image/jpeg'); }
      let saved = null;
      if (d.saved && d.saved.ref) {
        const k2 = safeName(d.saved.ref);
        const files = [`${k2}-page.jpg`, ...(d.saved.atlases || []).map((a, j) => `${k2}-a${j}.png`)];
        await Promise.all(files.map((x) => sending.get(x)).filter(Boolean)).catch(() => {});
        const all = files.every((x) => names.has(x));
        const pk = all ? null : await getBytes(d.saved.ref);
        if (pk || all) {
          const page = pk ? await put(files[0], pk.page, 'image/jpeg') : (have(files[0]), `${base}/${files[0]}`);
          const atlases = [];
          for (let j = 0; j < (d.saved.atlases || []).length; j++) atlases.push(Object.assign({}, d.saved.atlases[j], { data: pk ? await put(files[j + 1], pk.atlases[j], 'image/png') : (have(files[j + 1]), `${base}/${files[j + 1]}`) }));
          saved = Object.assign({}, d.saved, { ref: undefined, page: Object.assign({}, d.saved.page, { data: page }), atlases });
        }
      }
      return Object.assign({}, d, { data: undefined, ref: undefined, file, saved });
    };
    let next = 0, done = 0;
    if (onProgress) onProgress(0, list.length);
    const worker = async () => {
      while (next < list.length) { const i = next++; out[i] = await one(list[i]); if (onProgress) onProgress(++done, list.length); }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, list.length) }, worker));
    const drawings = out.filter(Boolean); // (l'ordre des dessins est gardé)
    const meta = { v: rec.v || null, date: rec.date, settings: rec.settings, comp: rec.comp, drawings, n: drawings.length, work: true, print: rec.print || null, workName: rec.workName || null, device: rec.device || null };
    if (rec.frozen) meta.frozen = true; // œuvre figée (voir freezeWork dans app.js) : rouverte en copie
    const { data: rows, error: e0 } = await client.from('compositions').select('id, meta').eq('id', id);
    err(e0);
    const old = (rows || [])[0];
    // (gardés d'une version à l'autre : son lien de partage, et le lien d'où elle a été reçue)
    if (old && old.meta && old.meta.share) meta.share = old.meta.share;
    if (old && old.meta && old.meta.sharedFrom) meta.sharedFrom = old.meta.sharedFrom;
    const { error } = old
      ? await client.from('compositions').update({ name: rec.name, thumb: rec.thumb, meta }).eq('id', id)
      : await client.from('compositions').insert({ id, name: rec.name, thumb: rec.thumb, meta });
    // l'œuvre existe déjà, dans un autre compte (faite ici avec un autre compte) : elle y reste ; les
    // fichiers envoyés pour rien sont retirés, et l'atelier le dit au lieu d'une erreur technique
    if (error && !old && (error.code === '23505' || /duplicate key|compositions_pkey/i.test(error.message || ''))) {
      await store.remove([...used]).catch(() => {});
      workFiles.delete(id);
      throw Object.assign(new Error(tr('cette œuvre appartient à un autre compte')), { code: 'foreign' });
    }
    err(error);
    // les fichiers qui ne servent plus : ceux du dossier, et ceux de la version d'avant rangés ailleurs
    const stale = new Set([...names].map((x) => `${base}/${x}`).filter((p) => !used.has(p)));
    if (old) pathsOf(old.meta).forEach((p) => { if (!used.has(p)) stale.add(p); });
    // (sauf ceux que gardent les articles du panier et les commandes faits de l'œuvre)
    if (stale.size) { const keep = await sharedRefs(id, id).catch(() => null); if (!keep) stale.clear(); else keep.forEach((p) => stale.delete(p)); }
    if (stale.size) {
      const { error: e3 } = await store.remove([...stale]);
      if (!e3) stale.forEach((p) => { if (p.startsWith(`${base}/`)) names.delete(p.slice(base.length + 1)); });
    }
    return `cloud:${id}`;
  }

  // ---------- Partager une œuvre (un lien : la personne reçoit sa propre copie) ----------
  // Le lien est gardé dans la fiche de l'œuvre (meta.share) ; la fonction « partage » (serveur) le lit
  // pour l'accueil du lien et fait la copie dans le compte de la personne (voir supabase/functions).
  const shareOk = (sh) => !!(sh && sh.token && !sh.revoked && new Date(sh.expires).getTime() > Date.now() + 86400e3);
  async function shareMeta(workId) {
    const { data, error } = await client.from('compositions').select('id, meta').eq('user_id', user.id).eq('id', workId);
    err(error);
    const row = (data || [])[0];
    if (!row) throw new Error(tr('œuvre introuvable dans votre compte'));
    return row;
  }
  // le lien de l'œuvre (celui déjà en cours, s'il est encore valable plus d'un jour ; sinon un nouveau) :
  // créé par le serveur (fonction « partage », action « creer ») — jeton tiré au hasard, unique, 30 jours
  async function shareCreate(workId) {
    if (!user) throw new Error(tr('connexion requise'));
    const data = await fnCall('partage', { action: 'creer', id: workId }, tr('le serveur ne répond pas : réessayez dans un instant'));
    if (!data || !data.token) throw new Error(tr('réponse inattendue du serveur'));
    return { token: data.token, expires: data.expires };
  }
  // le lien en cours de l'œuvre, s'il y en a un (sans en créer)
  async function shareGet(workId) {
    if (!user) return null;
    const { data, error } = await client.from('compositions').select('id, share:meta->share').eq('user_id', user.id).eq('id', workId);
    err(error);
    const row = (data || [])[0], sh = row && (row.share || (row.meta && row.meta.share));
    return shareOk(sh) ? { token: sh.token, expires: sh.expires } : null;
  }
  // désactiver le lien : il ne mène plus à rien (les copies déjà reçues restent à leurs destinataires)
  async function shareRevoke(workId) {
    const row = await shareMeta(workId);
    const meta = Object.assign({}, row.meta);
    if (!meta.share) return;
    delete meta.share;
    const { error } = await client.from('compositions').update({ meta }).eq('id', workId);
    err(error);
  }
  // l'accueil du lien (sans compte) : nom, vignette, prénom de celui qui partage
  async function shareSee(token) {
    const { data, error } = await client.functions.invoke('partage', { body: { action: 'voir', token } });
    if (error) {
      let msg = error.message || String(error);
      try { const j = error.context && error.context.json && (await error.context.json()); if (j && j.error) msg = j.error; } catch (e) { /* réponse sans détail */ }
      throw new Error(msg);
    }
    return data;
  }
  // recevoir l'œuvre : sa copie dans ce compte → son identifiant (celui de l'œuvre)
  const shareReceive = (token) => fnCall('partage', { action: 'recevoir', token });

  // ---------- Commandes payées en ligne (Stripe) ----------
  // le panier du compte devient une commande : la fonction « commande » (serveur) relit le panier,
  // recalcule les prix et la livraison et renvoie l'adresse de la page de paiement Stripe
  // (l'appel d'une fonction du serveur ; son message d'erreur, en clair)
  async function fnCall(name, body, offline) {
    if (!user) throw new Error(tr('connexion requise'));
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) {
      let msg = error.message || String(error);
      try { const j = error.context && error.context.json && (await error.context.json()); if (j && j.error) msg = j.error; } catch (e) { /* réponse sans détail */ }
      // (serveur injoignable : réseau coupé, ou fonction pas encore installée)
      if (error.name === 'FunctionsFetchError' || /failed to send a request|failed to fetch|load failed|networkerror/i.test(msg)) msg = offline || tr('le service de paiement ne répond pas : réessayez dans un instant');
      throw new Error(msg);
    }
    return data;
  }
  async function ordersCheckout(consent) {
    const data = await fnCall('commande', { consent: !!consent });
    if (!data || !data.url) throw new Error(tr('réponse inattendue du serveur'));
    // la page de paiement : seulement celle de Stripe (ou une page de ce site), jamais une autre adresse
    let to = null;
    try { to = new URL(data.url, location.href); } catch (e) { /* adresse illisible */ }
    if (!to || !(to.origin === 'https://checkout.stripe.com' || to.origin === location.origin)) throw new Error(tr('réponse inattendue du serveur'));
    return data;
  }
  // annuler (et rembourser) une commande : le client tant qu'elle est payée, l'administrateur jusqu'à l'expédition
  const ordersCancel = (id) => fnCall('commande-annuler', { id });
  // la facture d'une commande payée (faite par Stripe) : son lien, demandé au serveur
  const ordersInvoice = (id) => fnCall('facture', { id });
  // l'administrateur fait avancer une commande (statut, transporteur, numéro de suivi) ; le client est prévenu
  const ordersSet = (id, patch) => fnCall('commande-statut', Object.assign({ id }, patch));
  // les chiffres du tableau de bord du site (administrateur, double authentification : vérifié par le serveur)
  const dashboard = () => fnCall('tableau-de-bord', {}, 'le serveur ne répond pas : réessayez dans un instant');
  // toutes les commandes (administrateur, double authentification), les plus récentes d'abord, sans
  // les paiements commencés et abandonnés ; leurs œuvres s'ouvrent comme celles de Toutes les œuvres
  async function ordersAdmin() {
    if (!canDashboard()) return []; // (l'administrateur ou l'équipe : rôle « tableau »)
    const { data, error } = await withTimeout(client.from('orders').select('*').order('created_at', { ascending: false }).range(0, 149), 45000);
    err(error);
    const rows = (data || []).filter((o) => o.status !== 'attente_paiement' && o.status !== 'abandonnee');
    rows.forEach((o) => (o.items || []).forEach((it) => { if (it.compId) adminOpenable.add(it.compId); }));
    return rows;
  }
  // Gestion des commandes (l'équipe : page gestion-commandes.html) : les vignettes des œuvres commandées,
  // et les fichiers d'impression HD rangés avec chaque commande (bucket « impressions », que seule
  // l'équipe lit et écrit : <commande>/<n° de l'article>.pdf)
  async function staffThumbs(ids) {
    const list = [...new Set((ids || []).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)))];
    if (!user || !canDashboard() || !list.length) return {};
    const { data, error } = await withTimeout(client.rpc('staff_order_thumbs', { p_ids: list }), 30000);
    err(error);
    return Object.fromEntries((data || []).filter((r) => r.thumb).map((r) => [r.id, r.thumb]));
  }
  // l'historique des commandes (équipe seulement, voir order_log dans supabase/schema.sql) : { [orderId]: [lignes] }
  async function orderLog(orderIds) {
    if (!user || !canDashboard()) return {};
    const ids = (orderIds || []).filter((id) => /^[0-9a-f-]{36}$/.test(String(id)));
    if (!ids.length) return {};
    const { data, error } = await withTimeout(client.from('order_log').select('order_id, at, actor, action').in('order_id', ids).order('at', { ascending: true }).range(0, 999), 30000);
    err(error);
    const out = {};
    (data || []).forEach((r) => { (out[r.order_id] = out[r.order_id] || []).push(r); });
    return out;
  }
  // le fichier HD préparé : inscrit à l'historique sous le nom de l'équipier (par le serveur)
  async function hdLogged(orderId, index, dpi) {
    if (!user || !canDashboard()) return;
    const { error } = await client.rpc('order_log_hd', { p_order: orderId, p_index: Number(index) || 0, p_dpi: Math.round(Number(dpi) || 0) });
    err(error);
  }
  const PRINTS = 'impressions';
  const hdPath = (orderId, index) => `${orderId}/${Number(index) || 0}.pdf`;
  async function hdList(orderIds) {
    if (!user || !canDashboard()) return {};
    const out = {};
    await Promise.all((orderIds || []).filter((id) => /^[0-9a-f-]{36}$/.test(String(id))).map(async (id) => {
      const { data, error } = await client.storage.from(PRINTS).list(id);
      if (error) return;
      out[id] = (data || []).filter((f) => /^\d+\.pdf$/.test(f.name)).map((f) => ({ index: Number(f.name.split('.')[0]), size: (f.metadata && f.metadata.size) || f.size || 0, at: f.updated_at || f.created_at || null }));
    }));
    return out;
  }
  async function hdPut(orderId, index, blob) {
    if (!user || !canDashboard()) throw new Error(tr('connexion requise'));
    const { error } = await client.storage.from(PRINTS).upload(hdPath(orderId, index), blob, { upsert: true, contentType: 'application/pdf', cacheControl: '60' });
    err(error);
  }
  async function hdUrl(orderId, index, name) {
    const { data, error } = await client.storage.from(PRINTS).createSignedUrl(hdPath(orderId, index), 600, { download: name || true });
    err(error);
    return data && data.signedUrl;
  }
  // les vignettes des œuvres commandées (le visuel de chaque article dans « Mes commandes ») : { id: data URL }
  async function ordersThumbs(ids) {
    const list = [...new Set((ids || []).map(String).filter((x) => /^[0-9a-f-]{8,40}$/.test(x)))];
    if (!user || !list.length) return {};
    const { data, error } = await withTimeout(client.from('compositions').select('id, thumb').in('id', list), 30000);
    err(error);
    return Object.fromEntries((data || []).filter((r) => r.thumb).map((r) => [r.id, r.thumb]));
  }
  // les commandes du compte (« Mes commandes »), les plus récentes d'abord
  async function ordersList() {
    if (!user) return [];
    const { data, error } = await client.from('orders').select('id, ref, status, created_at, paid_at, items, subtotal_cents, shipping_cents, total_cents, delivery, carrier, tracking, shipping, cancelled_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }).range(0, 49);
    err(error);
    return data || [];
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
    // (le fichier d'abord ; la fiche seulement s'il est bien effacé, voir cloudDel)
    if (path) { const { error: e1 } = await client.storage.from(BUCKET).remove([path]); err(e1); }
    await delRow('exports', id);
  }

  // ---------- Panier dans le compte ----------
  // Un article du panier est une composition marquée meta.cart (produit, finition, taille, quantité…).
  async function cloudCart() {
    if (!user) return [];
    // (la fiche de l'article seulement, pas la composition : une œuvre d'une centaine de dessins, c'est
    // des Mo à lire, et sur iPhone le panier se figeait, voilé, le temps de les lire)
    const { data, error } = await withTimeout(client.from('compositions').select('id, name, created_at, thumb, cart:meta->cart').eq('user_id', user.id).not('meta->>cart', 'is', null).order('created_at', { ascending: false }), 45000);
    err(error);
    return (data || [])
      .map((row) => Object.assign({ id: row.id, recId: `cloud:${row.id}`, refs: [], title: row.name, thumb: row.thumb, date: row.created_at }, row.cart || (row.meta && row.meta.cart)))
      .reverse();
  }
  // quantité ou produit changés (cart), ou article commandé (cart : null, avec le nom de la commande) :
  // la composition reste, seule sa fiche change
  // order : le détail de la commande, gardé dans la fiche (l'article quitte le panier, la trace reste)
  async function cloudCartSet(cloudId, cart, name, order) {
    const id = cloudId.replace(/^cloud:/, '');
    const { data, error } = await client.from('compositions').select('meta').eq('id', id).single();
    err(error);
    const meta = Object.assign({}, data.meta);
    if (cart) meta.cart = cart;
    else {
      // commandée : figée, rouverte en copie
      if (name) { meta.ordered = true; meta.order = Object.assign({}, meta.cart || {}, order || {}); }
      delete meta.cart;
    }
    const { error: e2 } = await client.from('compositions').update(name ? { meta, name } : { meta }).eq('id', id);
    err(e2);
  }

  // renommer une œuvre du compte : sa ligne, et le nom gardé dans ses données
  async function cloudRename(cloudId, name) {
    const id = cloudId.replace(/^cloud:/, '');
    const { data: rows, error: e0 } = await client.from('compositions').select('id, meta').eq('id', id);
    err(e0);
    const row = (rows || [])[0];
    if (!row) return;
    const meta = Object.assign({}, row.meta || {}, { workName: name });
    const { error } = await client.from('compositions').update({ name, meta }).eq('id', id);
    err(error);
  }
  async function cloudDel(cloudId) {
    const id = cloudId.replace(/^cloud:/, '');
    const store = client.storage.from(BUCKET);
    const base = `${user.id}/${id}`;
    // les fichiers d'abord, et seulement s'ils sont bien effacés la fiche : sinon (réseau coupé…) les
    // dessins resteraient stockés alors que l'œuvre aurait disparu ; l'erreur remonte, l'œuvre reste
    // dans la liste et la suppression peut être relancée
    // (la fiche et la liste des fichiers : demandées en même temps)
    const [{ data: rows, error: e0 }, { data: files, error: e1 }] = await Promise.all([
      client.from('compositions').select('id, meta').eq('id', id),
      store.list(base, { limit: 1000 }),
    ]);
    err(e0);
    err(e1);
    const paths = new Set((files || []).map((f) => `${base}/${f.name}`));
    pathsOf(((rows || [])[0] || {}).meta).forEach((p) => paths.add(p)); // (ancien brouillon, fichiers d'une œuvre repris : un autre dossier)
    // (sauf les fichiers dont se servent encore d'autres fiches : l'œuvre d'où vient un article du panier,
    // les articles et commandes faits de cette œuvre — voir sharedRefs)
    const folders = new Set([id, ...[...paths].map((p) => p.split('/')[1])]);
    for (const f of folders) (await sharedRefs(f, id)).forEach((p) => paths.delete(p));
    if (paths.size) { const { error: e2 } = await store.remove([...paths]); err(e2); }
    workFiles.delete(id);
    await delRow('compositions', id);
  }
  // Supprime une ligne et vérifie qu'elle a disparu : une suppression refusée par les règles du serveur
  // (la ligne d'un autre compte) ne renvoie pas d'erreur, seulement aucune ligne supprimée
  async function delRow(table, id) {
    const { data: gone, error } = await client.from(table).delete().eq('id', id).select('id');
    err(error);
    if (gone && gone.length) return;
    const { data: still, error: e2 } = await client.from(table).select('id').eq('id', id);
    err(e2);
    if (still && still.length) throw new Error(tr('le serveur a refusé la suppression'));
  }

  window.Account = {
    enabled, init,
    onChange: (fn) => listeners.push(fn),
    user: () => user, displayName, providerOf, isRecovering: () => recovering,
    signInWith, signInEmail, signUpEmail, magicLink, resetPassword, updatePassword, updateProfile, updateEmail, signOut, deleteAccount,
    checkPassword, PASSWORD_MIN,
    share: { create: shareCreate, get: shareGet, revoke: shareRevoke, see: shareSee, receive: shareReceive },
    cloud: { list: cloudList, put: cloudPut, get: cloudGet, del: cloudDel, rename: cloudRename, workPut, workInfo, cart: cloudCart, cartSet: cloudCartSet, prune: cloudPrune },
    isAdmin, canDashboard, adminList, adminPage: ADMIN_PAGE, mfaState, mfaEnroll, mfaVerify, dashboard,
    limits: { max: WORK_MAX, keepDays: WORK_KEEP_DAYS },
    exports: { list: exportsList, put: exportPut, url: exportUrl, blob: exportBlob, del: exportDel },
    orders: { checkout: ordersCheckout, list: ordersList, thumbs: ordersThumbs, cancel: ordersCancel, invoice: ordersInvoice, admin: ordersAdmin, set: ordersSet, staffThumbs, hdList, hdPut, hdUrl, log: orderLog, hdLogged },
    contactEmail: cfg.contactEmail || '',
  };
})();
