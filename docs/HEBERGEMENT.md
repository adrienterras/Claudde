# Hébergement

Le site est fait de fichiers fixes : `deploy/preparer-site.sh` l'assemble dans `_site/` (l'accueil,
`landing/`, à la racine ; l'atelier, `collage/`, sous `/atelier/` ; la page de confidentialité aux
deux endroits ; les outils de fabrication retirés ; les adresses des scripts versionnées pour que les
navigateurs ne gardent pas une vieille version ; le fichier `_headers`). Le même script sert à
GitHub Pages et à Cloudflare Pages : les deux publient exactement le même site.

## Cloudflare Pages (recommandé : usage commercial autorisé, gratuit, en-têtes HTTP)

GitHub Pages n'est pas prévu pour un site commercial ; Cloudflare Pages l'accepte et applique en plus
les en-têtes de `_site/_headers` (HSTS, interdiction d'afficher le site dans un cadre, etc.), ce
qu'une balise `<meta>` ne peut pas faire.

### 1. La publication, après les tests

Le site n'est publié que si les tests passent : c'est le workflow `.github/workflows/pages.yml` qui,
après les tests, envoie `_site/` au projet Cloudflare Pages **`ateliergribouille`** (envoi direct,
`wrangler pages deploy`), en plus de GitHub Pages tant que celui-ci n'est pas coupé. Un projet relié
au dépôt (« Connect to Git ») publierait chaque envoi **sans** les tests : à ne pas utiliser (le
projet d'essai `claudde`, relié au dépôt, est à supprimer).

1. **Clé d'accès** : Cloudflare → icône du profil → **My Profile → API Tokens → Create Token →
   Create Custom Token**. Nom : `GitHub Actions — Pages`. Permissions : **Account → Cloudflare
   Pages → Edit**. Account Resources : votre compte. **Create Token**, puis copier la clé (affichée
   une seule fois).
2. **Identifiant du compte** : Cloudflare → **Workers & Pages** (ou la page du domaine) → **Account
   ID**, à droite.
3. **GitHub** → dépôt → **Settings → Secrets and variables → Actions → New repository secret** :
   `CLOUDFLARE_API_TOKEN` (la clé) et `CLOUDFLARE_ACCOUNT_ID` (l'identifiant).
4. Relancer la dernière publication (**Actions → Publier sur GitHub Pages → Run workflow**) : le
   projet `ateliergribouille` est créé au premier envoi ; le site est sur
   `https://ateliergribouille.pages.dev`. Le vérifier (accueil, `/atelier/`, connexion, import).

### 2. Le domaine (il reste enregistré chez Spaceship)

1. Cloudflare → **Add a domain** → `ateliergribouille.art` → offre **Free** ; vérifier l'import des
   enregistrements (messagerie : `MX`, SPF, DKIM, `SRV` autodiscover ; vérifications Google et
   GitHub). Ceux du site (`A` `185.199.108–111.153`, `AAAA` `2606:50c0:8000–8003::153`, `CNAME www`
   vers `….github.io`) en **DNS only**.
2. Chez **Spaceship** : DNSSEC désactivé (attendre que l'enregistrement `DS` ait disparu, plus une
   heure), puis **Nameservers → Custom** → les deux serveurs donnés par Cloudflare. Fait le
   22 novembre 2026 ; domaine **Active** le jour même.
3. Projet `ateliergribouille` → **Custom domains → Set up a custom domain** → `ateliergribouille.art` :
   Cloudflare propose de remplacer les `A` et `AAAA` de GitHub par son propre enregistrement, et crée
   le certificat HTTPS. Puis `www.ateliergribouille.art` (le `CNAME www` vers GitHub est remplacé).
4. Vérifier `https://ateliergribouille.art` et `/atelier/`, une connexion (Google et e-mail) et un
   import.
5. Ensuite seulement : GitHub → dépôt → **Settings → Pages** → retirer le domaine personnalisé, puis
   désactiver Pages ; retirer de `pages.yml` les étapes GitHub Pages ; supprimer le projet `claudde`.
   DNSSEC peut alors être réactivé dans Cloudflare (DNS → Settings), l'enregistrement `DS` donné
   étant à coller chez Spaceship.

Rien ne change pour Supabase (même domaine : les adresses de retour restent valables), ni pour
Umami, ni pour les e-mails.

## GitHub Pages (actuel)

`.github/workflows/pages.yml` lance `deploy/preparer-site.sh` puis publie `_site/` à chaque envoi
sur la branche de production.
