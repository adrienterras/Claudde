// Couche de données : Firestore, avec une connexion anonyme par téléphone.
// Les données sont enregistrées en ligne et partagées entre les membres.
//
// Modèle :
//   communities/{cid}                    { name, createdBy, createdAt }
//   communities/{cid}/players/{pid}      { name, ranking, uid|null, createdBy, createdAt }
//   communities/{cid}/matches/{mid}      { date, p1, p2, sets:[{a,b}], winner, createdBy, createdAt }

import { firebaseConfig } from './firebase-config.js';

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

        // Supprime le joueur et ses matchs en une seule opération.
        async deletePlayer(cid, pid, matchIds) {
            const batch = fs.writeBatch(db);
            for (const mid of matchIds) batch.delete(fs.doc(matches(cid), mid));
            batch.delete(fs.doc(players(cid), pid));
            await batch.commit();
        },

        async addMatch(cid, data) {
            await fs.addDoc(matches(cid), { ...data, createdBy: uid, createdAt: Date.now() });
        },

        async updateMatch(cid, mid, data) {
            await fs.updateDoc(fs.doc(matches(cid), mid), { ...data, updatedBy: uid, updatedAt: Date.now() });
        },

        async deleteMatch(cid, mid) {
            await fs.deleteDoc(fs.doc(matches(cid), mid));
        },
    };
}

export class MissingConfigError extends Error {}

export async function createStore() {
    if (!firebaseConfig) throw new MissingConfigError('Configuration Firebase manquante');
    return createFirebaseStore(firebaseConfig);
}
