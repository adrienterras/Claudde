/*
 * Mesure d'audience, sans cookie ni identifiant personnel. Activée seulement si
 * ATELIER_CONFIG.analytics est renseigné ; rien n'est envoyé sinon (tests, artefact, copie locale).
 *
 *   analytics: { provider: 'umami', websiteId: '…' }                       // Umami Cloud, gratuit
 *   analytics: { provider: 'plausible', domain: 'ateliergribouille.art' }  // payant
 *
 * Aucun script tiers n'est chargé (audit du 16 novembre 2026) : la page envoie elle-même la visite et
 * les événements à l'adresse de collecte de l'outil (endpoint), comme le ferait son script, avec
 * seulement le chemin de la page (jamais la partie « ?… », où passent les codes de connexion), la
 * provenance réduite à son site, la taille d'écran et la langue. Un script chargé depuis Umami
 * tournerait avec les mêmes droits que la page, dont la session du compte : s'il était compromis, il
 * pourrait la lire.
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
  // (ni copie locale, ni navigateur piloté par un programme : tests, robots)
  if (!cfg || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || navigator.webdriver) return;
  // la provenance : le site d'où l'on vient, sans chemin ni paramètres ; rien si c'est ce site
  const referrer = (() => { try { const r = new URL(document.referrer); return r.host === location.host ? '' : r.origin + '/'; } catch (e) { return ''; } })();
  const post = (url, body) => {
    try { fetch(url, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(noop); } catch (e) { /* ignoré */ }
  };
  let send;
  if (cfg.provider === 'umami' && cfg.websiteId) {
    const endpoint = cfg.endpoint || 'https://gateway.umami.is/api/send';
    send = (name, data) => post(endpoint, { type: 'event', payload: Object.assign({
      website: cfg.websiteId, hostname: location.hostname, url: location.pathname, referrer, title: document.title,
      language: navigator.language || '', screen: `${screen.width}x${screen.height}`,
    }, name ? { name: String(name).slice(0, 50) } : {}, name && data ? { data } : {}) });
  } else if (cfg.provider === 'plausible' && cfg.domain) {
    const endpoint = cfg.endpoint || 'https://plausible.io/api/event';
    send = (name, data) => post(endpoint, Object.assign({ name: name || 'pageview', domain: cfg.domain, url: location.origin + location.pathname, referrer: referrer || null }, name && data ? { props: data } : {}));
  } else return;
  window.Atelier.track = (name, props) => { if (name) send(name, props); };
  // la visite, une fois la page affichée (son titre traduit, le cas échéant)
  const visit = () => setTimeout(() => send(null), 0);
  if (document.readyState === 'complete') visit(); else window.addEventListener('load', visit, { once: true });
})();
