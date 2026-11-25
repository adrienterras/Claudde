/*
 * Atelier Gribouille — les e-mails des commandes (envoyés par Resend, depuis le domaine du site).
 *
 * Au client : commande confirmée (paiement reçu), en préparation, expédiée (avec le lien de suivi),
 * livrée, annulée et remboursée. À la boutique : nouvelle commande, commande annulée par le client.
 * Même allure que les e-mails du compte (supabase/emails) : fond crème, carte blanche, « Atelier
 * Gribouille » en capitales et en italique à empattements, bouton noir arrondi ; HTML en tableaux et
 * styles en ligne (les messageries ignorent les feuilles de style), avec une version texte.
 * Gabarits sans dépendance (testés par collage/tests/commande.spec.js) ; l'envoi (send) lit la clé
 * RESEND_API_KEY dans les secrets de la fonction : sans elle, rien n'est envoyé (et rien ne casse).
 * Sujets courts : certaines messageries lisent mal un sujet long coupé sur deux lignes.
 */

import { framePlan, framePixels } from './commande.js';

export const SITE = 'https://ateliergribouille.art';
const LOGO = `${SITE}/img/logo-mark-80.png`;
const C = { bg: '#f4efe6', card: '#ffffff', ink: '#2b2a26', ink2: '#4a4740', muted: '#8a8577', line: '#e8e0d2', soft: '#f8f5ef', accent: '#3e5a4c', argile: '#b5654d' };
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Helvetica,Arial,sans-serif';

const eur = (c) => `${(Number(c || 0) / 100).toFixed(2).replace('.', ',')} €`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// (typographie française : une espace insécable avant ! ? : ; et dans les guillemets, pour qu'ils ne tombent pas seuls à la ligne)
const fr = (s) => String(s == null ? '' : s).replace(/ ([!?:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');

// le lien de suivi du colis, selon le transporteur (Colissimo, Chronopost) ; sinon rien
export function trackingUrl(carrier, tracking) {
  const t = String(tracking || '').trim();
  if (!t) return null;
  const c = String(carrier || '').toLowerCase();
  if (/chrono/.test(c)) return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${encodeURIComponent(t)}`;
  if (/colissimo|la poste|laposte/.test(c) || !c) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(t)}`;
  return null;
}

const deliveryName = (order) => (order.delivery === 'express' ? 'Chronopost express (24 h)' : 'Colissimo (2 à 3 jours)');
const nameOf = (order) => (order.customer && order.customer.name) || (order.shipping && order.shipping.name) || '';
const addressLines = (order) => {
  const s = order.shipping || {}, a = s.address || {};
  return [s.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country === 'FR' ? 'France' : a.country].filter(Boolean);
};
const ordersLink = `${SITE}/atelier/?commandes`;
const subtotalOf = (order) => order.subtotal_cents != null ? order.subtotal_cents : Number(order.total_cents || 0) - Number(order.shipping_cents || 0);

// ---------- les morceaux de la page ----------
const btn = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;font-family:${SANS};font-size:15px;font-weight:600;padding:13px 26px;border-radius:999px;">${esc(label)}</a>`;
const para = (html) => `<tr><td style="font-family:${SANS};font-size:15px;line-height:1.65;color:${C.ink2};padding:0 0 14px;">${fr(html)}</td></tr>`;

// la frise d'avancement : Confirmée · En préparation · Expédiée · Livrée (l'étape en cours en vert)
const STEPS = [['payee', 'Confirmée'], ['en_preparation', 'En préparation'], ['expediee', 'Expédiée'], ['livree', 'Livrée']];
function stepsHtml(status) {
  const at = STEPS.findIndex(([k]) => k === status);
  if (at < 0) return '';
  const cells = STEPS.map(([, label], i) => {
    const done = i <= at, cur = i === at;
    const dot = `<div style="width:12px;height:12px;border-radius:50%;margin:0 auto 6px;background:${done ? C.accent : C.line};${cur ? `box-shadow:0 0 0 4px #dfe7e2;` : ''}"></div>`;
    return `<td align="center" width="25%" style="font-family:${SANS};font-size:11px;line-height:1.3;color:${done ? C.ink : C.muted};font-weight:${cur ? '700' : '400'};padding:0 2px;">${dot}${esc(label)}</td>`;
  }).join('');
  return `<tr><td style="padding:4px 0 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
}

// le visuel de l'œuvre commandée (la vignette de la composition, jointe au message : l'image n'est mise
// en ligne nulle part) ; vis : { [compId]: content_id }
const hex = (rgb, k = 1) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('')}`;
// le visuel d'un article tel qu'il sera livré : l'œuvre dans son cadre (teinte, baguettes, passe-partout
// ou bordure blanche) ou sur sa feuille, aux proportions réelles ; size : son plus grand côté, en px.
// En tableaux (les messageries ignorent la plupart des styles) ; l'image n'est jamais étirée (largeur seule)
export function framedHtml(it, src, size, alt = '') {
  const plan = framePlan(it), px = framePixels(plan, size);
  const img = `<img src="${esc(src)}" width="${px.img}" alt="${esc(alt)}" style="display:block;width:${px.img}px;max-width:100%;height:auto;${plan && plan.mat ? 'border:1px solid #e2dccd;' : ''}">`;
  const table = (td, inner) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 auto;"><tr><td style="${td}">${inner}</td></tr></table>`;
  const shadow = `box-shadow:0 ${Math.max(2, Math.round(size / 40))}px ${Math.max(6, Math.round(size / 12))}px rgba(43,42,38,0.18);`;
  if (!plan) {
    const b = Math.max(2, Math.round(size / 24));
    return table(`padding:${b}px;background:#ffffff;border:1px solid ${C.line};${shadow}`, img);
  }
  const white = `padding:${px.padY}px ${px.padX}px;background:#ffffff;`;
  if (!plan.framed) return table(`${white}border:1px solid ${C.line};${shadow}`, img);
  const edge = plan.rgb[0] > 235 ? '#d8d3c8' : hex(plan.rgb, 0.78);
  return table(`padding:${px.frame}px;background:${hex(plan.rgb)};border:1px solid ${edge};${shadow}`,
    table(`${white}border:1px solid ${plan.rgb[0] > 235 ? '#ece8df' : hex(plan.rgb, 0.7)};`, img));
}
// le visuel en grand, sous la frise : la première œuvre de la commande, dans son cadre
function heroHtml(order, vis) {
  const it = (order.items || []).find((x) => vis && vis[x.compId]);
  if (!it) return '';
  return `<tr><td align="center" style="padding:10px 0 28px;">${framedHtml(it, `cid:${vis[it.compId]}`, 260, it.title)}</td></tr>`;
}
// le récapitulatif : chaque œuvre (vignette, titre, article, prix), la livraison, le total
function recapHtml(order, vis) {
  const many = (order.items || []).length > 1;
  const thumb = (it) => (many && vis && vis[it.compId] ? `<td width="70" align="center" valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${C.line};">${framedHtml(it, `cid:${vis[it.compId]}`, 58)}</td>` : '');
  const rows = (order.items || []).map((it) => `<tr>${thumb(it)}
      <td style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:14px;line-height:1.45;color:${C.ink};"><b>${esc(it.title)}</b><br><span style="color:${C.muted};font-size:13px;">${esc(it.label)}${it.qty > 1 ? ` · quantité ${it.qty}` : ''}</span></td>
      <td align="right" valign="top" style="padding:10px 0 10px 12px;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:14px;color:${C.ink};white-space:nowrap;">${it.unit != null ? eur(Math.round(it.unit * 100) * (it.qty || 1)) : ''}</td>
    </tr>`).join('');
  const span = many && vis && Object.keys(vis).length ? ' colspan="2"' : '';
  const line = (label, value, strong) => `<tr><td${span} style="padding:${strong ? '12px' : '8px'} 0 0;font-family:${SANS};font-size:${strong ? '16px' : '14px'};color:${strong ? C.ink : C.ink2};font-weight:${strong ? '700' : '400'};">${label}</td><td align="right" style="padding:${strong ? '12px' : '8px'} 0 0 12px;font-family:${SANS};font-size:${strong ? '16px' : '14px'};color:${C.ink};font-weight:${strong ? '700' : '400'};white-space:nowrap;">${value}</td></tr>`;
  const ship = order.shipping_cents ? line(`Livraison · ${esc(deliveryName(order))}`, eur(order.shipping_cents)) : '';
  return `<tr><td style="padding:8px 0 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.soft};border-radius:12px;padding:16px 18px;">
      <tr><td colspan="3" style="font-family:${SANS};font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${C.muted};padding-bottom:4px;">Commande ${esc(order.ref)}</td></tr>
      ${rows}
      ${ship ? line('Œuvres', eur(subtotalOf(order))) : ''}${ship}
      ${line('Total TTC', eur(order.total_cents), true)}
    </table></td></tr>`;
}
function addressHtml(order, title) {
  const lines = addressLines(order);
  if (!lines.length) return '';
  return `<tr><td style="padding:16px 0 4px;font-family:${SANS};font-size:14px;line-height:1.55;color:${C.ink2};"><span style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${C.muted};">${esc(title)}</span><br>${lines.map(esc).join('<br>')}</td></tr>`;
}

// la page entière : en-tête (logo, Atelier Gribouille), titre, contenu, pied de page
function page({ preheader, title, body, footnote }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border-radius:16px;padding:34px 30px 30px;color:${C.ink};">
      <tr><td style="padding-bottom:26px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:12px;"><img src="${LOGO}" width="40" height="40" alt="" style="display:block;border:0;"></td>
          <td><div style="font-family:${SANS};font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:${C.muted};line-height:1;">Atelier</div><div style="font-family:${SERIF};font-size:24px;line-height:1.15;color:${C.ink};">Gribouille</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="font-family:${SERIF};font-size:26px;line-height:1.25;color:${C.ink};padding-bottom:16px;">${esc(fr(title))}</td></tr>
      ${body}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;padding:18px 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">
      <tr><td align="center">Atelier Gribouille · <a href="${SITE}" style="color:${C.muted};">ateliergribouille.art</a> · <a href="mailto:contact@ateliergribouille.art" style="color:${C.muted};">contact@ateliergribouille.art</a>${footnote ? `<br>${esc(footnote)}` : ''}</td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

// la version texte (messageries sans HTML, aperçu)
function textOf({ title, paras, order, extra }) {
  const items = (order.items || []).map((it) => `- ${it.title} — ${it.label}${it.qty > 1 ? ` × ${it.qty}` : ''}${it.unit != null ? ` : ${eur(Math.round(it.unit * 100) * (it.qty || 1))}` : ''}`);
  const total = `Total : ${eur(order.total_cents)}${order.shipping_cents ? ` (dont ${eur(order.shipping_cents)} de livraison${order.delivery === 'express' ? ' express' : ''})` : ''}`;
  return [title, '', ...paras, '', `Commande ${order.ref}`, ...items, total, ...(extra || []), '', `Suivre la commande : ${ordersLink}`, '', 'Atelier Gribouille · ateliergribouille.art · contact@ateliergribouille.art'].join('\n');
}

// l'e-mail au client pour une étape de la commande (status : payee, en_preparation, expediee, livree, annulee)
export function customerEmail(status, order, visuals) {
  const vis = visuals && visuals.map;
  const first = String(nameOf(order) || '').split(' ')[0];
  const hello = first ? `Bonjour ${first},` : 'Bonjour,';
  const url = trackingUrl(order.carrier, order.tracking);
  const C1 = {
    payee: {
      subject: `Commande ${order.ref} confirmée`, title: 'Merci pour votre commande !',
      paras: ['Nous avons bien reçu votre paiement. Nous allons imprimer et préparer votre œuvre avec soin, et nous vous écrirons dès son expédition.', 'Un changement d’avis ? Vous pouvez annuler la commande depuis Mon compte, tant que nous ne l’avons pas mise en préparation.'],
      cta: [ordersLink, 'Suivre ma commande'],
    },
    en_preparation: {
      subject: `Commande ${order.ref} en préparation`, title: 'Votre œuvre est en préparation',
      paras: ['Nous imprimons et emballons votre œuvre. Vous recevrez un e-mail avec le suivi du colis dès son départ.'],
      cta: [ordersLink, 'Suivre ma commande'],
    },
    expediee: {
      subject: `Commande ${order.ref} expédiée`, title: 'Votre colis est en route',
      paras: ['Votre œuvre vient de partir, bien protégée.', order.tracking ? `Transporteur : ${order.carrier || 'Colissimo'} · numéro de suivi : ${order.tracking}` : 'Le numéro de suivi vous sera envoyé dès qu’il est disponible.'],
      cta: url ? [url, 'Suivre le colis'] : [ordersLink, 'Suivre ma commande'],
    },
    livree: {
      subject: `Commande ${order.ref} livrée`, title: 'Votre œuvre est arrivée',
      paras: ['Votre colis a été livré. Nous espérons que l’œuvre vous plaît et qu’elle trouvera la plus belle place de la maison.', 'Longue vie aux gribouillis !'],
      cta: [`${SITE}/atelier/`, 'Créer une nouvelle œuvre'],
    },
    annulee: {
      subject: `Commande ${order.ref} annulée`, title: 'Votre commande est annulée',
      paras: [`La commande est annulée : ${eur(order.total_cents)} vous sont remboursés sur votre moyen de paiement, généralement sous 5 à 10 jours.`, 'Une question ? Répondez simplement à cet e-mail.'],
      cta: [ordersLink, 'Voir mes commandes'],
    },
  }[status];
  if (!C1) return null;
  const body = [
    stepsHtml(status),
    heroHtml(order, vis),
    para(esc(hello)),
    ...C1.paras.map((p) => para(esc(p))),
    `<tr><td style="padding:8px 0 24px;">${btn(C1.cta[0], C1.cta[1])}</td></tr>`,
    recapHtml(order, vis),
    status !== 'annulee' ? addressHtml(order, 'Adresse de livraison') : '',
  ].join('\n');
  const extra = [url ? `Suivre le colis : ${url}` : null].filter(Boolean);
  return {
    subject: C1.subject,
    html: page({ preheader: C1.paras[0], title: C1.title, body, footnote: 'Vous recevez cet e-mail au sujet de votre commande sur ateliergribouille.art.' }),
    text: textOf({ title: C1.title, paras: [hello, ...C1.paras], order, extra }),
    attachments: (visuals && visuals.attachments) || [],
  };
}

// l'e-mail à la boutique : nouvelle commande (avec l'adresse) ou commande annulée par le client
export function shopEmail(kind, order, visuals) {
  const vis = visuals && visuals.map;
  const c = order.customer || {};
  const who = [c.name, c.email || order.email, c.phone].filter(Boolean).join(' · ');
  const addr = addressLines(order);
  const admin = `${SITE}/atelier/?commandes`;
  const cancelled = kind === 'annulee';
  const title = cancelled ? 'Commande annulée par le client' : 'Nouvelle commande';
  const lead = cancelled ? `Commande ${order.ref} : le client l’a annulée, il est remboursé automatiquement.` : `Commande ${order.ref} · paiement reçu : ${eur(order.total_cents)}.`;
  const express = order.delivery === 'express';
  const body = [
    para(`<b style="color:${C.ink};white-space:normal;">${esc(lead)}</b>`),
    express && !cancelled ? para(`<span style="display:inline-block;background:#fbeee9;color:${C.argile};font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:5px 10px;border-radius:999px;">Express · Chronopost 24 h</span>`) : '',
    para(`<span style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${C.muted};">Client</span><br>${esc(who || '—')}`),
    `<tr><td style="padding:4px 0 22px;">${btn(admin, cancelled ? 'Voir les commandes' : 'Préparer la commande')}</td></tr>`,
    heroHtml(order, vis),
    recapHtml(order, vis),
    addressHtml(order, 'Adresse de livraison'),
  ].join('\n');
  const paras = [lead, `Client : ${who || '—'}`, addr.length ? `Livraison${express ? ' EXPRESS (Chronopost 24 h)' : ' Colissimo'} : ${addr.join(', ')}` : null, `À gérer dans l’atelier, espace administrateur, Commandes : ${admin}`].filter(Boolean);
  return {
    subject: cancelled ? `Annulation ${order.ref}` : `Nouvelle commande ${order.ref}`,
    html: page({ preheader: `${lead} ${who}`, title, body }),
    text: textOf({ title, paras, order }),
    attachments: (visuals && visuals.attachments) || [],
  };
}

// les visuels d'une commande, à joindre : thumbs = { [compId]: vignette en data URL JPEG } →
// { map: { [compId]: content_id }, attachments: [{ filename, content (base64), content_id }] }
export function visualsOf(order, thumbs) {
  const map = {}, attachments = [];
  (order.items || []).forEach((it, i) => {
    const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec((thumbs && thumbs[it.compId]) || '');
    if (!m || map[it.compId]) return;
    const id = `oeuvre-${i + 1}`;
    map[it.compId] = id;
    attachments.push({ filename: `${id}.${m[1] === 'png' ? 'png' : 'jpg'}`, content: m[2], content_id: id });
  });
  return { map, attachments };
}

// l'envoi (Resend) ; renvoie true si parti, false sinon (clé absente, refus) — jamais d'exception
export async function send(to, mail, env = (k) => (globalThis.Deno ? Deno.env.get(k) : undefined)) {
  const key = env('RESEND_API_KEY');
  if (!key || !to || !mail) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: env('ORDER_FROM') || 'Atelier Gribouille <commandes@ateliergribouille.art>', to: [to], reply_to: 'contact@ateliergribouille.art', subject: mail.subject, html: mail.html, text: mail.text }, mail.attachments && mail.attachments.length ? { attachments: mail.attachments } : {})),
    });
    if (!r.ok) console.error('Resend', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error('Resend', e); return false; }
}
export const shopAddress = (env = (k) => (globalThis.Deno ? Deno.env.get(k) : undefined)) => env('ORDER_NOTIFY') || 'contact@ateliergribouille.art';
// l'adresse du client : celle saisie à la page de paiement, sinon celle du compte
export const customerAddress = (order) => (order.customer && order.customer.email) || order.email || null;
