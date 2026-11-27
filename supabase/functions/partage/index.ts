// Fonction « partage » : recevoir une œuvre partagée par un lien (atelier/?partage=…).
// - « creer » (le propriétaire, connecté) : le lien de son œuvre — le jeton est tiré par le serveur, unique
//   (index de la base), valable 30 jours ; celui en cours resservi s'il vaut encore plus d'un jour ;
// - « voir » (sans compte) : le nom, la vignette et le prénom de celui qui partage, pour l'accueil du lien ;
// - « recevoir » (compte connecté) : une copie de l'œuvre dans le compte de la personne — ses fichiers
//   copiés sur le serveur dans son dossier, une nouvelle fiche à elle. Un deuxième « recevoir » rend la
//   même copie ; celui qui a partagé retrouve sa propre œuvre.
// Le lien est dans la fiche de l'œuvre (meta.share, écrit ici) : valable 30 jours au plus, désactivable.
// Recevoir n'est possible que dans la limite de place du compte (3 Go, 5 000 fichiers, comme ses propres
// envois) et 10 fois par heure. La clé serveur ne sert qu'ici, jamais dans le navigateur.
import { ORIGINS } from '../_shared/commande.js';
import { rest, userOf, replier, authUser, storageCopy, storageRemove } from '../_shared/supabase.js';
import { shareValid, shareReusable, newShare, receivedCopy, TOKEN_RE } from '../_shared/partage.js';
import { journal, journalFrom, errText } from '../_shared/journal.js';

journalFrom('partage');

const BUCKET = 'drawings';
const WORK_MAX = 15; // (comme l'atelier : Mes œuvres, sans les commandes ni le panier)
const ORDER_NAME = /^AG-\d{6}-[A-Z0-9]{4}\b/;
const RECEIVE_PER_HOUR = 10;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const firstName = (u) => {
  const m = (u && u.user_metadata) || {};
  return String(m.name || m.full_name || '').trim().split(/\s+/)[0].slice(0, 40);
};

Deno.serve(async (req) => {
  const { cors, reply } = replier(req, ORIGINS);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'méthode non permise' });
  try {
    const body = await req.json().catch(() => ({}));
    // le lien d'une œuvre, créé par le serveur pour son propriétaire
    if (body.action === 'creer') {
      const owner = await userOf(req);
      if (!owner) return reply(401, { error: 'connexion requise' });
      const id = String(body.id || '');
      if (!ID_RE.test(id)) return reply(400, { error: 'œuvre inconnue' });
      const [work] = (await rest('GET', `compositions?id=eq.${id}&user_id=eq.${owner.id}&select=id,share:meta->share,cart:meta->cart`)) || [];
      if (!work || work.cart) return reply(404, { error: 'œuvre introuvable dans votre compte' });
      if (shareReusable(work.share)) return reply(200, { token: work.share.token, expires: work.share.expires });
      const share = newShare();
      const done = await rest('POST', 'rpc/share_set', { p_id: id, p_uid: owner.id, p_share: share });
      if (!done) return reply(404, { error: 'œuvre introuvable dans votre compte' });
      return reply(200, { token: share.token, expires: share.expires });
    }
    const token = String(body.token || '');
    if (!TOKEN_RE.test(token)) return reply(404, { error: 'lien de partage inconnu' });
    const cols = body.action === 'recevoir' ? 'id,user_id,name,thumb,meta' : 'id,user_id,name,thumb,share:meta->share,n:meta->>n';
    const [row] = (await rest('GET', `compositions?meta->share->>token=eq.${token}&select=${cols}&limit=1`)) || [];
    const share = row && (row.share || (row.meta && row.meta.share));
    if (!row || !shareValid(share)) return reply(410, { error: 'ce lien de partage n’est plus valable : demandez-en un nouveau' });

    if (body.action === 'voir') {
      const owner = await authUser(row.user_id).catch(() => null);
      return reply(200, { name: row.name, thumb: row.thumb, n: Number(row.n) || null, from: firstName(owner), expires: share.expires });
    }
    if (body.action !== 'recevoir') return reply(400, { error: 'action inconnue' });

    const user = await userOf(req);
    if (!user) return reply(401, { error: 'connexion requise' });
    // celui qui a partagé : sa propre œuvre
    if (row.user_id === user.id) return reply(200, { id: row.id, own: true });
    // déjà reçue : la même copie
    const [had] = (await rest('GET', `compositions?user_id=eq.${user.id}&meta->>sharedFrom=eq.${token}&select=id&limit=1`)) || [];
    if (had) return reply(200, { id: had.id, again: true });
    // la place dans Mes œuvres
    const mine = (await rest('GET', `compositions?user_id=eq.${user.id}&meta->>cart=is.null&meta->>ordered=is.null&meta->>draft=is.null&select=name`)) || [];
    const admin = !!(user.app_metadata && user.app_metadata.atelier_role === 'admin'); // (sans limite, comme dans l'atelier)
    if (!admin && mine.filter((r) => !ORDER_NAME.test(r.name || '')).length >= WORK_MAX) {
      return reply(409, { error: `votre compte a déjà ${WORK_MAX} œuvres : supprimez-en une dans Mes œuvres pour recevoir celle-ci` });
    }
    // pas plus de RECEIVE_PER_HOUR œuvres reçues par heure
    const hour = new Date(Date.now() - 3600e3).toISOString();
    const recent = (await rest('GET', `compositions?user_id=eq.${user.id}&meta->>sharedFrom=not.is.null&created_at=gt.${hour}&select=id&limit=${RECEIVE_PER_HOUR}`)) || [];
    if (!admin && recent.length >= RECEIVE_PER_HOUR) return reply(429, { error: 'trop d’œuvres reçues en une heure : réessayez un peu plus tard' });
    // la copie : les fichiers d'abord (sur le serveur), puis la fiche ; en cas d'échec, rien ne reste
    const id = crypto.randomUUID();
    const { copies, meta } = receivedCopy(row.meta || {}, row.user_id, user.id, id, token);
    if (!copies.length) return reply(422, { error: 'cette œuvre n’a pas d’images à partager' });
    // la place du compte (comme pour ses propres envois) : la copie doit y tenir
    const room = await rest('POST', 'rpc/share_room', { p_uid: user.id, p_paths: copies.map(([from]) => from), p_admin: admin });
    if (room !== true) return reply(409, { error: 'votre compte n’a plus assez de place pour recevoir cette œuvre : supprimez des œuvres dans Mes œuvres' });
    const done = [];
    try {
      for (let i = 0; i < copies.length; i += 6) {
        await Promise.all(copies.slice(i, i + 6).map(async ([from, to]) => { await storageCopy(BUCKET, from, to); done.push(to); }));
      }
      meta.workName = row.name;
      await rest('POST', 'compositions', { id, user_id: user.id, name: row.name, thumb: row.thumb, meta }, 'return=minimal');
    } catch (e) {
      await storageRemove(BUCKET, done);
      throw e;
    }
    return reply(200, { id });
  } catch (e) {
    console.error(e);
    await journal('erreur', errText(e));
    return reply(500, { error: 'le partage n’a pas abouti : réessayez dans un instant' });
  }
});
