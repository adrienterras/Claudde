# Tableau de bord de l'administrateur

`https://ateliergribouille.art/tableau-de-bord.html` : l'état du site d'un coup d'œil, sur téléphone
comme sur ordinateur. Lien « Tableau de bord » dans le menu du compte (pastille en haut des pages du
site), visible seulement pour l'administrateur et l'équipe (rôle « tableau »).

## Ce qu'il montre

- **À surveiller** : commandes à préparer, dernière mise en ligne, erreurs serveur des dernières 24 h,
  e-mails non partis, paiement encore en mode test.
- **Ventes** : chiffre d'affaires du jour, sur 7 et 30 jours (commandes payées, sans les annulées et
  remboursées), panier moyen, une barre par jour, commandes par statut, commandes à préparer (la plus
  ancienne d'abord).
- **Activité** : comptes, œuvres enregistrées, liens de partage actifs, œuvres reçues, place de stockage
  utilisée, nouveaux comptes et œuvres par jour.
- **Audience** (Umami) : visiteurs et pages vues sur 7 et 30 jours, visiteurs par jour, pages les plus
  vues, provenance, pays.
- **Santé technique** : les 5 dernières mises en ligne (GitHub), les erreurs des fonctions serveur et
  les e-mails non partis des 7 derniers jours, l'état de Stripe, Resend, Umami et GitHub.

## Qui peut le voir

Les comptes qui ont le rôle **administrateur** (`admin`) ou **tableau** (`tableau`), écrits par le
serveur dans `app_metadata`, connectés avec la **double authentification** : la page demande le code de
l'application d'authentification, et l'active elle-même la première fois (code à scanner). C'est la
fonction serveur `tableau-de-bord` qui vérifie le rôle et la double authentification ; la page ne fait
qu'afficher ce que le serveur renvoie.

Le rôle `tableau` (l'équipe) ouvre ce tableau de bord et la **gestion des commandes** dans l'atelier
(onglet du compte → Commandes) : adresse de livraison, statuts, suivi, annulation et remboursement, et
l'ouverture des **œuvres commandées** pour les imprimer (fichiers de cette œuvre seulement, pendant une
heure, inscrit au journal `admin_log`). Il n'ouvre ni « Toutes les œuvres », ni les autres œuvres des
clients, ni leurs exports, et ne lève pas les quotas : cela reste au rôle `admin`. Le serveur le vérifie
(`is_staff()`, `staff_opened()`, fonctions `commande-statut` et `commande-annuler`).

**Donner le rôle `tableau`** à un compte (qui doit déjà exister : la personne crée son compte sur le
site et confirme son e-mail) : Supabase → SQL Editor → New query →

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"atelier_role": "tableau"}'::jsonb
where email in ('anastasia@ateliergribouille.art', 'stan@ateliergribouille.art');
```

→ Run. Le rôle compte à la prochaine connexion (se déconnecter puis se reconnecter). Pour le retirer :
`set raw_app_meta_data = raw_app_meta_data - 'atelier_role'`.

## Comment c'est fait

- `landing/tableau-de-bord.html`, `.css`, `.js` : la page.
- `supabase/functions/tableau-de-bord` : la fonction serveur. Elle lit la base par la fonction SQL
  `admin_dashboard()` (appelable seulement avec la clé serveur), puis GitHub et Umami si leurs clés sont
  dans les secrets. Une source qui ne répond pas n'empêche pas les autres.
- `public.site_events` (dans `supabase/schema.sql`) : le journal des erreurs des fonctions serveur et des
  e-mails non partis, écrit par les fonctions (`_shared/journal.js`), gardé 30 jours, inaccessible depuis
  le navigateur.

## Mise en place

1. **La base** : Supabase → SQL Editor → New query → coller tout `supabase/schema.sql` → Run (le fichier
   est idempotent : rien de ce qui existe n'est effacé). Cela crée le journal `site_events` et la fonction
   `admin_dashboard()`.
2. **La fonction** : publiée avec les autres à chaque mise en ligne (`.github/workflows/pages.yml`).
3. **Mises en ligne (GitHub), facultatif** : GitHub → photo du profil → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Nom : `Tableau de bord Atelier Gribouille` ; expiration : 1 an.
   - Repository access : **Only select repositories** → `adrienterras/Claudde`.
   - Permissions → Repository permissions → **Actions : Read-only** (rien d'autre).
   - Copier la clé, puis Supabase → Edge Functions → **Secrets** → Add new secret →
     nom `GITHUB_TOKEN_LECTURE`, valeur : la clé.
4. **Audience (Umami), facultatif** : Umami Cloud → Settings → **API keys** → Create key → copier la clé,
   puis Supabase → Edge Functions → Secrets → `UMAMI_API_KEY`. (L'identifiant du site est celui de
   `collage/config.js` ; un autre site : secret `UMAMI_WEBSITE_ID`.)

Sans ces deux clés, le tableau de bord marche : ces deux parties disent simplement qu'elles ne sont pas
branchées. Aucune clé ne se colle dans le code ni dans une conversation.
