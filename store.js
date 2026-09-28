// Couche de données : Firestore et Firebase Authentication.
//
// Chaque téléphone démarre avec une connexion anonyme. Le joueur peut ensuite
// protéger son profil avec un e-mail et un mot de passe : son identifiant ne
// change pas, et il peut se reconnecter depuis n'importe quel appareil
// (nouveau téléphone, application installée sur l'écran d'accueil…).
//
// Modèle :
//   users/{uid}                          { communities: { [cid]: { name } } }
//   communities/{cid}                    { name, createdBy, createdAt }
//   communities/{cid}/players/{pid}      { name, ranking, uid|null, createdBy, createdAt }
//   communities/{cid}/matches/{mid}      { type, date, t1, t2, sets:[{a,b}], winnerSide, createdBy, createdAt }

import { firebaseConfig } from './firebase-config.js';

export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

async function createFirebaseStore(config) {
    const [{ initializeApp }, auth, fs] = await Promise.all([
        import(`${FIREBASE_SDK}/firebase-app.js`),
        import(`${FIREBASE_SDK}/firebase-auth.js`),
        import(`${FIREBASE_SDK}/firebase-firestore.js`),
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
    const userDoc = () => fs.doc(db, 'users', uid);

    // Les écritures ne sont pas attendues : Firestore les applique tout de
    // suite à l'écran et les envoie dès que le réseau le permet. Sans cela,
    // sur un court sans réseau, l'écran resterait figé et on noterait le
    // même match plusieurs fois.
    const store = {
        onWriteError: () => {},

        async init() {
            // Attendre la session enregistrée sur ce téléphone avant d'en créer
            // une nouvelle, sinon le joueur perdrait son profil à chaque visite.
            await firebaseAuth.authStateReady();
            const user = firebaseAuth.currentUser
                || (await auth.signInAnonymously(firebaseAuth)).user;
            uid = user.uid;
            return uid;
        },

        // ----- Compte -----

        account() {
            const u = firebaseAuth.currentUser;
            return { email: u?.email || null, isAnonymous: !u || u.isAnonymous };
        },

        async secureAccount(email, password) {
            const cred = auth.EmailAuthProvider.credential(email, password);
            await auth.linkWithCredential(firebaseAuth.currentUser, cred);
        },

        async signIn(email, password) {
            const { user } = await auth.signInWithEmailAndPassword(firebaseAuth, email, password);
            uid = user.uid;
            return uid;
        },

        async signOut() {
            await auth.signOut(firebaseAuth);
            uid = (await auth.signInAnonymously(firebaseAuth)).user.uid;
            return uid;
        },

        async resetPassword(email) {
            await auth.sendPasswordResetEmail(firebaseAuth, email);
        },

        // Communautés rejointes, gardées en ligne pour les retrouver sur
        // n'importe quel appareil.
        async getMemberships() {
            try {
                const snap = await fs.getDoc(userDoc());
                const map = snap.exists() ? snap.data().communities || {} : {};
                return Object.entries(map).map(([id, v]) => ({ id, name: v.name }));
            } catch (e) {
                console.error(e);
                return [];
            }
        },

        saveMembership(cid, name) {
            send(fs.setDoc(userDoc(), { communities: { [cid]: { name } } }, { merge: true }));
        },

        // ----- Communautés, joueurs, matchs -----

        createCommunity(name) {
            const ref = fs.doc(fs.collection(db, 'communities'));
            send(fs.setDoc(ref, { name, createdBy: uid, createdAt: Date.now() }));
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

        addPlayer(cid, data) {
            const ref = fs.doc(players(cid));
            send(fs.setDoc(ref, { ...data, createdBy: uid, createdAt: Date.now() }));
            return ref.id;
        },

        updatePlayer(cid, pid, patch) {
            send(fs.updateDoc(fs.doc(players(cid), pid), patch));
        },

        // Supprime le joueur et ses matchs en une seule opération.
        deletePlayer(cid, pid, matchIds) {
            const batch = fs.writeBatch(db);
            for (const mid of matchIds) batch.delete(fs.doc(matches(cid), mid));
            batch.delete(fs.doc(players(cid), pid));
            send(batch.commit());
        },

        addMatch(cid, data) {
            send(fs.setDoc(fs.doc(matches(cid)), { ...data, createdBy: uid, createdAt: Date.now() }));
        },

        updateMatch(cid, mid, data) {
            send(fs.updateDoc(fs.doc(matches(cid), mid), { ...data, updatedBy: uid, updatedAt: Date.now() }));
        },

        deleteMatch(cid, mid) {
            send(fs.deleteDoc(fs.doc(matches(cid), mid)));
        },
    };

    function send(promise) {
        promise.catch(err => {
            console.error(err);
            store.onWriteError(err);
        });
    }

    return store;
}

export class MissingConfigError extends Error {}

export async function createStore() {
    if (!firebaseConfig) throw new MissingConfigError('Configuration Firebase manquante');
    return createFirebaseStore(firebaseConfig);
}
