// Fonction « facture » : le lien de la facture Stripe d'une commande, pour « Mes commandes ».
// Le client, pour sa propre commande payée (l'équipe aussi, avec la double authentification). La
// facture est faite par Stripe après le paiement (invoice_creation, voir _shared/commande.js) ; on la
// retrouve par la session de paiement de la commande. Le lien renvoyé mène toujours chez Stripe.
import { ORIGINS, INVOICE_STATUSES, invoiceLink } from '../_shared/commande.js';
import { rest, userOf, staffOf, replier } from '../_shared/supabase.js';
import { journal, journalFrom, errText } from '../_shared/journal.js';

journalFrom('facture');

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const NONE = 'facture introuvable pour cette commande : écrivez-nous à contact@ateliergribouille.art';

Deno.serve(async (req) => {
  const { cors, reply } = replier(req, ORIGINS);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'méthode non permise' });
  try {
    const user = await userOf(req);
    if (!user) return reply(401, { error: 'connexion requise' });
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply(400, { error: 'commande inconnue' });
    const [order] = (await rest('GET', `orders?id=eq.${id}&select=id,ref,user_id,status,stripe_session`)) || [];
    if (!order || (order.user_id !== user.id && !(await staffOf(req)))) return reply(404, { error: 'commande inconnue' });
    if (!INVOICE_STATUSES.includes(order.status)) return reply(409, { error: 'la facture est faite après le paiement' });
    if (!order.stripe_session || !STRIPE_KEY) return reply(404, { error: NONE });
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.stripe_session)}?expand[]=invoice`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` }, signal: AbortSignal.timeout(15000),
    });
    const session = await r.json().catch(() => null);
    if (!r.ok || !session) {
      await journal('erreur', `Stripe : session illisible (${r.status})`, order.ref);
      return reply(502, { error: 'Stripe ne répond pas : réessayez dans un instant' });
    }
    // (une commande payée avant les factures n'en a pas ; juste après le paiement, elle peut ne pas être prête)
    if (!session.invoice) return reply(404, { error: NONE });
    const url = invoiceLink(session.invoice);
    if (!url) return reply(409, { error: 'la facture est en préparation : réessayez dans une minute' });
    return reply(200, { url });
  } catch (e) {
    console.error(e);
    await journal('erreur', errText(e));
    return reply(500, { error: 'le serveur ne répond pas : réessayez dans un instant' });
  }
});
