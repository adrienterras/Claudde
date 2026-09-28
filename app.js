import { createStore, MissingConfigError } from './store.js';
import { computeStats, setsWon, normalizeMatch, involves, sortRecentFirst, RANKINGS } from './stats.js';

// ---------- Préférences locales (communautés rejointes sur ce téléphone) ----------

const PREFS_KEY = 'tiebreak-prefs-v1';

function loadPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        return { current: p.current || null, communities: p.communities || [], mode: p.mode === 'double' ? 'double' : 'simple' };
    } catch (e) {
        return { current: null, communities: [], mode: 'simple' };
    }
}

function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
}

const prefs = loadPrefs();

// ---------- État ----------

const S = {
    store: null,
    uid: null,
    cid: null,
    data: null,         // { community, players, matches }
    tab: 'classement',
    claimPid: null,     // profil proposé par un lien d'invitation personnel
    unsub: null,
    confirm: null,      // id de l'élément en attente de confirmation
};

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');

// ---------- Utilitaires ----------

function h(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function today() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

let toastTimer;
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function inviteLink(pid) {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('c', S.cid);
    if (pid) url.searchParams.set('p', pid);
    return url.toString();
}

async function shareInvite(pid, name) {
    const url = inviteLink(pid);
    const communityName = S.data?.community?.name || 'notre communauté';
    const text = name
        ? `${name}, rejoins « ${communityName} » sur Tie-Break pour suivre nos matchs de tennis :`
        : `Rejoins « ${communityName} » sur Tie-Break pour suivre nos matchs de tennis :`;

    if (navigator.share) {
        try {
            await navigator.share({ title: 'Tie-Break', text, url });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast('Lien d’invitation copié');
    } catch (e) {
        openSheet(`
            <h2 class="sheet-title">Lien d’invitation</h2>
            <p class="muted">Copiez ce lien et envoyez-le par message.</p>
            <input class="field-input" id="invite-url" readonly value="${h(url)}">
            <button class="btn btn-primary" data-action="close-sheet">Fermer</button>
        `);
        const input = document.getElementById('invite-url');
        input.focus();
        input.select();
    }
}

function me() {
    return S.data?.players.find(p => p.uid === S.uid) || null;
}

function playerName(pid) {
    return S.data?.players.find(p => p.id === pid)?.name || 'Joueur supprimé';
}

// ---------- Rendu ----------

function render() {
    if (!S.store) {
        app.innerHTML = `<div class="loading"><div class="ball"></div></div>`;
        return;
    }
    if (!S.cid) return renderWelcome();
    if (!S.data) {
        app.innerHTML = `<div class="loading"><div class="ball"></div></div>`;
        return;
    }
    if (!S.data.community) return renderMissing();
    if (!me()) return renderJoin();
    renderMain();
}

function renderWelcome() {
    app.innerHTML = `
        <main class="welcome">
            <div class="court-mark" aria-hidden="true">
                <svg viewBox="0 0 120 60"><rect x="2" y="2" width="116" height="56" rx="2"/><line x1="60" y1="2" x2="60" y2="58"/><line x1="2" y1="12" x2="118" y2="12"/><line x1="2" y1="48" x2="118" y2="48"/><line x1="30" y1="12" x2="30" y2="48"/><line x1="90" y1="12" x2="90" y2="48"/><line x1="30" y1="30" x2="90" y2="30"/></svg>
            </div>
            <h1 class="brand">Tie-Break</h1>
            <p class="lede">Notez vos matchs entre amis, suivez le classement de votre groupe et votre bilan contre chacun.</p>

            <form class="card form" data-form="create">
                <h2 class="card-title">Créer une communauté</h2>
                <label class="field">
                    <span class="field-label">Nom de la communauté</span>
                    <input class="field-input" id="c-name" name="community" required maxlength="40" placeholder="Les amis du dimanche">
                </label>
                <label class="field">
                    <span class="field-label">Votre prénom</span>
                    <input class="field-input" id="c-me" name="name" required maxlength="30" placeholder="Adrien" autocomplete="given-name">
                </label>
                <label class="field">
                    <span class="field-label">Votre classement</span>
                    ${rankingSelect('c-rank', 'ranking', '30/2')}
                </label>
                <button class="btn btn-primary" type="submit">Créer</button>
            </form>

            ${prefs.communities.length ? `
                <section class="card">
                    <h2 class="card-title">Vos communautés</h2>
                    <div class="list">
                        ${prefs.communities.map(c => `
                            <button class="list-row" data-action="open-community" data-cid="${h(c.id)}">
                                <span>${h(c.name)}</span><span class="chev">›</span>
                            </button>`).join('')}
                    </div>
                </section>` : ''}

            <p class="muted small">Un ami vous a invité ? Ouvrez simplement le lien qu’il vous a envoyé.</p>
        </main>`;
}

function renderMissing() {
    app.innerHTML = `
        <main class="welcome">
            <h1 class="brand">Tie-Break</h1>
            <div class="card">
                <h2 class="card-title">Communauté introuvable</h2>
                <p class="muted">Le lien est peut-être incomplet. Demandez à la personne qui vous a invité de vous le renvoyer.</p>
                <button class="btn btn-primary" data-action="home">Retour à l’accueil</button>
            </div>
        </main>`;
}

function renderJoin() {
    const free = S.data.players.filter(p => !p.uid);
    free.sort((a, b) => (b.id === S.claimPid) - (a.id === S.claimPid) || a.name.localeCompare(b.name, 'fr'));
    app.innerHTML = `
        <main class="welcome">
            <p class="eyebrow">Invitation</p>
            <h1 class="brand brand-sm">${h(S.data.community.name)}</h1>
            <p class="lede">${S.data.players.length} joueur${S.data.players.length > 1 ? 's' : ''} · ${S.data.matches.length} match${S.data.matches.length > 1 ? 's' : ''} joué${S.data.matches.length > 1 ? 's' : ''}</p>

            ${free.length ? `
                <section class="card">
                    <h2 class="card-title">Votre profil existe déjà ?</h2>
                    <p class="muted small">Un membre a peut-être déjà ajouté votre nom.</p>
                    <div class="list">
                        ${free.map(p => `
                            <div class="list-row ${p.id === S.claimPid ? 'is-highlight' : ''}">
                                <span class="avatar">${h(initials(p.name))}</span>
                                <span class="grow">${h(p.name)} <span class="chip">${h(p.ranking || 'NC')}</span></span>
                                <button class="btn btn-small" data-action="claim" data-pid="${h(p.id)}">C’est moi</button>
                            </div>`).join('')}
                    </div>
                </section>` : ''}

            <form class="card form" data-form="join">
                <h2 class="card-title">${free.length ? 'Sinon, créez votre profil' : 'Créez votre profil'}</h2>
                <label class="field">
                    <span class="field-label">Votre prénom</span>
                    <input class="field-input" id="j-name" name="name" required maxlength="30" autocomplete="given-name">
                </label>
                <label class="field">
                    <span class="field-label">Votre classement</span>
                    ${rankingSelect('j-rank', 'ranking', 'NC')}
                </label>
                <button class="btn btn-primary" type="submit">Rejoindre</button>
            </form>
            <button class="link" data-action="home">Retour</button>
        </main>`;
}

function rankingSelect(id, name, value) {
    return `<select class="field-input" id="${id}" name="${name}">
        ${RANKINGS.map(r => `<option value="${h(r)}" ${r === value ? 'selected' : ''}>${h(r)}</option>`).join('')}
    </select>`;
}

function renderMain() {
    const stats = computeStats(S.data.players, S.data.matches);
    const tabs = [
        ['classement', 'Classement'],
        ['matchs', 'Matchs'],
        ['moi', 'Mon bilan'],
    ];
    let body = '';
    if (S.tab === 'classement') body = viewRanking(stats[prefs.mode]);
    else if (S.tab === 'matchs') body = viewMatches();
    else body = viewPlayer(me().id, stats, true);

    app.innerHTML = `
        <header class="topbar">
            <button class="community-btn" data-action="switch-community" aria-label="Changer de communauté">
                <span class="community-name">${h(S.data.community.name)}</span>
                <span class="chev">▾</span>
            </button>
            <button class="btn btn-small btn-ghost" data-action="invite">Inviter</button>
        </header>
        <main class="content">${body}</main>
        <button class="fab" data-action="new-match"><span aria-hidden="true">+</span> Match</button>
        <nav class="tabbar">
            ${tabs.map(([id, label]) => `
                <button class="tab ${S.tab === id ? 'is-active' : ''}" data-action="tab" data-tab="${id}">
                    ${tabIcon(id)}<span>${label}</span>
                </button>`).join('')}
        </nav>`;
}

function tabIcon(id) {
    const icons = {
        classement: '<path d="M4 20V11h4v9M10 20V5h4v15M16 20v-6h4v6"/>',
        matchs: '<circle cx="12" cy="12" r="8"/><path d="M5.5 7c3 2 3 8 0 10M18.5 7c-3 2-3 8 0 10"/>',
        moi: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
    };
    return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[id]}</svg>`;
}

function formDots(form) {
    if (!form.length) return '';
    return `<span class="form-dots" aria-label="Forme : ${form.join(' ')}">${form.map(f =>
        `<span class="dot ${f === 'V' ? 'dot-w' : 'dot-l'}">${f}</span>`).join('')}</span>`;
}

function modeSwitch() {
    return `
        <div class="segmented" role="tablist" aria-label="Format">
            <button role="tab" class="seg ${prefs.mode === 'simple' ? 'is-active' : ''}" aria-selected="${prefs.mode === 'simple'}" data-action="mode" data-mode="simple">Simple</button>
            <button role="tab" class="seg ${prefs.mode === 'double' ? 'is-active' : ''}" aria-selected="${prefs.mode === 'double'}" data-action="mode" data-mode="double">Double</button>
        </div>`;
}

function viewRanking(stats) {
    const mine = me();
    return `
        <section class="section">
            <div class="section-head">
                <h2 class="section-title">Classement</h2>
                <span class="muted small">Points Elo · départ 1500</span>
            </div>
            ${modeSwitch()}
            <ol class="ranking">
                ${stats.table.map(r => `
                    <li>
                        <button class="rank-row ${r.player.id === mine.id ? 'is-me' : ''}" data-action="player" data-pid="${h(r.player.id)}">
                            <span class="rank-pos">${r.rank ?? '–'}</span>
                            <span class="rank-main">
                                <span class="rank-name">${h(r.player.name)}${r.player.id === mine.id ? ' <span class="you">vous</span>' : ''}</span>
                                <span class="rank-meta">
                                    <span class="chip">${h(r.player.ranking || 'NC')}</span>
                                    <span>${r.wins} V · ${r.losses} D</span>
                                    ${r.player.uid ? '' : '<span class="pending">invitation en attente</span>'}
                                </span>
                            </span>
                            <span class="rank-side">
                                <span class="rank-elo">${r.played ? r.elo : '—'}</span>
                                ${formDots(r.form)}
                            </span>
                        </button>
                    </li>`).join('')}
            </ol>
            <button class="btn btn-ghost btn-block" data-action="add-player">+ Ajouter un joueur</button>
        </section>`;
}

function viewMatches() {
    const list = sortRecentFirst(S.data.matches);
    if (!list.length) {
        return `<section class="section empty">
            <p class="empty-title">Aucun match pour l’instant</p>
            <p class="muted">Touchez « + Match » après votre prochaine partie pour noter le score.</p>
        </section>`;
    }
    let lastDate = null;
    return `<section class="section">
        <h2 class="section-title">Matchs</h2>
        <div class="matches">
        ${list.map(m => {
            const header = m.date !== lastDate ? `<p class="date-sep">${h(formatDate(m.date))}</p>` : '';
            lastDate = m.date;
            return header + matchCard(m);
        }).join('')}
        </div>
    </section>`;
}

function teamNames(team) {
    return team.map(id => h(playerName(id))).join('<span class="sb-amp"> / </span>');
}

// La personne qui a noté le match, ou le créateur de la communauté, peut le
// corriger ou le supprimer (mêmes conditions que firestore.rules).
function canManageMatch(m) {
    return m.createdBy === S.uid || S.data.community.createdBy === S.uid;
}

function matchCard(m) {
    const w1 = m.winnerSide === 1;
    const canManage = canManageMatch(m);
    const confirming = S.confirm === m.id;
    const isDouble = m.type === 'double';
    return `
        <article class="match">
            <div class="scoreboard ${isDouble ? 'is-double' : ''}">
                ${isDouble ? '<span class="sb-type">Double</span>' : ''}
                <div class="sb-row ${w1 ? 'is-winner' : ''}">
                    <span class="sb-name">${teamNames(m.t1)}</span>
                    ${m.sets.map(s => `<span class="sb-set ${s.a > s.b ? 'won' : ''}">${s.a}</span>`).join('')}
                </div>
                <div class="sb-row ${!w1 ? 'is-winner' : ''}">
                    <span class="sb-name">${teamNames(m.t2)}</span>
                    ${m.sets.map(s => `<span class="sb-set ${s.b > s.a ? 'won' : ''}">${s.b}</span>`).join('')}
                </div>
            </div>
            ${canManage ? (confirming
                ? `<div class="confirm-row">
                        <span class="small">Supprimer ce match ?</span>
                        <button class="btn btn-small btn-danger" data-action="delete-match" data-mid="${h(m.id)}">Supprimer</button>
                        <button class="btn btn-small btn-ghost" data-action="cancel-confirm">Annuler</button>
                   </div>`
                : `<div class="match-actions">
                        <button class="link small" data-action="edit-match" data-mid="${h(m.id)}">Modifier</button>
                        <button class="link small match-del" data-action="ask-delete" data-mid="${h(m.id)}">Supprimer</button>
                   </div>`)
            : ''}
        </article>`;
}

function recordList(map, emptyText) {
    const rows = Object.entries(map)
        .map(([oid, r]) => ({ oid, ...r, total: r.wins + r.losses }))
        .sort((a, b) => b.total - a.total || b.wins - a.wins);
    if (!rows.length) return `<p class="muted small">${emptyText}</p>`;
    return `
        <ul class="h2h">
            ${rows.map(o => `
                <li class="h2h-row">
                    <span class="h2h-name">${h(playerName(o.oid))}</span>
                    <span class="h2h-bar" aria-hidden="true">
                        <span class="bar-w" style="flex:${o.wins}"></span><span class="bar-l" style="flex:${o.losses}"></span>
                    </span>
                    <span class="h2h-score"><b>${o.wins}</b> - ${o.losses}</span>
                </li>`).join('')}
        </ul>`;
}

function viewPlayer(pid, allStats, isMine) {
    const mode = prefs.mode;
    const stats = allStats[mode];
    const row = stats.byId[pid];
    const p = row.player;
    const my = me();

    const recent = sortRecentFirst(S.data.matches.filter(m => m.type === mode && involves(m, pid))).slice(0, 5);

    return `
        <section class="section profile">
            <div class="profile-head">
                <span class="avatar avatar-lg">${h(initials(p.name))}</span>
                <div class="grow">
                    <h2 class="profile-name">${h(p.name)}</h2>
                    <p class="muted small">Classement FFT <span class="chip">${h(p.ranking || 'NC')}</span></p>
                </div>
                ${isMine ? `<button class="btn btn-small btn-ghost" data-action="edit-profile">Modifier</button>` : ''}
            </div>

            ${modeSwitch()}

            <div class="stat-row">
                <div class="stat"><span class="stat-value">${row.rank ?? '–'}</span><span class="stat-label">Rang</span></div>
                <div class="stat"><span class="stat-value">${row.played ? row.elo : '—'}</span><span class="stat-label">Points</span></div>
                <div class="stat"><span class="stat-value">${row.wins}<small>-</small>${row.losses}</span><span class="stat-label">V-D</span></div>
                <div class="stat"><span class="stat-value">${row.played ? Math.round(row.winRate * 100) : 0}<small>%</small></span><span class="stat-label">Victoires</span></div>
            </div>

            ${!isMine && my.id !== pid ? headToHeadVs(my, p, allStats) : ''}

            ${mode === 'simple' ? `
                <h3 class="sub-title">Face-à-face</h3>
                ${recordList(row.h2h, 'Pas encore de simple joué.')}
            ` : `
                <h3 class="sub-title">Avec ${isMine ? 'vos' : 'ses'} partenaires</h3>
                ${recordList(row.partners, 'Pas encore de double joué.')}
                <h3 class="sub-title">Contre ${isMine ? 'vos' : 'ses'} adversaires</h3>
                ${recordList(row.h2h, 'Pas encore de double joué.')}
            `}

            ${recent.length ? `<h3 class="sub-title">Derniers ${mode === 'simple' ? 'simples' : 'doubles'}</h3><div class="matches">${recent.map(m => matchCard(m)).join('')}</div>` : ''}

            ${!isMine && !p.uid ? `
                <div class="card invite-card">
                    <p class="small">${h(p.name)} n’a pas encore rejoint la communauté.</p>
                    <button class="btn btn-primary btn-small" data-action="invite-player" data-pid="${h(p.id)}">Envoyer son invitation</button>
                </div>` : ''}
            ${!isMine && p.uid && S.data.community.createdBy === S.uid ? `
                <button class="link small" data-action="release" data-pid="${h(p.id)}">Détacher ce profil de son téléphone (changement d’appareil)</button>` : ''}
            ${!isMine && S.data.community.createdBy === S.uid ? deletePlayerBlock(p) : ''}
        </section>`;
}

// Suppression d'un joueur (créateur de la communauté uniquement) : ses
// matchs sont supprimés avec lui pour que le classement reste juste.
function deletePlayerBlock(p) {
    const count = S.data.matches.filter(m => involves(m, p.id)).length;
    if (S.confirm !== 'player:' + p.id) {
        return `<button class="link small danger-link" data-action="ask-delete-player" data-pid="${h(p.id)}">Supprimer ce joueur</button>`;
    }
    return `
        <div class="card confirm-card">
            <p class="small"><b>Supprimer ${h(p.name)} de la communauté ?</b></p>
            <p class="small muted">${count
                ? `${count > 1 ? `Ses ${count} matchs seront` : 'Son match sera'} aussi supprimé${count > 1 ? 's' : ''} et le classement sera recalculé.`
                : 'Il n’a joué aucun match.'} Cette action est définitive.</p>
            <div class="confirm-row">
                <button class="btn btn-small btn-danger" data-action="delete-player" data-pid="${h(p.id)}">Supprimer</button>
                <button class="btn btn-small btn-ghost" data-action="cancel-confirm">Annuler</button>
            </div>
        </div>`;
}

function headToHeadVs(my, p, allStats) {
    const vs = allStats.simple.byId[my.id].h2h[p.id] || { wins: 0, losses: 0 };
    const dv = allStats.double.byId[my.id].h2h[p.id] || { wins: 0, losses: 0 };
    const dw = allStats.double.byId[my.id].partners[p.id] || { wins: 0, losses: 0 };
    const verdict = (r, them) => r.wins + r.losses
        ? (r.wins > r.losses ? 'Vous menez' : r.wins < r.losses ? `${h(them)} mène` : 'Égalité')
        : 'Jamais affrontés';
    const line = (label, r) => r.wins + r.losses
        ? `<span>${label} <b>${r.wins}-${r.losses}</b></span>` : '';
    const doubles = [line('En double contre', dv), line('En double ensemble', dw)].filter(Boolean).join('');
    return `
        <div class="vs-card">
            <p class="eyebrow">Vous contre ${h(p.name)} · simple</p>
            <p class="vs-score"><span class="${vs.wins >= vs.losses ? 'lead' : ''}">${vs.wins}</span><span class="vs-sep">–</span><span class="${vs.losses > vs.wins ? 'lead' : ''}">${vs.losses}</span></p>
            <p class="muted small">${verdict(vs, p.name)}</p>
            ${doubles ? `<p class="vs-doubles small">${doubles}</p>` : ''}
        </div>`;
}

// ---------- Feuilles (formulaires en bas d'écran) ----------

function openSheet(html) {
    sheetRoot.innerHTML = `
        <div class="sheet-backdrop" data-action="close-sheet"></div>
        <div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.classList.add('has-sheet');
}

function closeSheet() {
    sheetRoot.innerHTML = '';
    document.body.classList.remove('has-sheet');
}

function openMatchSheet(match = null) {
    const players = [...S.data.players].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const my = me();
    const others = players.filter(p => p.id !== my.id);
    if (!others.length) {
        openSheet(`
            <h2 class="sheet-title">Nouveau match</h2>
            <p class="muted">Ajoutez d’abord un autre joueur à la communauté.</p>
            <button class="btn btn-primary" data-action="add-player">+ Ajouter un joueur</button>`);
        return;
    }
    // Composition proposée : vous et un partenaire contre les deux suivants,
    // ou celle du match à modifier.
    const defaults = match
        ? { t1a: match.t1[0], t1b: match.t1[1] ?? others[1]?.id, t2a: match.t2[0], t2b: match.t2[1] ?? others[2]?.id }
        : { t1a: my.id, t2a: others[0].id, t1b: others[1]?.id, t2b: others[2]?.id };
    const set = i => match?.sets[i];
    const select = (id, label, extraClass = '') => `
        <label class="field ${extraClass}"><span class="field-label">${label}</span>
            <select class="field-input" id="m-${id}" name="${id}">
                ${players.map(p => `<option value="${h(p.id)}" ${p.id === defaults[id] ? 'selected' : ''}>${h(p.name)}</option>`).join('')}
            </select>
        </label>`;
    const setRow = i => `
        <div class="set-row" data-set="${i}">
            <span class="set-label">Set ${i + 1}</span>
            <input class="score-input" inputmode="numeric" pattern="[0-9]*" maxlength="2" id="s${i}a" aria-label="Set ${i + 1}, camp 1" value="${set(i)?.a ?? ''}">
            <span class="dash">–</span>
            <input class="score-input" inputmode="numeric" pattern="[0-9]*" maxlength="2" id="s${i}b" aria-label="Set ${i + 1}, camp 2" value="${set(i)?.b ?? ''}">
        </div>`;
    openSheet(`
        <form data-form="match" class="form">
            <h2 class="sheet-title">${match ? 'Modifier le match' : 'Nouveau match'}</h2>
            <input type="hidden" id="m-id" name="id" value="${h(match?.id ?? '')}">
            <input type="hidden" id="m-type" name="type" value="simple">
            <div class="segmented" role="tablist" aria-label="Format du match">
                <button type="button" role="tab" class="seg" data-action="match-type" data-type="simple">Simple</button>
                <button type="button" role="tab" class="seg" data-action="match-type" data-type="double">Double</button>
            </div>
            <label class="field">
                <span class="field-label">Date</span>
                <input class="field-input" type="date" id="m-date" name="date" value="${h(match?.date || today())}" required>
            </label>
            <div class="versus">
                <div class="team">
                    <p class="team-label" data-label-simple="Joueur 1" data-label-double="Équipe 1">Joueur 1</p>
                    ${select('t1a', 'Joueur')}
                    ${select('t1b', 'Partenaire', 'double-only')}
                </div>
                <div class="team">
                    <p class="team-label" data-label-simple="Joueur 2" data-label-double="Équipe 2">Joueur 2</p>
                    ${select('t2a', 'Joueur')}
                    ${select('t2b', 'Partenaire', 'double-only')}
                </div>
            </div>
            <div class="sets" id="sets">${[0, 1, 2].map(setRow).join('')}</div>
            <p class="muted small">Laissez vide un set non joué. Super tie-break : notez-le comme un set (10-7).</p>
            <p class="form-error" id="m-error" hidden></p>
            <button class="btn btn-primary" type="submit">${match ? 'Enregistrer les modifications' : 'Enregistrer le match'}</button>
        </form>`);
    setMatchType(match ? match.type : (players.length >= 4 ? prefs.mode : 'simple'));
}

function setMatchType(type) {
    const form = sheetRoot.querySelector('[data-form="match"]');
    if (!form) return;
    form.querySelector('#m-type').value = type;
    form.querySelectorAll('[data-action="match-type"]').forEach(b => {
        b.classList.toggle('is-active', b.dataset.type === type);
        b.setAttribute('aria-selected', b.dataset.type === type);
    });
    form.querySelectorAll('.double-only').forEach(el => { el.hidden = type !== 'double'; });
    form.querySelectorAll('.team-label').forEach(el => {
        el.textContent = type === 'double' ? el.dataset.labelDouble : el.dataset.labelSimple;
    });
    form.querySelectorAll('.team .field:not(.double-only) .field-label').forEach(el => {
        el.hidden = type !== 'double';
    });
    const err = form.querySelector('#m-error');
    if (type === 'double' && S.data.players.length < 4) {
        err.textContent = 'Il faut au moins 4 joueurs dans la communauté pour un double.';
        err.hidden = false;
    } else {
        err.hidden = true;
    }
}

function openPlayerSheet() {
    openSheet(`
        <form data-form="player" class="form">
            <h2 class="sheet-title">Ajouter un joueur</h2>
            <p class="muted small">Vous pourrez noter ses matchs tout de suite et lui envoyer son invitation ensuite.</p>
            <label class="field">
                <span class="field-label">Prénom</span>
                <input class="field-input" id="p-name" name="name" required maxlength="30">
            </label>
            <label class="field">
                <span class="field-label">Classement</span>
                ${rankingSelect('p-rank', 'ranking', 'NC')}
            </label>
            <button class="btn btn-primary" type="submit">Ajouter</button>
        </form>`);
}

function openProfileSheet() {
    const p = me();
    openSheet(`
        <form data-form="profile" class="form">
            <h2 class="sheet-title">Mon profil</h2>
            <label class="field">
                <span class="field-label">Prénom</span>
                <input class="field-input" id="e-name" name="name" required maxlength="30" value="${h(p.name)}">
            </label>
            <label class="field">
                <span class="field-label">Classement</span>
                ${rankingSelect('e-rank', 'ranking', p.ranking || 'NC')}
            </label>
            <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>`);
}

function openPlayerDetail(pid) {
    if (pid === me().id) { S.tab = 'moi'; render(); return; }
    const stats = computeStats(S.data.players, S.data.matches);
    openSheet(`<div class="sheet-scroll" data-pid-detail="${h(pid)}">${viewPlayer(pid, stats, false)}</div>`);
}

function openCommunitySheet() {
    openSheet(`
        <h2 class="sheet-title">Communautés</h2>
        <div class="list">
            ${prefs.communities.map(c => `
                <button class="list-row ${c.id === S.cid ? 'is-highlight' : ''}" data-action="open-community" data-cid="${h(c.id)}">
                    <span class="grow">${h(c.name)}</span>${c.id === S.cid ? '<span class="chip">actuelle</span>' : '<span class="chev">›</span>'}
                </button>`).join('')}
        </div>
        <button class="btn btn-ghost" data-action="home">+ Créer une autre communauté</button>`);
}

// ---------- Actions ----------

function rememberCommunity() {
    if (!S.data?.community) return;
    const entry = { id: S.cid, name: S.data.community.name };
    const i = prefs.communities.findIndex(c => c.id === S.cid);
    if (i === -1) prefs.communities.push(entry);
    else prefs.communities[i] = entry;
    prefs.current = S.cid;
    savePrefs();
}

function openCommunity(cid) {
    if (S.unsub) S.unsub();
    S.cid = cid;
    S.data = null;
    S.tab = 'classement';
    closeSheet();
    render();
    if (!cid) {
        prefs.current = null;
        savePrefs();
        return;
    }
    S.unsub = S.store.watch(cid, data => {
        S.data = { ...data, matches: data.matches.map(normalizeMatch) };
        if (data.community && data.players.some(p => p.uid === S.uid)) rememberCommunity();
        render();
    });
}

async function run(fn) {
    try {
        await fn();
    } catch (e) {
        console.error(e);
        toast('Échec de l’enregistrement. Vérifiez votre connexion et réessayez.');
    }
}

const actions = {
    'tab': el => { S.tab = el.dataset.tab; S.confirm = null; render(); window.scrollTo(0, 0); },
    'new-match': () => openMatchSheet(),
    'edit-match': el => {
        const match = S.data.matches.find(m => m.id === el.dataset.mid);
        if (match) openMatchSheet(match);
    },
    'mode': el => {
        prefs.mode = el.dataset.mode;
        savePrefs();
        rerenderKeepingSheet();
    },
    'match-type': el => setMatchType(el.dataset.type),
    'add-player': () => openPlayerSheet(),
    'edit-profile': () => openProfileSheet(),
    'player': el => openPlayerDetail(el.dataset.pid),
    'invite': () => shareInvite(null, null),
    'invite-player': el => shareInvite(el.dataset.pid, playerName(el.dataset.pid)),
    'close-sheet': () => closeSheet(),
    'switch-community': () => openCommunitySheet(),
    'open-community': el => openCommunity(el.dataset.cid),
    'home': () => openCommunity(null),
    'ask-delete': el => { S.confirm = el.dataset.mid; rerenderKeepingSheet(); },
    'cancel-confirm': () => { S.confirm = null; rerenderKeepingSheet(); },
    'delete-match': el => run(async () => {
        await S.store.deleteMatch(S.cid, el.dataset.mid);
        S.confirm = null;
        rerenderKeepingSheet();
        toast('Match supprimé');
    }),
    'claim': el => run(async () => {
        await S.store.updatePlayer(S.cid, el.dataset.pid, { uid: S.uid });
        toast('Bienvenue !');
    }),
    'ask-delete-player': el => { S.confirm = 'player:' + el.dataset.pid; rerenderKeepingSheet(); },
    'delete-player': el => run(async () => {
        const pid = el.dataset.pid;
        const name = playerName(pid);
        const matchIds = S.data.matches.filter(m => involves(m, pid)).map(m => m.id);
        await S.store.deletePlayer(S.cid, pid, matchIds);
        S.confirm = null;
        closeSheet();
        toast(`${name} a été supprimé`);
    }),
    'release': el => run(async () => {
        await S.store.updatePlayer(S.cid, el.dataset.pid, { uid: null });
        closeSheet();
        toast('Profil détaché : renvoyez-lui son invitation');
    }),
};

function rerenderKeepingSheet() {
    const detail = sheetRoot.querySelector('[data-pid-detail]');
    render();
    if (detail) openPlayerDetail(detail.dataset.pidDetail);
}

document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheetRoot.innerHTML) closeSheet();
});

document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const kind = form.dataset.form;

    if (kind === 'create') return run(async () => {
        const cid = await S.store.createCommunity(f.community.trim());
        await S.store.addPlayer(cid, { name: f.name.trim(), ranking: f.ranking, uid: S.uid });
        openCommunity(cid);
        toast('Communauté créée. Invitez vos amis !');
    });

    if (kind === 'join') return run(async () => {
        await S.store.addPlayer(S.cid, { name: f.name.trim(), ranking: f.ranking, uid: S.uid });
        toast('Bienvenue !');
    });

    if (kind === 'player') return run(async () => {
        const pid = await S.store.addPlayer(S.cid, { name: f.name.trim(), ranking: f.ranking, uid: null });
        closeSheet();
        openSheet(`
            <h2 class="sheet-title">${h(f.name.trim())} est ajouté</h2>
            <p class="muted">Envoyez-lui son lien : en l’ouvrant, il retrouvera son profil et ses matchs.</p>
            <button class="btn btn-primary" data-action="invite-player" data-pid="${h(pid)}">Envoyer l’invitation</button>
            <button class="btn btn-ghost" data-action="close-sheet">Plus tard</button>`);
    });

    if (kind === 'profile') return run(async () => {
        await S.store.updatePlayer(S.cid, me().id, { name: f.name.trim(), ranking: f.ranking });
        closeSheet();
        toast('Profil mis à jour');
    });

    if (kind === 'match') {
        const err = form.querySelector('#m-error');
        const fail = msg => { err.textContent = msg; err.hidden = false; };
        const isDouble = f.type === 'double';
        const t1 = isDouble ? [f.t1a, f.t1b] : [f.t1a];
        const t2 = isDouble ? [f.t2a, f.t2b] : [f.t2a];
        const everyone = [...t1, ...t2];
        if (new Set(everyone).size !== everyone.length) {
            return fail(isDouble ? 'Choisissez quatre joueurs différents.' : 'Choisissez deux joueurs différents.');
        }
        const sets = [];
        for (let i = 0; i < 3; i++) {
            const a = form.querySelector(`#s${i}a`).value.trim();
            const b = form.querySelector(`#s${i}b`).value.trim();
            if (a === '' && b === '') continue;
            if (a === '' || b === '') return fail(`Complétez le score du set ${i + 1}.`);
            const sa = Number(a), sb = Number(b);
            if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) return fail(`Le score du set ${i + 1} doit être un nombre.`);
            if (sa === sb) return fail(`Le set ${i + 1} ne peut pas être à égalité.`);
            sets.push({ a: sa, b: sb });
        }
        if (!sets.length) return fail('Indiquez au moins un set.');
        const won = setsWon(sets);
        if (won.a === won.b) return fail('Aucun vainqueur : vérifiez les sets.');
        const winnerSide = won.a > won.b ? 1 : 2;
        return run(async () => {
            const data = { type: f.type, date: f.date, t1, t2, sets, winnerSide };
            if (f.id) await S.store.updateMatch(S.cid, f.id, data);
            else await S.store.addMatch(S.cid, data);
            prefs.mode = f.type;
            savePrefs();
            closeSheet();
            S.tab = 'matchs';
            render();
            const names = (winnerSide === 1 ? t1 : t2).map(playerName).join(' et ');
            toast(f.id ? 'Match modifié' : `Victoire de ${names} enregistrée`);
        });
    }
});

// Saisie des scores : passer à la case suivante automatiquement.
document.addEventListener('input', e => {
    const input = e.target;
    if (!input.classList.contains('score-input')) return;
    input.value = input.value.replace(/\D/g, '');
    const v = Number(input.value);
    if (input.value.length === 2 || (input.value.length === 1 && v >= 2 && v <= 9)) {
        const all = [...document.querySelectorAll('.score-input')];
        const next = all[all.indexOf(input) + 1];
        if (next) next.focus();
    }
});

// ---------- Démarrage ----------

async function start() {
    render();
    const params = new URLSearchParams(location.search);
    const invitedCid = params.get('c');
    S.claimPid = params.get('p');
    if (invitedCid) history.replaceState(null, '', location.pathname);

    try {
        S.store = await createStore();
        S.uid = await S.store.init();
    } catch (e) {
        console.error(e);
        const title = e instanceof MissingConfigError ? 'Bientôt prêt' : 'Connexion impossible';
        const text = e instanceof MissingConfigError
            ? 'La base de données de l’application n’est pas encore branchée. Revenez dans quelques instants.'
            : 'Vérifiez votre connexion internet puis rechargez la page.';
        app.innerHTML = `<main class="welcome"><h1 class="brand">Tie-Break</h1><div class="card"><h2 class="card-title">${title}</h2>
            <p class="muted">${text}</p></div></main>`;
        return;
    }
    openCommunity(invitedCid || prefs.current);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

start();
