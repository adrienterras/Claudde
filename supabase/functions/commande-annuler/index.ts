// Fonction « commande-annuler » : annule une commande et la rembourse (Stripe).
// - le client, pour sa propre commande, tant qu'elle est « payée » (pas encore en préparation : les
//   œuvres sont personnalisées, une fois lancées elles ne s'annulent plus) ;
// - l'administrateur (double authentification), tant qu'elle n'est pas expédiée.
// Le statut passe d'abord à « annulée » (une seule fois, même si deux demandes se croisent), puis le
// remboursement part ; s'il échoue, la commande revient à son statut. E-mails : client et boutique.
import { ORIGINS } from '../_shared/commande.js';
import { customerEmail, customerAddress, shopEmail, shopAddress, send, visualsOf } from '../_shared/emails.js';
import { rest, userOf, adminOf, replier, thumbsOf } from '../_shared/supabase.js';

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

Deno.serve(async (req) => {
  const { cors, reply } = replier(req, ORIGINS);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'méthode non permise' });
  try {
    const user = await userOf(req);
    if (!user) return reply(401, { error: 'connexion requise' });
    const admin = await adminOf(req);
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply(400, { error: 'commande inconnue' });
    const [order] = (await rest('GET', `orders?id=eq.${id}&select=*`)) || [];
    if (!order || (!admin && order.user_id !== user.id)) return reply(404, { error: 'commande inconnue' });
    const allowed = admin ? ['payee', 'en_preparation'] : ['payee'];
    if (!allowed.includes(order.status)) {
      return reply(409, { error: order.status === 'annulee' ? 'commande déjà annulée' : 'cette commande est déjà en préparation : elle ne peut plus être annulée en ligne, écrivez-nous à contact@ateliergribouille.art' });
    }
    // (le statut d'abord, à condition qu'il n'ait pas changé entre-temps)
    const at = new Date().toISOString();
    const done = await rest('PATCH', `orders?id=eq.${id}&status=eq.${order.status}`, { status: 'annulee', updated_at: at }, 'return=representation');
    if (!done || !done.length) return reply(409, { error: 'la commande vient de changer : rechargez la page' });
    // le remboursement, entier
    if (order.payment_intent) {
      const r = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `refund-${id}` },
        body: `payment_intent=${encodeURIComponent(order.payment_intent)}&metadata[order_id]=${encodeURIComponent(id)}&metadata[ref]=${encodeURIComponent(order.ref)}`,
      });
      const refund = await r.json();
      if (!r.ok) {
        await rest('PATCH', `orders?id=eq.${id}`, { status: order.status, updated_at: new Date().toISOString() });
        console.error('Stripe', refund);
        return reply(502, { error: `remboursement refusé par Stripe : ${(refund.error && refund.error.message) || r.status}` });
      }
      await rest('PATCH', `orders?id=eq.${id}`, { refund: refund.id, cancelled_at: at });
    } else {
      await rest('PATCH', `orders?id=eq.${id}`, { cancelled_at: at });
    }
    const [saved] = (await rest('GET', `orders?id=eq.${id}&select=*`)) || [done[0]];
    const vis = visualsOf(saved, await thumbsOf(saved));
    await send(customerAddress(saved), customerEmail('annulee', saved, vis));
    if (!admin) await send(shopAddress(), shopEmail('annulee', saved, vis));
    return reply(200, { order: saved });
  } catch (e) {
    console.error(e);
    return reply(500, { error: String((e && (e as Error).message) || e).slice(0, 300) });
  }
});
