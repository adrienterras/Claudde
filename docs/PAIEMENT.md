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
3. Après le paiement, Stripe ramène le client sur `/atelier/?commande=AG-…` : « Merci », le panier se
   vide, la commande apparaît dans **« Mes commandes »** (sous le panier).
4. Stripe prévient la fonction **`stripe-webhook`**, qui vérifie la signature. Elle passe alors la
   commande en « payée », garde l'adresse et les coordonnées, et marque les œuvres « commandées » : elles
   sont figées, gardées hors de la purge et renommées `AG-… · titre`. Si la page de paiement est
   abandonnée, la commande passe en « abandonnée ».

Statuts : `attente_paiement`, `payee`, `en_preparation`, `expediee`, `livree`, `annulee`,
`abandonnee`. Pour l'instant, le statut, le transporteur et le numéro de suivi se changent à la main
dans Supabase → Table Editor → `orders`. Le client voit le suivi dans « Mes commandes ».

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

France métropolitaine uniquement, à domicile. Le prix est celui de l'article le plus cher à expédier,
plus 5 € par article imprimé de plus. Le kit DIY a sa livraison comprise ; le fichier HD et le guide
n'ont rien à livrer. Les montants sont **provisoires**, à remplacer par les coûts réels (transporteur et
emballage) avant la production :

| Format   | Affiche | Encadré |
|----------|---------|---------|
| 21 × 30  | 9,90 €  | 14,90 € |
| 30 × 40  | 9,90 €  | 19,90 € |
| 40 × 50  | 9,90 €  | 19,90 € |
| 50 × 70  | 9,90 €  | 24,90 € |
| 70 × 100 | 11,90 € | 39,90 € |

Pour les changer, modifier `SHIPPING` à **deux endroits identiques** : dans
`supabase/functions/_shared/commande.js`, qui fait foi pour le paiement, et dans `collage/js/app.js`,
pour l'affichage du panier. Un test (`collage/tests/commande.spec.js`) vérifie qu'ils sont égaux, ainsi
que les prix des articles.

## Passage en production (plus tard)

- Activer le compte Stripe en production (société, SIRET, pièce d'identité, IBAN).
- Remplacer `STRIPE_SECRET_KEY` par la clé `sk_live_…`, recréer le webhook en production et mettre à
  jour `STRIPE_WEBHOOK_SECRET`.
- Fixer les vrais frais de livraison.
- Mettre à jour la politique de confidentialité (Stripe comme prestataire de paiement) et les
  CGV (droit de rétractation exclu pour les produits personnalisés).
- Activer pour tous : `payments: 'stripe'` dans `collage/config.js`.
