// Faux client Supabase en mémoire, injecté dans la page par les tests (auth, table compositions, fichiers).
// Persistance de la session et des données dans localStorage pour survivre à un rechargement.
(function () {
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const db = { users: load('fake.users', {}), rows: load('fake.rows', []), files: load('fake.files', {}), session: load('fake.session', null) };
  const persist = () => { save('fake.users', db.users); save('fake.rows', db.rows); save('fake.files', db.files); save('fake.session', db.session); };
  const listeners = [];
  const emit = (ev) => { listeners.forEach((fn) => fn(ev, db.session)); };
  const setSession = (user) => { db.session = user ? { user } : null; persist(); emit(user ? 'SIGNED_IN' : 'SIGNED_OUT'); };
  const ok = (data) => Promise.resolve({ data, error: null });
  const ko = (message) => Promise.resolve({ data: null, error: { message } });
  window.__fake = { calls: [], db, forceRecovery: () => { emit('PASSWORD_RECOVERY'); } };
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

  const auth = {
    onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    getSession() { return ok({ session: db.session }); },
    signInWithPassword({ email, password }) {
      const u = db.users[email];
      if (!u || u.password !== password) return ko('Invalid login credentials');
      if (!u.confirmed) return ko('Email not confirmed');
      setSession(u); return ok({ session: db.session, user: u });
    },
    signUp({ email, password, options }) {
      if (db.users[email]) return ko('User already registered');
      if (password.length < 8) return ko('Password should be at least 8 characters');
      const u = { id: 'u-' + Math.random().toString(36).slice(2, 8), email, password, confirmed: !window.__FAKE_CONFIRM, user_metadata: (options && options.data) || {}, app_metadata: { provider: 'email' } };
      db.users[email] = u; persist();
      if (!u.confirmed) return ok({ session: null, user: u });
      setSession(u); return ok({ session: db.session, user: u });
    },
    signInWithOAuth({ provider, options }) { window.__fake.calls.push(['oauth', provider, options && options.redirectTo]); return ok({ url: 'about:blank' }); },
    signInWithOtp({ email }) { window.__fake.calls.push(['otp', email]); return ok({}); },
    resetPasswordForEmail(email) { window.__fake.calls.push(['reset', email]); return ok({}); },
    updateUser(attrs) {
      const u = db.session && db.users[db.session.user.email]; if (!u) return ko('not signed in');
      if (attrs.data) Object.assign(u.user_metadata, attrs.data);
      if (attrs.password) { if (attrs.password === u.password) return ko('New password should be different from the old password'); u.password = attrs.password; }
      if (attrs.email && attrs.email !== u.email) window.__fake.calls.push(['email-change', attrs.email]);
      db.session = { user: u }; persist(); emit('USER_UPDATED'); return ok({ user: u });
    },
    signOut() { setSession(null); return ok({}); },
  };
  const from = (table) => {
    const q = { filters: [], op: 'select', single: false, order: null };
    const run = () => {
      const uid = db.session && db.session.user.id;
      if (!uid) return ko('JWT expired');
      let rows = db.rows.filter((r) => r.user_id === uid && (r.__table || 'compositions') === table);
      q.filters.forEach(([k, v]) => { rows = rows.filter((r) => r[k] === v); });
      if (q.op === 'insert') { const row = Object.assign({ user_id: uid, created_at: new Date().toISOString(), __table: table }, q.row); db.rows.push(row); persist(); return ok([row]); }
      if (q.op === 'delete') { const ids = new Set(rows.map((r) => r.id)); db.rows = db.rows.filter((r) => !ids.has(r.id)); persist(); return ok(null); }
      if (q.order) rows.sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1));
      if (q.single) return rows.length ? ok(rows[0]) : ko('Row not found');
      return ok(rows);
    };
    const chain = {
      select() { return chain; }, insert(row) { q.op = 'insert'; q.row = row; return chain; }, delete() { q.op = 'delete'; return chain; },
      eq(k, v) { q.filters.push([k, v]); return chain; }, order(k) { q.order = k; return chain; }, single() { q.single = true; return chain; },
      then(res, rej) { return run().then(res, rej); },
    };
    return chain;
  };
  const storage = { from: () => ({
    async upload(path, blob) { db.files[path] = b64(await blob.arrayBuffer()); persist(); window.__fake.calls.push(['upload', path]); return { data: { path }, error: null }; },
    async download(path) { const f = db.files[path]; if (!f) return { data: null, error: { message: `fichier absent : ${path}` } }; return { data: new Blob([unb64(f)]), error: null }; },
    async list(prefix) { return { data: Object.keys(db.files).filter((p) => p.startsWith(prefix + '/')).map((p) => ({ name: p.slice(prefix.length + 1) })), error: null }; },
    async remove(paths) { paths.forEach((p) => { delete db.files[p]; }); persist(); return { data: paths, error: null }; },
    async createSignedUrl(path) { return db.files[path] ? { data: { signedUrl: 'blob:fake/' + path }, error: null } : { data: null, error: { message: 'fichier absent' } }; },
  }) };
  const rpc = (name) => {
    if (name !== 'delete_account') return ko('unknown function');
    const u = db.session && db.session.user; if (!u) return ko('non connecté');
    db.rows = db.rows.filter((r) => r.user_id !== u.id);
    Object.keys(db.files).forEach((p) => { if (p.startsWith(u.id + '/')) delete db.files[p]; });
    delete db.users[u.email]; db.session = null; persist();
    return ok(null);
  };
  window.supabase = { createClient: () => ({ auth, from, storage, rpc }) };
})();
