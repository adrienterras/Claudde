# Tie-Break

Application pour téléphone qui sert à noter les matchs de tennis entre amis :

- **Simples et doubles**, chacun avec son propre classement.
- **Classement de la communauté** en points Elo (tout le monde démarre à 1500 ; battre un joueur mieux classé rapporte plus). En double, la force d’une équipe est la moyenne de ses deux joueurs.
- **Bilan personnel** : victoires, défaites, pourcentage et forme sur les 5 derniers matchs.
- **Face-à-face** : en simple, votre bilan contre chaque ami ; en double, votre bilan avec chaque partenaire et contre chaque adversaire.
- **Profils** avec le classement FFT de chacun (NC, 40, 30/5 … 15/1, 5/6 … -30).
- **Invitations par lien** : ajoutez vos amis d’abord, notez vos matchs, puis envoyez-leur leur lien. En l’ouvrant, ils retrouvent leur profil et leur historique.

C’est une application web installable (PWA) : elle s’ouvre dans le navigateur du téléphone et s’ajoute à l’écran d’accueil comme une vraie application, sans passer par l’App Store ni le Play Store.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css` | Page et apparence |
| `app.js` | Écrans et actions |
| `stats.js` | Calcul du classement Elo, des bilans et des face-à-face |
| `store.js` | Enregistrement des données (mode démo ou Firebase) |
| `firebase-config.js` | Clés de votre projet Firebase (vide = mode démo) |
| `firestore.rules` | Règles de sécurité de la base de données |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur le téléphone et fonctionnement hors ligne |
| `horloge/` | L’ancienne horloge digitale |

## Essayer sur ordinateur

```bash
python3 -m http.server 8000
```

Puis ouvrez http://localhost:8000. Sans configuration Firebase, l’application est en **mode démo** : les données restent dans le navigateur. Le bouton « Essayer avec des données d’exemple » remplit une communauté fictive.

## Mettre en ligne (pour jouer avec vos amis)

### 1. Créer la base de données Firebase (gratuit)

1. Allez sur https://console.firebase.google.com et créez un projet (par exemple `tie-break`). Google Analytics n’est pas nécessaire.
2. **Build → Authentication → Get started → Sign-in method** : activez **Anonymous** (Anonyme). Chaque téléphone reçoit ainsi un identifiant sans créer de compte.
3. **Build → Firestore Database → Create database** : choisissez une région en Europe (`eur3`) et le **mode production**.
4. Dans Firestore, onglet **Rules** : remplacez le contenu par celui du fichier `firestore.rules`, puis cliquez sur **Publish**.
5. **Paramètres du projet (roue dentée) → Vos applications → icône Web `</>`** : enregistrez une application et copiez l’objet `firebaseConfig` dans `firebase-config.js`, à la place de `null`.

### 2. Héberger l’application avec GitHub Pages (gratuit)

1. Sur GitHub, dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, choisissez la branche et le dossier `/ (root)`.
2. Au bout d’une minute, l’application est disponible à l’adresse `https://<votre-pseudo>.github.io/<nom-du-dépôt>/`.
3. Dans Firebase, **Authentication → Settings → Authorized domains** : ajoutez `<votre-pseudo>.github.io`.

### 3. Installer sur le téléphone

- **iPhone (Safari)** : ouvrez l’adresse, touchez **Partager** puis **Sur l’écran d’accueil**.
- **Android (Chrome)** : ouvrez l’adresse, menu **⋮** puis **Installer l’application**.

## Utilisation

1. Créez votre communauté avec votre prénom et votre classement.
2. **Classement → + Ajouter un joueur** pour chaque ami.
3. **+ Match** après chaque partie : choisissez Simple ou Double, la date, les joueurs (deux équipes de deux en double) et le score de chaque set. Un super tie-break se note comme un set (10-7).
4. Touchez un joueur puis **Envoyer son invitation** : il reçoit un lien personnel qui l’attache directement à son profil. Le bouton **Inviter** en haut envoie un lien général : la personne choisit alors son profil ou en crée un.

Si un ami change de téléphone, le créateur de la communauté peut ouvrir son profil et le **détacher**, puis lui renvoyer son invitation.

## Limites connues

- Toute personne qui possède le lien de la communauté peut y noter des matchs : partagez-le seulement avec vos amis.
- Un profil est lié au navigateur du téléphone. Effacer les données du navigateur oblige à se faire renvoyer son invitation.
- Seule la personne qui a noté un match peut le supprimer.
