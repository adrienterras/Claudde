// Calculs dérivés des matchs : points Elo, victoires/défaites, face-à-face.

export const RANKINGS = [
    'NC', '40', '30/5', '30/4', '30/3', '30/2', '30/1', '30',
    '15/5', '15/4', '15/3', '15/2', '15/1', '15',
    '5/6', '4/6', '3/6', '2/6', '1/6', '0',
    '-2/6', '-4/6', '-15', '-30', 'Top 100', 'Top 60', 'Top 40',
];

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

function chronological(matches) {
    return [...matches].sort((x, y) =>
        (x.date || '').localeCompare(y.date || '') || (x.createdAt || 0) - (y.createdAt || 0));
}

export function computeStats(players, matches) {
    const ids = new Set(players.map(p => p.id));
    const by = {};
    for (const p of players) {
        by[p.id] = { elo: START, wins: 0, losses: 0, played: 0, form: [], h2h: {} };
    }

    for (const m of chronological(matches)) {
        if (!ids.has(m.p1) || !ids.has(m.p2) || !m.winner) continue;
        const loserId = m.winner === m.p1 ? m.p2 : m.p1;
        const w = by[m.winner], l = by[loserId];

        const expected = 1 / (1 + Math.pow(10, (l.elo - w.elo) / 400));
        const delta = K * (1 - expected);
        w.elo += delta;
        l.elo -= delta;

        w.wins++; l.losses++;
        w.played++; l.played++;
        w.form.push('V'); l.form.push('D');

        (w.h2h[loserId] ||= { wins: 0, losses: 0 }).wins++;
        (l.h2h[m.winner] ||= { wins: 0, losses: 0 }).losses++;
    }

    const table = players.map(p => ({
        player: p,
        ...by[p.id],
        elo: Math.round(by[p.id].elo),
        form: by[p.id].form.slice(-5),
        winRate: by[p.id].played ? by[p.id].wins / by[p.id].played : 0,
    }));

    table.sort((a, b) =>
        (b.played > 0) - (a.played > 0) ||
        b.elo - a.elo ||
        b.wins - a.wins ||
        a.player.name.localeCompare(b.player.name, 'fr'));

    table.forEach((row, i) => { row.rank = row.played ? i + 1 : null; });

    return { table, byId: Object.fromEntries(table.map(r => [r.player.id, r])) };
}
