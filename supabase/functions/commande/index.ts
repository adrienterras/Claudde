// Fonction « commande » : le panier du compte devient une commande, et une page de paiement Stripe.
// Appelée par l'atelier (bouton « Commander », compte connecté) avec le jeton de session ; renvoie
// l'adresse de la page de paiement. Les prix et la livraison sont recalculés ici (_shared/commande.js).
import { orderItems, totals, orderRef, checkoutParams, formBody, ORIGINS } from '../_shared/commande.js';
import { rest, userOf } from '../_shared/supabase.js';
import { journal, journalFrom, errText } from '../_shared/journal.js';

journalFrom('commande');

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

const cors = (origin: string) => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') || '';
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return reply(405, { error: 'méthode non permise' });
  try {
    if (!STRIPE_KEY) return reply(503, { error: 'paiement non configuré' });
    const user = await userOf(req);
    if (!user) return reply(401, { error: 'connexion requise' });
    const body = await req.json().catch(() => ({}));
    const consent = body && body.consent === true;

    // pas plus de 20 paiements commencés par heure et par compte
    const since = new Date(Date.now() - 3600e3).toISOString();
    const recent = await rest('GET', `orders?select=id&user_id=eq.${user.id}&created_at=gte.${encodeURIComponent(since)}`);
    if (recent && recent.length >= 20) return reply(429, { error: 'trop de commandes commencées : réessayez dans une heure' });

    // le panier, relu dans le compte (jamais celui envoyé par le navigateur)
    const rows = await rest('GET', `compositions?select=id,name,meta&user_id=eq.${user.id}&meta->>cart=not.is.null&order=created_at.asc`);
    const items = orderItems(rows);
    if (!items.length) return reply(400, { error: 'panier vide' });
    const t = totals(items);

    const [order] = await rest('POST', 'orders', {
      user_id: user.id, ref: orderRef(), status: 'attente_paiement', email: user.email || null, consent,
      items, subtotal_cents: t.subtotal, shipping_cents: t.shipping, total_cents: t.total,
    }, 'return=representation');

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': order.id },
      body: formBody(checkoutParams({ order, items, email: user.email, origin })),
    });
    const session = await r.json();
    if (!r.ok) {
      await rest('PATCH', `orders?id=eq.${order.id}`, { status: 'annulee' });
      console.error('Stripe', session);
      await journal('erreur', `Stripe refuse la page de paiement : ${(session.error && session.error.message) || r.status}`, order.ref);
      return reply(502, { error: 'la page de paiement n’a pas pu être préparée : réessayez dans un instant' });
    }
    await rest('PATCH', `orders?id=eq.${order.id}`, { stripe_session: session.id });
    return reply(200, { url: session.url, ref: order.ref });
  } catch (e) {
    console.error(e);
    await journal('erreur', errText(e));
    return reply(500, { error: 'la commande n’a pas pu être préparée : réessayez dans un instant' });
  }
});
