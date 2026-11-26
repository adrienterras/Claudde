// Fonction « partage » : recevoir une œuvre partagée par un lien (atelier/?partage=…).
// - « voir » (sans compte) : le nom, la vignette et le prénom de celui qui partage, pour l'accueil du lien ;
// - « recevoir » (compte connecté) : une copie de l'œuvre dans le compte de la personne — ses fichiers
//   copiés sur le serveur dans son dossier, une nouvelle fiche à elle. Un deuxième « recevoir » rend la
//   même copie ; celui qui a partagé retrouve sa propre œuvre.
// Le lien est dans la fiche de l'œuvre (meta.share, écrit par l'atelier de son propriétaire) : valable
// 30 jours, désactivable. La clé serveur ne sert qu'ici, jamais dans le navigateur.
import { ORIGINS } from '../_shared/commande.js';
import { rest, userOf, replier, authUser, storageCopy, storageRemove } from '../_shared/supabase.js';
import { shareValid, receivedCopy, TOKEN_RE } from '../_shared/partage.js';

const BUCKET = 'drawings';
const WORK_MAX = 15; // (comme l'atelier : Mes œuvres, sans les commandes ni le panier)
const ORDER_NAME = /^AG-\d{6}-[A-Z0-9]{4}\b/;

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
    // la copie : les fichiers d'abord (sur le serveur), puis la fiche ; en cas d'échec, rien ne reste
    const id = crypto.randomUUID();
    const { copies, meta } = receivedCopy(row.meta || {}, row.user_id, user.id, id, token);
    if (!copies.length) return reply(422, { error: 'cette œuvre n’a pas d’images à partager' });
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
    return reply(500, { error: String((e && (e as Error).message) || e).slice(0, 300) });
  }
});
