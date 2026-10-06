// Réglages de l'instance (publics par nature : la clé « anon » de Supabase est faite pour le navigateur).
// Laisser vide pour désactiver les comptes utilisateurs : l'app fonctionne alors sans connexion,
// avec les sauvegardes locales uniquement. Voir docs/COMPTES.md pour la mise en place.
window.ATELIER_CONFIG = {
  supabaseUrl: 'https://yfrerlyndrpfgerkbkyr.supabase.co',
  supabaseAnonKey: 'sb_publishable_anEQj6_shvidtJSVg0WrTQ_NhznsQHi', // clé publique (publishable) du projet
  contactEmail: 'bonjour@atelier-gribouille.com',
  // mesure d'audience sans cookies (Plausible) ; laisser vide pour désactiver — voir docs/ANALYTIQUE.md
  analytics: { provider: 'plausible', domain: 'ateliergribouille.art' },
};
