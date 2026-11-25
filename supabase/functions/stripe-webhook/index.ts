// Fonction « stripe-webhook » : Stripe y annonce les paiements. Paiement reçu : la commande passe
// « payée » (adresse de livraison et coordonnées gardées) et ses œuvres quittent le panier, marquées
// commandées (figées, gardées hors de la purge) ; page de paiement abandonnée : la commande aussi.
// Chaque notification est vérifiée (signature, secret STRIPE_WEBHOOK_SECRET) ; une notification reçue
// deux fois ne change rien de plus.
import { verifySignature, orderTrace } from '../_shared/commande.js';
import { rest } from '../_shared/supabase.js';

const SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

// le mode de livraison choisi sur la page de paiement (domicile, relais) : relu chez Stripe, avec le tarif
async function delivery(session: any) {
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}?expand[]=shipping_cost.shipping_rate`, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
    if (!r.ok) return null;
    const s = await r.json();
    const rate = s.shipping_cost && s.shipping_cost.shipping_rate;
    return (rate && rate.metadata && rate.metadata.mode) || null;
  } catch (e) { return null; }
}

async function paid(session: any) {
  const id = session.metadata && session.metadata.order_id;
  if (!id) return;
  const [order] = (await rest('GET', `orders?id=eq.${id}&select=*`)) || [];
  if (!order || order.status !== 'attente_paiement') return; // (déjà traitée, ou inconnue)
  const at = new Date().toISOString();
  const shipping = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || null;
  await rest('PATCH', `orders?id=eq.${id}&status=eq.attente_paiement`, {
    status: 'payee', paid_at: at, payment_intent: session.payment_intent || null,
    total_cents: session.amount_total ?? order.total_cents,
    shipping, customer: session.customer_details || null,
    shipping_cents: session.shipping_cost ? session.shipping_cost.amount_total : order.shipping_cents,
    delivery: session.shipping_cost ? await delivery(session) : null,
  });
  // les œuvres commandées : hors du panier, figées, avec la trace de la commande
  for (const it of order.items || []) {
    const [row] = (await rest('GET', `compositions?id=eq.${it.compId}&user_id=eq.${order.user_id}&select=id,name,meta`)) || [];
    if (!row) continue;
    const meta = Object.assign({}, row.meta);
    delete meta.cart;
    meta.ordered = true;
    meta.order = orderTrace(it, order, at, order.consent);
    await rest('PATCH', `compositions?id=eq.${row.id}`, { meta, name: `${order.ref} · ${it.title}`.slice(0, 80) });
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('méthode non permise', { status: 405 });
  const payload = await req.text();
  if (!(await verifySignature(payload, req.headers.get('Stripe-Signature'), SECRET))) return new Response('signature refusée', { status: 400 });
  try {
    const event = JSON.parse(payload);
    const session = event.data && event.data.object;
    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid') await paid(session);
    else if (event.type === 'checkout.session.async_payment_succeeded') await paid(session);
    else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const id = session.metadata && session.metadata.order_id;
      if (id) await rest('PATCH', `orders?id=eq.${id}&status=eq.attente_paiement`, { status: 'abandonnee' });
    }
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    // (une erreur : Stripe renverra la notification plus tard)
    return new Response('erreur', { status: 500 });
  }
});
