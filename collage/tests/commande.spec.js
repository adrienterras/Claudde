// Commandes payées (Stripe) : le calcul côté serveur (supabase/functions/_shared/commande.js) — prix
// recalculés, livraison, session de paiement, signature des notifications.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const MOD = pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'commande.js')).href;
const load = () => import(MOD);
const cart = (o) => Object.assign({ product: 'print', finish: 'cadre', size: '50x70', qty: 1, W: 50, H: 70, frame: 'bois-noir', mat: true }, o);

test.describe('Commandes : calcul côté serveur', () => {
  test('le catalogue du serveur est celui de l’atelier (prix des tirages, fichier, guide, kit)', async () => {
    const m = await load();
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
    const grab = (re) => { const x = re.exec(src); expect(x, String(re)).not.toBeNull(); return Function(`return (${x[1]});`)(); };
    expect(m.PRICES).toEqual(grab(/const PRICES = (\{[\s\S]*?\n {2}\});/));
    expect(m.KIT_BASE).toBe(grab(/const KIT_BASE = (\d+);/));
    expect(m.KIT_OPTIONS).toEqual(grab(/const KIT_OPTIONS = (\{[^}]*\});/));
    expect(m.KIT_CANVAS).toEqual(grab(/const KIT_CANVAS = (\[[^;]*\]);/));
    // la livraison affichée dans le panier est celle que le serveur fait payer
    expect(m.SHIPPING).toEqual(grab(/const SHIPPING = (\{[\s\S]*?\n {2}\});/));
    for (const mode of ['domicile']) {
      expect(Object.keys(m.SHIPPING[mode].papier)).toEqual(Object.keys(m.PRICES.print.papier));
      expect(Object.keys(m.SHIPPING[mode].cadre)).toEqual(Object.keys(m.PRICES.print.cadre));
    }
  });

  test('chaque article est vérifié, son prix recalculé ; la livraison : le plus cher à expédier, plus 5 € par article imprimé de plus', async () => {
    const m = await load();
    expect(m.normalizeItem(cart({ size: '99x99' }))).toBeNull();
    expect(m.normalizeItem(cart({ finish: 'toile' }))).toBeNull();
    expect(m.normalizeItem(cart({ product: 'constructor' }))).toBeNull();
    expect(m.normalizeItem(cart({ W: 2 }))).toBeNull();
    expect(m.normalizeItem(cart({ qty: 500 })).qty).toBe(20);
    expect(m.normalizeItem({ product: 'kit', qty: 3, W: 80, H: 80 }).qty).toBe(1);
    // le prix stocké dans le panier n'est jamais lu
    const items = m.orderItems([
      { id: 'a', name: 'Lou', meta: { cart: cart({ unit: 1, qty: 2 }) } },
      { id: 'b', name: 'Zoé', meta: { cart: { product: 'print', finish: 'papier', size: '21x30', qty: 1, W: 21, H: 30, margin: true } } },
      { id: 'c', name: 'Kit', meta: { cart: { product: 'kit', W: 80, H: 80, kit: { toile: true, colle: false, pinceau: true } } } },
      { id: 'd', name: 'HD', meta: { cart: { product: 'hd', size: '30x40', W: 30, H: 40 } } },
      { id: 'e', name: 'Faux', meta: { cart: cart({ size: '1x1' }) } },
      { id: 'f', name: 'Pas au panier', meta: {} },
    ]);
    expect(items.map((it) => [it.compId, it.unit, it.qty])).toEqual([['a', 129, 2], ['b', 39, 1], ['c', 45 + 45 + 6, 1], ['d', 29, 1]]);
    expect(items[0].label).toBe('Tableau encadré 50 × 70 cm, cadre bois noir, avec passe-partout');
    expect(items[1].label).toBe('Affiche 21 × 30 cm, bordure blanche');
    const t = m.totals(items);
    // tirages : 2 × 50 × 70 encadré (24,90 €) et une affiche (9,90 €) → 24,90 + 2 × 5 ; le kit a sa livraison comprise
    expect(t.shipping).toBe(3490);
    expect(t.subtotal).toBe((129 * 2 + 39 + 96 + 29) * 100);
    expect(t.total).toBe(t.subtotal + 3490);
    expect(m.shippingCents(m.orderItems([{ id: 'x', name: 'x', meta: { cart: { product: 'hd', W: 30, H: 40 } } }]))).toBe(0);
    // un seul mode : à domicile
    expect(m.deliveryOptions(items)).toEqual([{ mode: 'domicile', cents: 3490 }]);
    expect(m.SHIPPING.relais).toBeUndefined();
    // un kit seul : livraison comprise, à domicile ; rien à livrer : aucun mode
    expect(m.deliveryOptions([items[2]])).toEqual([{ mode: 'domicile', cents: 0 }]);
    expect(m.deliveryOptions([items[3]])).toEqual([]);
  });

  test('la session de paiement : montants en centimes, adresse en France, livraison, retour sur le site', async () => {
    const m = await load();
    const items = m.orderItems([{ id: 'a', name: 'Lou', meta: { cart: cart({ qty: 2 }) } }, { id: 'd', name: 'HD', meta: { cart: { product: 'hd', W: 30, H: 40 } } }]);
    const p = new Map(m.checkoutParams({ order: { id: 'o-1', ref: 'AG-261125-AB12' }, items, email: 'lou@example.org', origin: 'https://evil.example' }));
    expect(p.get('mode')).toBe('payment');
    expect(p.get('customer_email')).toBe('lou@example.org');
    expect(p.get('metadata[order_id]')).toBe('o-1');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('12900');
    expect(p.get('line_items[0][quantity]')).toBe('2');
    expect(p.get('line_items[1][price_data][unit_amount]')).toBe('2900');
    expect(p.get('shipping_address_collection[allowed_countries][0]')).toBe('FR');
    expect(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('2990');
    expect(p.get('shipping_options[0][shipping_rate_data][metadata][mode]')).toBe('domicile');
    expect(p.has('shipping_options[1][shipping_rate_data][type]')).toBe(false);
    // le récapitulatif écrit au-dessus du bouton Payer (Stripe replie le détail sur téléphone)
    expect(p.get('custom_text[submit][message]')).toBe('Votre commande : Lou — Tableau encadré 50 × 70 cm, cadre bois noir, avec passe-partout × 2 : 258,00 € · HD — Fichier HD : 29,00 € · Livraison à domicile : 29,90 € · Total : 316,90 €');
    const many = m.orderItems(Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, name: `Œuvre numéro ${i} avec un titre assez long`, meta: { cart: cart() } })));
    expect(m.summary(many).length).toBeLessThanOrEqual(1200);
    expect(m.summary(many)).toMatch(/et \d+ autre\(s\) article\(s\) · Livraison à domicile : .* · Total : /);
    // une origine inconnue revient sur le site
    expect(p.get('success_url')).toBe('https://ateliergribouille.art/atelier/?commande=AG-261125-AB12');
    expect(p.get('cancel_url')).toBe('https://ateliergribouille.art/atelier/?panier');
    // sans rien à livrer : pas d'adresse demandée
    const digital = new Map(m.checkoutParams({ order: { id: 'o-2', ref: 'R' }, items: [items[1]], origin: 'https://ateliergribouille.pages.dev' }));
    expect(digital.has('shipping_address_collection[allowed_countries][0]')).toBe(false);
    expect(digital.get('success_url')).toBe('https://ateliergribouille.pages.dev/atelier/?commande=R');
    expect(m.formBody([['a[b]', 'é & x']])).toBe('a%5Bb%5D=%C3%A9%20%26%20x');
    expect(m.orderRef(new Date('2026-11-25T10:00:00Z'), () => 0.5)).toMatch(/^AG-261125-[0-9A-Z]{4}$/);
  });

  test('une notification Stripe n’est acceptée qu’avec la bonne signature, récente', async () => {
    const m = await load();
    const secret = 'whsec_test_secret', body = '{"id":"evt_1","type":"checkout.session.completed"}', t = 1795600000;
    const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(await m.verifySignature(body, `t=${t},v1=${sig}`, secret, t + 10)).toBe(true);
    expect(await m.verifySignature(body, `t=${t},v0=abc,v1=${sig}`, secret, t)).toBe(true);
    expect(await m.verifySignature(body + ' ', `t=${t},v1=${sig}`, secret, t)).toBe(false);
    expect(await m.verifySignature(body, `t=${t},v1=${sig}`, 'whsec_autre', t)).toBe(false);
    expect(await m.verifySignature(body, `t=${t},v1=${sig}`, secret, t + 600)).toBe(false);
    expect(await m.verifySignature(body, '', secret, t)).toBe(false);
  });
});
