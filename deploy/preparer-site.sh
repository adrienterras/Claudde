#!/usr/bin/env bash
# Assemble le site publié dans _site/ : l'accueil (landing/) à la racine, l'atelier (collage/) sous
# /atelier/. Utilisé par la publication GitHub Pages (.github/workflows/pages.yml) et par Cloudflare
# Pages (commande de build : « bash deploy/preparer-site.sh », dossier de sortie : « _site »).
# Version (cache des navigateurs) : premier argument, sinon le commit donné par GitHub ou Cloudflare.
set -euo pipefail
cd "$(dirname "$0")/.."
SHA="${1:-${GITHUB_SHA:-${CF_PAGES_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || date +%s)}}}"
V="${SHA:0:8}"
rm -rf _site
mkdir -p _site/atelier
cp -r collage/. _site/atelier/
rm -rf _site/atelier/README.md _site/atelier/tests _site/atelier/node_modules _site/atelier/package.json _site/atelier/package-lock.json _site/atelier/playwright.config.js _site/atelier/.gitignore
cp -r landing/. _site/
cp collage/confidentialite.html _site/confidentialite.html
# le module des commandes partagé avec le serveur (visuel encadré, suivi du colis) : la page Mes commandes
cp supabase/functions/_shared/commande.js _site/commande-partage.js
# (copiée à la racine : ses polices et ses icônes sont sous atelier/)
sed -i -E 's#(href=")(fonts|assets)/#\1atelier/\2/#g' _site/confidentialite.html
# pas d'outils de fabrication en ligne (scripts et données de travail : vidéo, artefact, dessins d'exemple)
rm -rf _site/tools _site/atelier/tools
rm -f _site/atelier/samples/*.py
# Chaque déploiement change l'adresse des scripts et des feuilles de style : les navigateurs
# (Safari surtout) ne gardent plus une vieille version en cache après une mise à jour.
sed -i -E "s#(src=\"(js/[a-z0-9-]+|config)\.js)\"#\1?v=$V\"#g; s#href=\"style\.css\"#href=\"style.css?v=$V\"#" _site/atelier/index.html
sed -i -E "s#(src=\"[a-z0-9-]+\.js)\"#\1?v=$V\"#g; s#(href=\"[a-z0-9-]+\.css)\"#\1?v=$V\"#g" _site/index.html _site/tarifs.html _site/idees-dessins-enfants.html _site/photographier-les-dessins.html _site/a-propos.html _site/commandes.html _site/tableau-de-bord.html
touch _site/.nojekyll
# En-têtes HTTP (Cloudflare Pages les applique ; GitHub Pages les ignore) : ce qu'une balise meta ne
# peut pas faire — interdire l'affichage du site dans le cadre d'un autre site (clickjacking), imposer
# le HTTPS au navigateur (HSTS), ne jamais deviner le type d'un fichier.
cat > _site/_headers <<'HEADERS'
/*
  Strict-Transport-Security: max-age=31536000
  X-Frame-Options: DENY
  Content-Security-Policy: frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()
HEADERS
echo "Site prêt dans _site/ (version $V)"
