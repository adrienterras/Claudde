/*
 * Gestion des commandes (gestion-commandes.html), pour l'équipe : l'administrateur et les comptes au rôle
 * « tableau », connectés avec la double authentification (le serveur le vérifie : lecture des
 * commandes par is_staff(), changements par les fonctions commande-statut et commande-annuler).
 *
 * La liste : filtrée par statut (à préparer d'abord), cherchée par référence, nom, ville ou e-mail ;
 * chaque commande avec le visuel de ses œuvres. Le détail, dans une fenêtre : le client, la livraison,
 * les œuvres (le fichier HD d'impression, fait sur place), les étapes, l'étape suivante
 * (le client reçoit un e-mail à chacune), l'annulation avec remboursement.
 *
 * Tout ce qui vient de la base est échappé (esc) ou posé en texte.
 */
const V = new URL(import.meta.url).search;
const { framePlan, framePixels } = await import(`./commande-partage.js${V}`);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const euros = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100);
const day = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const dayTime = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const safeData = (u) => (typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : '');

const STATUS = { payee: 'À préparer', en_preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée', annulee: 'Annulée' };
const STEPS = [['payee', 'Payée'], ['en_preparation', 'En préparation'], ['expediee', 'Expédiée'], ['livree', 'Livrée']];
const FILTERS = [['payee', 'À préparer'], ['en_preparation', 'En préparation'], ['expediee', 'Expédiées'], ['livree', 'Livrées'], ['annulee', 'Annulées'], ['all', 'Toutes']];
// l'étape suivante, son bouton, et ce que le client reçoit
const NEXT = {
  payee: ['en_preparation', 'Passer en préparation', 'Le client reçoit un e-mail : sa commande est en préparation.'],
  en_preparation: ['expediee', 'Marquer comme expédiée', 'Le client reçoit un e-mail avec le numéro de suivi.'],
  expediee: ['livree', 'Marquer comme livrée', 'Le client reçoit un e-mail : sa commande est livrée.'],
};
const isExpress = (o) => o.delivery === 'express';
const deliveryName = (o) => (isExpress(o) ? 'Chronopost express, à domicile en 24 h' : 'Colissimo, à domicile');
const count = (o) => (o.items || []).reduce((n, it) => n + (Number(it.qty) || 1), 0);
const addressLines = (o) => {
  const s = o.shipping || {}, a = s.address || {};
  return [s.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country && a.country !== 'FR' ? a.country : 'France'].filter(Boolean);
};
const cityOf = (o) => ((o.shipping && o.shipping.address && o.shipping.address.city) || '');
const nameOf = (o) => ((o.shipping && o.shipping.name) || (o.customer && o.customer.name) || o.email || '');

// le visuel d'un article, tel qu'il sera livré (le même calcul que Mes commandes et les e-mails)
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
let orders = [], thumbs = new Map(), hd = {}, logs = {}, filter = 'payee', query = '', openRef = null;
let actions = null; // { set(id, patch), cancel(id) } : branchés au compte (voir start)

function matches(o) {
  if (filter !== 'all' && o.status !== filter) return false;
  if (!query) return true;
  const hay = [o.ref, nameOf(o), cityOf(o), o.email, o.customer && o.customer.email].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function renderFilters() {
  const box = $('gc-filters');
  box.textContent = '';
  FILTERS.forEach(([k, label]) => {
    const n = k === 'all' ? orders.length : orders.filter((o) => o.status === k).length;
    if (!n && !['payee', 'all'].includes(k)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.f = k;
    b.setAttribute('aria-pressed', String(filter === k));
    b.innerHTML = `${esc(label)} <b>${n}</b>`;
    b.addEventListener('click', () => { filter = k; renderFilters(); renderList(); });
    box.appendChild(b);
  });
}

function renderList() {
  const list = $('gc-list');
  list.textContent = '';
  const rows = orders.filter(matches)
    // à préparer : la plus ancienne d'abord ; sinon, la plus récente d'abord
    .sort((a, b) => (filter === 'payee' ? 1 : -1) * (new Date(a.paid_at || a.created_at) - new Date(b.paid_at || b.created_at)));
  $('gc-empty').hidden = rows.length > 0;
  $('gc-empty').textContent = query ? 'Aucune commande ne correspond à cette recherche.' : filter === 'payee' ? 'Aucune commande à préparer : tout est parti.' : 'Aucune commande ici.';
  rows.forEach((o) => {
    const li = document.createElement('li');
    li.className = 'o-card';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'o-item';
    b.dataset.ref = o.ref;
    const row = document.createElement('span');
    row.className = 'o-vis-row';
    const items = o.items || [];
    items.slice(0, 2).forEach((it) => { const src = thumbs.get(String(it.compId)); if (src) row.appendChild(visual(it, src, 64)); });
    if (items.length > 2) row.insertAdjacentHTML('beforeend', `<span class="o-more">+${items.length - 2}</span>`);
    const n = count(o);
    // à préparer depuis plus de 3 jours : signalé
    const late = o.status === 'payee' && Date.now() - new Date(o.paid_at || o.created_at) > 3 * 864e5;
    const main = document.createElement('span');
    main.className = 'o-main';
    main.innerHTML = `<b>${esc(o.ref)}</b><span class="gc-who">${esc([nameOf(o), cityOf(o)].filter(Boolean).join(' · '))}</span><span class="o-meta">${late ? '<span class="gc-late">payée il y a plus de 3 jours</span>' : esc(`payée le ${day(o.paid_at || o.created_at)}`)} · ${esc(n > 1 ? `${n} articles` : '1 article')}</span>${isExpress(o) ? '<span class="gc-express">Express 24 h</span>' : ''}`;
    const side = document.createElement('span');
    side.className = 'o-side';
    side.innerHTML = `<span class="o-pill s-${esc(o.status)}">${esc(STATUS[o.status] || o.status)}</span><span class="o-total">${esc(euros(o.total_cents))}</span><span class="o-see">Ouvrir ›</span>`;
    b.append(row, main, side);
    b.addEventListener('click', () => openDetail(o.ref));
    li.appendChild(b);
    list.appendChild(li);
  });
}

function closeDetail() { $('gc-detail').hidden = true; document.body.style.overflow = ''; openRef = null; }
function openDetail(ref) {
  const o = orders.find((x) => x.ref === ref);
  if (!o) return;
  openRef = ref;
  const body = $('gd-body');
  const c = o.customer || {};
  const at = STEPS.findIndex(([k]) => k === o.status);
  const steps = o.status === 'annulee' ? '' : `<ol class="od-steps">${STEPS.map(([k, l], i) => `<li class="${i < at ? 'done' : i === at ? 'done now' : ''}"><i></i>${esc(l)}</li>`).join('')}</ol>`;
  const files = hd[o.id] || [];
  const hdOf = (i) => files.find((f) => f.index === i);
  const items = (o.items || []).map((it, i) => {
    const f = hdOf(i);
    // le fichier d'impression HD (tableaux imprimés) : fait sur place (l'atelier travaille en coulisse,
    // voir startHD), puis rangé avec la commande
    const running = job && job.orderId === o.id && job.index === i;
    const file = it.product !== 'print' || !it.compId ? '' : running ? jobHtml()
      : f
        ? `<span class="gd-hd ok">Fichier HD prêt${f.size ? ` · ${esc(Math.round(f.size / 1048576 * 10) / 10)} Mo` : ''}${f.at ? ` · ${esc(day(f.at))}` : ''}</span><button type="button" class="gd-open gd-dl" data-hd="${i}">Télécharger le fichier HD</button> <button type="button" class="gd-redo" data-make="${i}"${job ? ' disabled' : ''}>Refaire</button>`
        : `<span class="gd-hd">Fichier HD à préparer (depuis un ordinateur pour les grands formats)</span><button type="button" class="gd-open gd-make" data-make="${i}"${job ? ' disabled' : ''}>Préparer le fichier HD</button>`;
    return `<li><span class="od-vis" data-vis="${i}"></span><span><b>${esc(it.title || 'Œuvre')}</b><small>${esc(it.label || '')}${Number(it.qty) > 1 ? ` × ${Math.round(Number(it.qty))}` : ''}</small><span class="gd-hd-row">${file}</span></span><span class="od-price">${esc(euros(Math.round((Number(it.unit) || 0) * 100) * (Number(it.qty) || 1)))}</span></li>`;
  }).join('');
  const next = NEXT[o.status];
  const canCancel = ['payee', 'en_preparation'].includes(o.status);
  body.innerHTML = `<p class="od-kicker">Commande</p>
    <h2 class="od-title" id="gd-title">${esc(o.ref)}</h2>
    <p class="od-date">Payée le ${esc(dayTime(o.paid_at || o.created_at))} · ${esc(STATUS[o.status] || o.status)}</p>
    ${o.status === 'annulee' ? `<p class="od-cancelled">Commande annulée${o.refund ? ' et remboursée' : ''}.</p>` : steps}
    <section class="od-sec"><h3>Client</h3><div class="gd-contact">
      <p>${esc(c.name || nameOf(o))}</p>
      ${(c.email || o.email) ? `<p><a href="mailto:${esc(c.email || o.email)}">${esc(c.email || o.email)}</a></p>` : ''}
      ${c.phone ? `<p><a href="tel:${esc(String(c.phone).replace(/[^+0-9]/g, ''))}">${esc(c.phone)}</a></p>` : ''}
    </div></section>
    <section class="od-sec"><h3>Livraison</h3>
      <span class="gd-mode${isExpress(o) ? ' express' : ''}">${esc(deliveryName(o))}</span>
      <p>${addressLines(o).map(esc).join('<br>')}</p>
      <button type="button" class="gd-copy" data-copy>Copier l’adresse</button>
      ${o.tracking ? `<p class="od-track">Suivi : <b>${esc([o.carrier, o.tracking].filter(Boolean).join(' '))}</b></p>` : ''}
    </section>
    <section class="od-sec"><h3>Œuvres à imprimer</h3><ul class="od-items">${items}</ul>
      <div class="od-sum"><div><span>Œuvres</span><span>${esc(euros(o.subtotal_cents))}</span></div><div><span>Livraison</span><span>${esc(euros(o.shipping_cents))}</span></div><div class="total"><span>Total payé</span><span>${esc(euros(o.total_cents))}</span></div></div>
    </section>
    ${next ? `<form class="gd-next" id="gd-next">
      ${next[0] === 'expediee' ? `<div class="gd-fields"><label>Transporteur<input name="carrier" list="gd-carriers" value="${esc(o.carrier || (isExpress(o) ? 'Chronopost' : 'Colissimo'))}" required></label><label>Numéro de suivi<input name="tracking" value="${esc(o.tracking || '')}" autocomplete="off" required></label></div><datalist id="gd-carriers"><option value="Colissimo"><option value="Chronopost"><option value="Mondial Relay"></datalist>` : ''}
      <button type="submit" class="btn btn-primary">${esc(next[1])}</button>
      <p>${esc(next[2])}</p>
    </form>` : ''}
    ${historyHtml(o)}
    ${canCancel ? `<div class="od-actions"><button type="button" class="od-cancel" data-cancel>Annuler et rembourser ${esc(euros(o.total_cents))}</button><p class="od-note">Le client est remboursé en entier par Stripe et reçoit un e-mail.</p></div>` : ''}`;
  (o.items || []).forEach((it, i) => { const src = thumbs.get(String(it.compId)); const slot = body.querySelector(`[data-vis="${i}"]`); if (src && slot) slot.appendChild(visual(it, src, 110)); });
  // télécharger un fichier HD (lien signé, valable 10 minutes)
  body.querySelectorAll('[data-hd]').forEach((b) => b.addEventListener('click', async () => {
    if (!actions || !actions.hdUrl) return;
    b.disabled = true;
    try {
      const i = Number(b.dataset.hd);
      const url = await actions.hdUrl(o.id, i, `${o.ref}-${i + 1}.pdf`);
      const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { console.error(err); done(`Fichier HD indisponible : ${(err && err.message) || ''}`, true); } finally { b.disabled = false; }
  }));
  body.querySelectorAll('[data-make]').forEach((b) => b.addEventListener('click', () => startHD(o, Number(b.dataset.make))));
  // copier l'adresse (étiquette du colis)
  const copy = body.querySelector('[data-copy]');
  copy.addEventListener('click', () => {
    const text = addressLines(o).join('\n');
    const ok = () => { copy.textContent = 'Adresse copiée'; setTimeout(() => { copy.textContent = 'Copier l’adresse'; }, 2500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok, () => {}); else ok();
  });
  const form = body.querySelector('#gd-next');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!actions) return;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const patch = { status: next[0] };
      if (form.carrier) { patch.carrier = form.carrier.value.trim(); patch.tracking = form.tracking.value.trim(); }
      const r = await actions.set(o.id, patch);
      done(`${o.ref} : ${STATUS[next[0]].toLowerCase()}${r && r.mailed ? ', le client est prévenu par e-mail' : ''}.`);
    } catch (err) { console.error(err); done(`${o.ref} non enregistrée : ${(err && err.message) || ''}`, true); } finally { btn.disabled = false; }
  });
  const cancel = body.querySelector('[data-cancel]');
  if (cancel) cancel.addEventListener('click', async () => {
    if (!cancel.classList.contains('confirm')) {
      cancel.classList.add('confirm');
      cancel.textContent = `Toucher encore pour rembourser ${euros(o.total_cents)} et annuler`;
      setTimeout(() => { if (cancel.isConnected) { cancel.classList.remove('confirm'); cancel.textContent = `Annuler et rembourser ${euros(o.total_cents)}`; } }, 6000);
      return;
    }
    if (!actions) return;
    cancel.disabled = true;
    try { await actions.cancel(o.id); done(`${o.ref} : annulée et remboursée.`); } catch (err) { console.error(err); done(`Annulation impossible : ${(err && err.message) || ''}`, true); } finally { cancel.disabled = false; }
  });
  $('gc-detail').hidden = false;
  document.body.style.overflow = 'hidden';
}
let onDone = null;
function done(text, err) { if (onDone) onDone(text, err); }

// l'historique : qui a fait quoi, et quand (écrit par le serveur ; la plus récente action en haut)
function historyHtml(o) {
  const rows = (logs[o.id] || []).slice().reverse();
  const list = rows.length
    ? `<ol class="gd-log">${rows.map((r) => `<li><span class="gd-log-at">${esc(dayTime(r.at))}</span><span><b>${esc(r.actor || 'l’équipe')}</b> : ${esc(r.action || '')}</span></li>`).join('')}</ol>`
    : '<p class="gd-log-empty">Rien d’inscrit pour l’instant : l’historique note chaque action depuis sa mise en place.</p>';
  return `<section class="od-sec"><h3>Historique</h3>${list}</section>`;
}

// ---------- le fichier HD, fait sans quitter la page ----------
// L'atelier (même site, même compte) s'ouvre dans un cadre invisible avec fichier-hd=…&coulisse=1 : il
// rouvre l'œuvre, la refait en haute définition, range le PDF avec la commande, et dit où il en est
// (postMessage) ; la page montre la barre de progression. Un seul fichier à la fois.
let job = null; // { orderId, ref, index, frame, pct, text, timer }
const JOB_SILENCE = 180000; // (sans nouvelles de l'atelier pendant 3 minutes : abandon)
function jobHtml() {
  const pct = Math.max(0, Math.min(100, Math.round(job.pct || 0)));
  return `<span class="gd-hd gd-job" data-job><span class="gd-job-top"><b>Fichier HD en préparation</b><span data-job-pct>${pct} %</span></span>`
    + `<span class="gd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Préparation du fichier HD"><i style="width:${pct}%"></i></span>`
    + `<small data-job-text>${esc(job.text || '')}</small><small class="gd-job-note">Gardez cette page ouverte.</small></span>`;
}
function jobPaint() {
  const el = document.querySelector('#gd-body [data-job]');
  if (!el || !job) return;
  const pct = Math.max(0, Math.min(100, Math.round(job.pct || 0)));
  el.querySelector('[data-job-pct]').textContent = `${pct} %`;
  const bar = el.querySelector('.gd-bar');
  bar.setAttribute('aria-valuenow', String(pct));
  bar.firstElementChild.style.width = `${pct}%`;
  el.querySelector('[data-job-text]').textContent = job.text || '';
}
function jobEnd(text, err) {
  if (!job) return;
  clearTimeout(job.timer);
  job.frame.remove();
  job = null;
  window.removeEventListener('beforeunload', jobGuard);
  if (openRef) openDetail(openRef); // (les boutons reviennent ; la liste des fichiers se relit après)
  done(text, err);
}
function jobWatch() { clearTimeout(job.timer); job.timer = setTimeout(() => jobEnd(`Le fichier HD de ${job.ref} n’a pas pu être fait : l’atelier ne répond plus. Réessayez, depuis un ordinateur pour les grands formats.`, true), JOB_SILENCE); }
function jobGuard(e) { e.preventDefault(); e.returnValue = ''; }
function startHD(o, index) {
  if (job) return;
  const frame = document.createElement('iframe');
  frame.className = 'gc-backstage';
  frame.title = 'Préparation du fichier HD';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.src = `atelier/?fichier-hd=${encodeURIComponent(o.id)}&article=${index}&coulisse=1`;
  job = { orderId: o.id, ref: o.ref, index, frame, pct: 1, text: 'Ouverture de l’atelier…', timer: 0 };
  document.body.appendChild(frame);
  window.addEventListener('beforeunload', jobGuard);
  jobWatch();
  if (openRef === o.ref) openDetail(o.ref);
}
window.addEventListener('message', (e) => {
  if (!job || e.origin !== location.origin || e.source !== job.frame.contentWindow) return;
  const m = e.data || {};
  if (m.atelier !== 'fichier-hd') return;
  if (m.kind === 'progress') {
    job.pct = Math.max(job.pct, Number(m.pct) || 0);
    if (m.text) job.text = String(m.text);
    jobWatch();
    jobPaint();
  } else if (m.kind === 'done') jobEnd(String(m.text || `Fichier HD de ${job.ref} prêt.`));
  else if (m.kind === 'error') jobEnd(String(m.text || `Le fichier HD de ${job.ref} n’a pas pu être fait.`), true);
});

export function render(rows, thumbMap, hdMap, logMap) {
  orders = (rows || []).filter((o) => STATUS[o.status]);
  hd = hdMap || {};
  logs = logMap || {};
  thumbs = new Map(Object.entries(thumbMap || {}).map(([k, v]) => [k, safeData(v)]).filter(([, v]) => v));
  renderFilters();
  renderList();
  $('gc-body').hidden = false;
  if (openRef) openDetail(openRef);
}
$('gd-close').addEventListener('click', closeDetail);
$('gc-detail').addEventListener('click', (e) => { if (e.target === $('gc-detail')) closeDetail(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('gc-detail').hidden) closeDetail(); });
$('gc-q').addEventListener('input', () => { query = $('gc-q').value.trim(); renderList(); });
window.GestionCommandes = { render, open: openDetail, setActions: (a, cb) => { actions = a; onDone = cb; } };

// ---------- l'accès et le chargement (commun aux pages de l'équipe : equipe.js) ----------
const doneMsg = (text, err) => { const el = $('gc-done'); el.textContent = text || ''; el.hidden = !text; el.classList.toggle('err', !!err); };
const { staffPage } = await import(`./equipe.js${V}`);
let firstLoad = true;
const page = staffPage({
  body: 'gc-body',
  what: 'la gestion des commandes',
  async load(A) {
    const rows = await A.orders.admin();
    const ids = [...new Set(rows.flatMap((o) => (o.items || []).map((it) => String(it.compId || ''))).filter(Boolean))];
    const [th, files, log] = await Promise.all([
      A.orders.staffThumbs(ids).catch((e) => { console.error(e); return {}; }),
      A.orders.hdList(rows.map((o) => o.id)).catch((e) => { console.error(e); return {}; }),
      A.orders.log(rows.map((o) => o.id)).catch((e) => { console.error(e); return {}; }),
    ]);
    window.GestionCommandes.setActions({
      set: (id, patch) => A.orders.set(id, patch),
      cancel: (id) => A.orders.cancel(id),
      hdUrl: (id, i, name) => A.orders.hdUrl(id, i, name),
    }, (text, err) => { doneMsg(text, err); if (!err) page.reload(); });
    render(rows, th, files, log);
    $('tb-when').textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')}`;
    // gestion-commandes.html#AG-… (lien de l'e-mail « Nouvelle commande ») : cette commande ouverte
    if (firstLoad) { firstLoad = false; openFromHash(); }
  },
});
function openFromHash() {
  const ref = decodeURIComponent((location.hash || '').slice(1));
  const o = ref && orders.find((x) => x.ref === ref);
  if (o) { filter = o.status; renderFilters(); renderList(); openDetail(ref); }
}
// un autre lien #AG-… alors que la page est déjà ouverte
window.addEventListener('hashchange', openFromHash);
