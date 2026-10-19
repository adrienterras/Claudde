// Page d'accueil : la vidéo de tête. En anglais, sa version anglaise ; si le système demande moins
// d'animations, elle ne défile pas d'elle-même (l'image fixe reste, avec les commandes).
(function () {
  'use strict';
  var v = document.getElementById('hero-video');
  if (!v) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pick() {
    var en = document.documentElement.lang === 'en';
    var want = en ? 'img/accueil-video-en.mp4' : 'img/accueil-video-fr.mp4';
    var src = v.querySelector('source');
    if (src.getAttribute('src') === want) return;
    src.setAttribute('src', want);
    v.load();
    if (!reduce) v.play().catch(function () { /* lecture refusée : l'image fixe reste */ });
  }
  if (reduce) { v.removeAttribute('autoplay'); v.pause(); v.controls = true; }
  pick();
  // la langue peut changer après le chargement (boutons FR / EN)
  new MutationObserver(pick).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.addEventListener('visibilitychange', function () { if (reduce) return; if (document.hidden) v.pause(); else v.play().catch(function () {}); });
})();
