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

## Limites et coûts

- Offre gratuite Supabase : 500 Mo de base, 1 Go de fichiers, 50 000 utilisateurs actifs par mois.
  Une composition pèse 1 à 3 Mo par dessin en haute définition, un export JPEG 300 dpi 5 à 20 Mo :
  comptez une vingtaine de compositions complètes avec leurs exports dans l'offre gratuite, puis
  l'offre Pro (25 $/mois, 100 Go). Les utilisateurs peuvent supprimer leurs exports depuis l'app.
- Les e-mails de confirmation partent du serveur SMTP de Supabase, limité à quelques envois par heure :
  pour un vrai public, branchez un SMTP (Brevo, Postmark, Resend) dans Authentication → SMTP Settings.
- RGPD : données hébergées en UE si la région Europe est choisie ; la page `confidentialite.html`
  décrit les traitements et la suppression. Déclarez Supabase comme sous-traitant dans votre registre.
