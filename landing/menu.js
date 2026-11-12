/*
 * Le menu du téléphone (≤ 900 px), sur l'accueil : le bouton à trois traits de l'en-tête ouvre,
 * sous l'en-tête, la liste des sections de la page (cachées de l'en-tête sur téléphone) et des
 * autres pages du site. Il se referme par le même bouton, par Échap, en touchant ailleurs ou en
 * choisissant un lien.
 */
(function () {
  'use strict';
  var btn = document.getElementById('nav-burger');
  var menu = document.getElementById('nav-menu');
  if (!btn || !menu) return;
  function set(open) {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.documentElement.classList.toggle('menu-open', open);
  }
  btn.addEventListener('click', function (e) { e.stopPropagation(); set(menu.hidden); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
  document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target)) set(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
  // repassé sur grand écran (tablette tournée) : le menu n'a plus lieu d'être
  var wide = window.matchMedia('(min-width: 901px)');
  var onWide = function () { if (wide.matches) set(false); };
  if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);
})();
