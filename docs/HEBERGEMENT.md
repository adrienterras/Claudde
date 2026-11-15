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

### 1. Le projet Pages

Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → dépôt
`adrienterras/Claudde`, puis :

| Réglage | Valeur |
|---|---|
| Production branch | `claude/children-drawings-art-app-kr5f77` |
| Framework preset | None |
| Build command | `bash deploy/preparer-site.sh` |
| Build output directory | `_site` |
| Root directory | (vide) |

**Save and Deploy**. Le site est alors en ligne sur une adresse `….pages.dev` : le vérifier
(accueil, `/atelier/`, connexion à un compte, import d'un dessin) avant de toucher au domaine.
Dans **Settings → Builds → Branch control**, on peut limiter les déploiements à la branche de
production (sinon chaque autre branche a sa propre adresse d'aperçu).

### 2. Le domaine (il reste enregistré chez Spaceship)

1. Cloudflare → **Add a domain** → `ateliergribouille.art` → offre **Free**. Cloudflare importe les
   enregistrements DNS existants.
2. **Vérifier** l'import, surtout la messagerie : enregistrements `MX`, et `TXT` (SPF `v=spf1…`, DKIM,
   DMARC), ainsi que celui de la vérification GitHub (`_github-pages-challenge-…`) et ceux d'un
   service d'envoi (Resend, Brevo). Les enregistrements qui pointent vers GitHub Pages (`A`
   `185.199.108–111.153`, `CNAME www` vers `….github.io`) seront remplacés à l'étape 4.
3. Chez **Spaceship** → le domaine → **Nameservers** → **Custom** → les deux serveurs donnés par
   Cloudflare. La propagation prend de quelques minutes à quelques heures ; pendant ce temps GitHub
   Pages continue de servir le site (le même), il n'y a pas de coupure.
4. Quand Cloudflare indique le domaine **Active** : projet Pages → **Custom domains** → **Set up a
   custom domain** → `ateliergribouille.art`, puis `www.ateliergribouille.art` (Cloudflare crée les
   enregistrements et le certificat HTTPS).
5. Vérifier `https://ateliergribouille.art` et `/atelier/`, une connexion (Google et e-mail) et un
   import.
6. Ensuite seulement : GitHub → dépôt → **Settings → Pages** → retirer le domaine personnalisé, puis
   désactiver Pages (ou supprimer le workflow `pages.yml`).

Rien ne change pour Supabase (même domaine : les adresses de retour restent valables), ni pour
Umami, ni pour les e-mails.

## GitHub Pages (actuel)

`.github/workflows/pages.yml` lance `deploy/preparer-site.sh` puis publie `_site/` à chaque envoi
sur la branche de production.
