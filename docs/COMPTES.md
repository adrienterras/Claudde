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

Le compte de l'éditeur voit les œuvres de tous les comptes, en lecture seule, dans
« Toutes les œuvres » (sous Mes œuvres, visible pour ce compte seulement), groupées par e-mail, par
pages de 60. « Ouvrir une copie » rouvre l'œuvre dans l'atelier comme une copie : elle rejoint le
compte de l'administrateur au premier changement ; l'original n'est ni modifié ni effacé.

Côté serveur (`supabase/schema.sql`, section « Administration », depuis le 16 novembre 2026) :

- l'administrateur est désigné par un rôle, `atelier_role = admin`, dans `app_metadata` (que seul le
  serveur peut écrire) **et** doit s'être connecté avec la **double authentification** (jeton de
  niveau `aal2`) : `is_admin()` vérifie les deux ;
- il ne lit plus les tables directement : la liste passe par `admin_works(p_from, p_count)` (avec
  l'e-mail des propriétaires), l'ouverture d'une œuvre par `admin_open(id)`, qui l'inscrit au
  journal `admin_log` (qui, quoi, quand ; lisible dans Table Editor, jamais depuis le navigateur) ;
- les fichiers d'un compte ne lui sont ouverts que dans l'heure qui suit l'ouverture d'une de ses
  œuvres, et jamais ses exports ; ni le panier ni les exports des autres comptes ne lui sont ouverts.

Dans l'atelier, la vue demande d'abord la double authentification : la première fois, « Activer la
double authentification » affiche un code à scanner avec une application (Google Authenticator,
Microsoft Authenticator, 1Password…) puis demande un premier code à 6 chiffres ; ensuite, à chaque
connexion, le code est redemandé. Si le téléphone est perdu : dans Supabase, Authentication → Users →
le compte → supprimer le facteur MFA, puis l'activer de nouveau depuis l'atelier.

Mise en place : réexécuter tout `supabase/schema.sql` dans l'éditeur SQL de Supabase (idempotent). Le
rôle se donne une fois, à la main, par l'identifiant du compte (Authentication → Users) :

```sql
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"atelier_role": "admin"}'::jsonb
  where id = '<identifiant du compte>';
```

Il prend effet à la connexion suivante. Pour le retirer : `- 'atelier_role'` au lieu de `|| …`. Une
œuvre rouverte est toujours nettoyée (`cleanSaved` : nombres forcés, textes vérifiés) : la ligne d'un
autre compte peut avoir été écrite à la main. La politique de confidentialité mentionne cet accès.

## Limites côté serveur

En plus de la limite de 15 œuvres et de la purge à 60 jours tenues par l'atelier (les œuvres
commandées ne sont jamais purgées et ne comptent pas dans les 15), le serveur pose des plafonds larges
qu'un script ne peut pas contourner : 300 lignes `compositions` et 1 000 exports par compte, 5 000
fichiers et 3 Go par dossier, taille des champs (nom, vignette, fiche). Le compte administrateur n'est
pas plafonné en nombre. Un dépassement renvoie « quota atteint ».

## Vérification anti-robot (option)

Pour bloquer les inscriptions en masse et l'épuisement du quota d'e-mails :

1. Cloudflare → Turnstile → Add widget : domaine `ateliergribouille.art`, mode « Managed ». Noter la
   clé du site (publique) et la clé secrète.
2. Donner la **clé du site** (publique) : elle va dans `collage/config.js`, `captchaSiteKey`, et la
   politique de sécurité de **chaque page où l'on se connecte** (`collage/index.html` et les pages de
   `landing/` qui chargent `compte.js`) doit autoriser `https://challenges.cloudflare.com`
   (`script-src` et `frame-src`). Les tests (`tests/csp.spec.js`) refusent la publication tant
   qu'une de ces pages ne l'autorise pas. Publier.
3. Ensuite seulement : Supabase → Authentication → Attack Protection → Enable Captcha protection →
   Cloudflare Turnstile, coller la **clé secrète**.

Dans cet ordre : sinon les connexions par mot de passe sont refusées le temps de la publication. Le
lien de connexion par e-mail ne crée plus de compte (`shouldCreateUser: false`) et répond de la même
façon pour une adresse inconnue.

## E-mails envoyés aux utilisateurs (expéditeur et modèles)

Par défaut, Supabase envoie ses e-mails (confirmation d'inscription, lien de connexion, mot de passe
oublié, changement d'adresse) depuis « Supabase Auth », en anglais, avec un quota de quelques
e-mails par heure. Pour qu'ils partent d'Atelier Gribouille, en français :

1. **Un service d'envoi (SMTP)** au nom de votre domaine. Deux choix simples et gratuits au volume
   de l'atelier : [Resend](https://resend.com) (3 000 e-mails/mois ; SMTP `smtp.resend.com`,
   port 465, utilisateur `resend`, mot de passe = la clé API) ou [Brevo](https://www.brevo.com)
   (300 e-mails/jour ; SMTP `smtp-relay.brevo.com`, port 587, identifiants donnés dans
   « SMTP & API »). Dans le service choisi, ajoutez le domaine de l'adresse d'envoi
   (`ateliergribouille.art` pour `contact@ateliergribouille.art`) et créez chez votre
   hébergeur DNS les enregistrements qu'il indique (SPF, DKIM, éventuellement DMARC) : sans eux,
   les e-mails finiraient en indésirables.
2. **Supabase → Project Settings → Authentication → SMTP Settings** : activez « Enable Custom
   SMTP », renseignez Sender email `contact@ateliergribouille.art`, Sender name
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

L'en-tête de toutes les pages du site (accueil, Tarifs, Idées, Photographier, À propos) porte une
pastille ronde (`landing/compte.js`) : l'icône de profil sans session ; la photo du compte (ou
l'initiale du prénom) une fois connecté, sans le prénom. À l'arrivée, rien n'est chargé : la page lit
seulement, dans le stockage local, la session que l'atelier y garde (même origine, clé
`sb-<projet>-auth-token`).

- **Non connecté** : la pastille ouvre, sur la page même, la fenêtre de connexion (Google, e-mail et
  mot de passe, création de compte, lien par e-mail, mot de passe oublié). On reste sur la page : le
  client Supabase (`atelier/vendor/supabase.js`) et le module des comptes de l'atelier
  (`atelier/js/account.js`) se chargent à ce moment-là, et la session est la même que dans l'atelier.
  Les retours de Google et des liens reçus par e-mail reviennent sur la page d'où l'on est parti
  (`?code=…`, échangé puis retiré de l'adresse) ; le lien « mot de passe oublié » ramène dans
  l'atelier, qui a le formulaire du nouveau mot de passe.
- **Connecté** : la pastille ouvre un menu, « Mon compte » (`atelier/?compte` : le tiroir du compte,
  ouvert en grand sur téléphone) et « Se déconnecter » (sur la page).

Les adresses de retour de Supabase (`https://ateliergribouille.art/**`) couvrent déjà toutes les pages.

## Ce qui demande un compte

Sans être connecté, on peut voir l'exemple et le manipuler (propositions, retouches, couleur du
fond), importer ses propres dessins (fichiers, glisser-déposer) et les photographier depuis
l'atelier. Enregistrer l'œuvre (l'icône Enregistrer, tout à gauche de la barre d'outils, ou
« Enregistrer cette œuvre » dans Propositions), télécharger, ajouter au panier et commander
demandent d'être connecté : la fenêtre de connexion ou d'inscription s'ouvre, puis l'action
demandée reprend d'elle-même. Sans réglage Supabase dans `config.js`, aucune de ces
restrictions ne s'applique.

## L'œuvre en cours dans le compte

Connecté, l'œuvre en cours (le brouillon gardé dans le navigateur) est aussi envoyée dans le compte,
une quinzaine de secondes après le dernier changement : une ligne `compositions` marquée `draft`
(une seule par compte, remplacée à chaque envoi, jamais listée parmi les compositions) et le dossier
`<utilisateur>/brouillon/` du bucket `drawings`, où chaque image n'est envoyée qu'une fois ; les
fichiers qui ne servent plus sont effacés à l'envoi suivant. La liste « Mes œuvres » est relue dans le compte à l'arrivée, à
la connexion, au retour sur la page après au moins 30 secondes d'absence et à l'ouverture de « Mes
œuvres » (si sa dernière lecture date de plus de 30 secondes) : une œuvre faite sur un autre appareil
y apparaît sans recharger la page. Un envoi manqué (réseau coupé) repart de lui-même 30 secondes plus
tard, ou dès que la connexion revient ; un refus du serveur est dit tel quel sous le compte (« l'envoi
dans votre compte a échoué (…) »). Connecté, une œuvre qui n'est que sur l'appareil a un bouton
« Envoyer dans mon compte ». Ce que l'appareil sait du compte (`atelier.oeuvres-vues:<utilisateur>`)
est retenu compte par compte : une œuvre faite sans être connecté part dans le compte qui se connecte ;
une œuvre déjà enregistrée dans un autre compte de l'appareil y reste (appareil partagé), et la ligne
d'état le dit (« … et dans un autre compte : elle n'est pas copiée dans celui-ci »). Sur un autre appareil, connecté,
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

## Tableau de bord

L'administrateur a aussi un tableau de bord du site (ventes, activité, audience, santé technique) :
`tableau-de-bord.html`, réservé à son compte avec la double authentification. Voir
[TABLEAU-DE-BORD.md](TABLEAU-DE-BORD.md).
