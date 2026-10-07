"""Images de synthèse pour les tests (aucun dessin d'enfant) : python3 make_fixtures.py"""
import random
from PIL import Image, ImageDraw, ImageFilter

random.seed(7)
W, H = 1240, 1754  # A4 à 150 dpi


def paper(color=(252, 251, 247)):
    im = Image.new('RGB', (W, H), color)
    px = im.load()
    # léger grain de papier
    for _ in range(40000):
        x, y = random.randrange(W), random.randrange(H)
        r, g, b = px[x, y]
        d = random.randint(-4, 4)
        px[x, y] = (r + d, g + d, b + d)
    return im


def figure(d, cx, cy, s, body=(220, 60, 50), head=(240, 180, 140)):
    """Un petit personnage : tête, corps, bras et jambes, contours noirs."""
    d.ellipse((cx - s * 0.35, cy - s * 1.1, cx + s * 0.35, cy - s * 0.4), fill=head, outline=(20, 20, 20), width=6)
    d.rectangle((cx - s * 0.4, cy - s * 0.4, cx + s * 0.4, cy + s * 0.5), fill=body, outline=(20, 20, 20), width=6)
    d.line((cx - s * 0.4, cy - s * 0.2, cx - s * 0.9, cy + s * 0.2), fill=(20, 20, 20), width=10)
    d.line((cx + s * 0.4, cy - s * 0.2, cx + s * 0.9, cy + s * 0.2), fill=(20, 20, 20), width=10)
    d.line((cx - s * 0.2, cy + s * 0.5, cx - s * 0.25, cy + s * 1.1), fill=(30, 60, 160), width=14)
    d.line((cx + s * 0.2, cy + s * 0.5, cx + s * 0.25, cy + s * 1.1), fill=(30, 60, 160), width=14)


# 1. page découpe : un seul sujet coloré au milieu d'une feuille blanche
im = paper(); d = ImageDraw.Draw(im)
figure(d, W / 2, H / 2, 260)
im.save('page-cutout.png')

# 2. page avec deux sujets séparés
im = paper(); d = ImageDraw.Draw(im)
figure(d, W * 0.3, H * 0.35, 180)
d.ellipse((W * 0.55, H * 0.6, W * 0.9, H * 0.85), fill=(250, 200, 30), outline=(20, 20, 20), width=6)  # soleil
for a in range(0, 360, 30):
    import math
    x0, y0 = W * 0.725, H * 0.725
    d.line((x0 + math.cos(math.radians(a)) * 240, y0 + math.sin(math.radians(a)) * 240, x0 + math.cos(math.radians(a)) * 300, y0 + math.sin(math.radians(a)) * 300), fill=(240, 150, 20), width=10)
im.save('page-two.png')

# 3. page entièrement peinte (fond) : grandes taches de couleurs variées, aucune ne domine
im = Image.new('RGB', (W, H), (200, 80, 60)); d = ImageDraw.Draw(im)
palette = [(60, 120, 200), (240, 200, 60), (80, 170, 90), (230, 120, 170), (250, 140, 40), (120, 80, 160)]
for i in range(60):
    c = palette[i % len(palette)]
    x, y = random.randrange(-200, W), random.randrange(-200, H)
    d.ellipse((x, y, x + random.randint(250, 520), y + random.randint(250, 520)), fill=c)
im = im.filter(ImageFilter.GaussianBlur(6))
im.save('page-texture.png')

# 4. page pâle : des lignes d'écriture au crayon gris (mots faits de petits traits), comme du texte
im = paper(); d = ImageDraw.Draw(im)
for row in range(14):
    y = 220 + row * 95  # ligne d'écriture de 40 px, interligne de 55 px
    x = 160
    while x < W - 220:
        w = random.randint(70, 170)
        for _ in range(w // 9):  # un mot : traits verticaux et boucles serrés
            xx = x + random.randint(0, w)
            d.line((xx, y, xx + random.randint(-4, 4), y + 40), fill=(110, 110, 110), width=3)
        d.line((x, y + 40, x + w, y + 40), fill=(120, 120, 120), width=2)
        x += w + 45
im.save('page-pale.png')

# 5. photo d'une feuille posée sur un parquet : lames de bois, feuille blanche avec un sujet
PW, PH = 1600, 1200
im = Image.new('RGB', (PW, PH), (150, 100, 60)); d = ImageDraw.Draw(im)
for i in range(0, PW, 130):
    tone = (random.randint(120, 170), random.randint(80, 110), random.randint(40, 65))
    d.rectangle((i, 0, i + 124, PH), fill=tone)
    for _ in range(60):
        y0 = random.randrange(PH)
        d.line((i + random.randint(5, 110), y0, i + random.randint(5, 110), y0 + random.randint(40, 200)), fill=(tone[0] - 15, tone[1] - 10, tone[2] - 5), width=2)
im = im.filter(ImageFilter.GaussianBlur(1))
sheet = Image.new('RGB', (900, 640), (250, 249, 244)); sd = ImageDraw.Draw(sheet)
figure(sd, 450, 320, 150)
im.paste(sheet, (350, 280))
im.save('photo-wood.png')

# 6. PDF de deux pages : une découpe et un fond
a = Image.open('page-cutout.png').convert('RGB'); b = Image.open('page-texture.png').convert('RGB')
a.save('two-pages.pdf', save_all=True, append_images=[b], resolution=150)
print('fixtures générées')

# Scans avec résolution déclarée : la taille réelle se lit dans l'en-tête (JFIF 300 dpi, pHYs 150 dpi)
scan = Image.open('page-cutout.png').convert('RGB')
scan.resize((2480, 3508), Image.LANCZOS).save('scan-300dpi.jpg', quality=85, dpi=(300, 300))
scan.save('scan-150dpi.png', dpi=(150, 150))
# même dessin sans résolution, en deux tailles de pixels : sert au test d'étalonnage
scan.resize((620, 877), Image.LANCZOS).save('noscale-small.jpg', quality=85)
scan.resize((1240, 1754), Image.LANCZOS).save('noscale-large.jpg', quality=85)
