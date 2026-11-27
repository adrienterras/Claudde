// Le guide de découpe des commandes « Originaux » (articles Guide et Kit) : fait dans l'atelier à l'ajout
// au panier, envoyé avec l'article dans le compte (meta.guide), puis, au paiement, rangé avec la commande
// (bucket privé « impressions », <commande>/guide-<n° de l'article>.pdf) et joint à l'e-mail de
// confirmation ; l'équipe peut le télécharger et le renvoyer au client (Gestion des commandes).
export const GUIDE_PRODUCTS = ['guide', 'kit'];
export const MAX_ATTACH = 30 * 1024 * 1024; // (au-delà, l'e-mail serait refusé : le guide reste à télécharger)

// les articles d'une commande qui ont un guide : [{ index, item }]
export function guideItems(order) {
  return (order.items || []).map((item, index) => ({ index, item })).filter(({ item }) => GUIDE_PRODUCTS.includes(item.product));
}
export const guidePath = (orderId, index) => `${orderId}/guide-${Math.max(0, Math.floor(Number(index) || 0))}.pdf`;
export function guideFileName(order, index) {
  const n = guideItems(order).length;
  const ref = String(order.ref || 'commande').replace(/[^A-Za-z0-9-]/g, '');
  return `guide-de-creation-${ref}${n > 1 ? `-${index + 1}` : ''}.pdf`;
}
// des octets en base64 (pièce jointe Resend), par morceaux
export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// les pièces jointes : tant que l'ensemble reste sous la limite ; les autres guides restent à télécharger
export function guideAttachments(order, files) {
  const out = [];
  let total = 0;
  for (const { index, bytes } of files) {
    if (!bytes || !bytes.length || total + bytes.length > MAX_ATTACH) continue;
    total += bytes.length;
    out.push({ filename: guideFileName(order, index), content: base64(bytes), content_type: 'application/pdf' });
  }
  return out;
}
