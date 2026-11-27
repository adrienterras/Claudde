// Le tableau de bord de l'administrateur : ce qui vient d'ailleurs que de la base (mises en ligne sur
// GitHub, audience sur Umami, mode du paiement Stripe), mis en forme pour tableau-de-bord.js. Fonctions
// pures (testées par tests/commande.spec.js) ; les appels réseau sont dans tableau-de-bord/index.ts.

export const GITHUB_REPO = 'adrienterras/Claudde';
export const GITHUB_BRANCH = 'claude/children-drawings-art-app-kr5f77';
export const UMAMI_API = 'https://api.umami.is/v1';
export const UMAMI_SITE = '8428c303-3200-487c-b30c-964e4f569442'; // (identifiant public du site, comme dans config.js)

// le paiement : vrais paiements (live), essais (test), ou pas de clé
export function stripeMode(key) {
  const k = String(key || '');
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  return null;
}

// les mises en ligne : la réponse de l'API GitHub (runs d'un workflow) → [{ n, title, status, at }]
export function deploysOf(json) {
  const runs = (json && Array.isArray(json.workflow_runs)) ? json.workflow_runs : [];
  return runs.slice(0, 5).map((r) => ({
    n: Number(r.run_number) || null,
    title: String(r.display_title || '').split('\n')[0].slice(0, 90),
    status: r.status === 'completed' ? String(r.conclusion || 'failure') : String(r.status || 'queued'),
    at: r.updated_at || r.run_started_at || r.created_at || null,
  }));
}

// les 30 jours du tableau (à l'heure de Paris), du plus ancien à aujourd'hui : « 2026-11-27 »
export function lastDays(now = new Date(), n = 30) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(fmt.format(new Date(now.getTime() - i * 864e5)));
  return [...new Set(out)];
}
// une valeur Umami : un nombre, ou { value } selon la version de l'API
const val = (x) => Number(x && typeof x === 'object' ? x.value : x) || 0;
// un classement Umami ([{ x, y }]) → [{ x, n }], 6 au plus
export const rankOf = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 6).map((r) => ({ x: String(r.x == null ? '' : r.x).slice(0, 120), n: val(r.y) }));

// l'audience : les réponses de l'API Umami → { d7, d30, byDay, pages, sources, pays }
export function audienceOf({ stats7, stats30, series, pages, sources, pays }, days) {
  const perDay = new Map();
  const visits = (series && (series.sessions || series.visitors)) || [];
  for (const p of visits) perDay.set(String(p.x || '').slice(0, 10), val(p.y));
  return {
    d7: { visitors: val(stats7 && stats7.visitors), pageviews: val(stats7 && stats7.pageviews) },
    d30: { visitors: val(stats30 && stats30.visitors), pageviews: val(stats30 && stats30.pageviews) },
    byDay: days.map((d) => ({ d, visitors: perDay.get(d) || 0 })),
    pages: rankOf(pages), sources: rankOf(sources), pays: rankOf(pays),
  };
}
