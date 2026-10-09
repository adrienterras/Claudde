/*
 * Mesure d'audience, sans cookie ni identifiant personnel. Activée seulement si
 * ATELIER_CONFIG.analytics est renseigné ; rien n'est chargé sinon (tests, artefact, copie locale).
 *
 *   analytics: { provider: 'umami', websiteId: '…', host: 'https://cloud.umami.is' }   // gratuit
 *   analytics: { provider: 'plausible', domain: 'ateliergribouille.art' }              // payant
 *
 * Les événements (Atelier.track) sont des compteurs d'usage : import, proposition choisie,
 * export, guide, sauvegarde, inscription. Jamais de contenu, de nom de fichier ni d'e-mail.
 * Voir docs/ANALYTIQUE.md.
 */
(function () {
  'use strict';
  const cfg = (window.ATELIER_CONFIG || {}).analytics;
  const noop = () => {};
  window.Atelier = Object.assign(window.Atelier || {}, { track: noop });
  if (!cfg || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  const s = document.createElement('script');
  s.defer = true;
  if (cfg.provider === 'umami' && cfg.websiteId) {
    s.src = (cfg.host || 'https://cloud.umami.is') + '/script.js';
    s.dataset.websiteId = cfg.websiteId;
    // sans la partie « ?… » des adresses : les codes de connexion (retour d'un lien e-mail) n'en sortent pas
    s.dataset.excludeSearch = 'true';
    window.Atelier.track = (name, props) => { try { if (window.umami) window.umami.track(name, props); } catch (e) { /* ignoré */ } };
  } else if (cfg.provider === 'plausible' && cfg.domain) {
    s.src = (cfg.host || 'https://plausible.io') + '/js/script.outbound-links.js';
    s.dataset.domain = cfg.domain;
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
    window.Atelier.track = (name, props) => { try { window.plausible(name, props ? { props } : undefined); } catch (e) { /* ignoré */ } };
  } else return;
  document.head.appendChild(s);
})();
