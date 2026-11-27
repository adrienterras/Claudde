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
      const u = { id: 'u-' + Math.random().toString(36).slice(2, 8), email, password, confirmed: !window.__FAKE_CONFIRM, user_metadata: (options && options.data) || {}, app_metadata: Object.assign({ provider: 'email' }, (window.__FAKE_ADMINS || []).includes(email) ? { atelier_role: 'admin' } : (window.__FAKE_VIEWERS || []).includes(email) ? { atelier_role: 'tableau' } : {}) };
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
      // (l'historique est sur le serveur, partagé : une ligne écrite depuis une autre fenêtre du site — l'atelier
      // en coulisse — se voit aussitôt)
      if (table === 'order_log') { const have = new Set(db.rows.map((r) => r.id)); load('fake.rows', []).forEach((r) => { if (r.__table === 'order_log' && !have.has(r.id)) db.rows.push(r); }); }
      let rows = db.rows.filter((r) => (table === 'order_log' ? isStaff(db.session && db.session.user) : (r.user_id === uid || (table === 'orders' && isStaff(db.session && db.session.user)))) && (r.__table || 'compositions') === table);
      // colonne, ou chemin JSON « meta->>clé » (texte : null si la clé manque ou vaut null)
      const val = (r, k) => { if (!k.includes('->>')) return r[k]; const [col, key] = k.split('->>'); const o = r[col]; return o && o[key] != null ? o[key] : null; };
      q.filters.forEach(([k, v, op]) => { rows = rows.filter((r) => { const x = val(r, k); return op === 'in' ? v.includes(x) : op === 'is' ? x == v : op === 'not-is' ? x != v : op === 'neq' ? x !== v : x === v; }); });
      // (comme la clé primaire : une ligne de même identifiant, même dans un autre compte, est refusée)
      if (q.op === 'insert' && q.row && q.row.id && db.rows.some((r) => r.id === q.row.id && (r.__table || 'compositions') === table)) return Promise.resolve({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` } });
      if (q.op === 'insert') { const row = Object.assign({ user_id: uid, created_at: new Date().toISOString(), __table: table }, q.row); db.rows.push(row); persist(); return ok([row]); }
      if (q.op === 'delete') { const ids = new Set(rows.map((r) => r.id)); db.rows = db.rows.filter((r) => !ids.has(r.id)); persist(); return ok(rows.map((r) => ({ id: r.id }))); } // (comme .delete().select() : les lignes supprimées)
      if (q.op === 'update') { rows.forEach((r) => Object.assign(r, q.row)); persist(); return ok(rows); }
      if (q.order) rows.sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1) * (q.asc ? -1 : 1));
      if (q.single) return rows.length ? ok(rows[0]) : q.single === 'maybe' ? ok(null) : ko('Cannot coerce the result to a single JSON object');
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      window.__fake.calls.push(['select', table, q.range ? q.range.join('-') : 'all']);
      return ok(rows);
    };
    const chain = {
      select() { return chain; }, insert(row) { q.op = 'insert'; q.row = row; return chain; }, delete() { q.op = 'delete'; return chain; }, update(row) { q.op = 'update'; q.row = row; return chain; },
      eq(k, v) { q.filters.push([k, v]); return chain; }, in(k, v) { q.filters.push([k, v, 'in']); return chain; }, neq(k, v) { q.filters.push([k, v, 'neq']); return chain; }, is(k, v) { q.filters.push([k, v, 'is']); return chain; }, not(k, op, v) { q.filters.push([k, v, 'not-' + op]); return chain; }, order(k, o) { q.order = k; q.asc = !!(o && o.ascending); return chain; }, single() { q.single = true; return chain; }, maybeSingle() { q.single = 'maybe'; return chain; }, range(a, b) { q.range = [a, b]; return chain; },
      then(res, rej) { return run().then(res, rej); },
    };
    return chain;
  };
  // les fichiers d'impression HD des commandes (bucket « impressions ») : l'équipe seulement, comme la règle
  // « impressions: staff » (dossier = une commande existante)
  const PRINTS = 'impressions:';
  const printsOk = (path) => isStaff(db.session && db.session.user) && db.rows.some((o) => o.__table === 'orders' && o.id === String(path).split('/')[0]);
  const prints = {
    async upload(path, blob) {
      if (!printsOk(path)) return { data: null, error: { message: 'new row violates row-level security policy' } };
      db.files[PRINTS + path] = b64(await blob.arrayBuffer()); persist(); window.__fake.calls.push(['upload-hd', path, blob.size, blob.type]);
      return { data: { path }, error: null };
    },
    async list(prefix) {
      if (!isStaff(db.session && db.session.user)) return { data: [], error: null };
      // (comme le vrai stockage, partagé : un fichier rangé depuis une autre fenêtre du site — l'atelier en
      // coulisse — se voit aussitôt)
      Object.assign(db.files, load('fake.files', {}));
      return { data: Object.keys(db.files).filter((p) => p.startsWith(PRINTS + prefix + '/')).map((p) => ({ name: p.slice(PRINTS.length + prefix.length + 1), metadata: { size: Math.round(db.files[p].length * 0.75) }, updated_at: new Date().toISOString() })), error: null };
    },
    async createSignedUrl(path) { return printsOk(path) && db.files[PRINTS + path] ? { data: { signedUrl: 'blob:fake/' + path }, error: null } : { data: null, error: { message: 'Object not found' } }; },
    async download(path) { return printsOk(path) && db.files[PRINTS + path] ? { data: new Blob([unb64(db.files[PRINTS + path])]), error: null } : { data: null, error: { message: 'Object not found' } }; },
  };
  const storage = { from: (bucket) => (bucket === 'impressions' ? prints : {
    async upload(path, blob) { db.files[path] = b64(await blob.arrayBuffer()); persist(); window.__fake.calls.push(['upload', path]); return { data: { path }, error: null }; },
    async download(path) {
      // (comme les règles du stockage : son dossier ; l'administrateur, le dossier d'un compte dont il a ouvert une œuvre)
      const uid = db.session && db.session.user.id, owner = path.split('/')[0];
      const me = db.session && db.session.user, work = path.split('/')[1];
      const opened = (l) => l.admin === uid && l.owner === owner && (isAdm(me) || l.id === work || ((db.rows.find((r) => r.id === l.id) || {}).meta || {}).fromWork === work);
      if (owner !== uid && !(isStaff(me) && work !== 'exports' && window.__fake.adminLog.some(opened))) return { data: null, error: { message: 'Object not found' } };
      const f = db.files[path]; if (!f) return { data: null, error: { message: `fichier absent : ${path}` } }; return { data: new Blob([unb64(f)]), error: null }; },
    async list(prefix) { return { data: Object.keys(db.files).filter((p) => p.startsWith(prefix + '/')).map((p) => ({ name: p.slice(prefix.length + 1) })), error: null }; },
    async copy(from, to) { const uid = db.session && db.session.user.id; if (window.__FAKE_COPY_FAIL || !db.files[from] || from.split('/')[0] !== uid) return { data: null, error: { message: 'Object not found' } }; db.files[to] = db.files[from]; persist(); window.__fake.calls.push(['copy', to, from]); return { data: { path: to }, error: null }; },
    async remove(paths) { if (window.__FAKE_REMOVE_FAIL) return { data: null, error: { message: 'réseau coupé' } }; paths.forEach((p) => { delete db.files[p]; }); persist(); return { data: paths, error: null }; }, // (__FAKE_REMOVE_FAIL : l'effacement des fichiers échoue)
    async createSignedUrl(path) { return db.files[path] ? { data: { signedUrl: 'blob:fake/' + path }, error: null } : { data: null, error: { message: 'fichier absent' } }; },
  }) };
  // (comme is_admin() : le rôle écrit côté serveur dans app_metadata, jamais l'e-mail, et la double authentification)
  const isAdm = (u) => !!(u && u.app_metadata && u.app_metadata.atelier_role === 'admin' && db.session && db.session.aal === 'aal2');
  // (comme is_staff() : l'administrateur ou l'équipe, rôle « tableau », avec la double authentification)
  const isStaff = (u) => !!(u && u.app_metadata && ['admin', 'tableau'].includes(u.app_metadata.atelier_role) && db.session && db.session.aal === 'aal2');
  // (une œuvre d'une commande payée : l'équipe peut l'ouvrir pour l'imprimer)
  const orderedWork = (id) => db.rows.some((o) => o.__table === 'orders' && !['attente_paiement', 'abandonnee'].includes(o.status) && (o.items || []).some((it) => it.compId === id));
  // l'historique des commandes (order_log), écrit comme le serveur : le prénom du compte qui agit
  const actorOf = (u) => String((u && u.user_metadata && u.user_metadata.name) || '').trim().split(/\s+/)[0] || String((u && u.email) || '').split('@')[0];
  const logOrder = (orderId, actor, action) => { db.rows.push({ __table: 'order_log', id: 'l-' + Math.random().toString(36).slice(2, 10), order_id: orderId, at: new Date(Date.now() + db.rows.length).toISOString(), actor, action }); persist(); };
  const rpc = (name, args) => {
    if (name === 'is_admin') return ok(isAdm(db.session && db.session.user));
    if (name === 'order_log_hd') {
      const u = db.session && db.session.user;
      if (!isStaff(u)) return ko('réservé à l’équipe');
      logOrder(args.p_order, actorOf(u), `fichier HD préparé (article ${(Number(args.p_index) || 0) + 1}, ${args.p_dpi} dpi)`);
      return ok(null);
    }
    // (les vignettes des œuvres commandées, pour l'équipe : staff_order_thumbs)
    if (name === 'staff_order_thumbs') {
      if (!isStaff(db.session && db.session.user)) return ok([]);
      return ok(db.rows.filter((r) => (args.p_ids || []).includes(r.id) && orderedWork(r.id) && r.thumb).map((r) => ({ id: r.id, thumb: r.thumb })));
    }
    if (name === 'admin_works' || name === 'admin_open') {
      const u = db.session && db.session.user;
      // (admin_works : l'administrateur ; admin_open : l'équipe aussi, pour une œuvre commandée seulement)
      if (!(name === 'admin_open' ? isStaff(u) && (isAdm(u) || orderedWork(args.p_id)) : isAdm(u))) return ko(isStaff(u) ? 'œuvre introuvable' : 'réservé à l\'administrateur, connecté avec la double authentification');
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
      // le partage d'une œuvre, comme la fonction « partage » (supabase/functions/partage) : « voir » sans
      // compte, « recevoir » : la copie dans le compte (fichiers copiés sous le même nom dans son dossier)
      if (name === 'partage' && body.action === 'creer') {
        // le lien créé par le serveur : jeton tiré au hasard, 30 jours ; celui en cours resservi
        const u = db.session && db.session.user;
        if (!u) return fnError('connexion requise');
        const w = db.rows.find((r) => r.id === body.id && r.user_id === u.id && (r.__table || 'compositions') === 'compositions');
        if (!w || (w.meta && w.meta.cart)) return fnError('œuvre introuvable dans votre compte');
        const cur = w.meta && w.meta.share;
        if (cur && new Date(cur.expires).getTime() > Date.now() + 864e5) return ok({ token: cur.token, expires: cur.expires });
        const b = crypto.getRandomValues(new Uint8Array(18));
        const share = { token: btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), at: new Date().toISOString(), expires: new Date(Date.now() + 30 * 864e5).toISOString() };
        w.meta = Object.assign({}, w.meta, { share });
        persist();
        return ok({ token: share.token, expires: share.expires });
      }
      if (name === 'partage') {
        const row = db.rows.find((r) => (r.__table || 'compositions') === 'compositions' && r.meta && r.meta.share && r.meta.share.token === body.token);
        const sh = row && row.meta.share;
        if (!row || sh.revoked || new Date(sh.expires).getTime() <= Date.now()) return fnError('ce lien de partage n’est plus valable : demandez-en un nouveau');
        if (body.action === 'voir') {
          const owner = Object.values(db.users).find((x) => x.id === row.user_id);
          return ok({ name: row.name, thumb: row.thumb, n: row.meta.n || null, from: String((owner && owner.user_metadata && owner.user_metadata.name) || '').split(/\s+/)[0], expires: sh.expires });
        }
        const u = db.session && db.session.user;
        if (!u) return fnError('connexion requise');
        if (row.user_id === u.id) return ok({ id: row.id, own: true });
        const had = db.rows.find((r) => r.user_id === u.id && r.meta && r.meta.sharedFrom === body.token);
        if (had) return ok({ id: had.id, again: true });
        const id = crypto.randomUUID(), map = new Map();
        const fix = (p) => { if (typeof p !== 'string') return p; if (!map.has(p)) { const to = `${u.id}/${id}/${p.split('/').pop()}`; db.files[to] = db.files[p]; map.set(p, to); } return map.get(p); };
        const meta = JSON.parse(JSON.stringify(row.meta));
        meta.drawings.forEach((d) => {
          d.file = fix(d.file);
          (d.pieceEdits || []).forEach((e) => { if (e && e.mask) e.mask = fix(e.mask); });
          if (d.saved && d.saved.page && typeof d.saved.page.data === 'string') { d.saved.page.data = fix(d.saved.page.data); (d.saved.atlases || []).forEach((a) => { a.data = fix(a.data); }); }
        });
        ['share', 'cart', 'ordered', 'order', 'fromWork', 'frozen', 'draft', 'device'].forEach((k) => { delete meta[k]; });
        Object.assign(meta, { work: true, sharedFrom: body.token, date: new Date().toISOString(), workName: row.name });
        db.rows.push({ id, user_id: u.id, name: row.name, thumb: row.thumb, created_at: new Date().toISOString(), meta });
        persist();
        return ok({ id });
      }
      // l'annulation (le client tant que « payée », l'administrateur jusqu'à l'expédition) et le statut (administrateur)
      if (name === 'commande-annuler' || name === 'commande-statut') {
        const u = db.session && db.session.user;
        if (!u) return fnError('connexion requise');
        const o = db.rows.find((r) => r.__table === 'orders' && r.id === body.id);
        const admin = isStaff(u); // (l'administrateur ou l'équipe)
        if (!o || (!admin && o.user_id !== u.id)) return fnError('commande inconnue');
        if (name === 'commande-statut') {
          if (!admin) return fnError('réservé à l’administrateur, connecté avec la double authentification');
          const before = o.status;
          Object.assign(o, { status: body.status || o.status, carrier: body.carrier == null ? o.carrier : body.carrier, tracking: body.tracking == null ? o.tracking : body.tracking });
          window.__fake.mails = (window.__fake.mails || []).concat(before !== o.status ? [[o.status, o.ref]] : []);
          const LBL = { en_preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée' };
          const parts = [before !== o.status ? `passée « ${LBL[o.status] || o.status} »` : '', body.tracking ? `suivi : ${[o.carrier, o.tracking].filter(Boolean).join(' ')}` : ''].filter(Boolean);
          if (parts.length) logOrder(o.id, actorOf(u), parts.join(', '));
          persist();
          return ok({ order: o, mailed: before !== o.status });
        }
        if (!(admin ? ['payee', 'en_preparation'] : ['payee']).includes(o.status)) return fnError('cette commande est déjà en préparation : elle ne peut plus être annulée en ligne, écrivez-nous à contact@ateliergribouille.art');
        o.status = 'annulee'; o.refund = 're_fake'; persist();
        logOrder(o.id, admin && o.user_id !== u.id ? actorOf(u) : 'le client', `annulée et remboursée (${((o.total_cents || 0) / 100).toFixed(2).replace('.', ',')} €)`);
        return ok({ order: o });
      }
      // le tableau de bord (administrateur et double authentification, comme la vraie fonction) : les
      // chiffres tirés du faux serveur ; ni GitHub ni Umami
      if (name === 'tableau-de-bord') {
        const u = db.session && db.session.user;
        // (l'administrateur, ou le rôle « tableau » : lecture du tableau de bord seulement)
        const reader = u && u.app_metadata && ['admin', 'tableau'].includes(u.app_metadata.atelier_role) && db.session && db.session.aal === 'aal2';
        if (!reader) return fnError('réservé à l’équipe du site, connectée avec la double authentification');
        const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10));
        const orders = db.rows.filter((r) => r.__table === 'orders');
        const paid = orders.filter((o) => o.paid_at && !['annulee', 'abandonnee', 'attente_paiement'].includes(o.status));
        const sum = (list) => ({ cents: list.reduce((a, o) => a + (o.total_cents || 0), 0), n: list.length });
        const statuts = {}; orders.forEach((o) => { statuts[o.status] = (statuts[o.status] || 0) + 1; });
        const works = db.rows.filter((r) => (r.__table || 'compositions') === 'compositions' && !(r.meta && (r.meta.cart || r.meta.draft)));
        return ok({
          at: new Date().toISOString(),
          ventes: { today: sum(paid), d7: sum(paid), d30: sum(paid), byDay: days.map((d) => ({ d, cents: paid.filter((o) => o.paid_at.slice(0, 10) === d).reduce((a, o) => a + o.total_cents, 0) })), statuts, stripeMode: 'test',
            aPreparer: orders.filter((o) => o.status === 'payee').map((o) => ({ ref: o.ref, total_cents: o.total_cents, paid_at: o.paid_at, delivery: o.delivery, client: (o.shipping && o.shipping.name) || '', articles: (o.items || []).length })),
            equipe: db.rows.filter((l) => l.__table === 'order_log' && l.action !== 'payée').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 25).map((l) => ({ at: l.at, actor: l.actor, action: l.action, ref: ((orders.find((o) => o.id === l.order_id)) || {}).ref || '' })) },
          activite: { comptes: { total: Object.keys(db.users).length, d7: Object.keys(db.users).length }, oeuvres: { total: works.length, d7: works.length }, partages: { actifs: 0, recus7: 0 }, stockage: { bytes: 0, files: Object.keys(db.files).length }, byDay: days.map((d) => ({ d, comptes: 0, oeuvres: 0 })) },
          audience: { error: 'Audience non branchée : ajoutez la clé UMAMI_API_KEY dans les secrets Supabase (voir docs/TABLEAU-DE-BORD.md).' },
          sante: { deploys: [], deployError: 'api.github.com : 404', erreurs24: 1, erreurs: [{ at: new Date().toISOString(), fn: 'partage', message: '<b>boom</b>' }], emails: [], services: { resend: false, umami: false, github: false } },
        });
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
      db.rows.push({ __table: 'orders', id: crypto.randomUUID(), user_id: u.id, ref, status: 'payee', email: u.email, consent: body.consent === true, items, subtotal_cents: 1000, shipping_cents: shipping, total_cents: 1000 + shipping, created_at: now, paid_at: now, carrier: null, tracking: null });
      cart.forEach((r) => { const c = r.meta.cart; delete r.meta.cart; r.meta.ordered = true; r.meta.order = Object.assign({}, c, { ref, at: now, paid: true }); r.name = `${ref} · ${r.name}`; });
      persist();
      return ok({ url: `/commandes.html?commande=${ref}`, ref }); // (comme le serveur : la page Mes commandes du site)
    },
  };
  window.supabase = { createClient: () => ({ auth, from, storage, rpc, functions }) };
})();
