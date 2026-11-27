#!/usr/bin/env bash
# Avant chaque publication (.github/workflows/pages.yml) : seule la branche de production se publie,
# et seulement son dernier commit (un run relancé sur un ancien commit ne doit pas écraser un site plus
# récent, ni des fonctions plus récentes).
set -euo pipefail
PROD="claude/children-drawings-art-app-kr5f77"
if [ "${GITHUB_REF_NAME:-}" != "$PROD" ]; then
  echo "::error::Seule la branche de production se publie (ici : ${GITHUB_REF_NAME:-?})."
  exit 1
fi
git fetch --quiet origin "$PROD"
tip="$(git rev-parse "origin/$PROD")"
if [ "$tip" != "$GITHUB_SHA" ]; then
  echo "::error::Ce run concerne ${GITHUB_SHA:0:7} mais la branche est à ${tip:0:7} : déploiement refusé pour ne pas revenir en arrière. Relancez le run du dernier commit."
  exit 1
fi
