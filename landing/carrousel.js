// Page d'accueil : le carrousel de l'atelier en six tableaux. Il défile seul (4 s par image), se met
// en pause sous la souris ou au clavier, se feuillette aux flèches, aux points et au doigt ; sans
// défilement automatique si le système demande moins d'animations (prefers-reduced-motion).
(function () {
  'use strict';
  var root = document.getElementById('carrousel');
  if (!root) return;
  var slides = Array.prototype.slice.call(root.querySelectorAll('.slide'));
  var dots = root.querySelector('.dots');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DELAY = 4000, index = 0, timer = 0, paused = false;
  slides.forEach(function (s, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', 'Image ' + (i + 1));
    b.addEventListener('click', function () { show(i); restart(); });
    dots.appendChild(b);
  });
  function show(i) {
    index = (i + slides.length) % slides.length;
    slides.forEach(function (s, j) { s.classList.toggle('is-active', j === index); });
    Array.prototype.forEach.call(dots.children, function (d, j) { d.setAttribute('aria-selected', j === index ? 'true' : 'false'); });
  }
  function next() { show(index + 1); }
  function stop() { clearInterval(timer); timer = 0; }
  function restart() { stop(); if (!reduce && !paused && !document.hidden) timer = setInterval(next, DELAY); }
  Array.prototype.forEach.call(root.querySelectorAll('.carousel-arrow'), function (b) {
    b.addEventListener('click', function () { show(index + Number(b.dataset.dir)); restart(); });
  });
  root.addEventListener('mouseenter', function () { paused = true; stop(); });
  root.addEventListener('mouseleave', function () { paused = false; restart(); });
  root.addEventListener('focusin', function () { paused = true; stop(); });
  root.addEventListener('focusout', function () { paused = false; restart(); });
  root.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') show(index + 1); else if (e.key === 'ArrowLeft') show(index - 1); });
  // au doigt : un glissement horizontal feuillette
  var x0 = null;
  root.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
  root.addEventListener('pointerup', function (e) { if (x0 === null) return; var dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) { show(index + (dx < 0 ? 1 : -1)); restart(); } });
  // onglet caché : on s'arrête, et on repart au retour
  document.addEventListener('visibilitychange', restart);
  show(0);
  restart();
  window.Carrousel = { show: show, index: function () { return index; }, stop: stop, start: restart };
})();
