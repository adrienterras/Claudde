// Calculs dérivés des matchs : points Elo, victoires/défaites, face-à-face.
// Simples et doubles ont chacun leur propre classement.

export const RANKINGS = [
    'NC', '40', '30/5', '30/4', '30/3', '30/2', '30/1', '30',
    '15/5', '15/4', '15/3', '15/2', '15/1', '15',
    '5/6', '4/6', '3/6', '2/6', '1/6', '0',
    '-2/6', '-4/6', '-15', '-30', 'Top 100', 'Top 60', 'Top 40',
];

export const MODES = ['simple', 'double'];

// En dessous de ce nombre de matchs, un joueur est « en rodage » : ses points
// sont affichés mais il n'a pas encore de rang, pour éviter qu'une seule
// victoire place quelqu'un en tête.
export const MIN_MATCHES = 3;

const START = 1500;
const K = 32;

export function setsWon(sets) {
    let a = 0, b = 0;
    for (const s of sets) {
        if (s.a > s.b) a++;
        else if (s.b > s.a) b++;
    }
    return { a, b };
}

// Un match se lit toujours comme deux équipes : t1 et t2 (1 joueur en
// simple, 2 en double), et le camp vainqueur (1 ou 2). Les premiers matchs
// enregistrés utilisaient p1/p2/winner : on les convertit à la volée.
export function normalizeMatch(m) {
    if (Array.isArray(m.t1)) return { ...m, type: m.type || (m.t1.length > 1 ? 'double' : 'simple') };
    return {
        ...m,
        type: 'simple',
        t1: [m.p1],
        t2: [m.p2],
        winnerSide: m.winner === m.p1 ? 1 : 2,
    };
}

export function involves(m, pid) {
    return m.t1.includes(pid) || m.t2.includes(pid);
}

export function sortRecentFirst(matches) {
    return [...matches].sort((x, y) =>
        (y.date || '').localeCompare(x.date || '') || (y.createdAt || 0) - (x.createdAt || 0));
}

function chronological(matches) {
    return [...matches].sort((x, y) =>
        (x.date || '').localeCompare(y.date || '') || (x.createdAt || 0) - (y.createdAt || 0));
}

function record(map, id) {
    return (map[id] ||= { wins: 0, losses: 0 });
}

function computeMode(players, matches, mode) {
    const ids = new Set(players.map(p => p.id));
    const by = {};
    for (const p of players) {
        // h2h : bilan contre chaque adversaire ; partners : bilan avec chaque partenaire (double).
        by[p.id] = { elo: START, wins: 0, losses: 0, played: 0, form: [], h2h: {}, partners: {} };
    }

    for (const m of chronological(matches)) {
        if (m.type !== mode) continue;
        if (![...m.t1, ...m.t2].every(id => ids.has(id))) continue;
        const winners = m.winnerSide === 1 ? m.t1 : m.t2;
        const losers = m.winnerSide === 1 ? m.t2 : m.t1;

        // En double, la force d'une équipe est la moyenne de ses deux joueurs.
        const avg = team => team.reduce((s, id) => s + by[id].elo, 0) / team.length;
        const expected = 1 / (1 + Math.pow(10, (avg(losers) - avg(winners)) / 400));
        const delta = K * (1 - expected);

        for (const id of winners) {
            const r = by[id];
            r.elo += delta; r.wins++; r.played++; r.form.push('V');
            for (const o of losers) record(r.h2h, o).wins++;
            for (const mate of winners) if (mate !== id) record(r.partners, mate).wins++;
        }
        for (const id of losers) {
            const r = by[id];
            r.elo -= delta; r.losses++; r.played++; r.form.push('D');
            for (const o of winners) record(r.h2h, o).losses++;
            for (const mate of losers) if (mate !== id) record(r.partners, mate).losses++;
        }
    }

    const table = players.map(p => ({
        player: p,
        ...by[p.id],
        elo: Math.round(by[p.id].elo),
        form: by[p.id].form.slice(-5),
        winRate: by[p.id].played ? by[p.id].wins / by[p.id].played : 0,
    }));

    table.sort((a, b) =>
        (b.played >= MIN_MATCHES) - (a.played >= MIN_MATCHES) ||
        (b.played > 0) - (a.played > 0) ||
        b.elo - a.elo ||
        b.wins - a.wins ||
        a.player.name.localeCompare(b.player.name, 'fr'));

    table.forEach((row, i) => { row.rank = row.played >= MIN_MATCHES ? i + 1 : null; });

    return { table, byId: Object.fromEntries(table.map(r => [r.player.id, r])) };
}

export function computeStats(players, matches) {
    return {
        simple: computeMode(players, matches, 'simple'),
        double: computeMode(players, matches, 'double'),
    };
}
