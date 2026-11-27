// Fonction « commande-statut » : l'administrateur (double authentification) fait avancer une commande —
// en préparation, expédiée (transporteur, numéro de suivi), livrée — et le client reçoit un e-mail à
// chaque étape ; le changement est inscrit à l'historique de la commande, avec son auteur. Appelée
// depuis la page Gestion des commandes.
import { ORIGINS } from '../_shared/commande.js';
import { customerEmail, customerAddress, send, visualsOf, guideEmail } from '../_shared/emails.js';
import { rest, staffOf, replier, thumbsOf, storageGet } from '../_shared/supabase.js';
import { journal, journalFrom, errText } from '../_shared/journal.js';
import { orderLog, statusLine } from '../_shared/historique.js';
import { guideItems, guidePath, guideAttachments } from '../_shared/guides.js';

journalFrom('commande-statut');

const STEPS = ['payee', 'en_preparation', 'expediee', 'livree'];

Deno.serve(async (req) => {
  const { cors, reply } = replier(req, ORIGINS);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'méthode non permise' });
  try {
    // (l'administrateur ou l'équipe, rôle « tableau », avec la double authentification)
    const admin = await staffOf(req);
    if (!admin) return reply(403, { error: 'réservé à l’équipe du site, connectée avec la double authentification' });
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply(400, { error: 'commande inconnue' });
    const [order] = (await rest('GET', `orders?id=eq.${id}&select=*`)) || [];
    if (!order) return reply(404, { error: 'commande inconnue' });
    // renvoyer au client son guide de découpe (commandes « Originaux »), rangé avec la commande
    if (body.action === 'guide') {
      if (['attente_paiement', 'abandonnee'].includes(order.status)) return reply(409, { error: 'commande non payée' });
      const files = [];
      for (const { index } of guideItems(order)) files.push({ index, bytes: await storageGet('impressions', guidePath(order.id, index)) });
      const att = guideAttachments(order, files);
      if (!att.length) return reply(404, { error: 'aucun guide de découpe rangé avec cette commande' });
      const mail = guideEmail(order, att.length);
      mail.attachments = att;
      const mailed = await send(customerAddress(order), mail);
      if (!mailed) return reply(502, { error: 'l’e-mail n’a pas pu partir : réessayez dans un instant' });
      await orderLog(id, admin, att.length > 1 ? 'guides de découpe renvoyés au client' : 'guide de découpe renvoyé au client');
      return reply(200, { mailed });
    }
    if (!STEPS.includes(order.status)) return reply(409, { error: 'commande annulée ou non payée : son statut ne change plus' });
    const status = STEPS.includes(body.status) ? body.status : order.status;
    // (une commande en préparation ou plus loin ne revient pas à « Payée » : cela rouvrirait au client
    // l'annulation et le remboursement en ligne)
    if (status === 'payee' && order.status !== 'payee') return reply(409, { error: 'une commande en préparation ne revient pas à « Payée »' });
    const carrier = body.carrier == null ? order.carrier : String(body.carrier).slice(0, 60) || null;
    const tracking = body.tracking == null ? order.tracking : String(body.tracking).trim().slice(0, 80) || null;
    const [saved] = await rest('PATCH', `orders?id=eq.${id}`, { status, carrier, tracking, updated_at: new Date().toISOString() }, 'return=representation');
    // l'historique : qui a fait avancer la commande
    const line = statusLine(order, saved);
    if (line) await orderLog(id, admin, line);
    // le client est prévenu quand le statut change (et à l'expédition, si le suivi arrive ensuite)
    let mailed = false;
    const changed = status !== order.status || (status === 'expediee' && tracking && tracking !== order.tracking);
    if (changed && body.notify !== false && status !== 'payee') mailed = await send(customerAddress(saved), customerEmail(status, saved, visualsOf(saved, await thumbsOf(saved))));
    return reply(200, { order: saved, mailed });
  } catch (e) {
    console.error(e);
    await journal('erreur', errText(e));
    return reply(500, { error: 'le statut n’a pas pu être changé : réessayez dans un instant' });
  }
});
