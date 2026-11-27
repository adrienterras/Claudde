// L'historique d'une commande (table public.order_log) : qui a fait quoi, et quand. Écrit seulement par
// le serveur (clé serveur) ou par la fonction SQL order_log_hd (l'équipe, pour le fichier HD) ; lu
// seulement par l'équipe (page Gestion des commandes), jamais par le client.
import { rest } from './supabase.js';

// le nom montré dans l'historique : le prénom du compte, sinon le début de son adresse e-mail
export function actorName(user) {
  if (!user) return '';
  const m = user.user_metadata || {};
  const name = String(m.name || m.full_name || '').trim();
  if (name) return name.split(/\s+/)[0].slice(0, 40);
  return String(user.email || '').split('@')[0].slice(0, 40);
}

const STATUS = { payee: 'Payée', en_preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée', annulee: 'Annulée' };
const eur = (c) => `${((Number(c) || 0) / 100).toFixed(2).replace('.', ',')} €`;

// ce qu'a changé une mise à jour de statut ou de suivi (commande-statut), ou null si rien
export function statusLine(before, after) {
  const parts = [];
  if (after.status !== before.status) parts.push(`passée « ${STATUS[after.status] || after.status} »`);
  const track = [after.carrier, after.tracking].filter(Boolean).join(' ');
  if ((after.tracking || '') !== (before.tracking || '') || (after.carrier || '') !== (before.carrier || '')) {
    if (track) parts.push(`suivi : ${track}`);
    else parts.push('suivi retiré');
  }
  return parts.length ? parts.join(', ') : null;
}
export const cancelLine = (order, refunded) => (refunded ? `annulée et remboursée (${eur(order.total_cents)})` : 'annulée');

// une ligne de l'historique ; une erreur ici n'empêche jamais l'action elle-même
export async function orderLog(orderId, user, action, who) {
  try {
    await rest('POST', 'order_log', { order_id: orderId, actor_id: user ? user.id : null, actor: (who || actorName(user) || '').slice(0, 60), action: String(action).slice(0, 300) });
  } catch (e) { console.error('historique', e); }
}
