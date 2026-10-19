// Page d'accueil : la vidéo de tête. Elle démarre d'elle-même (muette), aussi sur téléphone : si le
// navigateur refuse (économie d'énergie, réglages), la lecture est retentée au premier geste. En
// anglais, sa version anglaise. Une fois lue, la bande se replie pour laisser la place au reste.
(function () {
  'use strict';
  var v = document.getElementById('hero-video');
  var band = v && v.closest('.video-band');
  if (!v || !band || band.hidden) return; // bande cachée : rien n'est chargé
  var ended = false;
  function play() { if (ended) return; var p = v.play(); if (p && p.catch) p.catch(function () { /* retentée au premier geste */ }); }
  function pick() {
    var en = document.documentElement.lang === 'en';
    var want = en ? 'img/accueil-video-en.mp4' : 'img/accueil-video-fr.mp4';
    var src = v.querySelector('source');
    if (src.getAttribute('src') === want) return;
    var at = v.currentTime;
    src.setAttribute('src', want);
    v.load();
    if (at) v.currentTime = at;
    play();
  }
  pick();
  // la langue peut changer après le chargement (boutons FR / EN)
  new MutationObserver(pick).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // lecture refusée d'office : le premier geste (toucher, défilement, clic) la lance
  var kick = function () { if (v.paused) play(); };
  ['touchstart', 'scroll', 'click', 'keydown', 'pointerdown'].forEach(function (e) { window.addEventListener(e, kick, { passive: true, once: false }); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) v.pause(); else play(); });
  // lue jusqu'au bout : la bande se replie (hauteur vers 0), le bloc du dessous monte à sa place
  v.addEventListener('ended', function () {
    ended = true;
    band.style.height = band.offsetHeight + 'px';
    band.classList.add('done');
    requestAnimationFrame(function () { requestAnimationFrame(function () { band.style.height = '0px'; }); });
    band.addEventListener('transitionend', function () { band.hidden = true; }, { once: true });
  });
})();
