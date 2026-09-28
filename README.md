# Tie-Break

Application pour téléphone qui sert à noter les matchs de tennis entre amis :

- **Simples et doubles**, chacun avec son propre classement.
- **Classement de la communauté** en points Elo (tout le monde démarre à 1500 ; battre un joueur mieux classé rapporte plus). En double, la force d’une équipe est la moyenne de ses deux joueurs. Un joueur est classé à partir de 3 matchs ; avant, il apparaît « en rodage ».
- **Bilan personnel** : victoires, défaites, pourcentage et forme sur les 5 derniers matchs.
- **Face-à-face** : en simple, votre bilan contre chaque ami ; en double, votre bilan avec chaque partenaire et contre chaque adversaire.
- **Profils** avec le classement FFT de chacun (NC, 40, 30/5 … 15/1, 5/6 … -30).
- **Invitations par lien** : ajoutez vos amis d’abord, notez vos matchs, puis envoyez-leur leur lien. En l’ouvrant, ils retrouvent leur profil et leur historique.
- **Compte par e-mail** : chacun peut protéger son profil avec un e-mail et un mot de passe pour le retrouver sur l’application installée ou sur un autre téléphone.
- **Hors ligne** : l’application s’ouvre sans réseau, et un match noté sans réseau est envoyé dès que la connexion revient.

C’est une application web installable (PWA) : elle s’ouvre dans le navigateur du téléphone et s’ajoute à l’écran d’accueil comme une vraie application, sans passer par l’App Store ni le Play Store.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css` | Page et apparence |
| `app.js` | Écrans et actions |
| `stats.js` | Calcul du classement Elo, des bilans et des face-à-face |
| `store.js` | Enregistrement des données en ligne (Firebase) |
| `firebase-config.js` | Clés de votre projet Firebase |
| `firestore.rules` | Règles de sécurité de la base de données |
| `firebase.json`, `.firebaserc`, `.github/workflows/firestore-rules.yml` | Publication automatique des règles depuis GitHub |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur le téléphone et fonctionnement hors ligne |
| `horloge/` | L’ancienne horloge digitale |

## Essayer sur ordinateur

```bash
python3 -m http.server 8000
```

Puis ouvrez http://localhost:8000. Toutes les données sont enregistrées dans Firebase : l’application a donc besoin de `firebase-config.js` rempli pour fonctionner.

## Mettre en ligne (pour jouer avec vos amis)

### 1. Créer la base de données Firebase (gratuit)

1. Allez sur https://console.firebase.google.com et créez un projet (par exemple `tie-break`). Google Analytics n’est pas nécessaire.
2. **Build → Authentication → Get started → Sign-in method** : activez **Anonymous** (Anonyme), puis **Adresse e-mail/Mot de passe**. Chaque téléphone reçoit un identifiant anonyme, que le joueur peut ensuite protéger avec un e-mail.
3. **Build → Firestore Database → Create database** : choisissez une région en Europe (`eur3`) et le **mode production**.
4. Dans Firestore, onglet **Rules** : remplacez le contenu par celui du fichier `firestore.rules`, puis cliquez sur **Publish**.
5. **Paramètres du projet (roue dentée) → Vos applications → icône Web `</>`** : enregistrez une application et copiez l’objet `firebaseConfig` dans `firebase-config.js`, à la place de `null`.

### 2. Héberger l’application avec GitHub Pages (gratuit)

1. Sur GitHub, dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, choisissez la branche `main` et le dossier `/ (root)`.
2. Au bout d’une minute, l’application est disponible à l’adresse `https://<votre-pseudo>.github.io/<nom-du-dépôt>/`.
3. Dans Firebase, **Authentication → Settings → Authorized domains** : ajoutez `<votre-pseudo>.github.io`.

### 3. Publier les règles automatiquement (facultatif)

Sans cette étape, il faut recopier `firestore.rules` dans la console Firebase à chaque modification.

1. Console Firebase → **⚙ Paramètres du projet → Comptes de service → Générer une nouvelle clé privée**. Un fichier JSON est téléchargé : gardez-le secret.
2. Sur GitHub : **Settings → Secrets and variables → Actions → New repository secret**. Nom : `FIREBASE_SERVICE_ACCOUNT`, valeur : tout le contenu du fichier JSON.
3. Supprimez le fichier JSON de votre ordinateur.

Ensuite, chaque modification de `firestore.rules` sur `main` est publiée toute seule (onglet **Actions** du dépôt).

### 4. Installer sur le téléphone

- **iPhone (Safari)** : ouvrez l’adresse, touchez **Partager** puis **Sur l’écran d’accueil**.
- **Android (Chrome)** : ouvrez l’adresse, menu **⋮** puis **Installer l’application**.

Sur iPhone, Safari et l’application installée ne partagent pas leurs données. Après avoir rejoint une communauté dans Safari, protégez votre profil avec un e-mail (l’application le propose), puis connectez-vous dans l’application installée.

## Utilisation

1. Créez votre communauté avec votre prénom et votre classement.
2. **Classement → + Ajouter un joueur** pour chaque ami.
3. **+ Match** après chaque partie : choisissez Simple ou Double, la date, les joueurs (deux équipes de deux en double) et le score de chaque set. Un super tie-break se note comme un set (10-7).
4. Touchez un joueur puis **Envoyer son invitation** : il reçoit un lien personnel qui l’attache directement à son profil. Le bouton **Inviter** en haut envoie un lien général : la personne choisit alors son profil ou en crée un.

Le créateur de la communauté peut aussi **supprimer un joueur** depuis sa fiche : ses matchs sont supprimés avec lui et le classement est recalculé.

Si un ami change de téléphone, il lui suffit de **se connecter** avec l’e-mail de son profil. S’il ne l’avait pas protégé, le créateur de la communauté peut ouvrir son profil et le **détacher**, puis lui renvoyer son invitation.

## Limites connues

- Toute personne qui possède le lien de la communauté peut y noter des matchs : partagez-le seulement avec vos amis.
- Un profil non protégé par un e-mail est lié au navigateur du téléphone : effacer les données du navigateur oblige à se faire renvoyer son invitation.
- Seuls la personne qui a noté un match et le créateur de la communauté peuvent le modifier (bouton « Modifier » sous le score) ou le supprimer.
