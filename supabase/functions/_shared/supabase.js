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
