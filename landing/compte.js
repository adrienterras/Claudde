/*
 * Le compte dans l'en-tête du site (accueil, Tarifs, Idées, Photographier, À propos).
 *
 * Toujours une pastille ronde, entourée : la photo du compte (ou son initiale) une fois connecté,
 * sinon l'icône de profil.
 * - Non connecté : la pastille ouvre, sur la page même, la fenêtre de connexion (Google, e-mail et mot
 *   de passe, création de compte, lien par e-mail, mot de passe oublié). On reste sur la page.
 * - Connecté : la pastille ouvre un petit menu, « Mon compte » (l'atelier, tiroir du compte ouvert en
 *   grand) et « Se déconnecter ».
 *
 * L'atelier (même origine) garde la session Supabase dans le stockage local (« sb-<projet>-auth-token ») :
 * à l'arrivée, on y lit seulement si quelqu'un est connecté, sans rien charger. Le client Supabase et le
 * module des comptes de l'atelier (atelier/js/account.js) ne se chargent qu'au besoin : connexion,
 * déconnexion, ou retour d'une connexion Google ou d'un lien reçu par e-mail (?code=…). La session est
 * la même que celle de l'atelier. Chargé avant i18n.js : les textes de la page sont traduits avec le
 * reste ; ceux créés ensuite passent par SiteI18n.t.
 */
(function () {
  'use strict';
  const me = document.currentScript;
  const V = ((me && /[?&]v=([^&#]+)/.exec(me.src)) || [])[1];
  const ver = V ? `?v=${V}` : '';
  const t = (s) => (window.SiteI18n ? window.SiteI18n.t(s) : s);
  const en = () => !!(window.SiteI18n && window.SiteI18n.lang === 'en');
  // tr() attendu par le module des comptes de l'atelier : ses clés ont la forme « … {0} … »
  function trFn(strs, ...vals) {
    const key = Array.isArray(strs) && strs.raw ? strs.reduce((a, s, i) => a + s + (i < vals.length ? `{${i}}` : ''), '') : String(strs);
    return t(key).replace(/\{(\d+)\}/g, (m, i) => (vals[i] !== undefined ? vals[i] : m));
  }

  function storedUser() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        const s = JSON.parse(localStorage.getItem(k));
        if (s && s.user && (s.access_token || s.refresh_token)) return s.user;
      }
    } catch (e) { /* stockage inaccessible ou illisible : non connecté */ }
    return null;
  }
  // le nombre d'articles du panier, tel que l'atelier le garde sur cet appareil (copie du panier du compte)
  const cartCount = () => {
    try { const items = JSON.parse(localStorage.getItem('atelier-gribouille:panier') || '[]'); return Array.isArray(items) ? items.reduce((a, it) => a + (Number(it && it.qty) > 0 ? Math.round(Number(it.qty)) : 0), 0) : 0; } catch (e) { return 0; }
  };
  const nameOf = (u) => { const m = (u && u.user_metadata) || {}; return (m.name || m.full_name || (u && u.email ? u.email.split('@')[0] : '') || '').trim(); };
  // la photo du compte Google seulement (le seul hôte que la CSP ouvre aux images), sinon l'initiale
  const picOf = (u) => { const m = (u && u.user_metadata) || {}; const p = m.avatar_url || m.picture || ''; return typeof p === 'string' && /^https:\/\/lh3\.googleusercontent\.com\/[^"'\\()\s]+$/.test(p) ? p : ''; };

  const CSS = `
    .nav nav a.nav-account.round, .nav nav a.nav-account.round.on { width: 38px; height: 38px; padding: 0; gap: 0; justify-content: center; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); color: var(--ink); font-weight: 600; flex: none; }
    .nav nav a.nav-account.round:hover { border-color: var(--accent); }
    .nav nav a.nav-account.round .acc-avatar { width: 30px; height: 30px; font-size: .78rem; }
    .nav nav a.nav-account.round svg { width: 19px; height: 19px; }
    .nav nav a.nav-account.round > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .acc-pop { position: fixed; z-index: 60; min-width: 190px; padding: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 40px -18px rgba(43, 42, 34, .45); display: grid; font-family: var(--f-body); }
    .acc-pop[hidden] { display: none; }
    .acc-pop .who { padding: 8px 10px 6px; font-size: .78rem; color: var(--muted); border-bottom: 1px solid var(--line); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .acc-pop a, .acc-pop button { display: block; width: 100%; text-align: left; padding: 10px; border: 0; border-radius: 9px; background: none; font: inherit; font-size: .9rem; color: var(--ink); text-decoration: none; cursor: pointer; }
    .acc-pop a:hover, .acc-pop button:hover { background: var(--surface-2); }
    .acc-pop a.cart { display: flex; align-items: center; gap: 9px; }
    .acc-pop a.cart svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .acc-pop .cart-count { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; margin-left: auto; box-sizing: border-box; border-radius: 999px; background: var(--ink); color: var(--craie); font-size: .7rem; font-weight: 600; }
    .acc-modal { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 16px; background: rgba(43, 42, 34, .45); overflow-y: auto; font-family: var(--f-body); }
    .acc-modal[hidden] { display: none; }
    .acc-modal .card { position: relative; width: min(420px, 100%); margin: auto; padding: 28px 24px 22px; background: var(--craie); border-radius: 22px; box-shadow: 0 30px 70px -30px rgba(0, 0, 0, .6); display: grid; gap: 12px; }
    .acc-modal h2 { margin: 0; font-family: var(--f-display); font-weight: 400; font-size: 1.7rem; line-height: 1.15; }
    .acc-modal .sub { margin: -4px 0 4px; color: var(--ink-2); font-size: .92rem; }
    .acc-modal .x { position: absolute; top: 10px; right: 12px; width: 36px; height: 36px; border: 0; border-radius: 50%; background: none; font-size: 1.5rem; line-height: 1; color: var(--ink-2); cursor: pointer; }
    .acc-modal .x:hover { background: var(--surface-2); }
    .acc-modal .btn { justify-content: center; width: 100%; }
    .acc-modal .google { background: var(--surface); border: 1px solid var(--line); color: var(--ink); }
    .acc-modal .google svg { width: 18px; height: 18px; }
    .acc-modal .or { display: flex; align-items: center; gap: 10px; margin: 2px 0; color: var(--muted); font-size: .8rem; }
    .acc-modal .or::before, .acc-modal .or::after { content: ''; flex: 1; border-top: 1px solid var(--line); }
    .acc-modal .tabs { display: grid; grid-template-columns: 1fr 1fr; padding: 3px; background: var(--surface-2); border-radius: 999px; }
    .acc-modal .tabs button { border: 0; border-radius: 999px; padding: 9px 6px; background: none; font: inherit; font-size: .84rem; color: var(--ink-2); cursor: pointer; }
    .acc-modal .tabs button.on { background: var(--craie); color: var(--ink); font-weight: 600; box-shadow: 0 2px 8px -4px rgba(0, 0, 0, .3); }
    .acc-modal form { display: grid; gap: 10px; }
    .acc-modal label { display: grid; gap: 5px; font-size: .84rem; font-weight: 600; color: var(--ink-2); }
    .acc-modal label[hidden] { display: none; }
    .acc-modal label small { font-weight: 400; color: var(--muted); }
    .acc-modal input { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); font: inherit; font-size: 16px; font-weight: 400; color: var(--ink); }
    .acc-modal input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .acc-modal .links { margin: 0; text-align: center; font-size: .82rem; color: var(--muted); }
    .acc-modal .links button { border: 0; background: none; padding: 2px; font: inherit; color: var(--ink-2); text-decoration: underline; cursor: pointer; }
    .acc-modal .status { margin: 0; font-size: .86rem; color: var(--accent); }
    .acc-modal .status.err { color: var(--argile); }
    .acc-modal .status:empty { display: none; }
    .acc-modal .legal { margin: 2px 0 0; font-size: .74rem; color: var(--muted); text-align: center; }
    #auth-captcha[hidden] { display: none; }
  `;
  const CART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2.2l2.1 10.4a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.4"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>';
  const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853" stroke="none"/><path d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.5l3.3-2.6z" fill="#FBBC05" stroke="none"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" fill="#EA4335" stroke="none"/></svg>';
  function addStyle() {
    if (document.getElementById('acc-style')) return;
    const st = document.createElement('style');
    st.id = 'acc-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const el = (tag, props, kids) => {
    const e = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => { if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v); });
    (kids || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  };

  // ---------- Le module des comptes, chargé au besoin ----------
  let loading = null;
  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error(t('Pas de connexion au service des comptes. Vérifiez votre réseau.')));
    document.body.appendChild(s);
  });
  function account() {
    if (window.Account && window.Account.enabled && window.Account.__site) return Promise.resolve(window.Account);
    if (!loading) {
      loading = (window.supabase ? Promise.resolve() : load(`atelier/vendor/supabase.js${ver}`))
        .then(() => { if (!window.tr) window.tr = trFn; return window.Account ? null : load(`atelier/js/account.js${ver}`); })
        .then(() => {
          const A = window.Account;
          if (!A || !A.enabled) throw new Error(t('Le service des comptes n’est pas disponible pour le moment.'));
          A.init();
          A.__site = true;
          A.onChange((u) => { user = u; render(); });
          return A;
        });
      loading.catch(() => { loading = null; });
    }
    return loading;
  }

  // ---------- La pastille et son menu ----------
  let user = storedUser();
  let pop = null;
  function render() {
    addStyle();
    document.querySelectorAll('a.nav-account').forEach((a) => {
      const icon = a.querySelector('svg'), label = a.querySelector('span');
      let av = a.querySelector('.acc-avatar');
      a.classList.add('round');
      if (user) {
        const n = nameOf(user), pic = picOf(user);
        if (!av) { av = el('i', { class: 'acc-avatar', 'aria-hidden': 'true' }); a.insertBefore(av, a.firstChild); }
        av.textContent = pic ? '' : (n.charAt(0) || '?').toUpperCase();
        av.style.backgroundImage = pic ? `url("${pic}")` : '';
        if (icon) icon.setAttribute('hidden', '');
        a.classList.add('on');
        a.href = 'atelier/?compte';
        a.setAttribute('aria-haspopup', 'menu');
        a.setAttribute('aria-expanded', pop && !pop.hidden ? 'true' : 'false');
        if (label) label.textContent = t('Mon compte');
        a.setAttribute('aria-label', t('Mon compte'));
        a.title = n ? `${t('Mon compte')} · ${n}` : t('Mon compte');
      } else {
        if (av) av.remove();
        if (icon) icon.removeAttribute('hidden');
        a.classList.remove('on');
        a.href = 'atelier/?connexion';
        a.removeAttribute('aria-haspopup');
        a.removeAttribute('aria-expanded');
        if (label) label.textContent = t('Se connecter');
        a.setAttribute('aria-label', t('Se connecter'));
        a.title = t('Se connecter');
        if (pop) pop.hidden = true;
      }
      if (!a.dataset.wired) {
        a.dataset.wired = '1';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (user) togglePop(a); else openModal();
        });
      }
    });
  }
  function togglePop(a) {
    if (!pop) {
      pop = el('div', { class: 'acc-pop', role: 'menu', hidden: '' });
      document.body.appendChild(pop);
      document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) closePop(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { closePop(); a.focus(); } });
      window.addEventListener('resize', closePop);
      window.addEventListener('scroll', closePop, { passive: true });
    }
    if (!pop.hidden) { closePop(); return; }
    pop.textContent = '';
    const n = nameOf(user);
    if (n || user.email) pop.appendChild(el('p', { class: 'who', text: user.email || n }));
    pop.appendChild(el('a', { role: 'menuitem', href: `atelier/?compte${en() ? '&lang=en' : ''}`, target: '_blank', rel: 'noopener', text: t('Mon compte') }));
    // le panier, comme dans l'atelier : l'icône du chariot et le nombre d'articles ; il s'ouvre dans l'atelier
    const items = cartCount();
    const cart = el('a', { role: 'menuitem', class: 'cart', href: `atelier/?panier${en() ? '&lang=en' : ''}`, target: '_blank', rel: 'noopener', 'aria-label': items ? trFn`Mon panier : ${items} article(s)` : t('Mon panier') });
    cart.innerHTML = CART_ICON;
    cart.appendChild(el('span', { text: t('Mon panier') }));
    if (items) cart.appendChild(el('b', { class: 'cart-count', text: String(items) }));
    pop.appendChild(cart);
    const out = el('button', { type: 'button', role: 'menuitem', text: t('Se déconnecter') });
    out.addEventListener('click', () => {
      out.disabled = true;
      account().then((A) => A.signOut()).then(() => { user = null; render(); closePop(); })
        .catch((e) => { out.disabled = false; out.textContent = (e && e.message) || t('Se déconnecter'); });
    });
    pop.appendChild(out);
    pop.querySelectorAll('a').forEach((x) => x.addEventListener('click', closePop));
    const r = a.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
    pop.hidden = false;
    a.setAttribute('aria-expanded', 'true');
    const first = pop.querySelector('[role="menuitem"]');
    if (first) first.focus();
  }
  function closePop() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    document.querySelectorAll('a.nav-account').forEach((a) => a.setAttribute('aria-expanded', 'false'));
  }

  // ---------- La fenêtre de connexion ----------
  let modal = null, mode = 'signin';
  function buildModal() {
    addStyle();
    const close = el('button', { type: 'button', class: 'x', 'aria-label': t('Fermer'), text: '×' });
    const google = el('button', { type: 'button', class: 'btn google' });
    google.innerHTML = GOOGLE;
    google.appendChild(el('span', { text: t('Continuer avec Google') }));
    const tabs = el('div', { class: 'tabs', role: 'tablist' }, [
      el('button', { type: 'button', 'data-mode': 'signin', role: 'tab', text: t('J’ai déjà un compte') }),
      el('button', { type: 'button', 'data-mode': 'signup', role: 'tab', text: t('Créer un compte') }),
    ]);
    const nameField = el('label', { hidden: '' }, [el('span', {}, [`${t('Prénom')} `, el('small', { text: t('(facultatif)') })]), el('input', { id: 'accm-name', type: 'text', autocomplete: 'name', maxlength: '60' })]);
    const emailField = el('label', {}, [t('E-mail'), el('input', { id: 'accm-email', type: 'email', autocomplete: 'email', inputmode: 'email', required: '' })]);
    const pwField = el('label', {}, [t('Mot de passe'), el('input', { id: 'accm-password', type: 'password', autocomplete: 'current-password', required: '' })]);
    const submit = el('button', { type: 'submit', class: 'btn btn-primary', id: 'accm-submit' });
    const forgot = el('button', { type: 'button', id: 'accm-forgot', text: t('Mot de passe oublié ?') });
    const magic = el('button', { type: 'button', id: 'accm-magic', text: t('Lien de connexion par e-mail') });
    const form = el('form', { novalidate: '' }, [nameField, emailField, pwField, el('div', { id: 'auth-captcha', hidden: '' }), submit, el('p', { class: 'links' }, [forgot, ' · ', magic])]);
    const status = el('p', { class: 'status', role: 'status' });
    const legal = el('p', { class: 'legal' }, [`${t('En continuant, vous acceptez notre')} `, el('a', { href: 'confidentialite.html', target: '_blank', rel: 'noopener', text: t('politique de confidentialité') }), '.']);
    const card = el('div', { class: 'card' }, [close, el('h2', { id: 'accm-title', text: t('Bienvenue à l’atelier') }), el('p', { class: 'sub', text: t('Retrouvez vos œuvres sur tous vos appareils.') }), google, el('p', { class: 'or', text: t('ou') }), tabs, form, status, legal]);
    modal = el('div', { class: 'acc-modal', id: 'acc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'accm-title', hidden: '' }, [card]);
    document.body.appendChild(modal);

    const say = (msg, err) => { status.textContent = msg || ''; status.classList.toggle('err', !!err); };
    const setMode = (m) => {
      mode = m;
      tabs.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-selected', b.dataset.mode === m ? 'true' : 'false'); });
      nameField.hidden = m !== 'signup';
      submit.textContent = m === 'signup' ? t('Créer mon compte') : t('Se connecter');
      form.querySelector('#accm-password').setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
      say('');
    };
    setMode('signin');
    // une demande à la fois ; le message dit où l'on en est
    const busy = (fn, okMsg) => {
      const btns = card.querySelectorAll('button');
      btns.forEach((b) => { b.disabled = true; });
      say(t('Un instant…'));
      return Promise.resolve().then(fn)
        .then((r) => { if (okMsg !== null) say(typeof okMsg === 'function' ? okMsg(r) : okMsg || ''); return r; })
        .catch((e) => { say((e && e.message) || String(e), true); })
        .finally(() => { btns.forEach((b) => { b.disabled = false; }); });
    };
    const email = () => form.querySelector('#accm-email').value.trim();
    close.onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && !modal.hidden) closeModal(); });
    tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
    google.onclick = () => busy(() => account().then((A) => A.signInWith('google')), null);
    form.onsubmit = (e) => {
      e.preventDefault();
      const em = email(), pw = form.querySelector('#accm-password').value, nm = form.querySelector('#accm-name').value.trim();
      if (!em || !pw) { say(t('Indiquez votre e-mail et votre mot de passe.'), true); return; }
      if (mode === 'signup') {
        busy(() => account().then((A) => {
          const r = A.checkPassword(pw, { email: em, name: nm });
          if (!r.ok) throw new Error(trFn`Mot de passe trop faible : ${r.problems.join(' ; ')}.`);
          return A.signUpEmail(em, pw, nm);
        }).then((r) => {
          if (window.Atelier && window.Atelier.track) window.Atelier.track('Inscription', { via: 'email' });
          if (r && r.needsConfirm) { setMode('signin'); return trFn`Compte créé : confirmez votre e-mail avec le lien envoyé à ${em}, puis connectez-vous.`; }
          closeModal();
          return '';
        }), (m) => m);
      } else {
        busy(() => account().then((A) => A.signInEmail(em, pw)).then(() => closeModal()), '');
      }
    };
    forgot.onclick = () => {
      const em = email();
      if (!em) { say(t('Indiquez d’abord votre e-mail.'), true); return; }
      // (le nouveau mot de passe se choisit dans l'atelier, qui a le formulaire)
      busy(() => account().then((A) => A.resetPassword(em, `${location.origin}/atelier/`)), trFn`Un lien pour choisir un nouveau mot de passe a été envoyé à ${em}.`);
    };
    magic.onclick = () => {
      const em = email();
      if (!em) { say(t('Indiquez d’abord votre e-mail.'), true); return; }
      busy(() => account().then((A) => A.magicLink(em)), trFn`Si un compte existe pour ${em}, un lien de connexion vient d’y être envoyé : ouvrez-le sur cet appareil. Pas encore de compte ? Choisissez « Créer un compte ».`);
    };
  }
  let lastFocus = null;
  function openModal() {
    if (!modal) buildModal();
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    // le module se charge pendant qu'on remplit le formulaire
    account().catch(() => {});
    const first = modal.querySelector('#accm-email');
    if (first && window.matchMedia('(min-width: 601px)').matches) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  render();
  // retour d'une connexion Google ou d'un lien reçu par e-mail : la session s'établit ici, sur la page
  // (après les autres scripts de la page : la configuration, atelier/config.js, est chargée ensuite)
  if (/[?&](code|error_description)=/.test(location.search) || /access_token=/.test(location.hash)) window.addEventListener('DOMContentLoaded', () => { account().catch(() => {}); });
  window.SiteAccount = { open: openModal, render: () => { user = storedUser(); render(); } };
})();
