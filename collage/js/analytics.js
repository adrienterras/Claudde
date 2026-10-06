/*
 * Mesure d'audience, sans cookie ni identifiant : Plausible (plausible.io), exempté de bandeau
 * de consentement par la CNIL. Activée seulement si ATELIER_CONFIG.analytics est renseigné ;
 * rien n'est chargé sinon (tests, artefact, copie locale). Le script ignore de lui-même localhost.
 *
 *   analytics: { provider: 'plausible', domain: 'ateliergribouille.art' }
 *
 * Les événements (Atelier.track) sont des compteurs d'usage : import, proposition choisie,
 * export, guide, sauvegarde, inscription. Jamais de contenu, de nom de fichier ni d'e-mail.
 */
(function () {
  'use strict';
  const cfg = (window.ATELIER_CONFIG || {}).analytics;
  const noop = () => {};
  if (!cfg || !cfg.domain) { window.Atelier = Object.assign(window.Atelier || {}, { track: noop }); return; }
  const host = cfg.host || 'https://plausible.io';
  window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  const s = document.createElement('script');
  s.defer = true; s.src = host + '/js/script.outbound-links.js'; s.dataset.domain = cfg.domain;
  document.head.appendChild(s);
  window.Atelier = Object.assign(window.Atelier || {}, {
    track(name, props) { try { window.plausible(name, props ? { props } : undefined); } catch (e) { /* ignoré */ } },
  });
})();
