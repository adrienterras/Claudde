/*
 * Atelier Gribouille — commandes payées avec Stripe : ce que le serveur calcule lui-même.
 *
 * Le navigateur ne donne jamais un prix : la fonction « commande » relit le panier du compte (les
 * compositions marquées meta.cart), vérifie chaque article et en recalcule le prix d'après ce
 * catalogue, qui doit rester identique à celui de l'atelier (PRICES, KIT_*, dans collage/js/app.js ;
 * un test le vérifie). Les frais de livraison (France métropolitaine, à domicile) sont ici seulement.
 *
 * Module JavaScript sans dépendance : importé par les fonctions Supabase (Deno) et par les tests (Node).
 */

export const PRICES = {
  hd: 29, guide: 29,
  print: {
    papier: { '21x30': 39, '30x40': 49, '40x50': 69, '50x70': 99, '70x100': 129 },
    cadre: { '21x30': 59, '30x40': 79, '40x50': 99, '50x70': 129, '70x100': 179 },
  },
};
export const KIT_BASE = 45;
export const KIT_OPTIONS = { toile: null, colle: 11, pinceau: 6 };
export const KIT_CANVAS = [[1200, 17], [2000, 22], [3600, 27], [5400, 35], [7500, 45], [10000, 59], [Infinity, 79]];
export const SIZES = { '21x30': [21, 30], '30x40': [30, 40], '40x50': [40, 50], '50x70': [50, 70], '70x100': [70, 100] };

/*
 * Livraison en France métropolitaine (Corse comprise), en euros TTC — montants PROVISOIRES, à remplacer
 * par les coûts réels (transporteur, emballage) avant le passage en production. Deux modes, au choix du
 * client sur la page de paiement : à domicile, ou en point relais (le plus proche de l'adresse donnée ;
 * null : format trop grand pour un point relais, le 70 × 100 encadré). Prix : l'article le plus cher à
 * expédier, plus EXTRA par article imprimé de plus (quantités comprises). Le kit DIY a sa livraison
 * comprise dans son prix (KIT_BASE) ; fichier HD et guide : rien à livrer.
 */
export const SHIPPING = {
  domicile: {
    papier: { '21x30': 9.9, '30x40': 9.9, '40x50': 9.9, '50x70': 9.9, '70x100': 11.9 },
    cadre: { '21x30': 14.9, '30x40': 19.9, '40x50': 19.9, '50x70': 24.9, '70x100': 39.9 },
  },
  relais: {
    papier: { '21x30': 5.9, '30x40': 5.9, '40x50': 5.9, '50x70': 5.9, '70x100': 6.9 },
    cadre: { '21x30': 8.9, '30x40': 10.9, '40x50': 12.9, '50x70': 16.9, '70x100': null },
  },
  extra: 5,
};
export const DELIVERY = {
  domicile: 'Livraison à domicile',
  relais: 'Point relais (le plus proche de votre adresse)',
};
export const COUNTRIES = ['FR'];

const FRAMES = { 'bois-clair': 'bois clair', 'bois-noir': 'bois noir', 'bois-blanc': 'bois blanc', metal: 'aluminium', 'bois-fonce': 'bois foncé' };
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const cents = (eur) => Math.round(eur * 100);

// Un article du panier tel que gardé dans le compte (meta.cart), vérifié et remis en forme ; null s'il
// n'est pas valable (produit inconnu, taille hors catalogue, dimensions absurdes…)
export function normalizeItem(cart) {
  if (!cart || typeof cart !== 'object') return null;
  const product = cart.product;
  if (!['print', 'hd', 'guide', 'kit'].includes(product)) return null;
  const W = Number(cart.W), H = Number(cart.H);
  if (!(W >= 5 && W <= 400 && H >= 5 && H <= 400)) return null;
  const oneOff = product === 'guide' || product === 'kit';
  const qty = Math.round(Number(cart.qty));
  const it = { product, W, H, qty: oneOff ? 1 : Math.min(20, Math.max(1, Number.isFinite(qty) ? qty : 1)) };
  if (product === 'print') {
    if (!own(PRICES.print, cart.finish) || !own(SIZES, cart.size)) return null;
    it.finish = cart.finish; it.size = cart.size;
    if (it.finish === 'cadre') { it.frame = own(FRAMES, cart.frame) ? cart.frame : 'bois-clair'; it.mat = cart.mat === true; }
    it.margin = cart.margin === true && !(it.finish === 'cadre' && it.mat);
  }
  if (product === 'hd') { if (own(SIZES, cart.size)) it.size = cart.size; it.margin = cart.margin === true; }
  if (product === 'kit') {
    const k = cart.kit && typeof cart.kit === 'object' ? cart.kit : {};
    it.kit = { toile: k.toile !== false, colle: k.colle !== false, pinceau: k.pinceau !== false };
  }
  return it;
}

export const kitCanvasPrice = (W, H) => KIT_CANVAS.find(([a]) => W * H <= a)[1];
export function unitPrice(it) {
  if (it.product === 'print') return PRICES.print[it.finish][it.size];
  if (it.product === 'kit') {
    return Object.keys(KIT_OPTIONS).reduce((t, k) => t + (it.kit[k] ? (k === 'toile' ? kitCanvasPrice(it.W, it.H) : KIT_OPTIONS[k]) : 0), KIT_BASE);
  }
  return PRICES[it.product];
}

// frais de livraison de tout le panier, en centimes, pour un mode (domicile, relais) ; null : ce mode
// n'est pas possible pour ce panier (un article trop grand pour un point relais)
export function shippingCents(items, mode = 'domicile') {
  const each = [];
  items.filter((it) => it.product === 'print').forEach((it) => { for (let i = 0; i < it.qty; i++) each.push(SHIPPING[mode][it.finish][it.size]); });
  if (!each.length) return 0;
  if (each.some((v) => v == null)) return null;
  return cents(Math.max(...each) + SHIPPING.extra * (each.length - 1));
}
// les modes possibles pour ce panier, avec leur prix en centimes (domicile toujours, en premier)
export function deliveryOptions(items) {
  if (!needsDelivery(items)) return [];
  const out = [{ mode: 'domicile', cents: shippingCents(items, 'domicile') }];
  const relais = shippingCents(items, 'relais');
  // (rien d'imprimé, seulement un kit : sa livraison est comprise, à domicile)
  if (relais != null && items.some((it) => it.product === 'print')) out.push({ mode: 'relais', cents: relais });
  return out;
}
// à livrer (une adresse est demandée) : un tirage ou un kit
export const needsDelivery = (items) => items.some((it) => it.product === 'print' || it.product === 'kit');

const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const sizeLabel = (size, W, H) => { const [a, b] = SIZES[size]; return W >= H ? `${b} × ${a} cm` : `${a} × ${b} cm`; };
// l'article en clair (page de paiement Stripe, trace de la commande)
export function itemLabel(it) {
  if (it.product === 'print' && it.finish === 'cadre') {
    return `Tableau encadré ${sizeLabel(it.size, it.W, it.H)}, cadre ${FRAMES[it.frame]}, ${it.mat ? 'avec passe-partout' : it.margin ? 'bordure blanche' : 'sans passe-partout'}`;
  }
  if (it.product === 'print') return `Affiche ${sizeLabel(it.size, it.W, it.H)}${it.margin ? ', bordure blanche' : ''}`;
  if (it.product === 'hd') return `Fichier HD${it.size ? ` ${sizeLabel(it.size, it.W, it.H)}` : ''}`;
  if (it.product === 'guide') return 'Guide DIY';
  const parts = ['guide imprimé et gabarits', it.kit.toile ? `toile ${fmt(it.W)} × ${fmt(it.H)} cm` : 'sans toile', it.kit.colle ? 'colle et vernis' : null, it.kit.pinceau ? 'pinceaux' : null].filter(Boolean);
  return `Kit DIY : ${parts.join(', ')}`;
}

// les lignes du panier du compte → les articles de la commande (les non valables sont écartés)
export function orderItems(rows) {
  return (rows || []).map((row) => {
    const it = normalizeItem(row && row.meta && row.meta.cart);
    if (!it) return null;
    return Object.assign(it, { compId: String(row.id), title: String(row.name || 'Œuvre').slice(0, 80), unit: unitPrice(it), label: itemLabel(it) });
  }).filter(Boolean);
}
export function totals(items) {
  const subtotal = items.reduce((t, it) => t + cents(it.unit) * it.qty, 0);
  const shipping = shippingCents(items, 'domicile');
  return { subtotal, shipping, total: subtotal + shipping };
}

export function orderRef(now = new Date(), rnd = Math.random) {
  return `AG-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(rnd() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0')}`;
}

// les adresses où l'atelier est servi (retour après paiement) ; une autre origine revient sur le site
export const ORIGINS = ['https://ateliergribouille.art', 'https://www.ateliergribouille.art', 'https://ateliergribouille.pages.dev'];
export const siteOrigin = (origin) => (ORIGINS.includes(origin) ? origin : ORIGINS[0]);

// La session de paiement Stripe (Checkout), en paramètres de formulaire (l'API Stripe les veut ainsi)
export function checkoutParams({ order, items, email, origin }) {
  const site = siteOrigin(origin);
  const p = [
    ['mode', 'payment'], ['locale', 'fr'],
    ['client_reference_id', order.id], ['metadata[order_id]', order.id], ['metadata[ref]', order.ref],
    ['payment_intent_data[metadata][order_id]', order.id], ['payment_intent_data[metadata][ref]', order.ref],
    ['success_url', `${site}/atelier/?commande=${encodeURIComponent(order.ref)}`],
    ['cancel_url', `${site}/atelier/?panier`],
  ];
  if (email) p.push(['customer_email', email]);
  items.forEach((it, i) => {
    const b = `line_items[${i}]`;
    p.push([`${b}[quantity]`, String(it.qty)], [`${b}[price_data][currency]`, 'eur'], [`${b}[price_data][unit_amount]`, String(cents(it.unit))],
      [`${b}[price_data][product_data][name]`, `${it.title} — ${it.label}`.slice(0, 200)]);
  });
  if (needsDelivery(items)) {
    COUNTRIES.forEach((c, i) => p.push([`shipping_address_collection[allowed_countries][${i}]`, c]));
    p.push(['phone_number_collection[enabled]', 'true']);
    deliveryOptions(items).forEach((o, i) => {
      const s = `shipping_options[${i}][shipping_rate_data]`;
      p.push([`${s}[type]`, 'fixed_amount'], [`${s}[fixed_amount][amount]`, String(o.cents)], [`${s}[fixed_amount][currency]`, 'eur'],
        [`${s}[display_name]`, o.cents ? DELIVERY[o.mode] : `${DELIVERY[o.mode]} (comprise dans le kit)`], [`${s}[metadata][mode]`, o.mode]);
    });
  }
  return p;
}
export const formBody = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

// La signature d'une notification Stripe (en-tête Stripe-Signature : « t=…,v1=… ») : HMAC-SHA256 du
// texte « t.corps » avec le secret du webhook ; refusée au-delà de 5 minutes d'écart
export async function verifySignature(payload, header, secret, now = Date.now() / 1000, tolerance = 300) {
  if (!header || !secret) return false;
  const parts = String(header).split(',').map((x) => x.split('='));
  const t = Number((parts.find(([k]) => k === 't') || [])[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(now - t) > tolerance) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

// La trace gardée dans la fiche de l'œuvre commandée (comme l'atelier le faisait à la commande par e-mail)
export const orderTrace = (it, order, at, consent) => ({
  product: it.product, finish: it.finish, size: it.size, frame: it.frame, mat: it.mat, margin: it.margin, kit: it.kit, W: it.W, H: it.H,
  ref: order.ref, at, label: it.label, qty: it.qty, unit: it.unit, consent: !!consent, paid: true,
});
