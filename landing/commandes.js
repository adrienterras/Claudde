/*
 * Mes commandes (commandes.html), hors de l'atelier : la liste des commandes du compte et, pour chacune,
 * son détail dans une fenêtre (frise d'avancement, œuvres dans leur cadre, prix, livraison, adresse,
 * suivi du colis, annulation tant qu'elle est payée).
 *
 * Le compte : le même que celui de l'atelier (session Supabase du stockage local), par le module des
 * comptes que compte.js charge (SiteAccount.account). Le visuel des œuvres et le lien de suivi viennent
 * du module partagé avec le serveur et les e-mails (supabase/functions/_shared/commande.js, publié à la
 * racine du site sous le nom commande-partage.js).
 *
 * Adresses : commandes.html#AG-… ouvre cette commande (lien des e-mails) ; ?commande=AG-… est le retour
 * de la page de paiement (merci, la commande apparaît dès que Stripe a prévenu le serveur, et les œuvres
 * payées quittent le panier de cet appareil).
 */
const V = new URL(import.meta.url).search; // (la version du site, pour le cache : ?v=…)
const { framePlan, framePixels, trackingUrl } = await import(`./commande-partage.js${V}`);

const $ = (id) => document.getElementById(id);
const t = (s) => (window.SiteI18n ? window.SiteI18n.t(s) : s);
const tf = (s, ...vals) => t(s).replace(/\{(\d+)\}/g, (m, i) => (vals[i] !== undefined ? vals[i] : m));
const en = () => !!(window.SiteI18n && window.SiteI18n.lang === 'en');
const locale = () => (en() ? 'en-GB' : 'fr-FR');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const euros = (cents) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100);
const day = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
const safeData = (u) => (typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : '');

const STATUS = {
  attente_paiement: 'Paiement en attente', payee: 'Payée', en_preparation: 'En préparation',
  expediee: 'Expédiée', livree: 'Livrée', annulee: 'Annulée',
};
const STEPS = [['payee', 'Confirmée'], ['en_preparation', 'En préparation'], ['expediee', 'Expédiée'], ['livree', 'Livrée']];
const deliveryName = (o) => (o.delivery === 'express' ? t('Chronopost express, à domicile en 24 h') : t('Colissimo, à domicile (2 à 3 jours)'));
const subtotalOf = (o) => (o.subtotal_cents != null ? o.subtotal_cents : Number(o.total_cents || 0) - Number(o.shipping_cents || 0));
const addressLines = (o) => {
  const s = o.shipping || {}, a = s.address || {};
  return [s.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country === 'FR' ? 'France' : a.country].filter(Boolean);
};

// le visuel d'un article, tel qu'il sera livré : l'œuvre dans son cadre, ou sur sa feuille ; size : son
// plus grand côté en px (la vignette garde ses proportions : seule sa largeur est donnée)
function visual(it, src, size) {
  const plan = framePlan(it), px = framePixels(plan, size);
  const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(', ')})`;
  const box = document.createElement('span');
  box.className = 'o-vis';
  const img = new Image();
  img.alt = '';
  img.src = src;
  img.style.width = `${px.img}px`;
  if (plan && plan.mat) img.classList.add('mat');
  if (!plan) { box.style.padding = `${Math.max(2, Math.round(size / 24))}px`; box.appendChild(img); return box; }
  const white = document.createElement('span');
  white.className = 'o-vis-white';
  white.style.padding = `${px.padY}px ${px.padX}px`;
  white.appendChild(img);
  if (plan.framed) {
    const light = plan.rgb[0] > 235;
    box.style.padding = `${px.frame}px`;
    box.style.background = rgb(plan.rgb);
    box.style.borderColor = light ? '#d8d3c8' : rgb(plan.rgb, 0.78);
    white.style.borderColor = light ? '#ece8df' : rgb(plan.rgb, 0.7);
  } else white.classList.add('sheet');
  box.appendChild(white);
  return box;
}

// ---------- l'état de la page ----------
let A = null;
let orders = [];
const thumbs = new Map(); // (les vignettes déjà lues, le temps de la page)
const returnRef = (/[?&]commande=([A-Z0-9-]{4,40})\b/.exec(location.search) || [])[1] || null;

function status(msg, err) {
  const el = $('o-status');
  el.textContent = msg || '';
  el.hidden = !msg;
  el.classList.toggle('err', !!err);
}
function show(part) {
  $('o-loading').hidden = part !== 'loading';
  $('o-signin').hidden = part !== 'signin';
  $('o-empty').hidden = part !== 'empty';
  $('o-list').hidden = part !== 'list';
}

async function load() {
  const rows = (await A.orders.list()).filter((o) => STATUS[o.status]);
  const missing = [...new Set(rows.flatMap((o) => (o.items || []).map((it) => String(it.compId || ''))).filter((id) => id && !thumbs.has(id)))];
  if (missing.length && A.orders.thumbs) {
    try { const got = await A.orders.thumbs(missing); missing.forEach((id) => thumbs.set(id, safeData(got[id]))); } catch (e) { console.error(e); }
  }
  orders = rows;
  renderList();
  return rows;
}

function renderList() {
  const list = $('o-list');
  list.textContent = '';
  if (!orders.length) { show('empty'); return; }
  show('list');
  orders.forEach((o) => {
    const li = document.createElement('li');
    li.className = `o-card${returnRef && o.ref === returnRef ? ' o-new' : ''}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'o-item';
    b.dataset.ref = o.ref;
    const row = document.createElement('span');
    row.className = 'o-vis-row';
    const items = o.items || [];
    items.slice(0, 2).forEach((it) => { const src = thumbs.get(String(it.compId)); if (src) row.appendChild(visual(it, src, 64)); });
    if (items.length > 2) row.insertAdjacentHTML('beforeend', `<span class="o-more">+${items.length - 2}</span>`);
    const count = items.reduce((n, it) => n + (Number(it.qty) || 1), 0);
    const main = document.createElement('span');
    main.className = 'o-main';
    main.innerHTML = `<b>${esc(o.ref)}</b><span class="o-meta">${esc(day(o.paid_at || o.created_at))} · ${esc(count > 1 ? tf('{0} articles', count) : t('1 article'))}</span>`;
    const side = document.createElement('span');
    side.className = 'o-side';
    side.innerHTML = `<span class="o-pill s-${esc(o.status)}">${esc(t(STATUS[o.status]))}</span><span class="o-total">${esc(euros(o.total_cents))}</span><span class="o-see">${esc(t('Voir le détail'))} ›</span>`;
    b.append(row, main, side);
    b.addEventListener('click', () => openDetail(o.ref));
    li.appendChild(b);
    // le suivi du colis, dès qu'il y a un numéro : le transporteur, le numéro, le lien pour suivre
    if (o.tracking) {
      const url = trackingUrl(o.carrier, o.tracking);
      const p = document.createElement('p');
      p.className = 'o-track';
      p.innerHTML = `<span>${esc(t('Suivi du colis'))} : <b>${esc([o.carrier, o.tracking].filter(Boolean).join(' '))}</b></span>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(t('Suivre le colis'))} ›</a>` : ''}`;
      li.appendChild(p);
    }
    list.appendChild(li);
  });
}

// ---------- le détail d'une commande ----------
let lastFocus = null;
function openDetail(ref) {
  const o = orders.find((x) => x.ref === ref);
  if (!o) return;
  lastFocus = document.activeElement;
  fillDetail(o);
  $('o-detail').hidden = false;
  document.documentElement.style.overflow = 'hidden';
  try { history.replaceState(history.state, '', `${location.pathname}${location.search}#${encodeURIComponent(o.ref)}`); } catch (e) { /* ignoré */ }
  setTimeout(() => $('od-close').focus(), 30);
}
function closeDetail() {
  if ($('o-detail').hidden) return;
  $('o-detail').hidden = true;
  document.documentElement.style.overflow = '';
  try { history.replaceState(history.state, '', `${location.pathname}${location.search}`); } catch (e) { /* ignoré */ }
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function fillDetail(o) {
  const body = $('od-body');
  const cancelled = o.status === 'annulee', pending = o.status === 'attente_paiement';
  const step = STEPS.findIndex(([k]) => k === o.status);
  const parts = [];
  parts.push(`<p class="od-kicker">${esc(t('Commande'))}</p><h2 class="od-title" id="od-title">${esc(o.ref)}</h2><p class="od-date">${esc(tf('Passée le {0}', day(o.paid_at || o.created_at)))} · <span class="o-pill s-${esc(o.status)}">${esc(t(STATUS[o.status]))}</span></p>`);
  if (cancelled) {
    parts.push(`<p class="od-cancelled">${esc(o.cancelled_at ? tf('Commande annulée le {0}. Le remboursement est fait sur votre moyen de paiement (5 à 10 jours en général).', day(o.cancelled_at)) : t('Commande annulée. Le remboursement est fait sur votre moyen de paiement (5 à 10 jours en général).'))}</p>`);
  } else if (pending) {
    parts.push(`<p class="od-cancelled">${esc(t('Le paiement de cette commande n’est pas encore confirmé.'))}</p>`);
  } else {
    parts.push(`<ol class="od-steps" aria-label="${esc(t('Avancement'))}">${STEPS.map(([k, label], i) => `<li class="${i <= step ? 'done' : ''}${i === step ? ' now' : ''}"${i === step ? ' aria-current="step"' : ''}><i></i>${esc(t(label))}</li>`).join('')}</ol>`);
  }
  parts.push(`<section class="od-sec"><h3>${esc(t('Vos œuvres'))}</h3><ul class="od-items" id="od-items"></ul>
    <div class="od-sum">
      <div><span>${esc(t('Œuvres'))}</span><span>${esc(euros(subtotalOf(o)))}</span></div>
      ${o.shipping_cents ? `<div><span>${esc(tf('Livraison · {0}', deliveryName(o)))}</span><span>${esc(euros(o.shipping_cents))}</span></div>` : ''}
      <div class="total"><span>${esc(t('Total TTC'))}</span><span>${esc(euros(o.total_cents))}</span></div>
    </div></section>`);
  const lines = addressLines(o);
  if (lines.length || o.shipping_cents) {
    parts.push(`<section class="od-sec"><h3>${esc(t('Livraison'))}</h3><p>${esc(deliveryName(o))}${lines.length ? `<br>${lines.map(esc).join('<br>')}` : ''}</p></section>`);
  }
  if (o.tracking) {
    const url = trackingUrl(o.carrier, o.tracking);
    const label = [o.carrier, o.tracking].filter(Boolean).join(' ');
    parts.push(`<section class="od-sec od-track"><h3>${esc(t('Suivi du colis'))}</h3><p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ›</a>` : esc(label)}</p></section>`);
  }
  parts.push('<div class="od-actions" id="od-actions"></div>');
  body.innerHTML = parts.join('');
  // les œuvres : le visuel dans son cadre, le titre, l'article, le prix
  const ul = $('od-items');
  (o.items || []).forEach((it) => {
    const li = document.createElement('li');
    const v = document.createElement('span');
    v.className = 'od-vis';
    const src = thumbs.get(String(it.compId));
    if (src) v.appendChild(visual(it, src, window.matchMedia('(max-width: 480px)').matches ? 84 : 110));
    const txt = document.createElement('span');
    txt.innerHTML = `<b>${esc(it.title || '')}</b><small>${esc(it.label || '')}${Number(it.qty) > 1 ? ` · ${esc(tf('quantité {0}', it.qty))}` : ''}</small>`;
    const price = document.createElement('span');
    price.className = 'od-price';
    price.textContent = it.unit != null ? euros(Math.round(Number(it.unit) * 100) * (Number(it.qty) || 1)) : '';
    // recommander un tableau imprimé : l'œuvre telle quelle, rouverte dans l'atelier avec l'article déjà
    // choisi ; seuls la taille, l'encadrement, la bordure blanche et le passe-partout s'y changent
    if (it.product === 'print' && it.compId && !pending) {
      const q = new URLSearchParams({ recommander: String(it.compId), taille: it.size || '', finition: it.finish || '', cadre: it.frame || '', pp: it.mat ? '1' : '0', bord: it.margin ? '1' : '0' });
      const a = document.createElement('a');
      a.className = 'od-again';
      a.href = `atelier/?${q}`;
      a.textContent = t('Recommander');
      txt.appendChild(a);
    }
    li.append(v, txt, price);
    ul.appendChild(li);
  });
  const actions = $('od-actions');
  // la facture (faite par Stripe après le paiement) : demandée au serveur au moment du clic
  if (!pending && o.status !== 'abandonnee') {
    const f = document.createElement('button');
    f.type = 'button';
    f.className = 'od-invoice';
    f.textContent = t('Télécharger la facture');
    f.onclick = async () => {
      f.disabled = true;
      f.textContent = t('Préparation de la facture…');
      const old = actions.querySelector('.od-invoice-err');
      if (old) old.remove();
      try {
        const { url } = await A.orders.invoice(o.id);
        if (!/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(String(url || ''))) throw new Error(t('lien de facture invalide'));
        location.assign(url);
      } catch (e) {
        console.error(e);
        f.insertAdjacentHTML('afterend', `<p class="od-note od-invoice-err">${esc(tf('Facture indisponible : {0}', (e && e.message) || ''))}</p>`);
      }
      f.disabled = false;
      f.textContent = t('Télécharger la facture');
    };
    actions.appendChild(f);
  }
  // annuler, tant que la commande est payée (pas encore en préparation) : remboursée aussitôt
  if (o.status === 'payee') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'od-cancel';
    b.textContent = t('Annuler la commande');
    let timer = 0;
    b.onclick = async () => {
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = tf('Confirmer l’annulation (remboursement de {0})', euros(o.total_cents));
        timer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = t('Annuler la commande'); }, 6000);
        return;
      }
      clearTimeout(timer);
      b.disabled = true;
      b.textContent = t('Annulation…');
      try {
        await A.orders.cancel(o.id);
        await load();
        const now = orders.find((x) => x.ref === o.ref);
        if (now) fillDetail(now);
        status(tf('Commande {0} annulée : le remboursement est en route vers votre moyen de paiement (5 à 10 jours en général).', o.ref));
      } catch (e) {
        console.error(e);
        b.disabled = false;
        b.classList.remove('confirm');
        b.textContent = t('Annuler la commande');
        actions.insertAdjacentHTML('beforeend', `<p class="od-note">${esc(tf('Annulation impossible : {0}', (e && e.message) || ''))}</p>`);
      }
    };
    actions.appendChild(b);
    actions.insertAdjacentHTML('beforeend', `<p class="od-note">${esc(t('Possible tant que la commande n’est pas en préparation. Le remboursement est entier.'))}</p>`);
  } else if (!cancelled) {
    actions.insertAdjacentHTML('beforeend', `<p class="od-note">${esc(t('Une question ? Écrivez-nous à contact@ateliergribouille.art en indiquant la référence de la commande.'))}</p>`);
  }
}

$('od-close').addEventListener('click', closeDetail);
$('o-detail').addEventListener('click', (e) => { if (e.target === $('o-detail')) closeDetail(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
$('o-signin-btn').addEventListener('click', () => { if (window.SiteAccount) window.SiteAccount.open(); });

// ---------- retour de la page de paiement ----------
// la commande paraît dès que Stripe a prévenu le serveur ; les œuvres payées quittent alors le panier de
// cet appareil (le panier du compte, lui, est déjà vidé par le serveur)
function dropPaidFromCart(o) {
  try {
    const KEY = 'atelier-gribouille:panier';
    const ids = new Set((o.items || []).map((it) => `cloud:${it.compId}`));
    const cart = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(cart)) return;
    const left = cart.filter((it) => !ids.has(it && it.recId));
    if (left.length !== cart.length) localStorage.setItem(KEY, JSON.stringify(left));
  } catch (e) { /* stockage inaccessible */ }
}
async function afterPayment(ref) {
  status(tf('Merci ! Votre paiement est bien reçu (commande {0}). Vous suivez son avancement ici.', ref));
  for (const wait of [0, 2000, 4000, 8000, 15000, 30000]) {
    await new Promise((r) => setTimeout(r, wait));
    let rows = [];
    try { rows = await load(); } catch (e) { console.error(e); continue; }
    const o = rows.find((x) => x.ref === ref);
    if (o && o.status !== 'attente_paiement') { dropPaidFromCart(o); break; }
  }
  try { const url = new URL(location.href); url.searchParams.delete('commande'); history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch (e) { /* ignoré */ }
}

// ---------- démarrage ----------
let started = false;
async function start(user) {
  if (!user) { started = false; orders = []; $('o-list').textContent = ''; closeDetail(); show('signin'); return; }
  if (started) return;
  started = true;
  show('loading');
  try {
    await load();
    const ref = decodeURIComponent((location.hash || '').slice(1));
    if (ref && orders.some((o) => o.ref === ref)) openDetail(ref);
    if (returnRef) afterPayment(returnRef);
  } catch (e) {
    console.error(e);
    show('none');
    status(tf('Vos commandes n’ont pas pu être chargées : {0}', (e && e.message) || ''), true);
    started = false;
  }
}
(async () => {
  try {
    A = await window.SiteAccount.account();
    let first = true;
    A.onChange((u) => { first = false; start(u); });
    // (si le module ne prévient pas tout de suite : l'état connu)
    setTimeout(() => { if (first) start(A.user()); }, 1500);
  } catch (e) {
    console.error(e);
    show('none');
    status((e && e.message) || t('Le service des comptes n’est pas disponible pour le moment.'), true);
  }
})();
