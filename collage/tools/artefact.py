#!/usr/bin/env python3
"""L'atelier en une seule page (artefact de démonstration, hors site) : index.html avec la feuille de style,
les scripts et les images incorporés, pour être publié tel quel comme une page autonome.

- style.css en ligne ; les images d'assets/ en data: (les .webp des mises en scène tels quels : leurs
  tailles en pixels sont celles que l'application attend) ;
- pdf.js et jsPDF en ligne ; pas de Supabase ni de config.js (sans compte : sauvegardes locales) ;
- un script de réglages : le worker de pdf.js à côté de la page (`pdf.worker.min.js`, publié avec elle) et
  le jeu d'exemple (`samples/d1-p01.jpg`… publié avec elle : `window.COLLAGE_SAMPLES`) ;
- les scripts de l'application mis bout à bout, dans l'ordre d'index.html.
Usage : python3 tools/artefact.py <sortie.html>   (depuis le dossier collage/)
"""
import base64, json, mimetypes, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # collage/
out = sys.argv[1] if len(sys.argv) > 1 else 'atelier-collage.html'
html = open(os.path.join(HERE, 'index.html'), encoding='utf8').read()
css = open(os.path.join(HERE, 'style.css'), encoding='utf8').read()
cache = {}

def data_uri(rel):
    """`assets/x.png` → data:…"""
    rel = rel.split('?')[0]
    if rel in cache: return cache[rel]
    path = os.path.join(HERE, rel)
    mime = {'.svg': 'image/svg+xml', '.webp': 'image/webp'}.get(os.path.splitext(rel)[1]) or mimetypes.guess_type(path)[0] or 'application/octet-stream'
    cache[rel] = f"data:{mime};base64,{base64.b64encode(open(path, 'rb').read()).decode()}"
    return cache[rel]

def inline_assets(text):
    return re.sub(r"assets/[A-Za-z0-9_@.-]+(?:\?v=\d+)?", lambda m: data_uri(m.group(0)), text)

# l'en-tête : titre, icônes, polices, feuille de style (pas la politique de sécurité du contenu du site :
# ses scripts sont ici en ligne, et la page est servie par un autre hôte)
head = html[:html.find('</head>')]
title = re.search(r'<title>.*?</title>', head).group(0)
icons = re.findall(r'<link rel="(?:icon|apple-touch-icon)"[^>]*>', head)
fonts = re.findall(r'<link rel="preconnect"[^>]*>|<link rel="stylesheet" href="https://fonts[^"]*">', head)
parts = [title] + [inline_assets(l) for l in icons] + fonts + ['<style>\n' + inline_assets(css) + '\n</style>']
# le corps, sans les balises de scripts (remises en ligne plus bas)
body = html[html.find('<body'):]
body = body[body.find('>') + 1:body.rfind('</body>')]
srcs = re.findall(r'<script src="([^"]+)"></script>', body)
body = re.sub(r'\s*<script src="[^"]+"></script>', '', body)
parts.append(inline_assets(body))
# les scripts : pdf.js, jsPDF, les réglages, puis l'application
vendor = lambda f: open(os.path.join(HERE, 'vendor', f), encoding='utf8').read()
parts.append('<script>\n' + vendor('pdf.min.js') + '\n</script>')
parts.append('<script>\n' + vendor('jspdf.umd.min.js') + '\n</script>')
samples = {'base': 'samples/', 'pages': [{'file': f'd1-p{i:02d}.jpg', 'name': f'Dessins 1 — p.{i}'} for i in range(1, 18)] + [{'file': f'd2-p{i:02d}.jpg', 'name': f'Dessins 2 — p.{i}'} for i in range(1, 25)]}
parts.append("<script>\nwindow.PDFJS_WORKER_SRC = 'pdf.worker.min.js';\nwindow.COLLAGE_SAMPLES = " + json.dumps(samples, ensure_ascii=False) + ';\n</script>')
app = []
for src in srcs:
    if src in ('vendor/supabase.js', 'config.js'): continue
    app.append(inline_assets(open(os.path.join(HERE, src), encoding='utf8').read()))
parts.append('<script>\n' + '\n'.join(app) + '\n</script>')
open(out, 'w', encoding='utf8').write('\n'.join(parts) + '\n')
print('ok', os.path.getsize(out))
