// Couche de données : même interface en mode démo (localStorage) et en
// mode Firebase (Firestore + connexion anonyme).
//
// Modèle :
//   communities/{cid}                    { name, createdBy, createdAt }
//   communities/{cid}/players/{pid}      { name, ranking, uid|null, createdBy, createdAt }
//   communities/{cid}/matches/{mid}      { date, p1, p2, sets:[{a,b}], winner, createdBy, createdAt }

import { firebaseConfig } from './firebase-config.js';

function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

// ---------- Mode démo ----------

const DEMO_KEY = 'tiebreak-demo-v1';

function createDemoStore() {
    const listeners = new Set();

    function load() {
        try {
            const raw = localStorage.getItem(DEMO_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* stockage indisponible */ }
        return { uid: newId(), communities: {} };
    }

    let db = load();

    function save() {
        try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
        listeners.forEach(fn => fn());
    }

    window.addEventListener('storage', e => {
        if (e.key === DEMO_KEY) { db = load(); listeners.forEach(fn => fn()); }
    });

    function community(cid) {
        const c = db.communities[cid];
        if (!c) throw new Error('Communauté introuvable');
        return c;
    }

    return {
        mode: 'demo',
        async init() { save(); return db.uid; },

        async createCommunity(name) {
            const cid = newId();
            db.communities[cid] = {
                info: { name, createdBy: db.uid, createdAt: Date.now() },
                players: {},
                matches: {},
            };
            save();
            return cid;
        },

        watch(cid, cb) {
            const emit = () => {
                const c = db.communities[cid];
                if (!c) { cb({ community: null, players: [], matches: [] }); return; }
                cb({
                    community: { id: cid, ...c.info },
                    players: Object.entries(c.players).map(([id, p]) => ({ id, ...p })),
                    matches: Object.entries(c.matches).map(([id, m]) => ({ id, ...m })),
                });
            };
            listeners.add(emit);
            emit();
            return () => listeners.delete(emit);
        },

        async addPlayer(cid, data) {
            const pid = newId();
            community(cid).players[pid] = { ...data, createdBy: db.uid, createdAt: Date.now() };
            save();
            return pid;
        },

        async updatePlayer(cid, pid, patch) {
            Object.assign(community(cid).players[pid], patch);
            save();
        },

        async addMatch(cid, data) {
            community(cid).matches[newId()] = { ...data, createdBy: db.uid, createdAt: Date.now() };
            save();
        },

        async deleteMatch(cid, mid) {
            delete community(cid).matches[mid];
            save();
        },
    };
}

// ---------- Mode Firebase ----------

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

async function createFirebaseStore(config) {
    const [{ initializeApp }, auth, fs] = await Promise.all([
        import(`${FB}/firebase-app.js`),
        import(`${FB}/firebase-auth.js`),
        import(`${FB}/firebase-firestore.js`),
    ]);

    const app = initializeApp(config);
    const firebaseAuth = auth.getAuth(app);
    let db;
    try {
        db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
    } catch (e) {
        db = fs.getFirestore(app);
    }
    let uid = null;

    const communityDoc = cid => fs.doc(db, 'communities', cid);
    const players = cid => fs.collection(db, 'communities', cid, 'players');
    const matches = cid => fs.collection(db, 'communities', cid, 'matches');

    return {
        mode: 'firebase',

        async init() {
            // Attendre la session enregistrée sur ce téléphone avant d'en créer
            // une nouvelle, sinon le joueur perdrait son profil à chaque visite.
            await firebaseAuth.authStateReady();
            const user = firebaseAuth.currentUser
                || (await auth.signInAnonymously(firebaseAuth)).user;
            uid = user.uid;
            return uid;
        },

        async createCommunity(name) {
            const ref = fs.doc(fs.collection(db, 'communities'));
            await fs.setDoc(ref, { name, createdBy: uid, createdAt: Date.now() });
            return ref.id;
        },

        watch(cid, cb) {
            const state = { community: undefined, players: undefined, matches: undefined };
            const emit = () => {
                if (state.community === undefined || !state.players || !state.matches) return;
                cb({ ...state });
            };
            const onError = err => {
                console.error(err);
                cb({ community: null, players: [], matches: [], error: err });
            };
            const unsubs = [
                fs.onSnapshot(communityDoc(cid), snap => {
                    state.community = snap.exists() ? { id: cid, ...snap.data() } : null;
                    emit();
                }, onError),
                fs.onSnapshot(players(cid), snap => {
                    state.players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    emit();
                }, onError),
                fs.onSnapshot(matches(cid), snap => {
                    state.matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    emit();
                }, onError),
            ];
            return () => unsubs.forEach(u => u());
        },

        async addPlayer(cid, data) {
            const ref = await fs.addDoc(players(cid), { ...data, createdBy: uid, createdAt: Date.now() });
            return ref.id;
        },

        async updatePlayer(cid, pid, patch) {
            await fs.updateDoc(fs.doc(players(cid), pid), patch);
        },

        async addMatch(cid, data) {
            await fs.addDoc(matches(cid), { ...data, createdBy: uid, createdAt: Date.now() });
        },

        async deleteMatch(cid, mid) {
            await fs.deleteDoc(fs.doc(matches(cid), mid));
        },
    };
}

export async function createStore() {
    if (firebaseConfig) return createFirebaseStore(firebaseConfig);
    return createDemoStore();
}
