# Audit de sécurité — octobre 2026

Périmètre : site statique (GitHub Pages, `ateliergribouille.art`), application dans le navigateur,
comptes et stockage Supabase, mesure d'audience Umami, workflows GitHub.

## Verdict

Pas de faille bloquante. L'architecture limite naturellement les risques : aucun serveur à nous,
pas de secret dans le code ni dans l'historique Git, règles d'accès par ligne et par dossier côté
Supabase, dessins traités dans le navigateur. Les points corrigés lors de l'audit sont listés plus
bas ; il reste quelques réglages à faire dans les tableaux de bord Supabase et GitHub.

## Ce qui est en place

- **Base de données** : `compositions` et `exports` sous Row Level Security, politique
  `auth.uid() = user_id` en lecture et en écriture ; un compte ne voit que ses lignes.
- **Fichiers** : bucket `drawings` privé, un dossier par utilisateur imposé par la politique de
  stockage, 50 Mo par fichier, types limités à JPEG / PNG / WebP / PDF.
- **Suppression de compte** : fonction `security definer` avec `search_path` fixé, refuse les
  appels non connectés, n'efface que les données de l'appelant ; `grant execute` limité aux
  utilisateurs connectés.
- **Clés** : seule la clé publique (publishable) est dans le code, ce qui est son usage prévu.
  Aucune clé `service_role`, aucun mot de passe de base dans le dépôt ni dans l'historique.
- **Mots de passe** : 10 caractères minimum, trois familles sur quatre, refus des suites, des mots
  courants et de l'e-mail ou du nom ; confirmation d'e-mail activée.
- **PDF importés** : pdf.js 3.11 avec `isEvalSupported: false`, ce qui neutralise CVE-2024-4367
  (exécution de script par une police malveillante).
- **Paramètres d'URL** : `?lang` est validé contre une liste fermée, `?exemple` est un simple
  drapeau ; pas de redirection construite à partir de l'URL.
- **Mesure d'audience** : sans cookie ni identifiant, aucune donnée de contenu transmise.
- **Workflows GitHub** : permissions minimales (`contents: read` ; `pages: write` et
  `id-token: write` uniquement pour la publication), garde sur la pointe de branche pour empêcher
  un ancien run de redéployer une vieille version.

## Corrigé lors de l'audit

- **Échappement HTML** : les noms de fichiers, titres proposés par Claude, noms de compositions et
  d'exports, et vignettes lus depuis la base sont désormais échappés avant insertion dans la
  page (`esc()`), et les vignettes n'acceptent qu'une data URL image. Avant, un nom de fichier
  contenant du HTML pouvait altérer l'affichage de sa propre session (auto-XSS, sans accès aux
  données d'un autre compte grâce au RLS).
- **Politique de référent** `strict-origin-when-cross-origin` sur toutes les pages : les liens
  sortants ne transmettent plus l'URL complète.
- **Workflow de tests** : permissions explicitement limitées à la lecture.

## À faire dans les tableaux de bord (non vérifiable depuis le code)

1. **Supabase → Authentication → URL Configuration** : Site URL `https://ateliergribouille.art`
   et liste des redirections limitée à `https://ateliergribouille.art/**`. C'est ce qui empêche un
   lien de connexion ou de réinitialisation de renvoyer ailleurs.
2. **Supabase → Authentication → Providers → Email** : longueur minimale 10 et caractères requis,
   pour que la règle du navigateur soit aussi appliquée côté serveur. Vérifier que les limites de
   débit (rate limits) par défaut sont actives.
3. **Supabase → Authentication → Attack protection** : activer la protection contre les mots de
   passe fuités (HaveIBeenPwned) si le plan le permet.
4. **GitHub** : authentification à deux facteurs sur le compte, protection de la branche
   déployée (pas de force-push), et revue des accès au dépôt.
5. **Spaceship** (DNS et domaine) et **Umami** : deux facteurs activés. Un DNS compromis
   redirigerait tout le site.
6. **Quotas** : aucun plafond par utilisateur sur le nombre de fichiers stockés. Surveiller
   l'usage du bucket (1 Go sur l'offre gratuite) et, si besoin, limiter le nombre de compositions
   par compte via une politique ou un déclencheur.

## Limites connues, acceptées

- GitHub Pages ne permet pas d'en-têtes HTTP personnalisés : pas de `Content-Security-Policy`
  ni de `HSTS` côté serveur (HTTPS forcé par GitHub Pages). Une CSP par balise `<meta>` est
  possible mais demande une liste précise des origines (Supabase, Umami, Google Fonts, blob:,
  data:, workers) et des tests : à envisager quand le site sera stable.
- Le jeton de session Supabase est gardé dans `localStorage` (comportement par défaut de la
  librairie) : une injection de script le lirait. C'est pourquoi l'échappement HTML ci-dessus
  compte, et pourquoi aucune extension tierce n'est chargée en dehors d'Umami.
- Google Fonts est chargé depuis les serveurs Google (adresse IP transmise). Toléré par la CNIL,
  mais auto-héberger les deux polices serait plus propre ; à faire si on veut un site sans
  aucun appel à Google.
- jsPDF 2.5 (création du guide) tourne uniquement dans le navigateur de l'utilisateur sur ses
  propres données ; les vulnérabilités connues (déni de service par expression régulière) n'ont
  pas d'impact ici.

## Rejouer l'audit

- `git log --all -p -S"service_role"` et `-S"sb_secret"` : aucun secret dans l'historique.
- `grep -n "innerHTML" collage/js/app.js` : chaque interpolation de donnée passe par `esc()`.
- `npm test` dans `collage/` : 41 tests, dont l'absence d'erreur de page.
