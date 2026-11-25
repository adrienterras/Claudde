// Faux client Supabase en mémoire, injecté dans la page par les tests (auth, table compositions, fichiers).
// Persistance de la session et des données dans localStorage pour survivre à un rechargement.
(function () {
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const db = { users: load('fake.users', {}), rows: load('fake.rows', []), files: load('fake.files', {}), session: load('fake.session', null) };
  const persist = () => { save('fake.users', db.users); save('fake.rows', db.rows); save('fake.files', db.files); save('fake.session', db.session); };
  const listeners = [];
  const emit = (ev) => { listeners.forEach((fn) => fn(ev, db.session)); };
  // (aal : niveau d'authentification du jeton ; aal2 après le code de la double authentification)
  const setSession = (user) => { db.session = user ? { user, aal: 'aal1' } : null; persist(); emit(user ? 'SIGNED_IN' : 'SIGNED_OUT'); };
  const ok = (data) => Promise.resolve({ data, error: null });
  const ko = (message) => Promise.resolve({ data: null, error: { message } });
  window.__fake = { calls: [], db, adminLog: [], forceRecovery: () => { emit('PASSWORD_RECOVERY'); } };
  const TOTP = '123456'; // (le code « affiché par l'application » dans les tests)
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

  const auth = {
    onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    getSession() { return ok({ session: db.session }); },
    signInWithPassword({ email, password, options }) {
      if (options && options.captchaToken) window.__fake.calls.push(['captcha', 'password', options.captchaToken]);
      const u = db.users[email];
      if (!u || u.password !== password) return ko('Invalid login credentials');
      if (!u.confirmed) return ko('Email not confirmed');
      setSession(u); return ok({ session: db.session, user: u });
    },
    signUp({ email, password, options }) {
      if (options && options.captchaToken) window.__fake.calls.push(['captcha', 'signup', options.captchaToken]);
      if (db.users[email]) return ko('User already registered');
      if (password.length < 8) return ko('Password should be at least 8 characters');
      const u = { id: 'u-' + Math.random().toString(36).slice(2, 8), email, password, confirmed: !window.__FAKE_CONFIRM, user_metadata: (options && options.data) || {}, app_metadata: Object.assign({ provider: 'email' }, (window.__FAKE_ADMINS || []).includes(email) ? { atelier_role: 'admin' } : {}) };
      db.users[email] = u; persist();
      if (!u.confirmed) return ok({ session: null, user: u });
      setSession(u); return ok({ session: db.session, user: u });
    },
    signInWithOAuth({ provider, options }) { window.__fake.calls.push(['oauth', provider, options && options.redirectTo]); return ok({ url: 'about:blank' }); },
    signInWithOtp({ email, options }) {
      window.__fake.calls.push(['otp', email, options && options.shouldCreateUser, options && options.captchaToken]);
      // (comme Supabase avec shouldCreateUser: false : une adresse inconnue est refusée)
      if (options && options.shouldCreateUser === false && !db.users[email]) return ko('Signups not allowed for otp');
      return ok({});
    },
    resetPasswordForEmail(email, options) { window.__fake.calls.push(['reset', email, options && options.captchaToken]); return ok({}); },
    updateUser(attrs) {
      const u = db.session && db.users[db.session.user.email]; if (!u) return ko('not signed in');
      if (attrs.data) Object.assign(u.user_metadata, attrs.data);
      if (attrs.password) { if (attrs.password === u.password) return ko('New password should be different from the old password'); u.password = attrs.password; }
      if (attrs.email && attrs.email !== u.email) window.__fake.calls.push(['email-change', attrs.email]);
      db.session = Object.assign({}, db.session, { user: u }); persist(); emit('USER_UPDATED'); return ok({ user: u });
    },
    signOut() { setSession(null); return ok({}); },
    // double authentification (TOTP) : facteurs gardés sur le compte
    mfa: {
      getAuthenticatorAssuranceLevel() {
        const u = db.session && db.users[db.session.user.email]; if (!u) return ko('not signed in');
        return ok({ currentLevel: db.session.aal || 'aal1', nextLevel: (u.factors || []).some((f) => f.status === 'verified') ? 'aal2' : 'aal1' });
      },
      listFactors() {
        const u = db.session && db.users[db.session.user.email]; if (!u) return ko('not signed in');
        const all = (u.factors || []).map((f) => Object.assign({ factor_type: 'totp' }, f));
        return ok({ all, totp: all.filter((f) => f.status === 'verified') });
      },
      enroll() {
        const u = db.session && db.users[db.session.user.email]; if (!u) return ko('not signed in');
        const f = { id: 'f-' + Math.random().toString(36).slice(2, 8), status: 'unverified' };
        u.factors = (u.factors || []).concat(f); persist(); window.__fake.calls.push(['mfa-enroll']);
        return ok({ id: f.id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/test' } });
      },
      unenroll({ factorId }) { const u = db.session && db.users[db.session.user.email]; if (u) { u.factors = (u.factors || []).filter((f) => f.id !== factorId); persist(); } return ok({}); },
      challengeAndVerify({ factorId, code }) {
        const u = db.session && db.users[db.session.user.email]; if (!u) return ko('not signed in');
        const f = (u.factors || []).find((x) => x.id === factorId); if (!f) return ko('Factor not found');
        if (code !== TOTP) return ko('Invalid TOTP code entered');
        f.status = 'verified'; db.session = { user: u, aal: 'aal2' }; persist(); emit('MFA_CHALLENGE_VERIFIED');
        return ok({});
      },
    },
  };
  const from = (table) => {
    const q = { filters: [], op: 'select', single: false, order: null };
    const run = () => {
      const uid = db.session && db.session.user.id;
      if (!uid) return ko('JWT expired');
      // (comme les règles RLS : ses propres lignes seulement ; l'administrateur passe par admin_works et admin_open)
      // (les commandes de tous les comptes : l'administrateur, avec la double authentification, les lit)
      let rows = db.rows.filter((r) => (r.user_id === uid || (table === 'orders' && isAdm(db.session && db.session.user))) && (r.__table || 'compositions') === table);
      // colonne, ou chemin JSON « meta->>clé » (texte : null si la clé manque ou vaut null)
      const val = (r, k) => { if (!k.includes('->>')) return r[k]; const [col, key] = k.split('->>'); const o = r[col]; return o && o[key] != null ? o[key] : null; };
      q.filters.forEach(([k, v, op]) => { rows = rows.filter((r) => { const x = val(r, k); return op === 'is' ? x == v : op === 'not-is' ? x != v : op === 'neq' ? x !== v : x === v; }); });
      // (comme la clé primaire : une ligne de même identifiant, même dans un autre compte, est refusée)
      if (q.op === 'insert' && q.row && q.row.id && db.rows.some((r) => r.id === q.row.id && (r.__table || 'compositions') === table)) return Promise.resolve({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` } });
      if (q.op === 'insert') { const row = Object.assign({ user_id: uid, created_at: new Date().toISOString(), __table: table }, q.row); db.rows.push(row); persist(); return ok([row]); }
      if (q.op === 'delete') { const ids = new Set(rows.map((r) => r.id)); db.rows = db.rows.filter((r) => !ids.has(r.id)); persist(); return ok(rows.map((r) => ({ id: r.id }))); } // (comme .delete().select() : les lignes supprimées)
      if (q.op === 'update') { rows.forEach((r) => Object.assign(r, q.row)); persist(); return ok(rows); }
      if (q.order) rows.sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1));
      if (q.single) return rows.length ? ok(rows[0]) : ko('Row not found');
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      window.__fake.calls.push(['select', table, q.range ? q.range.join('-') : 'all']);
      return ok(rows);
    };
    const chain = {
      select() { return chain; }, insert(row) { q.op = 'insert'; q.row = row; return chain; }, delete() { q.op = 'delete'; return chain; }, update(row) { q.op = 'update'; q.row = row; return chain; },
      eq(k, v) { q.filters.push([k, v]); return chain; }, neq(k, v) { q.filters.push([k, v, 'neq']); return chain; }, is(k, v) { q.filters.push([k, v, 'is']); return chain; }, not(k, op, v) { q.filters.push([k, v, 'not-' + op]); return chain; }, order(k) { q.order = k; return chain; }, single() { q.single = true; return chain; }, range(a, b) { q.range = [a, b]; return chain; },
      then(res, rej) { return run().then(res, rej); },
    };
    return chain;
  };
  const storage = { from: () => ({
    async upload(path, blob) { db.files[path] = b64(await blob.arrayBuffer()); persist(); window.__fake.calls.push(['upload', path]); return { data: { path }, error: null }; },
    async download(path) {
      // (comme les règles du stockage : son dossier ; l'administrateur, le dossier d'un compte dont il a ouvert une œuvre)
      const uid = db.session && db.session.user.id, owner = path.split('/')[0];
      if (owner !== uid && !(isAdm(db.session && db.session.user) && path.split('/')[1] !== 'exports' && window.__fake.adminLog.some((l) => l.admin === uid && l.owner === owner))) return { data: null, error: { message: 'Object not found' } };
      const f = db.files[path]; if (!f) return { data: null, error: { message: `fichier absent : ${path}` } }; return { data: new Blob([unb64(f)]), error: null }; },
    async list(prefix) { return { data: Object.keys(db.files).filter((p) => p.startsWith(prefix + '/')).map((p) => ({ name: p.slice(prefix.length + 1) })), error: null }; },
    async copy(from, to) { const uid = db.session && db.session.user.id; if (!db.files[from] || from.split('/')[0] !== uid) return { data: null, error: { message: 'Object not found' } }; db.files[to] = db.files[from]; persist(); window.__fake.calls.push(['copy', to, from]); return { data: { path: to }, error: null }; },
    async remove(paths) { if (window.__FAKE_REMOVE_FAIL) return { data: null, error: { message: 'réseau coupé' } }; paths.forEach((p) => { delete db.files[p]; }); persist(); return { data: paths, error: null }; }, // (__FAKE_REMOVE_FAIL : l'effacement des fichiers échoue)
    async createSignedUrl(path) { return db.files[path] ? { data: { signedUrl: 'blob:fake/' + path }, error: null } : { data: null, error: { message: 'fichier absent' } }; },
  }) };
  // (comme is_admin() : le rôle écrit côté serveur dans app_metadata, jamais l'e-mail, et la double authentification)
  const isAdm = (u) => !!(u && u.app_metadata && u.app_metadata.atelier_role === 'admin' && db.session && db.session.aal === 'aal2');
  const rpc = (name, args) => {
    if (name === 'is_admin') return ok(isAdm(db.session && db.session.user));
    if (name === 'admin_works' || name === 'admin_open') {
      const u = db.session && db.session.user;
      if (!isAdm(u)) return ko('réservé à l\'administrateur, connecté avec la double authentification');
      const email = (id) => (Object.values(db.users).find((x) => x.id === id) || {}).email || null;
      if (name === 'admin_open') {
        const r = db.rows.find((x) => x.id === args.p_id && (x.__table || 'compositions') === 'compositions' && !(x.meta && x.meta.cart));
        if (!r) return ko('œuvre introuvable');
        window.__fake.adminLog.push({ admin: u.id, owner: r.user_id, id: r.id });
        return ok([r]);
      }
      const rows = db.rows.filter((r) => (r.__table || 'compositions') === 'compositions' && r.user_id !== u.id && !(r.meta && (r.meta.cart || r.meta.draft)))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(args.p_from || 0, (args.p_from || 0) + (args.p_count || 60))
        .map((r) => ({ id: r.id, user_id: r.user_id, email: email(r.user_id), name: r.name, created_at: r.created_at, thumb: r.thumb, meta: { date: r.meta.date, n: r.meta.n, ordered: r.meta.ordered, frozen: r.meta.frozen, comp: r.meta.comp, settings: r.meta.settings } }));
      window.__fake.calls.push(['admin_works', args.p_from || 0]);
      return ok(rows);
    }
    if (name !== 'delete_account') return ko('unknown function');
    const u = db.session && db.session.user; if (!u) return ko('non connecté');
    // (comme le vrai Supabase : les lignes partent en cascade, mais pas les fichiers du stockage,
    // que l'application doit effacer elle-même avant)
    db.rows = db.rows.filter((r) => r.user_id !== u.id);
    delete db.users[u.email]; db.session = null; persist();
    return ok(null);
  };
  // Fonctions du serveur : « commande » fait comme la vraie fonction, puis comme Stripe et sa
  // notification aussitôt (paiement reçu : la commande « payée », les œuvres quittent le panier) ;
  // window.__fake.fns[nom] la remplace (erreur, réponse lente…)
  let orderN = 0;
  const fnError = (message) => Promise.resolve({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: message }) } } });
  const functions = {
    invoke(name, opts) {
      const body = (opts && opts.body) || {};
      window.__fake.calls.push(['invoke', name, body]);
      const h = window.__fake.fns && window.__fake.fns[name];
      if (h) return Promise.resolve(h(body));
      // l'annulation (le client tant que « payée », l'administrateur jusqu'à l'expédition) et le statut (administrateur)
      if (name === 'commande-annuler' || name === 'commande-statut') {
        const u = db.session && db.session.user;
        if (!u) return fnError('connexion requise');
        const o = db.rows.find((r) => r.__table === 'orders' && r.id === body.id);
        const admin = isAdm(u);
        if (!o || (!admin && o.user_id !== u.id)) return fnError('commande inconnue');
        if (name === 'commande-statut') {
          if (!admin) return fnError('réservé à l’administrateur, connecté avec la double authentification');
          const before = o.status;
          Object.assign(o, { status: body.status || o.status, carrier: body.carrier == null ? o.carrier : body.carrier, tracking: body.tracking == null ? o.tracking : body.tracking });
          window.__fake.mails = (window.__fake.mails || []).concat(before !== o.status ? [[o.status, o.ref]] : []);
          persist();
          return ok({ order: o, mailed: before !== o.status });
        }
        if (!(admin ? ['payee', 'en_preparation'] : ['payee']).includes(o.status)) return fnError('cette commande est déjà en préparation : elle ne peut plus être annulée en ligne, écrivez-nous à contact@ateliergribouille.art');
        o.status = 'annulee'; o.refund = 're_fake'; persist();
        return ok({ order: o });
      }
      if (name !== 'commande') return fnError('fonction inconnue');
      const u = db.session && db.session.user;
      if (!u) return fnError('connexion requise');
      const cart = db.rows.filter((r) => r.user_id === u.id && (r.__table || 'compositions') === 'compositions' && r.meta && r.meta.cart);
      if (!cart.length) return fnError('panier vide');
      const ref = `AG-261125-T${++orderN}`;
      const now = new Date().toISOString();
      const items = cart.map((r) => Object.assign({}, r.meta.cart, { compId: r.id, title: r.name, label: 'article', unit: 10 }));
      const shipping = window.__fake.shipping == null ? 990 : window.__fake.shipping;
      db.rows.push({ __table: 'orders', id: `o-${orderN}`, user_id: u.id, ref, status: 'payee', email: u.email, consent: body.consent === true, items, subtotal_cents: 1000, shipping_cents: shipping, total_cents: 1000 + shipping, created_at: now, paid_at: now, carrier: null, tracking: null });
      cart.forEach((r) => { const c = r.meta.cart; delete r.meta.cart; r.meta.ordered = true; r.meta.order = Object.assign({}, c, { ref, at: now, paid: true }); r.name = `${ref} · ${r.name}`; });
      persist();
      return ok({ url: `${location.pathname}?commande=${ref}`, ref });
    },
  };
  window.supabase = { createClient: () => ({ auth, from, storage, rpc, functions }) };
})();
