/*
 * Gestion des commandes (gestion-commandes.html), pour l'équipe : l'administrateur et les comptes au rôle
 * « tableau », connectés avec la double authentification (le serveur le vérifie : lecture des
 * commandes par is_staff(), changements par les fonctions commande-statut et commande-annuler).
 *
 * La liste : filtrée par statut (à préparer d'abord), cherchée par référence, nom, ville ou e-mail ;
 * chaque commande avec le visuel de ses œuvres. Le détail, dans une fenêtre : le client, la livraison,
 * les œuvres (« Ouvrir dans l'atelier » pour l'exporter et l'imprimer), les étapes, l'étape suivante
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
let orders = [], thumbs = new Map(), hd = {}, filter = 'payee', query = '', openRef = null;
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
    const f = hdOf(i), make = `atelier/?fichier-hd=${encodeURIComponent(o.id)}&article=${i}`;
    // le fichier d'impression HD (tableaux imprimés) : à préparer dans l'atelier, puis rangé avec la commande
    const file = it.product !== 'print' || !it.compId ? '' : f
      ? `<span class="gd-hd ok">Fichier HD prêt${f.size ? ` · ${esc(Math.round(f.size / 1048576 * 10) / 10)} Mo` : ''}${f.at ? ` · ${esc(day(f.at))}` : ''}</span><button type="button" class="gd-open gd-dl" data-hd="${i}">Télécharger le fichier HD</button> <a class="gd-redo" href="${esc(make)}" target="_blank" rel="noopener">Refaire</a>`
      : `<span class="gd-hd">Fichier HD à préparer (depuis un ordinateur)</span><a class="gd-open gd-make" href="${esc(make)}" target="_blank" rel="noopener">Préparer le fichier HD</a>`;
    return `<li><span class="od-vis" data-vis="${i}"></span><span><b>${esc(it.title || 'Œuvre')}</b><small>${esc(it.label || '')}${Number(it.qty) > 1 ? ` × ${Math.round(Number(it.qty))}` : ''}</small>${it.compId ? `<a class="gd-open" href="atelier/?commande-oeuvre=${encodeURIComponent(it.compId)}" target="_blank" rel="noopener">Ouvrir dans l’atelier</a>` : ''}<span class="gd-hd-row">${file}</span></span><span class="od-price">${esc(euros(Math.round((Number(it.unit) || 0) * 100) * (Number(it.qty) || 1)))}</span></li>`;
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

export function render(rows, thumbMap, hdMap) {
  orders = (rows || []).filter((o) => STATUS[o.status]);
  hd = hdMap || {};
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
    const [th, files] = await Promise.all([
      A.orders.staffThumbs(ids).catch((e) => { console.error(e); return {}; }),
      A.orders.hdList(rows.map((o) => o.id)).catch((e) => { console.error(e); return {}; }),
    ]);
    window.GestionCommandes.setActions({
      set: (id, patch) => A.orders.set(id, patch),
      cancel: (id) => A.orders.cancel(id),
      hdUrl: (id, i, name) => A.orders.hdUrl(id, i, name),
    }, (text, err) => { doneMsg(text, err); if (!err) page.reload(); });
    render(rows, th, files);
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
