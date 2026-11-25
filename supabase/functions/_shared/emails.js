/*
 * Atelier Gribouille — les e-mails des commandes (envoyés par Resend, depuis le domaine du site).
 *
 * Au client : commande confirmée (paiement reçu), en préparation, expédiée (avec le lien de suivi),
 * livrée, annulée et remboursée. À la boutique : nouvelle commande, commande annulée par le client.
 * Gabarits sans dépendance (testés par collage/tests/commande.spec.js) ; l'envoi (send) lit la clé
 * RESEND_API_KEY dans les secrets de la fonction : sans elle, rien n'est envoyé (et rien ne casse).
 * Sujets courts : certaines messageries lisent mal un sujet long coupé sur deux lignes.
 */

export const SITE = 'https://ateliergribouille.art';
const eur = (c) => `${(Number(c || 0) / 100).toFixed(2).replace('.', ',')} €`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// le lien de suivi du colis, selon le transporteur (Colissimo, Chronopost) ; sinon rien
export function trackingUrl(carrier, tracking) {
  const t = String(tracking || '').trim();
  if (!t) return null;
  const c = String(carrier || '').toLowerCase();
  if (/chrono/.test(c)) return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${encodeURIComponent(t)}`;
  if (/colissimo|la poste|laposte/.test(c) || !c) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(t)}`;
  return null;
}

const itemsText = (order) => (order.items || []).map((it) => `- ${it.title} — ${it.label}${it.qty > 1 ? ` × ${it.qty}` : ''}`).join('\n');
const itemsHtml = (order) => `<ul>${(order.items || []).map((it) => `<li>${esc(it.title)} — ${esc(it.label)}${it.qty > 1 ? ` × ${it.qty}` : ''}</li>`).join('')}</ul>`;
const totalLine = (order) => `Total : ${eur(order.total_cents)}${order.shipping_cents ? ` (dont ${eur(order.shipping_cents)} de livraison${order.delivery === 'express' ? ' express' : ''})` : ''}`;
const nameOf = (order) => (order.customer && order.customer.name) || (order.shipping && order.shipping.name) || '';
const addressLines = (order) => {
  const s = order.shipping || {}, a = s.address || {};
  return [s.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean);
};
const ordersLink = `${SITE}/atelier/?commandes`;
const foot = 'Atelier Gribouille · ateliergribouille.art · contact@ateliergribouille.art';

function wrap(title, paras, order) {
  const text = [title, '', ...paras.map((p) => p.text), '', `Commande ${order.ref}`, itemsText(order), totalLine(order), '', `Suivre la commande : ${ordersLink}`, '', foot].join('\n');
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#2b2a22;line-height:1.55;max-width:560px">
<h2 style="font-family:Georgia,serif;font-weight:500">${esc(title)}</h2>
${paras.map((p) => `<p>${p.html || esc(p.text)}</p>`).join('\n')}
<p><b>Commande ${esc(order.ref)}</b></p>${itemsHtml(order)}<p>${esc(totalLine(order))}</p>
<p><a href="${ordersLink}" style="color:#3e5a4c">Suivre la commande dans Mon compte</a></p>
<p style="color:#7f7868;font-size:12px">${esc(foot)}</p></div>`;
  return { text, html };
}

// l'e-mail au client pour une étape de la commande (status : payee, en_preparation, expediee, livree, annulee)
export function customerEmail(status, order) {
  const hello = nameOf(order) ? `Bonjour ${String(nameOf(order)).split(' ')[0]},` : 'Bonjour,';
  if (status === 'payee') {
    return { subject: `Commande ${order.ref} confirmée`, ...wrap('Merci pour votre commande !', [
      { text: hello },
      { text: 'Nous avons bien reçu votre paiement. Nous préparons votre œuvre avec soin, et vous préviendrons dès son expédition.' },
      { text: 'Vous pouvez annuler la commande depuis Mon compte tant que nous ne l’avons pas mise en préparation.' },
    ], order) };
  }
  if (status === 'en_preparation') {
    return { subject: `Commande ${order.ref} en préparation`, ...wrap('Votre œuvre est en préparation', [
      { text: hello },
      { text: 'Nous imprimons et emballons votre œuvre. Vous recevrez un e-mail avec le suivi du colis dès son départ.' },
    ], order) };
  }
  if (status === 'expediee') {
    const url = trackingUrl(order.carrier, order.tracking);
    const track = order.tracking ? `Transporteur : ${order.carrier || 'Colissimo'} · numéro de suivi : ${order.tracking}` : 'Le colis est en route.';
    return { subject: `Commande ${order.ref} expédiée`, ...wrap('Votre colis est en route', [
      { text: hello },
      { text: 'Votre œuvre vient de partir.' },
      { text: track, html: url ? `${esc(track)} — <a href="${esc(url)}" style="color:#3e5a4c">suivre le colis</a>` : esc(track) },
    ], order) };
  }
  if (status === 'livree') {
    return { subject: `Commande ${order.ref} livrée`, ...wrap('Votre œuvre est arrivée', [
      { text: hello },
      { text: 'Votre colis a été livré. Nous espérons que l’œuvre vous plaît : longue vie aux gribouillis !' },
    ], order) };
  }
  if (status === 'annulee') {
    return { subject: `Commande ${order.ref} annulée`, ...wrap('Votre commande est annulée', [
      { text: hello },
      { text: `La commande est annulée : ${eur(order.total_cents)} vous sont remboursés sur votre moyen de paiement, généralement sous 5 à 10 jours.` },
    ], order) };
  }
  return null;
}

// l'e-mail à la boutique : nouvelle commande (avec l'adresse) ou commande annulée par le client
export function shopEmail(kind, order) {
  const c = order.customer || {};
  const who = [c.name, c.email || order.email, c.phone].filter(Boolean).join(' · ');
  const addr = addressLines(order);
  const admin = `${SITE}/atelier/?commandes`;
  const title = kind === 'annulee' ? `Commande ${order.ref} annulée par le client` : `Nouvelle commande ${order.ref}`;
  const lines = [
    { text: kind === 'annulee' ? 'Le client a annulé sa commande ; il est remboursé automatiquement.' : `Paiement reçu : ${eur(order.total_cents)}.` },
    { text: `Client : ${who || '—'}` },
    addr.length ? { text: `Livraison${order.delivery === 'express' ? ' EXPRESS (Chronopost 24 h)' : ' Colissimo'} : ${addr.join(', ')}` } : null,
    { text: `À gérer dans l’atelier, espace administrateur, Commandes : ${admin}` },
  ].filter(Boolean);
  return { subject: kind === 'annulee' ? `Annulation ${order.ref}` : `Nouvelle commande ${order.ref}`, ...wrap(title, lines, order) };
}

// l'envoi (Resend) ; renvoie true si parti, false sinon (clé absente, refus) — jamais d'exception
export async function send(to, mail, env = (k) => (globalThis.Deno ? Deno.env.get(k) : undefined)) {
  const key = env('RESEND_API_KEY');
  if (!key || !to || !mail) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('ORDER_FROM') || 'Atelier Gribouille <commandes@ateliergribouille.art>', to: [to], reply_to: 'contact@ateliergribouille.art', subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!r.ok) console.error('Resend', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error('Resend', e); return false; }
}
export const shopAddress = (env = (k) => (globalThis.Deno ? Deno.env.get(k) : undefined)) => env('ORDER_NOTIFY') || 'contact@ateliergribouille.art';
// l'adresse du client : celle saisie à la page de paiement, sinon celle du compte
export const customerAddress = (order) => (order.customer && order.customer.email) || order.email || null;
