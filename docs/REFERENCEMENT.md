# Référencement (SEO)

## Ce qui est en place

- **Langue** : le site s'ouvre en français tant que le visiteur n'a pas choisi l'anglais
  (`?lang=en` ou bouton FR / EN). Googlebot navigue avec un navigateur réglé en anglais : sans
  cela, la page indexée était la traduction anglaise. Un bandeau propose l'anglais dans l'atelier.
- **Versions FR / EN déclarées** (`hreflang`) sur l'accueil, les tarifs, l'atelier et le livre ;
  la version anglaise (`?lang=en`) déclare sa propre adresse canonique.
- **Titres et descriptions** écrits pour les recherches réelles : « tableau avec les dessins de
  vos enfants », « que faire des dessins de ses enfants », « livre de dessins d'enfants »…
- **Données structurées** (schema.org) : Organisation, FAQ (accueil), Produit avec prix (tarifs),
  Article et fil d'Ariane (idées), application web (atelier, livre).
- **FAQ visible** sur l'accueil (8 questions) et **article de conseils**
  `idees-dessins-enfants.html` (« Que faire des dessins de ses enfants ? 9 idées »).
- **Partage** : aperçus Open Graph et Twitter complets (image, dimensions, langue).
- **Vitesse** : images des compositions réduites (−40 %), chargées à la demande, avec dimensions
  (pas de saut de page) ; bibliothèques PDF chargées seulement quand elles servent.
- **Plan du site** `sitemap.xml` (avec les versions anglaises) et `robots.txt`.
- Contrôle automatique : `collage/tests/seo.spec.js` (titre, description, canonique, données
  structurées, textes de remplacement des images, plan du site, langue par défaut).

## À faire de votre côté (le plus important pour remonter)

1. **Google Search Console** (https://search.google.com/search-console) : ajouter le domaine
   `ateliergribouille.art` (vérification par enregistrement DNS chez le registraire), puis
   « Sitemaps » → envoyer `https://ateliergribouille.art/sitemap.xml`, et « Inspection de l'URL »
   → « Demander une indexation » pour l'accueil et l'article. Même chose sur Bing Webmaster Tools.
2. **Liens entrants** : c'est ce qui pèse le plus. Blogs parents, sites d'écoles et de crèches,
   annuaires de créateurs, Pinterest (photos des tableaux), Instagram, articles invités
   (« idées cadeaux grands-parents », « que faire des dessins d'enfants »).
3. **Contenu régulier** : un article par mois sur une recherche précise (cadeau fête des
   grands-mères, dessins de maternelle, encadrer un dessin d'enfant…), sur le modèle
   d'`idees-dessins-enfants.html`, ajouté au plan du site.
4. **Avis clients** : dès les premières commandes, des avis (Google, Trustpilot) ; ils pourront
   ensuite enrichir les données structurées du produit.
5. **Photos réelles** de tableaux accrochés (avec l'accord des familles), nommées et décrites :
   elles remontent dans Google Images.

Le classement prend en général plusieurs semaines à quelques mois après l'indexation.
