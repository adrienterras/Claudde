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

## Administration

Le compte `adrien@terras.me` voit les œuvres de tous les comptes, en lecture seule, dans
« Toutes les œuvres » (sous Mes œuvres, visible pour ce compte seulement), groupées par e-mail.
« Ouvrir une copie » rouvre l'œuvre dans l'atelier comme une copie : elle rejoint le compte de
l'administrateur au premier changement ; l'original n'est ni modifié ni effacé. Côté serveur
(`supabase/schema.sql`, section « Administration ») : la fonction `is_admin()` compare l'e-mail du
jeton signé par Supabase à cette adresse, les règles « admin reads all » lui ouvrent la lecture des
lignes `compositions` et des fichiers du bucket `drawings`, et `admin_owners(ids)` lui rend les
e-mails des propriétaires. Les exports et le panier des autres comptes ne sont pas concernés. Pour
changer l'adresse : la fonction `is_admin()` dans le SQL (le serveur), et `adminEmail` dans
`collage/config.js` (la vue ; par défaut la même adresse). La politique de confidentialité mentionne
cet accès.

## E-mails envoyés aux utilisateurs (expéditeur et modèles)

Par défaut, Supabase envoie ses e-mails (confirmation d'inscription, lien de connexion, mot de passe
oublié, changement d'adresse) depuis « Supabase Auth », en anglais, avec un quota de quelques
e-mails par heure. Pour qu'ils partent d'Atelier Gribouille, en français :

1. **Un service d'envoi (SMTP)** au nom de votre domaine. Deux choix simples et gratuits au volume
   de l'atelier : [Resend](https://resend.com) (3 000 e-mails/mois ; SMTP `smtp.resend.com`,
   port 465, utilisateur `resend`, mot de passe = la clé API) ou [Brevo](https://www.brevo.com)
   (300 e-mails/jour ; SMTP `smtp-relay.brevo.com`, port 587, identifiants donnés dans
   « SMTP & API »). Dans le service choisi, ajoutez le domaine de l'adresse d'envoi
   (`atelier-gribouille.com` pour `bonjour@atelier-gribouille.com`) et créez chez votre
   hébergeur DNS les enregistrements qu'il indique (SPF, DKIM, éventuellement DMARC) : sans eux,
   les e-mails finiraient en indésirables.
2. **Supabase → Project Settings → Authentication → SMTP Settings** : activez « Enable Custom
   SMTP », renseignez Sender email `bonjour@atelier-gribouille.com`, Sender name
   `Atelier Gribouille`, puis l'hôte, le port, l'utilisateur et le mot de passe du service.
   Enregistrez. (La limite d'envoi, « Rate limits », peut alors être relevée, par exemple à 60/h.)
3. **Supabase → Authentication → Email Templates** : pour chacun des quatre modèles, collez
   l'objet et le corps donnés dans `supabase/emails/` (en tête de chaque fichier : l'onglet
   Supabase visé et l'objet conseillé) :
   - Confirm signup → `confirmation.html`
   - Magic Link → `lien-magique.html`
   - Reset Password → `mot-de-passe.html`
   - Change Email Address → `changement-email.html`
   Les variables `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` sont celles de
   Supabase, à laisser telles quelles. Envoyez-vous un e-mail de test (créer un compte avec une
   autre adresse, ou « mot de passe oublié ») pour vérifier l'expéditeur et le rendu.

## Mise à jour du schéma

Le fichier `supabase/schema.sql` est idempotent : après une évolution (par exemple l'ajout de la table
`exports`), ré-exécutez-le tel quel dans le SQL Editor. Les objets existants sont conservés.

## Le compte depuis le site

L'en-tête de l'accueil et de la page Tarifs porte un lien compte (`landing/compte.js`). Sans charger
Supabase, il lit dans le stockage local du navigateur la session que l'atelier y garde (même origine,
clé `sb-<projet>-auth-token`) : connecté, il affiche le prénom et mène à `atelier/?compte` (le panneau
Mon compte s'ouvre à l'arrivée) ; sinon « Se connecter » mène à `atelier/?connexion` (le panneau de
connexion s'ouvre). Rien n'est envoyé nulle part : c'est une simple lecture locale.

## Ce qui demande un compte

Sans être connecté, on peut voir l'exemple et le manipuler (propositions, retouches, couleur du
fond). Importer ses propres dessins (fichiers, glisser-déposer, photo), télécharger, sauvegarder et
commander demandent d'être connecté : la fenêtre de connexion ou d'inscription s'ouvre, puis
l'action demandée reprend d'elle-même. Sans réglage Supabase dans `config.js`, aucune de ces
restrictions ne s'applique.

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

## Retouches de découpe partagées (retirées le 22 octobre 2026)

L'option « Aider à améliorer le détourage » et l'apprentissage hebdomadaire qui s'en servait ont été
retirés de l'atelier : ils ouvraient un point d'écriture anonyme dans Supabase et donnaient la clé
service à un workflow GitHub. Chaque utilisateur garde la découpe apprise de ses propres retouches,
dans son navigateur (`Extract.learnCut`). Côté Supabase, `supabase/schema.sql` supprime la table et
les politiques `retouches` ; le bucket se vide puis se supprime depuis le tableau de bord (Storage →
retouches). Le secret GitHub `SUPABASE_SERVICE_ROLE_KEY` n'a plus d'usage et doit être supprimé.

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
