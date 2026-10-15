# Comptes utilisateurs — mise en place

L'app reste un site statique : les comptes (Google, e-mail) et le stockage des compositions
passent par [Supabase](https://supabase.com), un service hébergé qui peut être choisi en Europe.
Sans réglage, l'app fonctionne sans compte (sauvegardes locales seulement).

## 1. Projet Supabase (10 min)

1. Créez un compte sur supabase.com, puis **New project** : nom `atelier-gribouille`, région
   **Europe (Frankfurt ou Paris)**, mot de passe de base de données à conserver.
2. Dashboard → **SQL Editor** → New query → collez le contenu de `supabase/schema.sql` → **Run**.
3. Dashboard → **Project Settings → API** : notez l'**URL du projet** et la clé **anon public**.
4. Dans le dépôt, remplissez `collage/config.js` avec ces deux valeurs, commitez, poussez. La clé anon
   est faite pour le navigateur : elle ne donne accès qu'à ce que les règles RLS autorisent.
5. **Authentication → URL Configuration** :
   - Site URL : `https://ateliergribouille.art`
   - Redirect URLs : `https://ateliergribouille.art/**` (couvre `/atelier/`), `https://adrienterras.github.io/**`,
     `http://localhost:8781/**` (tests), `http://localhost:8765/**` (développement).
6. **Authentication → Providers → Email** : laissez « Confirm email » activé (recommandé). Dans la
   même page, section **Password** : « Minimum password length » = **10** et « Required characters » =
   « Lowercase, uppercase letters, digits and symbols » (ou au moins la variante lettres + chiffres),
   pour que le serveur applique la même règle que l'app (10 caractères, trois familles sur quatre, pas
   de mot de passe courant, pas de lien avec l'e-mail ou le nom). Sur l'offre Pro, activez aussi
   « Prevent use of leaked passwords » (vérification HaveIBeenPwned).
   **Authentication → Email Templates** : traduisez les quatre modèles en français si vous le souhaitez
   (confirmation, lien magique, changement d'e-mail, réinitialisation).

## 2. Google (15 min)

1. [console.cloud.google.com](https://console.cloud.google.com) → nouveau projet « Atelier Gribouille ».
2. **APIs & Services → OAuth consent screen** : type Externe, nom de l'app, e-mail d'assistance,
   domaine autorisé `ateliergribouille.art`, liens vers `https://ateliergribouille.art/confidentialite.html`
   (politique de confidentialité) et conditions. Scopes : `email`, `profile`, `openid`.
   Publiez l'écran (« Publish app ») pour sortir du mode test, sinon seuls les testeurs déclarés peuvent se connecter.
3. **Credentials → Create credentials → OAuth client ID** : type « Web application ».
   - Authorized JavaScript origins : `https://ateliergribouille.art`
   - Authorized redirect URIs : `https://<ref>.supabase.co/auth/v1/callback` (l'URL exacte est affichée
     dans Supabase → Authentication → Providers → Google).
4. Copiez Client ID et Client Secret dans Supabase → Providers → **Google** → Enable → Save.

## 3. Vérifier

- Ouvrez le site, cliquez « Se connecter ou créer un compte » : les deux modes (Google, e-mail) doivent fonctionner.
- Sauvegardez une composition : elle apparaît avec la mention « mon compte » et se rouvre depuis un
  autre navigateur connecté au même compte.
- « Supprimer mon compte » efface les fichiers, les compositions et le compte (fonction `delete_account`).

## Mise à jour du schéma

Le fichier `supabase/schema.sql` est idempotent : après une évolution (par exemple l'ajout de la table
`exports`), ré-exécutez-le tel quel dans le SQL Editor. Les objets existants sont conservés.

## L'œuvre en cours dans le compte

Connecté, l'œuvre en cours (le brouillon gardé dans le navigateur) est aussi envoyée dans le compte,
une quinzaine de secondes après le dernier changement : une ligne `compositions` marquée `draft`
(une seule par compte, remplacée à chaque envoi, jamais listée parmi les compositions) et le dossier
`<utilisateur>/brouillon/` du bucket `drawings`, où chaque image n'est envoyée qu'une fois ; les
fichiers qui ne servent plus sont effacés à l'envoi suivant. Sur un autre appareil, connecté,
l'atelier rouvre cette œuvre de lui-même (ou la propose, si une œuvre plus récente jamais envoyée
est en cours sur place). Aucun changement de schéma : la ligne et le dossier suivent les règles
existantes (propriétaire seulement). Place : une photo de téléphone pèse 2 à 5 Mo ; une œuvre de
vingt photos occupe donc jusqu'à 100 Mo du quota de fichiers.

## Retouches de découpe partagées (option)

Dans l'atelier, une case « Aider à améliorer le détourage » (section Importer, décochée par défaut,
mémorisée dans le navigateur) envoie chaque retouche de découpe faite à la main : le dessin recadré
autour de la pièce (JPEG, 1200 px au plus), la découpe automatique et la découpe corrigée (PNG
noir et blanc) et une fiche JSON (taille de page, rectangles, réglages de découpe, type de page).
Jamais de nom de fichier, d'e-mail ni d'identifiant de compte ; les dossiers sont nommés par mois
et identifiant aléatoire. Le schéma crée la table `retouches` et le bucket `retouches` (4 Mo par
fichier, JPEG/PNG/JSON), tous deux **en écriture seule** pour `anon` et `authenticated` : rien n'est
lisible depuis l'application, seul le tableau de bord Supabase (ou la clé service) y accède.
Finalité : constituer, avec consentement, les exemples d'un futur modèle de détourage. Pour
l'exploiter : Storage → retouches, ou `select path, meta from retouches order by created_at`.
Effacement sur demande : supprimer le dossier et la ligne ; la fiche porte l'horodatage que
l'utilisateur peut citer.

### Apprentissage à partir des retouches

Le workflow « Apprentissage de la découpe » (`.github/workflows/apprentissage.yml`, chaque lundi
matin ou à la main depuis l'onglet Actions) exécute `collage/tools/apprendre.js` : il télécharge les
retouches avec la **clé service** de Supabase, rejoue la découpe de l'atelier sur chaque exemple
avec différents réglages, et retient ceux qui rapprochent le plus les découpes automatiques des
découpes corrigées. Résultat : `collage/js/cut-learned.js` (réglages d'office de l'atelier, appliqués
seulement à partir de 20 exemples et si le gain se confirme en validation croisée) et le rapport
`docs/APPRENTISSAGE.md`, validés et poussés par le workflow, ce qui republie l'atelier. Les exemples
restent dans l'espace temporaire du runner : jamais dans le dépôt.

Mise en place (une fois) : dans le dépôt GitHub, Settings → Secrets and variables → Actions → New
repository secret, nom `SUPABASE_SERVICE_ROLE_KEY`, valeur : la clé `service_role` du projet
(Supabase → Project Settings → API). Cette clé donne tous les droits sur le projet : elle ne doit
figurer nulle part ailleurs (ni dans le code, ni dans une conversation). L'URL du projet est lue
dans `collage/config.js` (ou le secret `SUPABASE_URL`).

## Limites et coûts

- Offre gratuite Supabase : 500 Mo de base, 1 Go de fichiers, 50 000 utilisateurs actifs par mois.
  Une composition pèse 1 à 3 Mo par dessin en haute définition (l'image d'origine `dN.jpg`, plus
  sa page de travail `dN-page.jpg` et la planche des masques de ses pièces `dN-decoupeK.png`,
  quelques centaines de Ko : c'est ce qui rend la réouverture indépendante de la découpe automatique
  du moment), un export JPEG 300 dpi 5 à 20 Mo :
  comptez une vingtaine de compositions complètes avec leurs exports dans l'offre gratuite, puis
  l'offre Pro (25 $/mois, 100 Go). Les utilisateurs peuvent supprimer leurs exports depuis l'app.
- Les e-mails de confirmation partent du serveur SMTP de Supabase, limité à quelques envois par heure :
  pour un vrai public, branchez un SMTP (Brevo, Postmark, Resend) dans Authentication → SMTP Settings.
- RGPD : données hébergées en UE si la région Europe est choisie ; la page `confidentialite.html`
  décrit les traitements et la suppression. Déclarez Supabase comme sous-traitant dans votre registre.
