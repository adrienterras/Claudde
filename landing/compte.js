/*
 * Le compte dans l'en-tête du site : l'atelier (même origine) garde sa session Supabase dans le
 * stockage local (clé « sb-<projet>-auth-token ») ; sans charger Supabase, on y lit si quelqu'un est
 * connecté et son prénom. Connecté : la pastille du compte, comme dans l'atelier (la photo du compte,
 * sinon l'initiale), et « Prénom » → atelier/?compte (le panneau Mon compte) ; sinon
 * « Se connecter » → atelier/?connexion (le panneau de connexion). Chargé avant i18n.js, pour que le
 * libellé soit traduit avec le reste de la page.
 */
(function () {
  'use strict';
  function session() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        var s = JSON.parse(localStorage.getItem(k));
        if (s && s.user && (s.access_token || s.refresh_token)) return s.user;
      }
    } catch (e) { /* stockage inaccessible ou illisible : non connecté */ }
    return null;
  }
  function name(u) {
    var m = u.user_metadata || {};
    return (m.name || m.full_name || (u.email ? u.email.split('@')[0] : '') || '').trim();
  }
  // la pastille du compte, comme dans l'atelier (.acc-avatar) : la photo du compte, sinon l'initiale
  function avatar(a, u, n) {
    var icon = a.querySelector('svg');
    var av = a.querySelector('.acc-avatar');
    if (!u) {
      if (av) av.remove();
      if (icon) icon.removeAttribute('hidden');
      return;
    }
    if (!av) {
      av = document.createElement('i');
      av.className = 'acc-avatar';
      av.setAttribute('aria-hidden', 'true');
      a.insertBefore(av, a.firstChild);
    }
    var m = u.user_metadata || {};
    var pic = m.avatar_url || m.picture || '';
    av.textContent = pic ? '' : (n.charAt(0) || '?').toUpperCase();
    av.style.backgroundImage = pic ? 'url("' + String(pic).replace(/["\\]/g, '') + '")' : '';
    if (icon) icon.setAttribute('hidden', '');
  }
  function run() {
    var u = session();
    document.querySelectorAll('a.nav-account').forEach(function (a) {
      var label = a.querySelector('span');
      avatar(a, u, u ? name(u) : '');
      if (u) {
        var n = name(u);
        a.href = 'atelier/?compte';
        a.classList.add('on');
        a.setAttribute('aria-label', 'Mon compte');
        if (label) label.textContent = n || 'Mon compte';
        a.title = 'Mon compte';
      } else {
        a.href = 'atelier/?connexion';
        a.classList.remove('on');
        if (label) label.textContent = 'Se connecter';
      }
    });
  }
  run();
})();
