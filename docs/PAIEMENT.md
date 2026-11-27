# Paiement en ligne (Stripe)

Depuis le 25 novembre 2026, « Commander » peut ouvrir une page de paiement Stripe au lieu de préparer
un e-mail de commande. Le paiement est **en essai** : il n'est actif que dans un onglet ouvert avec
`?paiement=test` (par exemple `https://ateliergribouille.art/atelier/?paiement=test`), et `?paiement=non`
l'arrête. Pour tous les autres visiteurs, rien ne change tant que la configuration ne l'active pas.

## Comment ça marche

1. Le client, connecté, ouvre son panier. Avec le paiement en ligne, le panier affiche la livraison et
   le total à payer.
2. « Commander » appelle la fonction Supabase **`commande`** (`supabase/functions/commande`). Elle :
   - relit le panier **dans le compte** ;
   - vérifie chaque article et **recalcule les prix et la livraison** (`supabase/functions/_shared/commande.js`) ;
   - crée la commande (table `orders`, statut « attente_paiement ») ;
   - renvoie l'adresse de la page de paiement Stripe, qui demande l'adresse de livraison (France
     uniquement) et le téléphone.
3. Après le paiement, Stripe ramène le client sur la page **Mes commandes** du site
   (`/commandes.html?commande=AG-…`), avec un merci ; la commande y paraît dès que Stripe a prévenu le
   serveur, et le panier se vide.
4. Stripe prévient la fonction **`stripe-webhook`**, qui vérifie la signature. Elle passe alors la
   commande en « payée », garde l'adresse et les coordonnées, et marque les œuvres « commandées » : elles
   sont figées, gardées hors de la purge et renommées `AG-… · titre`. Si la page de paiement est
   abandonnée, la commande passe en « abandonnée ».

Statuts : `attente_paiement`, `payee`, `en_preparation`, `expediee`, `livree`, `annulee`,
`abandonnee`. Ils avancent depuis l'atelier (voir « Suivre les commandes »). Le client les voit dans
**Mes commandes** est une page du site, hors de l'atelier : `/commandes.html` (`landing/commandes.html`,
`commandes.js`), ouverte par le menu du compte de l'en-tête, par « Mes commandes » dans Mon compte de
l'atelier, et par les e-mails (`commandes.html#AG-…` ouvre la commande). Chaque commande y a son détail,
dans une fenêtre : la frise d'avancement, les œuvres dans leur cadre, les prix, la livraison et
l'adresse, le suivi du colis, l'annulation tant qu'elle est payée. L'ancien lien de l'atelier
(`atelier/?commandes`) y mène. La gestion des commandes (administrateur) reste dans l'atelier :
`atelier/?gestion-commandes`, lien de l'e-mail « Nouvelle commande ».

**Recommander** : dans le détail d'une commande, chaque tableau imprimé a un bouton « Recommander ». Il
ouvre l'atelier (`atelier/?recommander=<œuvre commandée>&taille=…&finition=…&cadre=…&pp=…&bord=…`) :
l'œuvre commandée s'y rouvre (en copie) et la fenêtre « Recommander l'œuvre » s'ouvre avec l'article
commandé déjà choisi. Seuls la taille, l'encadrement, la bordure blanche et le passe-partout s'y changent
(ni fichier HD, ni couleur du cadre). L'article reprend les fichiers de l'œuvre dans le compte : rien
n'est renvoyé depuis l'appareil.

Livraison : **France métropolitaine uniquement** (Corse comprise). Stripe n'accepte que les adresses
en France (`COUNTRIES`) et le rappelle au-dessus de l'adresse (`SHIP_ZONE`).

## Mise en place (une fois)

1. **Table `orders`** : Supabase → SQL Editor → coller la section « Commandes payées en ligne » de
   `supabase/schema.sql` (à la fin du fichier) → Run.
2. **Clé Stripe** : Stripe (environnement de test) → Développeurs → Clés API → clé secrète
   `sk_test_…` → Supabase → Edge Functions → Secrets → `STRIPE_SECRET_KEY`. *(Fait le 25 novembre 2026.)*
3. **Déploiement des fonctions** : Supabase → Account preferences → Access Tokens → nouvelle clé →
   GitHub → dépôt → Settings → Secrets and variables → Actions → `SUPABASE_ACCESS_TOKEN`. Chaque
   publication (`pages.yml`) déploie alors `commande` et `stripe-webhook`. Sans cette clé, l'étape est
   sautée.
4. **Webhook** : Stripe (environnement de test) → Développeurs → Webhooks → Ajouter une destination :
   - URL : `https://yfrerlyndrpfgerkbkyr.supabase.co/functions/v1/stripe-webhook` ;
   - événements : `checkout.session.completed`, `checkout.session.expired`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`.

   Copier ensuite le **secret de signature** (`whsec_…`) dans Supabase → Edge Functions → Secrets →
   `STRIPE_WEBHOOK_SECRET`.
5. **Essai** : ouvrir l'atelier avec `?paiement=test`, se connecter, ajouter une œuvre au panier,
   Commander, puis payer avec la carte de test `4242 4242 4242 4242` (date future, n'importe quel
   cryptogramme).

## Livraison

France métropolitaine uniquement, à domicile. Le client choisit sur la page de paiement :

- **Colissimo**, en 2 à 3 jours ouvrés ;
- **Chronopost express**, en 24 h, s'il y a un tirage dans le panier.

Le prix est celui de l'article le plus cher à expédier, plus 5 € par article imprimé de plus. Le kit DIY
a sa livraison standard comprise ; le fichier HD et le guide n'ont rien à livrer. Le panier affiche la
livraison Colissimo dans le total, et le prix de l'express. Le mode choisi est gardé dans la commande
(`delivery` : `domicile` ou `express`).

Les montants sont **provisoires**, à remplacer par les coûts réels :

| Format   | Affiche Colissimo | Affiche express | Encadré Colissimo | Encadré express |
|----------|-------------------|-----------------|-------------------|-----------------|
| 21 × 30  | 9,90 €            | 19,90 €         | 14,90 €           | 24,90 €         |
| 30 × 40  | 9,90 €            | 19,90 €         | 19,90 €           | 29,90 €         |
| 40 × 50  | 9,90 €            | 19,90 €         | 19,90 €           | 29,90 €         |
| 50 × 70  | 9,90 €            | 19,90 €         | 24,90 €           | 34,90 €         |
| 70 × 100 | 11,90 €           | 21,90 €         | 39,90 €           | 49,90 €         |

Pour les changer, modifier `SHIPPING` à **deux endroits identiques** : dans
`supabase/functions/_shared/commande.js`, qui fait foi pour le paiement, et dans `collage/js/app.js`,
pour l'affichage du panier. Un test (`collage/tests/commande.spec.js`) vérifie qu'ils sont égaux. (Un
essai de livraison en point relais, le 25 novembre 2026, a été retiré.)

Une page de paiement abandonnée expire au bout de 31 minutes : la commande passe alors « abandonnée »
et sort de « Mes commandes ».

## Suivre les commandes (équipe)

Page **Gestion des commandes** (`gestion-commandes.html`, menu du compte), pour l'administrateur et le
rôle « tableau », avec la double authentification : client, adresse, œuvres (fichier HD
d'impression, fait sur place), statut et suivi, **Annuler et rembourser** jusqu'à l'expédition. Détail dans
`docs/TABLEAU-DE-BORD.md`. Fonctions `commande-statut` et `commande-annuler` : réservées à l'équipe.

## Factures

Faites par **Stripe** après chaque paiement (`invoice_creation` dans la session de paiement,
`_shared/commande.js`) : numérotées à la suite, au nom et à l'adresse de facturation saisis par le client,
articles et livraison détaillés, référence de la commande (champ « Commande »). Stripe les garde dans
son tableau de bord (Facturation → Factures) et les envoie au client. Le client la retrouve aussi dans
**Mes commandes** (détail d'une commande → « Télécharger la facture ») : la fonction `facture` vérifie
que la commande est la sienne et payée, retrouve la facture par la session de paiement et ne renvoie
qu'un lien chez Stripe (une commande payée avant les factures n'en a pas : le bouton le dit). Coût : 0,4 % du montant, au plus
environ 2 € par facture (frais Stripe des factures après paiement).

À régler une fois dans Stripe :
- **Settings → Business → Public details** : raison sociale, adresse, e-mail et téléphone du vendeur.
- **Settings → Billing → Invoice template** : pied de page avec SIRET, forme juridique et mention de TVA
  (numéro de TVA intracommunautaire, ou « TVA non applicable, art. 293 B du CGI » en franchise).
- **Settings → Customer emails** : cocher l'envoi des factures et des reçus de paiement.

## E-mails

Envoyés par **Resend**, depuis `commandes@ateliergribouille.art` (réponses vers contact@) :

- **au client** : commande confirmée (paiement reçu), en préparation, expédiée (avec le lien de suivi
  Colissimo ou Chronopost), livrée, annulée ;
- **à la boutique** (`contact@ateliergribouille.art`) : nouvelle commande (avec l'adresse), commande
  annulée par le client.

Chaque e-mail montre l'œuvre commandée **telle qu'elle sera livrée** : dans son cadre (teinte et
baguettes du bois ou de l'aluminium, passe-partout ou bordure blanche) ou sur sa feuille pour une
affiche, aux proportions réelles. La vignette est jointe au message (image intégrée, jamais mise en
ligne). Le même visuel accompagne chaque article dans **Mes commandes** (page du site) ; le
calcul (`framePlan`, dans `_shared/commande.js`) est le même des deux côtés : la page charge ce module,
publié à la racine du site sous le nom `commande-partage.js` (deploy/preparer-site.sh).

À régler une fois : Resend → API Keys → créer une clé « Envoi », puis la coller dans Supabase → Edge
Functions → Secrets → `RESEND_API_KEY`. Sans cette clé, rien n'est envoyé et rien ne casse. Réglages
facultatifs : `ORDER_FROM` (l'expéditeur) et `ORDER_NOTIFY` (l'adresse de la boutique).

## Annulation par le client

Dans Mes commandes (détail de la commande), **Annuler la commande** reste proposé tant que la commande est
« Payée », c'est-à-dire tant que vous ne l'avez pas passée « En préparation » ; l'annulation demande une
deuxième touche pour confirmer. Les œuvres sont personnalisées : une fois lancées, elles ne s'annulent
plus en ligne. Fonction `commande-annuler` : la commande passe « annulée », puis **Stripe rembourse le
montant entier** (`refund`, `cancelled_at`). Le client et la boutique reçoivent un e-mail.

Colonnes ajoutées à la table `orders` (SQL à exécuter une fois) :

```sql
alter table public.orders add column if not exists refund text;
alter table public.orders add column if not exists cancelled_at timestamptz;
```

## Passage en production (plus tard)

- Activer le compte Stripe en production (société, SIRET, pièce d'identité, IBAN).
- Remplacer `STRIPE_SECRET_KEY` par la clé `sk_live_…`, recréer le webhook en production et mettre à
  jour `STRIPE_WEBHOOK_SECRET`.
- Fixer les vrais frais de livraison.
- Mettre à jour la politique de confidentialité (Stripe comme prestataire de paiement) et les
  CGV (droit de rétractation exclu pour les produits personnalisés).
- Activer pour tous : `payments: 'stripe'` dans `collage/config.js`.
