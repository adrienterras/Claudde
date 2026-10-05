// Réglages de l'instance (publics par nature : la clé « anon » de Supabase est faite pour le navigateur).
// Laisser vide pour désactiver les comptes utilisateurs : l'app fonctionne alors sans connexion,
// avec les sauvegardes locales uniquement. Voir docs/COMPTES.md pour la mise en place.
window.ATELIER_CONFIG = {
  supabaseUrl: '',      // ex. https://abcdefghijkl.supabase.co
  supabaseAnonKey: '',  // clé « anon public » du projet Supabase
  contactEmail: 'bonjour@atelier-gribouille.com',
};
