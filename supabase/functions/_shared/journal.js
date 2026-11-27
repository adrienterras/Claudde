// Le journal du site : les erreurs des fonctions serveur et les e-mails qui ne sont pas partis, que le
// tableau de bord de l'administrateur affiche (table site_events, écrite seulement avec la clé serveur,
// gardée 30 jours). Une écriture ratée du journal ne casse jamais la fonction qui l'appelle.
import { rest } from './supabase.js';

let SOURCE = '';
// le nom de la fonction qui écrit (au début de chaque index.ts)
export const journalFrom = (name) => { SOURCE = String(name || '').slice(0, 40); };
export const errText = (e) => String((e && e.message) || e || '').slice(0, 300);

export async function journal(kind, message, ref) {
  try {
    await rest('POST', 'site_events', {
      kind, fn: SOURCE || null, message: String(message || '').slice(0, 300) || '(sans détail)', ref: ref ? String(ref).slice(0, 60) : null,
    }, 'return=minimal');
  } catch (e) { console.error('journal', e); }
}
