// Pages du site : une image qui n'a pas pu se charger (réseau faible sur téléphone : Safari affiche
// alors un « ? » et ne la redemande jamais) est redemandée, jusqu'à trois fois, de plus en plus tard.
(function () {
  'use strict';
  var bust = function (url, n) { return url.replace(/([?&])r=\d+$/, '').replace(/^([^?]*)(\?.*)?$/, function (m, p, q) { return p + (q ? q + '&' : '?') + 'r=' + n; }); };
  function retry(img) {
    var n = Number(img.getAttribute('data-retry') || 0) + 1;
    if (n > 3 || !img.getAttribute('src')) return;
    img.setAttribute('data-retry', String(n));
    setTimeout(function () {
      // (une image à plusieurs définitions : chaque adresse de srcset est redemandée aussi)
      var set = img.getAttribute('data-srcset') || img.getAttribute('srcset');
      if (set) {
        img.setAttribute('data-srcset', set);
        img.srcset = set.split(',').map(function (c) { var p = c.trim().split(/\s+/); p[0] = bust(p[0], n); return p.join(' '); }).join(', ');
      }
      img.src = bust(img.getAttribute('src'), n);
    }, 1200 * n);
  }
  document.addEventListener('error', function (e) { var t = e.target; if (t && t.tagName === 'IMG') retry(t); }, true);
  // (une image déjà en échec avant que ce script ne soit lu)
  [].forEach.call(document.images, function (img) { if (img.complete && img.getAttribute('src') && !img.naturalWidth) retry(img); });
})();
