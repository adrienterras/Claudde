// Accès à la base depuis une fonction Supabase (Deno), avec la clé serveur : l'API REST (PostgREST) et
// l'API d'authentification, sans bibliothèque. La clé serveur ne quitte jamais la fonction.
const env = (k) => (globalThis.Deno ? Deno.env.get(k) : undefined) || '';

export const SUPABASE_URL = env('SUPABASE_URL');
// clé serveur : l'ancienne (service_role, un JWT) ou la nouvelle (sb_secret_…, liste JSON)
export const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY') || (() => {
  try { const k = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); return k.default || Object.values(k)[0] || ''; } catch (e) { return ''; }
})();

const serverHeaders = (extra) => Object.assign(
  { apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
  SERVICE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SERVICE_KEY}` } : {},
  extra || {},
);

export async function rest(method, path, body, prefer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: serverHeaders(prefer ? { Prefer: prefer } : null), body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`base de données (${r.status}) : ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// le compte qui appelle (jeton de session envoyé par l'atelier), ou null
export async function userOf(req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token === SERVICE_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

// l'administrateur (rôle écrit par le serveur dans app_metadata) connecté avec la double
// authentification (niveau aal2 du jeton, comme public.is_admin()) ; sinon null
export async function adminOf(req) {
  const u = await userOf(req);
  if (!u || !(u.app_metadata && u.app_metadata.atelier_role === 'admin')) return null;
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return claims.aal === 'aal2' ? u : null;
  } catch (e) { return null; }
}

// la réponse JSON d'une fonction appelée par l'atelier, avec les en-têtes CORS du site
export function replier(req, origins) {
  const origin = req.headers.get('Origin') || '';
  const cors = {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  return { cors, reply: (status, data) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) };
}

// les vignettes des œuvres d'une commande (pour le visuel des e-mails) : { [compId]: data URL }
export async function thumbsOf(order) {
  const ids = [...new Set((order.items || []).map((it) => it.compId).filter((x) => /^[0-9a-f-]{36}$/.test(String(x))))];
  if (!ids.length) return {};
  try {
    const rows = (await rest('GET', `compositions?id=in.(${ids.join(',')})&select=id,thumb`)) || [];
    return Object.fromEntries(rows.filter((r) => r.thumb).map((r) => [r.id, r.thumb]));
  } catch (e) { console.error(e); return {}; }
}
