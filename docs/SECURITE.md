# Sécurité d'Atelier Gribouille

Périmètre (mis à jour le 27 novembre 2026) : site statique publié sur Cloudflare Pages
(`ateliergribouille.art`, domaine chez Spaceship, DNS chez Cloudflare), application dans le
navigateur, comptes, base et stockage Supabase, fonctions serveur Supabase (paiement Stripe, e-mails
Resend, partage, tableau de bord), mesure d'audience Umami, publication par GitHub Actions. Schéma de
l'ensemble : voir la page « Architecture » et `docs/HEBERGEMENT.md`.

## Verdict

Pas de faille bloquante (dernier audit complet : 27 novembre 2026, plus bas). Les dessins sont
traités dans le navigateur ; le serveur se limite à six fonctions qui vérifient chacune l'appelant
(compte connecté, administrateur avec double authentification, ou signature Stripe) ; aucun secret
dans le code ni dans l'historique Git ; règles d'accès par ligne et par dossier côté Supabase ; les
prix sont recalculés par le serveur. Il reste quelques réglages à faire dans les tableaux de bord
Supabase et GitHub (liste plus bas).

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
- **Workflows GitHub** : permissions minimales (`contents: read` partout), publication seulement
  après les tests et seulement depuis la branche de production, garde sur la pointe de branche
  (`deploy/verifier-pointe.sh`) pour empêcher un ancien run de redéployer une vieille version. Deux
  clés de publication, chacune dans son propre job : `CLOUDFLARE_API_TOKEN` (site) et
  `SUPABASE_ACCESS_TOKEN` (fonctions). Leurs outils (wrangler, CLI Supabase) sont installés à une
  version exacte avec leurs dépendances verrouillées (`deploy/outils-*/package-lock.json`, `npm ci`).

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

- Depuis le passage à Cloudflare Pages (22 novembre 2026), `_headers` applique HSTS,
  `frame-ancestors 'self'` (aucun autre site ne peut afficher celui-ci dans un cadre), `X-Frame-Options`, `nosniff`, etc. La CSP complète est en balise
  `<meta>` sur chaque page (testée par `tests/csp.spec.js`) ; `style-src` garde `'unsafe-inline'`.
- Le jeton de session Supabase est gardé dans `localStorage` (comportement par défaut de la
  librairie) : une injection de script le lirait. C'est pourquoi l'échappement HTML ci-dessus
  compte, et pourquoi aucune extension tierce n'est chargée en dehors d'Umami.
- jsPDF 4.2.1 et pdf.js 3.11 (`isEvalSupported: false`) tournent uniquement dans le navigateur de
  l'utilisateur, sur ses propres fichiers.
- L'ouverture d'un lien de partage (« voir », sans compte) n'est pas limitée en fréquence : elle ne
  coûte qu'une lecture d'index (jeton unique) et ne renvoie que le nom, la vignette et un prénom.

## Audit d'octobre 2026 (panier, réouverture automatique)

Corrigé :
- **Suppression du compte** : les projets Supabase récents interdisent d'effacer les fichiers du
  stockage en SQL ; `delete_account()` échouait ou laissait les images. L'application efface
  maintenant elle-même compositions, exports et fichiers restants (API Storage, sous-dossiers
  compris) avant d'appeler `delete_account()`, qui ne supprime plus que le compte
  (`supabase/schema.sql` mis à jour ; l'ancienne version reste compatible, il n'y a plus rien à
  effacer). Test : le faux Supabase ne supprime plus les fichiers lui-même.
- **Statistiques** : Umami n'enregistre plus la partie « ?… » des adresses (codes de connexion au
  retour d'un lien e-mail) ; le rapport d'erreur à copier ne la contient plus non plus.
- **Panier** : relu du navigateur, chaque article est vérifié (produit, finition, taille, identifiant)
  et son prix recalculé d'après le catalogue à chaque affichage et à la commande (un prix modifié
  à la main dans `localStorage` n'a pas d'effet) ; quantité entière de 1 à 20 ; un article
  invalide est écarté sans bloquer le panier. Le rôle d'un dessin relu d'une sauvegarde est
  vérifié contre la liste des rôles.

À faire côté réglages (hors du code) :
- **Supabase → Authentication → URL Configuration** : ne garder que
  `https://ateliergribouille.art/**` dans les adresses de retour autorisées en production
  (retirer `adrienterras.github.io/**` et les `localhost`) ; utiliser un projet séparé pour les essais.
- **Umami** : le script est chargé sans version figée depuis cloud.umami.is, sur la même origine que
  la session ; l'auto-héberger (copie figée dans `vendor/`) puis poser une CSP en `<meta>`
  (`script-src 'self'`, `connect-src` limité à Supabase et Umami, `img-src 'self' data: blob:`,
  `worker-src 'self' blob:`).
- **GitHub Actions** : figer les actions sur un SHA de commit plutôt que `@v4`.
- **jsPDF** : passer à une version récente (dénis de service connus, sans impact sur les données
  d'autrui).
- Une ancienne branche (`d12bf53`, projet Firebase « tie-break ») contient une configuration Firebase
  publique : restreindre cette clé aux domaines autorisés dans Google Cloud.

## Audit du 10 octobre 2026 (site complet)

Relu : tout le code publié (atelier, accueil, tarifs, article), le schéma Supabase, les
workflows et l'historique Git complet (toutes branches). Aucune faille exploitable trouvée :
- aucun secret (`service_role`, `sb_secret`, clés d'API, jetons GitHub, clés privées) dans le code
  ni dans l'historique ; seule la clé publique Supabase est présente, comme prévu ;
- toutes les insertions HTML de données (noms, titres, vignettes, panier, comptes) passent par
  `esc()` ou `safeData()`; les vignettes viennent du canvas ;
- règles d'accès par ligne et par dossier inchangées et correctes ; supabase-js 2.117 (à jour).

Corrigé :
- **Politique de sécurité du contenu (CSP)** en balise `<meta>` sur l'atelier, l'accueil,
  les tarifs, l'article et la page de confidentialité : scripts limités au site et à Umami (aucun
  script inline sauf celui de la page de confidentialité, autorisé par son empreinte), connexions
  limitées au site, à Supabase et à Umami, images au site, aux data/blob et aux avatars Google,
  polices et feuilles de style au site seul (les polices sont auto-hébergées, voir plus bas),
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Une injection de script ne
  s'exécuterait plus et ne pourrait rien envoyer ailleurs : c'est la protection qui manquait au
  jeton de session gardé dans `localStorage`. Test `tests/csp.spec.js` : politique présente partout,
  empreintes à jour, aucun parcours (import PDF, export PDF, guide) ne la viole, et un script
  injecté est bien bloqué.
- **jsPDF 2.5.1 → 4.2.1** : corrige les dénis de service connus (CVE-2025-29907, CVE-2025-57810) et
  les failles corrigées depuis dans les versions 3 et 4. Le PDF produit est identique (mêmes opérations de
  dessin, rotations comprises, comparées entre les deux versions).
- **Actions GitHub figées sur leur commit** (SHA) au lieu d'une étiquette `@v4` qu'on pourrait
  déplacer.
- **`delete_account()`** : droit d'exécution retiré au rôle `anon` (la fonction refusait déjà ces
  appels ; à rejouer dans l'éditeur SQL de Supabase, une ligne).

Vérifications à faire en ligne (impossibles depuis l'environnement de l'audit, sans accès réseau
au site ni à Supabase) :
1. Après la mise en ligne, ouvrir l'atelier, se connecter, sauvegarder, rouvrir une composition :
   la console du navigateur ne doit afficher aucune erreur « Content Security Policy ». Vérifier
   dans Umami que les visites arrivent toujours.
2. Avec la clé publique seule, `GET https://yfrerlyndrpfgerkbkyr.supabase.co/rest/v1/compositions?select=id`
   doit répondre `[]` (aucune ligne visible sans connexion), de même pour `exports`.
3. Les réglages listés plus haut (adresses de retour, longueur des mots de passe, protection
   contre les mots de passe fuités, double authentification GitHub / Spaceship / Umami).

Restent acceptés : pdf.js 3.11 (la faille connue CVE-2024-4367 est neutralisée par
`isEvalSupported: false`) ; le script Umami chargé depuis cloud.umami.is sans version figée ;
pas d'en-têtes HTTP (`frame-ancestors`, HSTS) possibles sur GitHub Pages ; la commande par e-mail
reprend le total calculé dans le navigateur, que le client peut modifier dans son e-mail :
toujours recalculer le prix d'après le catalogue avant d'encaisser.

## 11 octobre 2026 : correctif Umami

La CSP du 10 octobre bloquait la mesure d'audience : le script d'Umami Cloud envoie ses données à
`gateway.umami.is` (endpoint changé par Umami en 2026 ; `api-gateway.umami.dev` est l'ancien),
absent de `connect-src`. Ajouté sur les six pages ; `tests/csp.spec.js` vérifie désormais que
`cloud.umami.is` (script) et `gateway.umami.is` (données) sont autorisés. Si Umami change encore
d'adresse, le symptôme est le même (0 visite, erreur « Content Security Policy » dans la console)
et la correction tient en une ligne par page.

## 14 octobre 2026 : collecte des retouches (option)

- Nouveau point d'écriture anonyme : table et bucket `retouches`, insert seulement (`anon`,
  `authenticated`), aucune lecture ni suppression depuis le navigateur ; chemin contraint par
  expression régulière, 4 Mo par fichier, JPEG/PNG/JSON seulement, fiche JSON limitée à 8 Ko.
- Risque accepté : un tiers muni de la clé publique peut y déposer des fichiers (comme sur tout
  point d'écriture anonyme) ; à surveiller dans Storage, quota du projet en garde-fou. Si l'abus
  survient, restreindre la politique à `authenticated` ou passer par une fonction Edge avec limite
  de débit.
- Rien n'est envoyé sans la case cochée ; la case est décochée par défaut et son état n'est gardé
  que dans le navigateur (`atelier.partage-decoupes`).

## 22 octobre 2026 : audit, retrait du partage des retouches

- La case « Aider à améliorer le détourage » était cochée par défaut (consentement non valable) :
  d'abord décochée par défaut, puis l'option retirée entièrement.
- Le point d'écriture anonyme `retouches` (table, bucket, politiques) est supprimé dans
  `supabase/schema.sql` : plus personne ne peut y déposer de fichiers ni fausser l'apprentissage.
- Le workflow « Apprentissage de la découpe » (clé `service_role` exposée dans le même job que
  `npm ci`, droit d'écriture sur le dépôt) et `tools/apprendre.js` sont retirés ; le secret
  `SUPABASE_SERVICE_ROLE_KEY` est à supprimer des secrets du dépôt.
- Restent, connus et mineurs : script Umami chargé depuis son serveur, pas d'en-têtes HTTP sur
  GitHub Pages (CSP en balise meta), pas de quota de stockage par compte, total des commandes
  calculé dans le navigateur (à vérifier avant d'encaisser). Les œuvres gardées dans le navigateur
  ne sont rattachées à aucun compte (appareil partagé : visibles par le suivant).

## Audit du 12 novembre 2026 (vue administrateur, comptes, pages du site)

Relu : tout le code publié, le schéma Supabase, les workflows, les bibliothèques et l'historique Git
complet. Aucun secret, aucune fuite entre comptes. Corrigé :
- **Œuvre relue piégée** : l'affirmation plus haut (« toutes les insertions passent par `esc()` »)
  n'était plus vraie. Trois valeurs d'une œuvre relue (compteurs de la composition, réglages de couleur
  d'un dessin, source de la taille du scan) étaient insérées telles quelles ; or la ligne d'un compte
  peut être écrite à la main avec son jeton, et l'administrateur rouvre celles des autres. Sans script
  possible (CSP), du HTML pouvait s'afficher dans la session de l'administrateur. Toute œuvre relue est
  maintenant nettoyée (`cleanSaved` : nombres bornés, textes vérifiés) et les trois insertions sont
  échappées. Test `save.spec.js` « Œuvre relue piégée ».
- **Administrateur par rôle serveur** : `is_admin()` lit `app_metadata.atelier_role = 'admin'`, que
  seul le serveur peut écrire, au lieu de l'e-mail du jeton (qui ne tenait qu'à la confirmation des
  e-mails). L'adresse n'est plus dans le code de l'atelier. À rejouer : section « Administration » de
  `supabase/schema.sql`, puis se reconnecter.
- **CSP** : images limitées à `lh3.googleusercontent.com` (photos des comptes Google) au lieu de tous
  les domaines `*.googleusercontent.com` ; ancien domaine d'Umami retiré. La photo de profil n'est
  acceptée que de cet hôte, dans l'atelier comme sur l'accueil.
- **Panier** : seules les clés du catalogue sont acceptées (plus « constructor »), tailles de l'œuvre
  bornées de 5 à 400 cm (le prix du kit en dépend).
- **Publication** : les dossiers d'outils (`/tools`, `/atelier/tools`, scripts des dessins d'exemple)
  ne sont plus publiés.

À faire par l'éditeur (hors du code) :
- protéger la branche publiée (ni force-push ni suppression) et limiter l'environnement
  `production` (anciennement `github-pages`) à cette branche ;
- faire tourner la clé `service_role` dans Supabase (elle a été présente une semaine dans un workflow
  en octobre), puis supprimer le secret `SUPABASE_SERVICE_ROLE_KEY` du dépôt ;
- les réglages Supabase, GitHub, Spaceship et Umami déjà listés plus haut.

Restent connus : script Umami chargé depuis son serveur, pas de quota de stockage par compte côté
serveur, pas de protection contre l'affichage en cadre (impossible en balise meta), total des
commandes à recalculer avant d'encaisser.

## 15 novembre 2026 : suppressions fiables

Relevé par une relecture externe : la suppression d'une œuvre ou d'un export effaçait les fichiers sans
vérifier le résultat, puis la fiche ; un échec réseau laissait les dessins stockés alors que l'œuvre
avait disparu de l'écran (fichiers restés privés, balayés à la suppression du compte). Désormais la
fiche n'est supprimée que si les fichiers le sont, et sa disparition est vérifiée (une suppression
refusée par les règles du serveur ne renvoie pas d'erreur) ; sinon « Suppression impossible », l'œuvre
reste et la suppression se relance. Test `account.spec.js` « suppression : si l'effacement des
fichiers échoue ».

## 16 novembre 2026 : corrections de l'audit complet

- **Publication** : `pages.yml` appelle la suite de tests (`tests.yml`, `workflow_call`) et ne
  publie que si elle passe ; publication manuelle limitée à la branche de production ; droits par job.
- **Mesure d'audience** : plus aucun script tiers ; la page envoie elle-même ses compteurs à Umami
  (`script-src` réduit à `'self'` et aux empreintes, vérifié par `tests/csp.spec.js`).
- **Administrateur** : double authentification exigée par le serveur (`aal2` dans `is_admin()`),
  lecture par `admin_works` / `admin_open` seulement, journal `admin_log`, fichiers d'un compte ouverts
  une heure après l'ouverture d'une de ses œuvres, ni panier ni exports ; rôle donné par identifiant
  (plus d'adresse e-mail dans le schéma). Voir docs/COMPTES.md.
- **Limites serveur** : plafonds de lignes par compte (déclencheurs), taille des champs (contraintes),
  nombre et volume de fichiers par dossier (règle restrictive du stockage).
- **Comptes** : vérification anti-robot Turnstile prête (activée par `captchaSiteKey`) ; lien de
  connexion sans création de compte, même réponse pour une adresse inconnue.
- **Commandes** : les œuvres commandées ne sont plus purgées et gardent le détail de la commande.
- **Appareil partagé** : « Se déconnecter et effacer cet appareil » ; la suppression du compte
  efface aussi l'appareil.
- **Métadonnées des photos** (signalé par une contre-expertise) : une image importée était gardée
  telle quelle, avec sa position GPS, sa date et son appareil. `stripMetadata` (app.js) les retire
  avant tout enregistrement, sans recompression ; seuls l'orientation et la résolution sont gardées
  dans un EXIF minimal (`tests/metadonnees.spec.js`).

Le schéma a été rejoué deux fois sur une base PostgreSQL qui imite Supabase (rôles, `auth.jwt()`,
`storage.objects`) : lecture refusée sans `aal2`, journal écrit, fichiers ouverts après l'ouverture
seulement, exports jamais, plafonds atteints refusés.

## Audit du 27 novembre 2026 (paiement, commandes, partage, publication)

Trois relectures en parallèle (serveur et base, navigateur, publication et dépendances), chaque point
vérifié dans le code. Rien de critique : prix recalculés par le serveur, commandes inaccessibles d'un
compte à l'autre, double remboursement impossible, signature Stripe vérifiée, aucune injection de code
trouvée (y compris par une œuvre partagée ou la vue administrateur), aucun secret dans l'historique.
Corrigé :

- **Publication** : la CLI Supabase était prise à la dernière version « 2.x » à chaque déploiement,
  avec une clé qui ouvre tout le compte Supabase ; wrangler, figé, gardait des dépendances libres.
  Désormais versions exactes, dépendances verrouillées, et un job par clé.
- **Partage** : le jeton était tiré par le navigateur, sans unicité : un compte pouvait recopier le
  jeton d'un autre sur sa propre œuvre et la faire apparaître à sa place. Le jeton est maintenant
  tiré par la fonction `partage` (action « creer », fonction SQL `share_set`), unique (index
  `compositions_share_token_key`, qui rend aussi la recherche d'un lien instantanée) et jamais
  valable plus de 30 jours, même si une date plus lointaine est écrite dans la fiche.
- **Recevoir une œuvre** contournait la limite de 3 Go et 5 000 fichiers par compte (copie faite avec
  la clé serveur) : la fonction vérifie la place avant (`share_room`) et limite à 10 réceptions par
  heure.
- **Annulation** : Stripe injoignable au moment du remboursement laissait la commande « annulée »
  sans remboursement. Le statut est maintenant rétabli ; un nouvel essai garde la même clé
  d'idempotence.
- **Notification Stripe en double** : traitée une seule fois (e-mails non doublés).
- **Page de paiement** : l'atelier ne suit plus que l'adresse de Stripe (ou une page du site).
- **Messages d'erreur** : les fonctions ne renvoient plus le détail technique au navigateur ; il va au
  journal `site_events`, lu par le tableau de bord de l'administrateur.
- **Commandes** : plus de modification directe depuis le navigateur (le droit `update` est retiré) ;
  une commande en préparation ne revient plus à « Payée » (cela rouvrait l'annulation au client).
- **Vérification anti-robot** : régler `captchaSiteKey` sans autoriser Cloudflare dans la politique
  de sécurité de chaque page de connexion bloquait l'inscription ; les tests le refusent maintenant.
- Cette page était restée sur l'architecture d'octobre (GitHub Pages, « aucun serveur ») : mise à jour.

Restent à décider : demander confirmation avant de recevoir une œuvre dont le lien a été ouvert sans
compte sur l'appareil ; données laissées sur l'appareil après « Se déconnecter » simple.

À faire dans les réglages : mettre `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` et
`SUPABASE_ACCESS_TOKEN` dans les secrets de l'environnement GitHub « production », limité à la branche
de production, puis supprimer leurs copies au niveau du dépôt ; une clé Supabase limitée à ce projet si
possible ; supprimer l'ancien workflow Firebase de la branche `main` et le secret
`FIREBASE_SERVICE_ACCOUNT` s'ils ne servent plus.

## Rejouer l'audit

- `git log --all -p -S"service_role"` et `-S"sb_secret"`, puis les motifs `sk_live`, `rk_live`,
  `whsec_`, `re_`, `sbp_`, `ghp_`, `github_pat_` : aucun secret dans l'historique.
- `grep -n "innerHTML" collage/js/app.js` : chaque interpolation de donnée passe par `esc()`.
- `npm test` dans `collage/` : 98 tests, dont l'absence d'erreur de page et `tests/csp.spec.js`.

Ajouts du même jour (gestion des commandes par l'équipe) : la page `gestion-commandes.html` n'affiche
que ce que le serveur renvoie au rôle `tableau` ou `admin` avec double authentification ; les vignettes
des œuvres passent par `staff_order_thumbs()` (œuvres d'une commande seulement) ; les fichiers HD
d'impression sont dans le bucket privé `impressions` (PDF seulement, 200 Mo), politique « impressions:
staff » : `is_staff()` et dossier d'une commande existante, aucun accès client ni anonyme, téléchargement
par lien signé de 10 minutes. Factures : fonction `facture` (connexion requise ; la commande du compte,
ou l'équipe avec double authentification ; commande payée), lien renvoyé seulement s'il mène en https chez
Stripe, revérifié par la page avant d'y aller. Historique des commandes (`order_log`) : écrit par les fonctions
serveur et par `order_log_hd()` (équipe seulement, auteur = `auth.uid()`), lu par `is_staff()` seulement,
aucune écriture directe depuis le navigateur. Fichier HD en coulisse : l'atelier est ouvert dans un cadre
du même site (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`) ; les messages ne sont acceptés
que de la même origine et du cadre ouvert par la page.

## Polices auto-hébergées (novembre 2026)

Montserrat et Playfair Display ne viennent plus de Google Fonts : le site les sert lui-même
(`collage/fonts/`, publié sous `/atelier/fonts/`, avec `fonts.css` et les licences SIL OFL 1.1).
Aucune page n'appelle plus `fonts.googleapis.com` ni `fonts.gstatic.com`, et la CSP ne les autorise
plus : l'adresse IP des visiteurs n'est plus transmise à Google pour afficher les polices (risque
RGPD relevé par la jurisprudence allemande de 2022 et par la CNIL). Seuls les sous-ensembles latin
et latin étendu sont gardés (français, anglais), soit six fichiers woff2, environ 200 Ko. Test
`tests/fonts.spec.js` : polices chargées sur chaque page, aucune requête vers Google. L'artefact
d'aperçu (`tools/artefact.py`), hébergé ailleurs et qui n'accepte que Google Fonts comme feuille
externe, garde le lien Google : il n'est pas le site public.
