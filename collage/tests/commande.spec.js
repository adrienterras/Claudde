// Commandes payées (Stripe) : le calcul côté serveur (supabase/functions/_shared/commande.js) — prix
// recalculés, livraison, session de paiement, signature des notifications.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const MOD = pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'commande.js')).href;
const load = () => import(MOD);
const MAILS = pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'emails.js')).href;
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
    for (const mode of ['domicile', 'express']) {
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
    // deux modes : Colissimo (standard) d'abord, puis Chronopost express (34,90 € + 2 × 5 €)
    expect(m.deliveryOptions(items)).toEqual([{ mode: 'domicile', cents: 3490 }, { mode: 'express', cents: 4490 }]);
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
    expect(p.has('shipping_address_collection[allowed_countries][1]')).toBe(false); // (la France seulement)
    expect(p.get('custom_text[shipping_address][message]')).toBe('Livraison en France métropolitaine uniquement (Corse comprise).');
    expect(p.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('2990');
    expect(p.get('shipping_options[0][shipping_rate_data][metadata][mode]')).toBe('domicile');
    expect(p.get('shipping_options[0][shipping_rate_data][display_name]')).toBe('Colissimo, à domicile');
    expect(p.get('shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]')).toBe('3');
    // express : 34,90 € (50 × 70 encadré) + 5 €, en 24 h
    expect(p.get('shipping_options[1][shipping_rate_data][fixed_amount][amount]')).toBe('3990');
    expect(p.get('shipping_options[1][shipping_rate_data][metadata][mode]')).toBe('express');
    expect(p.get('shipping_options[1][shipping_rate_data][display_name]')).toBe('Chronopost express, à domicile en 24 h');
    expect(p.get('shipping_options[1][shipping_rate_data][delivery_estimate][minimum][value]')).toBe('1');
    expect(p.has('shipping_options[2][shipping_rate_data][type]')).toBe(false);
    // une page de paiement abandonnée expire au bout de 31 minutes
    const at = new Map(m.checkoutParams({ order: { id: 'o', ref: 'R' }, items, now: 1795600000000 })).get('expires_at');
    expect(at).toBe(String(1795600000 + 31 * 60));
    // le récapitulatif écrit au-dessus du bouton Payer (Stripe replie le détail sur téléphone)
    expect(p.get('custom_text[submit][message]')).toBe('Votre commande : Lou — Tableau encadré 50 × 70 cm, cadre bois noir, avec passe-partout × 2 : 258,00 € · HD — Fichier HD : 29,00 € · Livraison : Colissimo 29,90 € ou Chronopost express 39,90 € · Total : 316,90 € avec Colissimo');
    const many = m.orderItems(Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, name: `Œuvre numéro ${i} avec un titre assez long`, meta: { cart: cart() } })));
    expect(m.summary(many).length).toBeLessThanOrEqual(1200);
    expect(m.summary(many)).toMatch(/et \d+ autre\(s\) article\(s\) · Livraison : Colissimo .* · Total : /);
    // une origine inconnue revient sur le site
    expect(p.get('success_url')).toBe('https://ateliergribouille.art/commandes.html?commande=AG-261125-AB12'); // (la page Mes commandes du site)
    expect(p.get('cancel_url')).toBe('https://ateliergribouille.art/atelier/?panier');
    // sans rien à livrer : pas d'adresse demandée
    const digital = new Map(m.checkoutParams({ order: { id: 'o-2', ref: 'R' }, items: [items[1]], origin: 'https://ateliergribouille.pages.dev' }));
    expect(digital.has('shipping_address_collection[allowed_countries][0]')).toBe(false);
    expect(digital.get('success_url')).toBe('https://ateliergribouille.pages.dev/commandes.html?commande=R');
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

  test('les e-mails des commandes : un par étape, sujets courts, lien de suivi selon le transporteur ; sans clé Resend, rien ne part', async () => {
    const e = await import(MAILS);
    const order = { ref: 'AG-261125-AB12', total_cents: 4890, shipping_cents: 990, delivery: 'domicile', items: [{ title: 'Courtepointe', label: 'Affiche 21 × 30 cm', qty: 1, unit: 39 }], customer: { name: 'Camille Martin', email: 'camille@example.org', phone: '+33600000000' }, shipping: { name: 'Camille Martin', address: { line1: '3 rue des Lilas', postal_code: '75011', city: 'Paris', country: 'FR' } } };
    const subjects = ['payee', 'en_preparation', 'expediee', 'livree', 'annulee'].map((st) => e.customerEmail(st, order).subject);
    expect(subjects).toEqual(['Commande AG-261125-AB12 confirmée', 'Commande AG-261125-AB12 en préparation', 'Commande AG-261125-AB12 expédiée', 'Commande AG-261125-AB12 livrée', 'Commande AG-261125-AB12 annulée']);
    subjects.forEach((x) => expect(x.length).toBeLessThan(60));
    const paid = e.customerEmail('payee', order);
    expect(paid.text).toContain('Bonjour Camille,');
    expect(paid.text).toContain('Courtepointe — Affiche 21 × 30 cm');
    expect(paid.text).toContain('Total : 48,90 € (dont 9,90 € de livraison)');
    expect(paid.html).toContain('https://ateliergribouille.art/commandes.html#AG-261125-AB12'); // (la page Mes commandes, sur cette commande)
    expect(paid.text).toContain('https://ateliergribouille.art/commandes.html#AG-261125-AB12');
    expect(e.shopEmail('nouvelle', order).html).toContain('https://ateliergribouille.art/atelier/?gestion-commandes');
    // expédiée : le lien de suivi du transporteur
    const sent = e.customerEmail('expediee', Object.assign({}, order, { carrier: 'Colissimo', tracking: '6A12345678901' }));
    expect(sent.html).toContain('https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901');
    expect(e.trackingUrl('Chronopost', 'XY 1')).toBe('https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=XY%201');
    expect(e.trackingUrl('Autre', '')).toBeNull();
    // les textes du client sont échappés dans le HTML
    expect(e.customerEmail('payee', Object.assign({}, order, { items: [{ title: '<b>x</b>', label: 'y', qty: 1 }] })).html).toContain('&lt;b&gt;x&lt;/b&gt;');
    // la boutique : nouvelle commande, avec le client et l'adresse
    const shop = e.shopEmail('nouvelle', Object.assign({}, order, { delivery: 'express' }));
    expect(shop.subject).toBe('Nouvelle commande AG-261125-AB12');
    expect(shop.text).toContain('Camille Martin · camille@example.org · +33600000000');
    expect(shop.text).toContain('EXPRESS (Chronopost 24 h) : Camille Martin, 3 rue des Lilas, 75011 Paris, France');
    // le gabarit : la frise d'avancement, le logo, le récapitulatif avec les prix, l'adresse
    expect(paid.html).toContain('https://ateliergribouille.art/img/logo-mark-80.png');
    expect(paid.html).toContain('Confirmée');
    expect(paid.html).toContain('Total TTC');
    expect(paid.html).toContain('Adresse de livraison');
    expect(paid.html).toContain('Merci pour votre commande\u00a0!');
    // le visuel de l'œuvre : la vignette jointe au message (image intégrée, jamais mise en ligne)
    const withVis = Object.assign({}, order, { items: [Object.assign({}, order.items[0], { compId: 'c1' })] });
    const vis = e.visualsOf(withVis, { c1: 'data:image/jpeg;base64,QUJD', autre: 'data:image/jpeg;base64,REVG' });
    expect(vis.attachments).toEqual([{ filename: 'oeuvre-1.jpg', content: 'QUJD', content_id: 'oeuvre-1' }]);
    const mail = e.customerEmail('payee', withVis, vis);
    expect(mail.html).toContain('src="cid:oeuvre-1"');
    expect(mail.attachments).toHaveLength(1);
    expect(e.shopEmail('nouvelle', withVis, vis).html).toContain('cid:oeuvre-1');
    // sans vignette (ou une adresse au lieu d'une image) : pas de visuel, pas de pièce jointe
    expect(e.visualsOf(withVis, { c1: 'https://exemple.org/x.jpg' }).attachments).toEqual([]);
    expect(e.customerEmail('payee', withVis).html).not.toContain('cid:');
    expect(e.shopEmail('annulee', order).subject).toBe('Annulation AG-261125-AB12');
    // sans clé : rien ne part, sans erreur
    expect(await e.send('x@example.org', paid, () => undefined)).toBe(false);
    expect(e.customerAddress({ email: 'compte@example.org' })).toBe('compte@example.org');
    expect(e.customerAddress(order)).toBe('camille@example.org');
  });
  test('le visuel d’un article commandé (Mes commandes, e-mails) : le cadre, le passe-partout ou la bordure, aux proportions réelles ; un seul calcul, partagé', async () => {
    const m = await load();
    const e = await import(MAILS);
    // les mesures sont celles de l'atelier (tirages, bordure, cadres)
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
    const frames = Function(`return (${/const PRINT_FRAMES = (\[[\s\S]*?\n {2}\]);/.exec(src)[1]});`)();
    expect(Object.fromEntries(frames.map((f) => [f.key, { print: f.print, mat: f.mat }]))).toEqual(m.PRINT_FRAMES);
    expect(frames.map((f) => [f.key, [f.w, f.h]])).toEqual(Object.entries(m.SIZES));
    expect(Number(/const MARGIN_CM = ([\d.]+);/.exec(src)[1])).toBe(m.MARGIN_CM);
    // encadré avec passe-partout (paysage) : le cadre 70 × 50, la fenêtre 50 × 40 au centre
    const plan = m.framePlan(m.normalizeItem(cart({ W: 70, H: 50 })));
    expect(plan).toEqual({ framed: true, mat: true, rgb: [38, 36, 34], profile: 1.5, outerW: 70, outerH: 50, artW: 50, artH: 40, padX: 10, padY: 5 });
    // affiche avec bordure blanche : la feuille, l'œuvre 3 cm en retrait ; fichier HD : l'œuvre seule
    expect(m.framePlan(m.normalizeItem({ product: 'print', finish: 'papier', size: '30x40', margin: true, W: 30, H: 40 }))).toMatchObject({ framed: false, outerW: 30, outerH: 40, artW: 24, artH: 34, padX: 3, padY: 3 });
    expect(m.framePlan(m.normalizeItem({ product: 'hd', size: '30x40', W: 30, H: 40 }))).toBeNull();
    // l'e-mail : la teinte du cadre autour de l'œuvre, l'image à sa largeur seule (jamais étirée)
    const html = e.framedHtml(m.normalizeItem(cart({ W: 70, H: 50 })), 'cid:oeuvre-1', 260);
    expect(html).toContain('background:#262422');
    expect(html).toMatch(/<img src="cid:oeuvre-1" width="\d+"[^>]*height:auto/);
    expect(html).not.toMatch(/<img[^>]*height="/);
    expect(e.framedHtml({ product: 'print', finish: 'papier', size: '30x40', W: 30, H: 40 }, 'cid:x', 60)).not.toContain('#262422');
    const order = { ref: 'AG-1', total_cents: 13890, shipping_cents: 990, items: [Object.assign(m.normalizeItem(cart({ frame: 'bois-clair' })), { compId: 'c1', title: 'Lou', label: 'x', unit: 129 })] };
    expect(e.customerEmail('payee', order, e.visualsOf(order, { c1: 'data:image/jpeg;base64,QUJD' })).html).toContain('background:#d4b892');
    // la page Mes commandes du site se sert du même module (publié sous le nom commande-partage.js)
    const build = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'preparer-site.sh'), 'utf8');
    expect(build).toContain('cp supabase/functions/_shared/commande.js _site/commande-partage.js');
    expect(fs.readFileSync(path.join(__dirname, '..', '..', 'landing', 'commandes.js'), 'utf8')).toMatch(/import\(`\.\/commande-partage\.js/);
    expect(m.trackingUrl('Chronopost', 'XY1')).toMatch(/chronopost\.fr.*XY1/);
    expect(e.trackingUrl).toBe(m.trackingUrl);
  });
});

// Partager une œuvre (supabase/functions/_shared/partage.js) : la copie reçue
test.describe('Partage : la copie reçue, côté serveur', () => {
  const MOD_P = pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'partage.js')).href;
  test('les fichiers vont dans le dossier de la personne, sous le même nom ; la fiche ne garde rien de l’original (lien, commande, panier)', async () => {
    const p = await import(MOD_P);
    const meta = {
      v: 3, n: 2, work: true, frozen: true, share: { token: 'x'.repeat(24), expires: '2099-01-01' }, order: { ref: 'AG' }, fromWork: 'w0',
      drawings: [
        { name: 'a', file: 'own/w1/k1.jpg', pieceEdits: [null, { mask: 'own/w1/m.png' }], saved: { page: { data: 'own/w1/s1-page.jpg' }, atlases: [{ data: 'own/w1/s1-a0.png' }] } },
        { name: 'b', file: 'own/w1/k1.jpg' }, // (deux sujets d'une même feuille : un seul fichier)
        { name: 'c', file: 'own/old/k1.jpg' }, // (même nom dans un autre dossier : renommé)
      ],
    };
    const { copies, meta: out } = p.receivedCopy(meta, 'own', 'me', 'NEW', 'tok', new Date('2026-11-26T10:00:00Z'));
    expect(copies).toEqual([
      ['own/w1/k1.jpg', 'me/NEW/k1.jpg'], ['own/w1/m.png', 'me/NEW/m.png'], ['own/w1/s1-page.jpg', 'me/NEW/s1-page.jpg'],
      ['own/w1/s1-a0.png', 'me/NEW/s1-a0.png'], ['own/old/k1.jpg', 'me/NEW/2-k1.jpg'],
    ]);
    expect(out.drawings.map((d) => d.file)).toEqual(['me/NEW/k1.jpg', 'me/NEW/k1.jpg', 'me/NEW/2-k1.jpg']);
    expect(out.drawings[0].pieceEdits[1].mask).toBe('me/NEW/m.png');
    expect(out.drawings[0].saved.atlases[0].data).toBe('me/NEW/s1-a0.png');
    expect(out).toMatchObject({ work: true, sharedFrom: 'tok', date: '2026-11-26T10:00:00.000Z', v: 3 });
    ['share', 'order', 'fromWork', 'frozen'].forEach((k) => expect(out[k]).toBeUndefined());
    expect(meta.drawings[0].file).toBe('own/w1/k1.jpg'); // (l'original n'est pas touché)
    // le lien : valable 30 jours au plus, désactivable
    expect(p.shareValid({ token: 'a'.repeat(22), expires: new Date(Date.now() + 1e6).toISOString() })).toBe(true);
    expect(p.shareValid({ token: 'a'.repeat(22), expires: new Date(Date.now() - 1).toISOString() })).toBe(false);
    expect(p.shareValid({ token: 'a'.repeat(22), expires: '2099-01-01', revoked: true })).toBe(false);
    expect(p.shareValid({ token: 'a/b', expires: '2099-01-01' })).toBe(false);
    // jamais plus de 30 jours devant lui : une date lointaine écrite à la main ne fait pas un lien sans fin
    expect(p.shareValid({ token: 'a'.repeat(22), expires: '2099-01-01' })).toBe(false);
    expect(p.shareValid({ token: 'a'.repeat(22), expires: new Date(Date.now() + 29.5 * 864e5).toISOString() })).toBe(true);
    // le jeton d'un nouveau lien : tiré par le serveur, 24 caractères sûrs dans une adresse, jamais deux fois le même
    const s1 = p.newShare(), s2 = p.newShare();
    expect(s1.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(s1.token).not.toBe(s2.token);
    expect(p.shareValid(s1)).toBe(true);
    expect(Math.round((new Date(s1.expires) - new Date(s1.at)) / 864e5)).toBe(30);
    expect(p.shareReusable(s1)).toBe(true);
    expect(p.shareReusable({ token: s1.token, expires: new Date(Date.now() + 3600e3).toISOString() })).toBe(false); // (moins d'un jour : un nouveau lien)
  });
});

test.describe('Tableau de bord : les sources extérieures, côté serveur', () => {
  const TAB = pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'tableau.js')).href;
  test('mode du paiement, mises en ligne GitHub, audience Umami (deux formes de réponse), 30 jours à l’heure de Paris', async () => {
    const t = await import(TAB);
    expect(t.stripeMode('sk_live_abc')).toBe('live');
    expect(t.stripeMode('rk_test_abc')).toBe('test');
    expect(t.stripeMode('')).toBeNull();
    expect(t.stripeMode('pk_live_abc')).toBeNull(); // (une clé publique n'est pas la clé du serveur)
    const runs = { workflow_runs: [
      { run_number: 713, display_title: 'Tests : plus de réimport\nsuite', status: 'completed', conclusion: 'success', updated_at: '2026-11-27T12:25:23Z' },
      { run_number: 714, display_title: 'En cours', status: 'in_progress', conclusion: null, run_started_at: '2026-11-27T13:00:00Z' },
      { run_number: 712, display_title: 'Raté', status: 'completed', conclusion: 'failure' },
    ] };
    expect(t.deploysOf(runs)).toEqual([
      { n: 713, title: 'Tests : plus de réimport', status: 'success', at: '2026-11-27T12:25:23Z' },
      { n: 714, title: 'En cours', status: 'in_progress', at: '2026-11-27T13:00:00Z' },
      { n: 712, title: 'Raté', status: 'failure', at: null },
    ]);
    expect(t.deploysOf(null)).toEqual([]);
    // les jours : 30, du plus ancien à aujourd'hui, à l'heure de Paris (23 h 30 UTC = le lendemain à Paris)
    const days = t.lastDays(new Date('2026-11-27T23:30:00Z'));
    expect(days).toHaveLength(30);
    expect(days[29]).toBe('2026-11-28');
    expect(days[0]).toBe('2026-10-30');
    // Umami : valeurs simples ou { value } ; visiteurs par jour depuis « sessions »
    const a = t.audienceOf({
      stats7: { visitors: { value: 612 }, pageviews: { value: 2140 } }, stats30: { visitors: 2380, pageviews: 8710 },
      series: { sessions: [{ x: `${days[29]} 00:00:00`, y: 41 }, { x: `${days[0]} 00:00:00`, y: 7 }] },
      pages: [{ x: '/', y: 3120 }, { x: '/atelier/', y: 2480 }], sources: [{ x: null, y: 12 }], pays: [{ x: 'FR', y: 2010 }],
    }, days);
    expect(a.d7).toEqual({ visitors: 612, pageviews: 2140 });
    expect(a.d30).toEqual({ visitors: 2380, pageviews: 8710 });
    expect(a.byDay).toHaveLength(30);
    expect(a.byDay[29]).toEqual({ d: days[29], visitors: 41 });
    expect(a.byDay[0].visitors).toBe(7);
    expect(a.byDay[10].visitors).toBe(0);
    expect(a.pages).toEqual([{ x: '/', n: 3120 }, { x: '/atelier/', n: 2480 }]);
    expect(a.sources).toEqual([{ x: '', n: 12 }]);
    expect(a.pays).toEqual([{ x: 'FR', n: 2010 }]);
  });
});
