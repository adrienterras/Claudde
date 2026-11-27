// Fonction « commande-statut » : l'administrateur (double authentification) fait avancer une commande —
// en préparation, expédiée (transporteur, numéro de suivi), livrée — et le client reçoit un e-mail à
// chaque étape. Appelée depuis l'espace administrateur de l'atelier (Commandes).
import { ORIGINS } from '../_shared/commande.js';
import { customerEmail, customerAddress, send, visualsOf } from '../_shared/emails.js';
import { rest, adminOf, replier, thumbsOf } from '../_shared/supabase.js';
import { journal, journalFrom, errText } from '../_shared/journal.js';

journalFrom('commande-statut');

const STEPS = ['payee', 'en_preparation', 'expediee', 'livree'];

Deno.serve(async (req) => {
  const { cors, reply } = replier(req, ORIGINS);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'méthode non permise' });
  try {
    const admin = await adminOf(req);
    if (!admin) return reply(403, { error: 'réservé à l’administrateur, connecté avec la double authentification' });
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply(400, { error: 'commande inconnue' });
    const [order] = (await rest('GET', `orders?id=eq.${id}&select=*`)) || [];
    if (!order) return reply(404, { error: 'commande inconnue' });
    if (!STEPS.includes(order.status)) return reply(409, { error: 'commande annulée ou non payée : son statut ne change plus' });
    const status = STEPS.includes(body.status) ? body.status : order.status;
    const carrier = body.carrier == null ? order.carrier : String(body.carrier).slice(0, 60) || null;
    const tracking = body.tracking == null ? order.tracking : String(body.tracking).trim().slice(0, 80) || null;
    const [saved] = await rest('PATCH', `orders?id=eq.${id}`, { status, carrier, tracking, updated_at: new Date().toISOString() }, 'return=representation');
    // le client est prévenu quand le statut change (et à l'expédition, si le suivi arrive ensuite)
    let mailed = false;
    const changed = status !== order.status || (status === 'expediee' && tracking && tracking !== order.tracking);
    if (changed && body.notify !== false && status !== 'payee') mailed = await send(customerAddress(saved), customerEmail(status, saved, visualsOf(saved, await thumbsOf(saved))));
    return reply(200, { order: saved, mailed });
  } catch (e) {
    console.error(e);
    await journal('erreur', errText(e));
    return reply(500, { error: String((e && (e as Error).message) || e).slice(0, 300) });
  }
});
