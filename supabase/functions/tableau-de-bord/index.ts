// Fonction « tableau-de-bord » : les chiffres du tableau de bord de l'administrateur
// (tableau-de-bord.html), seulement pour l'administrateur et les comptes au rôle « tableau »,
// connectés avec la double authentification. La base (fonction SQL admin_dashboard), puis, si leurs clés sont dans les secrets :
// les mises en ligne (GitHub, clé en lecture seule GITHUB_TOKEN_LECTURE) et l'audience (Umami,
// UMAMI_API_KEY). Une source qui ne répond pas n'empêche pas les autres.
import { ORIGINS } from '../_shared/commande.js';
import { rest, dashboardOf, replier } from '../_shared/supabase.js';
import { journal, journalFrom, errText } from '../_shared/journal.js';
import { stripeMode, deploysOf, audienceOf, lastDays, GITHUB_REPO, GITHUB_BRANCH, UMAMI_API, UMAMI_SITE } from '../_shared/tableau.js';

journalFrom('tableau-de-bord');
const env = (k: string) => Deno.env.get(k) || '';

async function getJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} : ${r.status}`);
  return r.json();
}

async function deploys() {
  const token = env('GITHUB_TOKEN_LECTURE');
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'atelier-gribouille-tableau', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const json = await getJson(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/pages.yml/runs?per_page=5&branch=${encodeURIComponent(GITHUB_BRANCH)}`, headers);
  return deploysOf(json);
}

async function audience() {
  const key = env('UMAMI_API_KEY');
  if (!key) return { error: 'Audience non branchée : ajoutez la clé UMAMI_API_KEY dans les secrets Supabase (voir docs/TABLEAU-DE-BORD.md).' };
  const site = env('UMAMI_WEBSITE_ID') || UMAMI_SITE;
  const now = Date.now(), d30 = now - 30 * 864e5, d7 = now - 7 * 864e5;
  const h = { 'x-umami-api-key': key, Accept: 'application/json' };
  const base = `${UMAMI_API}/websites/${site}`;
  const metrics = async (types: string[], from: number) => {
    for (const t of types) {
      try { return await getJson(`${base}/metrics?startAt=${from}&endAt=${now}&type=${t}&limit=6`, h); } catch (e) { /* type suivant (selon la version d'Umami) */ }
    }
    return [];
  };
  const [stats7, stats30, series, pages, sources, pays] = await Promise.all([
    getJson(`${base}/stats?startAt=${d7}&endAt=${now}`, h),
    getJson(`${base}/stats?startAt=${d30}&endAt=${now}`, h),
    getJson(`${base}/pageviews?startAt=${d30}&endAt=${now}&unit=day&timezone=Europe%2FParis`, h).catch(() => null),
    metrics(['path', 'url'], d30), metrics(['referrer'], d30), metrics(['country'], d30),
  ]);
  return audienceOf({ stats7, stats30, series, pages, sources, pays }, lastDays(new Date(now)));
}

Deno.serve(async (req) => {
  const { cors, reply } = replier(req, ORIGINS);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'méthode non permise' });
  try {
    const reader = await dashboardOf(req);
    if (!reader) return reply(403, { error: 'réservé à l’équipe du site, connectée avec la double authentification' });
    const [base, runs, aud] = await Promise.all([
      rest('POST', 'rpc/admin_dashboard', {}),
      deploys().then((r) => ({ runs: r }), (e) => ({ error: errText(e) })),
      audience().catch((e) => ({ error: `Audience indisponible (${errText(e)}).` })),
    ]);
    const d = base || {};
    d.ventes = Object.assign(d.ventes || {}, { stripeMode: stripeMode(env('STRIPE_SECRET_KEY')) });
    d.sante = Object.assign(d.sante || {}, {
      deploys: (runs as any).runs || [],
      deployError: (runs as any).error || null,
      services: { resend: !!env('RESEND_API_KEY'), umami: !!env('UMAMI_API_KEY') && !(aud as any).error, github: !!(runs as any).runs },
    });
    d.audience = aud;
    return reply(200, d);
  } catch (e) {
    console.error(e);
    await journal('erreur', errText(e));
    return reply(500, { error: 'le tableau de bord n’a pas pu être lu : réessayez dans un instant' });
  }
});
