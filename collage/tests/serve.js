// Petit serveur statique pour les tests (aucune dépendance) : node tests/serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || process.env.PORT || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // comme en ligne : /atelier/ est l'atelier (ce dossier)
  let base = root, rel = url;
  if (url.startsWith('/atelier/')) rel = url.slice('/atelier'.length);
  let file = path.join(base, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
  // comme en ligne : les pages du site (landing/) à la racine, à côté de l'atelier (Mes commandes…), et le
  // module des commandes partagé avec le serveur
  if (!url.startsWith('/atelier/')) {
    const site = path.resolve(root, '..', 'landing');
    if (url === '/commande-partage.js') file = path.resolve(root, '..', 'supabase', 'functions', '_shared', 'commande.js');
    else if (!fs.existsSync(file) && fs.existsSync(path.join(site, url))) file = path.join(site, url);
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('introuvable'); return; }
    // (les essais voient l'étape Exporter, réservée en ligne à l'équipe : tests/account.spec.js couvre la règle)
    if (path.basename(file) === 'config.js' && file.startsWith(root)) data = Buffer.concat([data, Buffer.from('\nwindow.ATELIER_CONFIG.exportForAll = true;\n')]);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`Atelier Gribouille : http://localhost:${port}/`));
