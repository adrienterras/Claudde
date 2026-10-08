// Petit serveur statique pour les tests (aucune dépendance) : node tests/serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const livre = path.resolve(__dirname, '..', '..', 'livre');
const port = Number(process.argv[2] || process.env.PORT || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // comme en ligne : /livre/ est le livre de dessins (dossier ../livre), /atelier/ l'atelier (ce dossier)
  let base = root, rel = url;
  if (url.startsWith('/livre/')) { base = livre; rel = url.slice('/livre'.length); } else if (url.startsWith('/atelier/')) rel = url.slice('/atelier'.length);
  let file = path.join(base, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('introuvable'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`Atelier Gribouille : http://localhost:${port}/`));
