/*
 * Tableau de bord de l'administrateur (tableau-de-bord.html) : l'état du site d'un coup d'œil.
 *
 * - À surveiller : ce qui demande une action (commandes à préparer, erreurs, e-mails non partis,
 *   mise en ligne échouée, paiement encore en mode test).
 * - Ventes : chiffre d'affaires du jour, de 7 et 30 jours, par jour, commandes par statut, à préparer.
 * - Activité : comptes, œuvres, partages, stockage.
 * - Audience : visiteurs et pages vues (Umami), pages, provenance, pays.
 * - Santé technique : mises en ligne (GitHub), erreurs des fonctions serveur, e-mails, services.
 *
 * Les chiffres viennent de la fonction serveur « tableau-de-bord », réservée au compte administrateur
 * avec la double authentification (le serveur le vérifie) ; la page ne fait que les afficher.
 * Tout ce qui vient du serveur est échappé (esc) avant d'entrer dans la page.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
const euros = (cents, round) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: round ? 0 : 2, minimumFractionDigits: round ? 0 : 2 }).format((Number(cents) || 0) / 100);
const hm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const dayShort = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
// « il y a 3 h », « hier à 18 h 02 », « 24 nov. à 09 h 10 »
function when(iso) {
  const d = new Date(iso), now = new Date(), min = Math.round((now - d) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  if (min < 6 * 60) return `il y a ${Math.round(min / 60)} h`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `aujourd’hui à ${hm(iso)}`;
  if (d.toDateString() === y.toDateString()) return `hier à ${hm(iso)}`;
  return `${dayShort(iso)} à ${hm(iso)}`;
}
const bytes = (b) => { b = Number(b) || 0; if (b < 1e6) return `${num(Math.round(b / 1e3))} Ko`; if (b < 1e9) return `${(b / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Mo`; return `${(b / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`; };
const plural = (n, one, many) => `${num(n)} ${Number(n) > 1 ? many : one}`;
const pill = (kind, text) => `<span class="tb-pill ${kind}">${esc(text)}</span>`;

const STATUS = [
  ['attente_paiement', 'Paiement en attente'], ['payee', 'Payées'], ['en_preparation', 'En préparation'],
  ['expediee', 'Expédiées'], ['livree', 'Livrées'], ['annulee', 'Annulées'],
];
const LIVRAISON = { express: 'Chronopost express', domicile: 'Colissimo, domicile' };
const DEPLOY = { success: ['ok', 'Réussie'], failure: ['bad', 'Échouée'], cancelled: ['info', 'Remplacée'], in_progress: ['run', 'En cours'], queued: ['run', 'En attente'] };
const COUNTRY = { FR: 'France', BE: 'Belgique', CH: 'Suisse', CA: 'Canada', LU: 'Luxembourg', US: 'États-Unis', GB: 'Royaume-Uni', DE: 'Allemagne', ES: 'Espagne', IT: 'Italie', NL: 'Pays-Bas', MA: 'Maroc' };

// barres d'une valeur par jour : une seule série, la valeur et le jour au toucher
function bars(days, key, label, kind) {
  const fmt = kind === 'eur' ? (c) => euros(c, true) : num;
  const vals = days.map((d) => Number(d[key]) || 0), max = Math.max(1, ...vals), n = vals.length;
  const W = 300, H = 90, gap = 2, bw = (W - gap * (n - 1)) / n;
  const rects = vals.map((v, i) => {
    const h = v ? Math.max(3, (v / max) * (H - 4)) : 2;
    return `<rect class="bar${v ? '' : ' zero'}" data-i="${i}" x="${(i * (bw + gap)).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(2, bw / 2).toFixed(2)}"></rect>`;
  }).join('');
  const total = vals.reduce((a, b) => a + b, 0);
  return `<div class="tb-chart" data-vals="${esc(JSON.stringify(vals))}" data-days="${esc(JSON.stringify(days.map((d) => d.d)))}" data-fmt="${kind === 'eur' ? 'eur' : 'n'}">
    <div class="tb-chart-head"><span>${esc(label)}</span><span>max <b>${esc(fmt(max === 1 && !vals.some((v) => v) ? 0 : max))}</b> · total <b>${esc(fmt(total))}</b></span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`${label}, ${n} jours, total ${fmt(total)}`)}">${rects}<line class="base" x1="0" x2="${W}" y1="${H}" y2="${H}"></line></svg>
    <div class="axis"><span>${esc(dayShort(days[0].d))}</span><span>${esc(dayShort(days[n - 1].d))}</span></div>
  </div>`;
}
// la valeur d'une barre au toucher (ou au survol)
function wireCharts(root) {
  root.querySelectorAll('.tb-chart').forEach((c) => {
    const svg = c.querySelector('svg'), vals = JSON.parse(c.dataset.vals), days = JSON.parse(c.dataset.days);
    const fmt = c.dataset.fmt === 'eur' ? (v) => euros(v, true) : num;
    let tip = null, hl = null;
    const show = (e) => {
      const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(vals.length - 1, Math.floor(((e.clientX - r.left) / r.width) * vals.length)));
      if (!tip) { tip = document.createElement('div'); tip.className = 'tb-tip'; c.appendChild(tip); }
      tip.textContent = `${dayShort(days[i])} : ${fmt(vals[i])}`;
      const cr = c.getBoundingClientRect(), x = r.left - cr.left + ((i + 0.5) / vals.length) * r.width;
      tip.style.left = `${Math.max(50, Math.min(cr.width - 50, x))}px`;
      tip.style.top = `${r.top - cr.top - 4}px`;
      if (hl) hl.classList.remove('hl');
      hl = svg.querySelector(`[data-i="${i}"]`); if (hl) hl.classList.add('hl');
    };
    const hide = () => { if (tip) { tip.remove(); tip = null; } if (hl) { hl.classList.remove('hl'); hl = null; } };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  });
}
const tile = (label, value, sub, up) => `<div class="tb-tile"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<small${up ? ' class="up"' : ''}>${esc(sub)}</small>` : ''}</div>`;
function rank(items, fmtX) {
  if (!items || !items.length) return '<ul class="tb-list"><li class="empty">Rien pour l’instant.</li></ul>';
  const max = Math.max(...items.map((i) => Number(i.n) || 0), 1);
  return `<ul class="tb-list tb-rank">${items.slice(0, 6).map((i) => `<li><i style="width:${Math.round(((Number(i.n) || 0) / max) * 100)}%"></i><span>${esc(fmtX ? fmtX(i.x) : i.x)}</span><span class="num">${num(i.n)}</span></li>`).join('')}</ul>`;
}

// ce qui demande une action, en premier
function watchRows(d) {
  const rows = [];
  const v = d.ventes || {}, s = d.sante || {}, todo = (v.aPreparer || []).length;
  if (todo) rows.push(['todo', 'À faire', plural(todo, 'commande à préparer', 'commandes à préparer'), `la plus ancienne payée ${when(v.aPreparer[0].paid_at)}`, '#tb-ventes']);
  const dep = (s.deploys || [])[0];
  if (dep) {
    const [k, w] = DEPLOY[dep.status] || ['info', dep.status];
    rows.push([k, w, `Dernière mise en ligne : ${dep.title}`, when(dep.at), '#tb-sante']);
  }
  if (s.erreurs24) rows.push(['bad', 'Erreur', plural(s.erreurs24, 'erreur serveur', 'erreurs serveur') + ' en 24 h', (s.erreurs || [])[0] ? `${s.erreurs[0].fn} · ${when(s.erreurs[0].at)}` : '', '#tb-sante']);
  if ((s.emails || []).length) rows.push(['bad', 'E-mail', plural(s.emails.length, 'e-mail non parti', 'e-mails non partis'), when(s.emails[0].at), '#tb-sante']);
  if (v.stripeMode === 'test') rows.push(['info', 'Test', 'Paiement en mode test', 'aucun vrai paiement n’est encaissé', '#tb-sante']);
  if (!rows.some((r) => r[0] === 'bad' || r[0] === 'todo')) rows.unshift(['ok', 'Tout va bien', 'Rien à traiter pour l’instant', '', '']);
  return `<div class="tb-watch">${rows.map(([k, w, text, sub, href]) => `<${href ? `a href="${href}"` : 'div'} class="tb-watch-row">${pill(k, w)}<span>${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>${href ? '<span class="go" aria-hidden="true">›</span>' : '<span></span>'}</${href ? 'a' : 'div'}>`).join('')}</div>`;
}

function ventes(v, opts) {
  const st = v.statuts || {};
  const chips = STATUS.filter(([k]) => st[k]).map(([k, l]) => `<span class="tb-chip">${esc(l)} <b>${num(st[k])}</b></span>`).join('') || '<span class="tb-chip">Aucune commande</span>';
  const todo = v.aPreparer || [];
  const list = todo.length ? todo.slice(0, 8).map((o) => `<li><span><b>${esc(o.ref)}</b> · ${esc(o.client || '')}</span><span class="num">${esc(euros(o.total_cents))}</span><small>payée ${esc(when(o.paid_at))} · ${esc(plural(o.articles, 'article', 'articles'))} · ${esc(LIVRAISON[o.delivery] || LIVRAISON.domicile)}</small></li>`).join('') : '<li class="empty">Aucune commande à préparer.</li>';
  return `<section class="tb-sec" id="tb-ventes" aria-labelledby="tb-h-ventes">
    <h2 id="tb-h-ventes">Ventes <small>commandes payées, remboursements déduits</small></h2>
    <div class="tb-tiles">
      ${tile('Aujourd’hui', euros(v.today.cents, true), plural(v.today.n, 'commande', 'commandes'))}
      ${tile('7 derniers jours', euros(v.d7.cents, true), plural(v.d7.n, 'commande', 'commandes'))}
      ${tile('30 derniers jours', euros(v.d30.cents, true), plural(v.d30.n, 'commande', 'commandes'))}
      ${tile('Panier moyen', v.d30.n ? euros(v.d30.cents / v.d30.n, true) : '—', 'sur 30 jours')}
    </div>
    ${bars(v.byDay, 'cents', 'Chiffre d’affaires par jour', 'eur')}
    <p class="tb-sub">Commandes par statut</p>
    <div class="tb-chips">${chips}</div>
    <p class="tb-sub">À préparer, la plus ancienne d’abord</p>
    <ul class="tb-list">${list}</ul>
    ${opts && opts.admin ? '<a class="tb-more" href="atelier/?compte" target="_blank" rel="noopener">Ouvrir les commandes dans l’atelier ›</a>' : ''}
  </section>`;
}

function activite(a) {
  return `<section class="tb-sec" id="tb-activite" aria-labelledby="tb-h-activite">
    <h2 id="tb-h-activite">Activité</h2>
    <div class="tb-tiles">
      ${tile('Comptes', num(a.comptes.total), `+${num(a.comptes.d7)} en 7 jours`, a.comptes.d7 > 0)}
      ${tile('Œuvres enregistrées', num(a.oeuvres.total), `+${num(a.oeuvres.d7)} en 7 jours`, a.oeuvres.d7 > 0)}
      ${tile('Liens de partage actifs', num(a.partages.actifs), `${plural(a.partages.recus7, 'œuvre reçue', 'œuvres reçues')} en 7 jours`)}
      ${tile('Stockage', bytes(a.stockage.bytes), plural(a.stockage.files, 'fichier', 'fichiers'))}
    </div>
    ${bars(a.byDay, 'comptes', 'Nouveaux comptes par jour')}
    ${bars(a.byDay, 'oeuvres', 'Œuvres enregistrées par jour')}
  </section>`;
}

function audience(u) {
  if (!u || u.error) {
    return `<section class="tb-sec" id="tb-audience" aria-labelledby="tb-h-audience"><h2 id="tb-h-audience">Audience</h2>
      <p class="o-status">${esc((u && u.error) || 'Audience indisponible.')}</p></section>`;
  }
  return `<section class="tb-sec" id="tb-audience" aria-labelledby="tb-h-audience">
    <h2 id="tb-h-audience">Audience <small>Umami, sans cookie</small></h2>
    <div class="tb-tiles">
      ${tile('Visiteurs, 7 jours', num(u.d7.visitors), `${plural(u.d7.pageviews, 'page vue', 'pages vues')}`)}
      ${tile('Visiteurs, 30 jours', num(u.d30.visitors), `${plural(u.d30.pageviews, 'page vue', 'pages vues')}`)}
    </div>
    ${bars(u.byDay, 'visitors', 'Visiteurs par jour')}
    <div class="tb-cols">
      <div><p class="tb-sub">Pages les plus vues, 30 jours</p>${rank(u.pages)}</div>
      <div><p class="tb-sub">Provenance</p>${rank(u.sources, (x) => x || 'Accès direct')}</div>
      <div><p class="tb-sub">Pays</p>${rank(u.pays, (x) => COUNTRY[x] || x)}</div>
    </div>
  </section>`;
}

function sante(s, v) {
  const deploys = (s.deploys || []).slice(0, 5).map((r) => { const [k, w] = DEPLOY[r.status] || ['info', r.status]; return `<li><span>${pill(k, w)} n° ${esc(r.n)} · ${esc(r.title)}</span><span class="num">${esc(when(r.at))}</span></li>`; }).join('') || `<li class="empty">${esc(s.deployError ? `Mises en ligne illisibles (${s.deployError}).` : 'Aucune mise en ligne lue.')}</li>`;
  const errs = (s.erreurs || []).slice(0, 6).map((e) => `<li><span>${esc(e.message)}</span><span class="num">${esc(e.fn)}</span><small>${esc(when(e.at))}</small></li>`).join('') || '<li class="empty">Aucune erreur ces 7 derniers jours.</li>';
  const mails = (s.emails || []).slice(0, 6).map((e) => `<li><span>${esc(e.what)}</span><span class="num">${esc(e.ref || '')}</span><small>${esc(when(e.at))} · ${esc(e.reason || '')}</small></li>`).join('') || '<li class="empty">Tous les e-mails sont partis.</li>';
  const svc = s.services || {};
  const one = (label, st, okText, badText) => `<li><span>${esc(label)}</span><span>${st === true ? pill('ok', okText) : st === 'test' ? pill('info', 'Mode test') : pill('bad', badText)}</span></li>`;
  return `<section class="tb-sec" id="tb-sante" aria-labelledby="tb-h-sante">
    <h2 id="tb-h-sante">Santé technique</h2>
    <p class="tb-sub">Mises en ligne</p>
    <ul class="tb-list">${deploys}</ul>
    <p class="tb-sub">Erreurs des fonctions serveur, 7 jours</p>
    <ul class="tb-list err">${errs}</ul>
    <p class="tb-sub">E-mails non partis</p>
    <ul class="tb-list">${mails}</ul>
    <p class="tb-sub">Services</p>
    <ul class="tb-list">
      ${one('Paiement (Stripe)', v.stripeMode === 'live' ? true : v.stripeMode === 'test' ? 'test' : false, 'En service', 'Non configuré')}
      ${one('E-mails (Resend)', svc.resend, 'En service', 'Clé manquante')}
      ${one('Audience (Umami)', svc.umami, 'Branchée', 'Clé manquante')}
      ${one('Mises en ligne (GitHub)', svc.github, 'Branchées', 'Clé manquante')}
    </ul>
  </section>`;
}

export function render(d, opts) {
  const body = $('tb-body');
  body.innerHTML = `<section class="tb-sec" aria-labelledby="tb-h-watch"><h2 id="tb-h-watch">À surveiller${opts && opts.example ? '<span class="tb-example">Données d’exemple</span>' : ''}</h2>${watchRows(d)}</section>
    ${ventes(d.ventes, opts)}${activite(d.activite)}${audience(d.audience)}${sante(d.sante || {}, d.ventes || {})}`;
  body.hidden = false;
  $('tb-when').textContent = `Mis à jour ${when(d.at)}`;
  wireCharts(body);
}
window.TableauDeBord = { render };

// ---------- l'accès et le chargement ----------
let A = null, busy = false, loadedAt = 0, factorId = null;
const status = (text) => { const el = $('tb-status'); el.textContent = text || ''; el.hidden = !text; };
// la porte : 'signin' (pas connecté), 'notadmin', 'enroll' (double authentification à activer), 'verify' (code)
function gate(kind) {
  const texts = {
    signin: 'Connectez-vous avec le compte administrateur pour voir le tableau de bord.',
    notadmin: 'Cette page est réservée à l’équipe du site.',
    enroll: 'Le tableau de bord demande la double authentification : activez-la une fois, avec une application d’authentification sur votre téléphone.',
    verify: 'Pour voir le tableau de bord, saisissez le code de votre application d’authentification.',
  };
  $('tb-gate').hidden = !kind;
  $('tb-body').hidden = !!kind || !$('tb-body').childElementCount;
  if (!kind) return;
  $('tb-gate-text').textContent = texts[kind];
  $('tb-signin-btn').hidden = kind !== 'signin';
  $('tb-enroll').hidden = kind !== 'enroll';
  $('tb-mfa').hidden = kind !== 'verify';
  $('tb-qr').hidden = true;
  factorId = null;
  $('tb-when').textContent = '';
  if (kind === 'verify') setTimeout(() => $('tb-code').focus(), 50);
}
async function load() {
  if (busy) return;
  busy = true;
  $('tb-refresh').classList.add('spin');
  status('');
  try {
    const d = await A.dashboard();
    if (!d || !d.ventes) throw new Error('réponse inattendue du serveur');
    render(d, { admin: A.isAdmin() });
    loadedAt = Date.now();
  } catch (e) {
    console.error(e);
    status(`Le tableau de bord n’a pas pu être chargé : ${(e && e.message) || ''}`);
    if (!loadedAt) $('tb-when').textContent = '';
  } finally {
    busy = false;
    $('tb-refresh').classList.remove('spin');
  }
}
async function start(user) {
  if (!user) { gate('signin'); return; }
  if (!(A.canDashboard ? A.canDashboard() : A.isAdmin())) { gate('notadmin'); return; }
  let st = 'ok';
  try { st = await A.mfaState(); } catch (e) { console.error(e); }
  if (st === 'enroll' || st === 'verify') { gate(st); return; }
  gate(null);
  await load();
}
$('tb-signin-btn').addEventListener('click', () => { if (window.SiteAccount) window.SiteAccount.open(); });
// la double authentification activée ici : le code à scanner, puis le premier code saisi la valide
$('tb-enroll').addEventListener('click', async () => {
  const b = $('tb-enroll');
  b.disabled = true;
  status('');
  try {
    const f = await A.mfaEnroll();
    factorId = f.factorId;
    if (f.qr) $('tb-qr-img').src = f.qr; else $('tb-qr-img').hidden = true;
    $('tb-qr-secret').textContent = f.secret || '';
    $('tb-qr').hidden = false;
    $('tb-mfa').hidden = false;
    b.hidden = true;
    setTimeout(() => $('tb-code').focus(), 50);
  } catch (e) {
    status((e && e.message) || 'La double authentification n’a pas pu être préparée.');
  } finally { b.disabled = false; }
});
$('tb-refresh').addEventListener('click', () => { if (A && A.user()) start(A.user()); });
$('tb-mfa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = $('tb-code-ok');
  ok.disabled = true;
  status('');
  try {
    await A.mfaVerify($('tb-code').value, factorId || undefined);
    $('tb-code').value = '';
    await start(A.user());
  } catch (err) {
    status((err && err.message) || 'Code refusé.');
  } finally { ok.disabled = false; }
});
// de retour sur l'onglet après quelques minutes : les chiffres sont relus
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && loadedAt && Date.now() - loadedAt > 3 * 60e3 && A && A.user()) load();
});
if (!window.__TB_NO_START) (async () => {
  try {
    A = await window.SiteAccount.account();
    let first = true;
    A.onChange((u) => { first = false; start(u); });
    setTimeout(() => { if (first) start(A.user()); }, 1500);
  } catch (e) {
    console.error(e);
    $('tb-when').textContent = '';
    status((e && e.message) || 'Le service des comptes n’est pas disponible pour le moment.');
  }
})();
