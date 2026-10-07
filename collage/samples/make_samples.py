"""Dessins d'exemple de synthèse (aucun auteur, aucune donnée personnelle) : python3 make_samples.py
Feutre et crayon de cire sur papier « scanné », A4 à 150 dpi. Génère les JPEG et manifest.json."""
import json, math, random
from PIL import Image, ImageDraw, ImageFilter

W, H = 1240, 1754
random.seed(12)

# ---------- papier et outils de dessin ----------
def paper():
    im = Image.new('RGB', (W, H), (251, 250, 246))
    px = im.load()
    for _ in range(60000):
        x, y = random.randrange(W), random.randrange(H)
        r, g, b = px[x, y]; d = random.randint(-5, 3)
        px[x, y] = (r + d, g + d, b + d - 1)
    # légère ombre de scanner sur un bord
    sh = Image.new('L', (W, H), 0); sd = ImageDraw.Draw(sh)
    for i in range(40): sd.rectangle((0, 0, W, H), outline=255 - i * 5, width=1) if False else None
    return im

def wobble(points, amp=4):
    out = []
    for i, (x, y) in enumerate(points):
        out.append((x + random.uniform(-amp, amp), y + random.uniform(-amp, amp)))
    return out

def dense(points, step=6, closed=False):
    """rééchantillonne une polyligne tous les `step` px"""
    pts = list(points) + ([points[0]] if closed else [])
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        for k in range(n):
            t = k / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    out.append(pts[-1])
    return out

def stroke(d, points, color, width=9, amp=2.5, passes=2, closed=False):
    """trait de feutre : plusieurs passes légèrement décalées, bouts ronds"""
    pts = dense(points, 6, closed)
    for p in range(passes):
        q = wobble(pts, amp)
        c = tuple(max(0, min(255, v + random.randint(-12, 12))) for v in color)
        w = max(2, int(width * random.uniform(0.85, 1.1)))
        d.line(q, fill=c, width=w, joint='curve')
        for (x, y) in (q[0], q[-1]):
            d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=c)

def circle_pts(cx, cy, r, n=48):
    return [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]

def crayon_fill(d, polygon, color, spacing=11, angle=35, width=7, alpha_jitter=True):
    """remplissage au crayon de cire : hachures qui débordent un peu, inégales"""
    xs = [p[0] for p in polygon]; ys = [p[1] for p in polygon]
    x0, x1, y0, y1 = min(xs) - 20, max(xs) + 20, min(ys) - 20, max(ys) + 20
    mask = Image.new('L', (W, H), 0); ImageDraw.Draw(mask).polygon(polygon, fill=255)
    mask = mask.filter(ImageFilter.MaxFilter(5))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
    a = math.radians(angle); dx, dy = math.cos(a), math.sin(a)
    nx, ny = -dy, dx
    diag = math.hypot(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    t = -diag / 2
    while t < diag / 2:
        px, py = cx + nx * t, cy + ny * t
        p0 = (px - dx * diag / 2, py - dy * diag / 2); p1 = (px + dx * diag / 2, py + dy * diag / 2)
        c = tuple(max(0, min(255, v + random.randint(-18, 18))) for v in color) + (random.randint(150, 230),)
        seg = wobble(dense([p0, p1], 8), 2)
        # on laisse de petits trous pour l'effet crayon
        if random.random() > 0.08:
            ld.line(seg, fill=c, width=int(width * random.uniform(0.7, 1.2)), joint='curve')
        t += spacing * random.uniform(0.8, 1.2)
    layer.putalpha(Image.composite(layer.getchannel('A'), Image.new('L', (W, H), 0), mask))
    base = d._image
    base.paste(layer, (0, 0), layer)

def felt_fill(d, polygon, color):
    """aplat de feutre, un peu inégal"""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
    ld.polygon(wobble(dense(polygon, 8, True), 2), fill=color + (200,))
    for _ in range(14):  # traces de feutre plus foncées
        x = random.uniform(min(p[0] for p in polygon), max(p[0] for p in polygon))
        ys = [p[1] for p in polygon]
        ld.line([(x, min(ys)), (x + random.uniform(-10, 10), max(ys))], fill=tuple(max(0, v - 14) for v in color) + (60,), width=random.randint(8, 18))
    mask = Image.new('L', (W, H), 0); ImageDraw.Draw(mask).polygon(polygon, fill=255)
    layer.putalpha(Image.composite(layer.getchannel('A'), Image.new('L', (W, H), 0), mask))
    d._image.paste(layer, (0, 0), layer)

INK = (40, 38, 45)
RED = (214, 62, 52); ORANGE = (240, 140, 40); YELLOW = (248, 204, 40); GREEN = (70, 150, 70); DGREEN = (40, 110, 60)
BLUE = (50, 110, 200); LBLUE = (120, 180, 230); PINK = (235, 120, 170); PURPLE = (130, 80, 170); BROWN = (140, 90, 50); GRAY = (150, 150, 160)

def draw_on(fn):
    im = paper(); d = ImageDraw.Draw(im); d._image = im
    fn(d)
    return im

# ---------- sujets ----------
def sun(d, cx=620, cy=720, r=230):
    crayon_fill(d, circle_pts(cx, cy, r), YELLOW, spacing=12, width=9)
    stroke(d, circle_pts(cx, cy, r), ORANGE, 12, closed=True)
    for k in range(14):
        a = 2 * math.pi * k / 14 + random.uniform(-0.1, 0.1)
        stroke(d, [(cx + math.cos(a) * (r + 30), cy + math.sin(a) * (r + 30)), (cx + math.cos(a) * (r + random.uniform(110, 170)), cy + math.sin(a) * (r + random.uniform(110, 170)))], ORANGE, 11)
    stroke(d, circle_pts(cx - 75, cy - 40, 16), INK, 8, closed=True); stroke(d, circle_pts(cx + 75, cy - 40, 16), INK, 8, closed=True)
    stroke(d, [(cx - 90, cy + 50), (cx - 40, cy + 95), (cx + 40, cy + 95), (cx + 90, cy + 50)], RED, 10)

def house(d):
    body = [(330, 900), (910, 900), (910, 1400), (330, 1400)]
    crayon_fill(d, body, (235, 170, 120), spacing=12); stroke(d, body, INK, 10, closed=True)
    roof = [(290, 910), (620, 560), (950, 910)]
    crayon_fill(d, roof, RED, spacing=11); stroke(d, roof, INK, 10, closed=True)
    door = [(560, 1400), (690, 1400), (690, 1180), (560, 1180)]
    felt_fill(d, door, BROWN); stroke(d, door, INK, 8, closed=True)
    for wx in (380, 760):
        win = [(wx, 1000), (wx + 110, 1000), (wx + 110, 1110), (wx, 1110)]
        felt_fill(d, win, LBLUE); stroke(d, win, INK, 8, closed=True)
        stroke(d, [(wx + 55, 1000), (wx + 55, 1110)], INK, 6); stroke(d, [(wx, 1055), (wx + 110, 1055)], INK, 6)
    chim = [(760, 700), (830, 700), (830, 820), (760, 760)]
    felt_fill(d, chim, BROWN); stroke(d, chim, INK, 8, closed=True)
    for k in range(3):
        stroke(d, circle_pts(800 + k * 40, 620 - k * 70, 30 + k * 8, 24), GRAY, 7, closed=True)

def cat(d):
    head = circle_pts(620, 640, 190)
    crayon_fill(d, head, ORANGE, spacing=12); stroke(d, head, INK, 10, closed=True)
    for sx in (-1, 1):
        ear = [(620 + sx * 90, 490), (620 + sx * 200, 360), (620 + sx * 180, 560)]
        crayon_fill(d, ear, ORANGE, spacing=12); stroke(d, ear, INK, 10, closed=True)
    body = [(430, 1300), (520, 880), (720, 880), (810, 1300)]
    crayon_fill(d, body, ORANGE, spacing=12); stroke(d, body, INK, 10, closed=True)
    stroke(d, [(810, 1250), (930, 1200), (960, 1050), (900, 960)], INK, 10)
    for sx in (-1, 1):
        stroke(d, circle_pts(620 + sx * 70, 610, 22), DGREEN, 8, closed=True)
        for k in range(3):
            stroke(d, [(620 + sx * 60, 690 + k * 18), (620 + sx * 230, 660 + k * 40)], INK, 5)
    stroke(d, [(600, 690), (640, 690), (620, 715)], PINK, 8, closed=True)
    stroke(d, [(560, 1300), (560, 1420)], INK, 10); stroke(d, [(680, 1300), (680, 1420)], INK, 10)

def rainbow(d):
    cols = [RED, ORANGE, YELLOW, GREEN, BLUE, PURPLE]
    for i, c in enumerate(cols):
        r = 520 - i * 48
        pts = [(620 + r * math.cos(math.pi + math.pi * k / 40), 1150 + r * math.sin(math.pi + math.pi * k / 40)) for k in range(41)]
        stroke(d, pts, c, 40, amp=3, passes=2)
    for cx, cy in ((250, 1120), (990, 1120)):
        cl = []
        for k in range(5):
            cl += circle_pts(cx + (k - 2) * 60, cy + (0 if k % 2 else 30), 70, 20)
        stroke(d, [(cx - 150, cy + 60), (cx + 150, cy + 60)], LBLUE, 9)
        for k in range(5):
            stroke(d, circle_pts(cx + (k - 2) * 60, cy + (0 if k % 2 else 25), 60, 20)[:11], LBLUE, 9)

def figure(d, cx=620, top=380, s=1.0):
    head = circle_pts(cx, top + 140 * s, 120 * s)
    crayon_fill(d, head, (245, 205, 170), spacing=12); stroke(d, head, INK, 9, closed=True)
    for k in range(9):
        a = math.pi + math.pi * (k + 0.5) / 9
        stroke(d, [(cx + 120 * s * math.cos(a), top + 140 * s + 120 * s * math.sin(a)), (cx + 170 * s * math.cos(a), top + 140 * s + 170 * s * math.sin(a))], BROWN, 9)
    stroke(d, circle_pts(cx - 40 * s, top + 120 * s, 12 * s), INK, 7, closed=True); stroke(d, circle_pts(cx + 40 * s, top + 120 * s, 12 * s), INK, 7, closed=True)
    stroke(d, [(cx - 45 * s, top + 190 * s), (cx, top + 215 * s), (cx + 45 * s, top + 190 * s)], RED, 7)
    body = [(cx - 110 * s, top + 270 * s), (cx + 110 * s, top + 270 * s), (cx + 130 * s, top + 620 * s), (cx - 130 * s, top + 620 * s)]
    crayon_fill(d, body, BLUE, spacing=11); stroke(d, body, INK, 9, closed=True)
    for sx in (-1, 1):
        stroke(d, [(cx + sx * 115 * s, top + 300 * s), (cx + sx * 300 * s, top + 480 * s)], INK, 11)
        for k in range(4):
            stroke(d, [(cx + sx * 300 * s, top + 480 * s), (cx + sx * (330 + k * 8) * s, top + (500 + k * 22) * s)], INK, 6)
        leg = [(cx + sx * 60 * s, top + 620 * s), (cx + sx * 75 * s, top + 950 * s)]
        stroke(d, leg, (60, 60, 90), 16)
        stroke(d, [(cx + sx * 75 * s, top + 950 * s), (cx + sx * 150 * s, top + 960 * s)], INK, 12)

def flower(d, cx=620, cy=700, r=70, petal=PINK):
    stroke(d, [(cx, cy + r), (cx + 10, cy + 650)], DGREEN, 14)
    for sx in (-1, 1):
        leaf = [(cx + 5, cy + 400), (cx + sx * 120, cy + 330), (cx + sx * 160, cy + 420), (cx + sx * 60, cy + 470)]
        crayon_fill(d, leaf, GREEN, spacing=10); stroke(d, leaf, DGREEN, 8, closed=True)
    for k in range(8):
        a = 2 * math.pi * k / 8
        px, py = cx + math.cos(a) * r * 1.9, cy + math.sin(a) * r * 1.9
        pts = circle_pts(px, py, r * 1.05, 28)
        crayon_fill(d, pts, petal, spacing=10, width=7); stroke(d, pts, tuple(max(0, v - 60) for v in petal), 8, closed=True)
    pts = circle_pts(cx, cy, r)
    crayon_fill(d, pts, YELLOW, spacing=9); stroke(d, pts, ORANGE, 8, closed=True)

def tree(d):
    trunk = [(560, 1450), (680, 1450), (660, 950), (580, 950)]
    crayon_fill(d, trunk, BROWN, spacing=10); stroke(d, trunk, INK, 9, closed=True)
    crown = []
    for k in range(40):
        a = 2 * math.pi * k / 40
        rr = 380 + 40 * math.sin(a * 6)
        crown.append((620 + rr * math.cos(a), 700 + rr * 0.85 * math.sin(a)))
    crayon_fill(d, crown, GREEN, spacing=12, width=9); stroke(d, crown, DGREEN, 10, closed=True)
    for _ in range(9):
        a = random.uniform(0, 2 * math.pi); rr = random.uniform(80, 300)
        p = circle_pts(620 + rr * math.cos(a), 700 + rr * 0.8 * math.sin(a), 32, 20)
        felt_fill(d, p, RED); stroke(d, p, (150, 30, 30), 6, closed=True)

def boat(d):
    hull = [(250, 1050), (990, 1050), (880, 1250), (360, 1250)]
    crayon_fill(d, hull, RED, spacing=11); stroke(d, hull, INK, 10, closed=True)
    stroke(d, [(620, 1050), (620, 450)], BROWN, 14)
    sail = [(640, 470), (960, 1000), (640, 1000)]
    crayon_fill(d, sail, (250, 250, 240), spacing=14, width=5); stroke(d, sail, INK, 9, closed=True)
    sail2 = [(600, 560), (330, 1000), (600, 1000)]
    crayon_fill(d, sail2, YELLOW, spacing=11); stroke(d, sail2, INK, 9, closed=True)
    for y in (1330, 1400, 1470):
        pts = [(150 + k * 30, y + 25 * math.sin(k / 1.6)) for k in range(32)]
        stroke(d, pts, BLUE, 12, amp=1.5)

def hearts(d):
    def heart(cx, cy, s, col):
        pts = []
        for k in range(60):
            t = 2 * math.pi * k / 60
            x = 16 * math.sin(t) ** 3; y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
            pts.append((cx + x * s, cy + y * s))
        crayon_fill(d, pts, col, spacing=11); stroke(d, pts, tuple(max(0, v - 70) for v in col), 10, closed=True)
    heart(620, 800, 24, RED)
    heart(300, 400, 7, PINK); heart(960, 420, 8, PINK); heart(330, 1350, 6, PURPLE); heart(940, 1320, 7, RED)

def butterfly(d):
    stroke(d, [(620, 520), (620, 1250)], INK, 16)
    stroke(d, circle_pts(620, 480, 48), INK, 10, closed=True)
    stroke(d, [(600, 440), (540, 340)], INK, 7); stroke(d, [(640, 440), (700, 340)], INK, 7)
    for sx in (-1, 1):
        up = [(620 + sx * 20, 600), (620 + sx * 420, 420), (620 + sx * 470, 760), (620 + sx * 40, 860)]
        crayon_fill(d, up, PURPLE, spacing=11); stroke(d, up, INK, 9, closed=True)
        low = [(620 + sx * 30, 900), (620 + sx * 380, 950), (620 + sx * 300, 1260), (620 + sx * 40, 1150)]
        crayon_fill(d, low, ORANGE, spacing=11); stroke(d, low, INK, 9, closed=True)
        for (px, py, r, c) in ((250, 600, 50, YELLOW), (380, 700, 32, LBLUE), (230, 1050, 40, PINK)):
            p = circle_pts(620 + sx * px, py, r, 24); felt_fill(d, p, c); stroke(d, p, INK, 6, closed=True)

def car(d):
    body = [(230, 1150), (1010, 1150), (1010, 950), (820, 950), (700, 760), (420, 760), (330, 950), (230, 950)]
    crayon_fill(d, body, BLUE, spacing=11); stroke(d, body, INK, 10, closed=True)
    for wx in (420, 820):
        w = circle_pts(wx, 1170, 95); felt_fill(d, w, INK); stroke(d, w, INK, 8, closed=True)
        stroke(d, circle_pts(wx, 1170, 35), GRAY, 8, closed=True)
    for wx in (450, 710):
        win = [(wx, 790), (wx + 180, 790), (wx + 200, 940), (wx - 20, 940)]
        felt_fill(d, win, LBLUE); stroke(d, win, INK, 7, closed=True)
    stroke(d, circle_pts(990, 1000, 22), YELLOW, 10, closed=True)

def bird(d):
    body = circle_pts(620, 860, 220)
    crayon_fill(d, body, LBLUE, spacing=12); stroke(d, body, INK, 10, closed=True)
    head = circle_pts(830, 640, 120)
    crayon_fill(d, head, LBLUE, spacing=12); stroke(d, head, INK, 10, closed=True)
    beak = [(940, 620), (1060, 650), (940, 690)]
    felt_fill(d, beak, ORANGE); stroke(d, beak, INK, 8, closed=True)
    stroke(d, circle_pts(860, 610, 16), INK, 8, closed=True)
    wing = [(560, 760), (300, 600), (330, 900), (560, 940)]
    crayon_fill(d, wing, BLUE, spacing=11); stroke(d, wing, INK, 9, closed=True)
    stroke(d, [(430, 1040), (250, 1080), (250, 1180), (430, 1120)], BLUE, 10, closed=True)
    for lx in (580, 680):
        stroke(d, [(lx, 1075), (lx, 1250)], ORANGE, 9); stroke(d, [(lx - 40, 1250), (lx + 40, 1250)], ORANGE, 9)

def sun_and_cloud(d):
    sun(d, 400, 500, 150)
    for cx, cy in ((850, 1100),):
        for k in range(6):
            p = circle_pts(cx + (k - 2.5) * 70, cy + (0 if k % 2 else 40), 80, 24)
            crayon_fill(d, p, (245, 245, 250), spacing=14, width=5); stroke(d, p, LBLUE, 8, closed=True)
    figure(d, 450, 950, 0.55)

def snail(d):
    body = [(260, 1200), (980, 1200), (960, 1120), (400, 1090), (300, 1130)]
    crayon_fill(d, body, GREEN, spacing=10); stroke(d, body, INK, 9, closed=True)
    pts = []
    for k in range(120):
        t = k / 120 * 4 * math.pi; r = 40 + k * 2.6
        pts.append((640 + r * math.cos(t), 850 + r * math.sin(t)))
    stroke(d, pts, BROWN, 14, amp=1.5)
    crayon_fill(d, circle_pts(640, 850, 300, 40), (230, 190, 110), spacing=13, width=8)
    stroke(d, pts, BROWN, 12, amp=1.5)
    stroke(d, [(300, 1130), (280, 980)], INK, 9); stroke(d, [(380, 1110), (400, 960)], INK, 9)
    stroke(d, circle_pts(280, 960, 18), INK, 7, closed=True); stroke(d, circle_pts(400, 940, 18), INK, 7, closed=True)

# ---------- pages de fond : gouache à la brosse large, comme une page entièrement peinte par un enfant ----------
def _clamp(c): return tuple(max(0, min(255, int(v))) for v in c)
def _mix(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
def _jit(c, k): return _clamp(tuple(v + random.uniform(-k, k) for v in c))

def brush(layer, p0, p1, color, width, load=1.0, bristles=None, curve=0.0):
    """Un coup de brosse plate : des poils parallèles, chacun un peu décalé et d'une teinte proche ;
    la peinture s'épuise le long du trait (fin de trait sec, poils qui lâchent), les bords sont irréguliers."""
    d = ImageDraw.Draw(layer, 'RGBA')
    (x0, y0), (x1, y1) = p0, p1
    L = math.hypot(x1 - x0, y1 - y0) or 1
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    nx, ny = -uy, ux
    n = bristles or max(6, int(width / 2.2))
    for i in range(n):
        off = (i / (n - 1) - 0.5) * width * random.uniform(0.92, 1.04)
        if random.random() < 0.03: continue  # poil qui manque
        c = _jit(color, 16)
        # un peu plus sombre sur les bords du trait (peinture repoussée)
        edge = abs(off) / (width / 2)
        c = _clamp(_mix(c, (c[0] * 0.86, c[1] * 0.86, c[2] * 0.86), edge ** 3 * 0.35))
        w = random.uniform(4.0, 6.0)
        # le trait en segments : l'alpha baisse quand la brosse se vide, et le trait finit en pointillé
        segs = max(6, int(L / 22))
        pts = []
        for k in range(segs + 1):
            t = k / segs
            bend = math.sin(t * math.pi) * curve * width
            jx = random.uniform(-1.2, 1.2); jy = random.uniform(-1.2, 1.2)
            pts.append((x0 + ux * L * t + nx * (off + bend) + jx, y0 + uy * L * t + ny * (off + bend) + jy))
        for k in range(segs):
            t = k / segs
            a = min(1, load * 1.15) * (1 - 0.12 * t) * random.uniform(0.94, 1.0)
            if t > 0.82 and random.random() < (t - 0.82) * 2.2: continue  # brosse sèche
            d.line([pts[k], pts[k + 1]], fill=c + (int(255 * min(1, a)),), width=int(w))

def dab(layer, cx, cy, r, color, load=0.9, texture=True):
    """une touche ronde de pinceau chargé : une tache aux bords irréguliers, puis deux ou trois petits
    coups de brosse par-dessus pour la texture"""
    d = ImageDraw.Draw(layer, 'RGBA')
    pts = [(cx + r * random.uniform(0.86, 1.08) * math.cos(a), cy + r * random.uniform(0.86, 1.08) * math.sin(a)) for a in [2 * math.pi * k / 22 for k in range(22)]]
    d.polygon(pts, fill=_jit(color, 5) + (int(235 * load),))
    for _ in range(3 if texture else 0):
        a = random.uniform(0, math.pi)
        brush(layer, (cx - math.cos(a) * r * 0.7, cy - math.sin(a) * r * 0.7), (cx + math.cos(a) * r * 0.7, cy + math.sin(a) * r * 0.7), color, r * 0.9, load * 0.8)

def painted_page(bg, sweeps, base_angle=0):
    """`sweeps` : liste de (couleur, nombre, largeur, direction en degrés ± écart, longueur, charge)."""
    im = paper()
    # première couche : la feuille entière, en larges passages bord à bord (un enfant couvre tout)
    # en alternant les trois teintes principales : aucune ne domine la page, comme une vraie gouache mélangée
    bases = [sw[0] for sw in sweeps[:5]]
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    y = -40; k = 0
    while y < H + 40:
        dy = math.tan(math.radians(base_angle)) * (W + 160)
        brush(layer, (-80, y - dy / 2 + random.uniform(-6, 6)), (W + 80, y + dy / 2 + random.uniform(-14, 14)), _jit(bases[k % 5], 8), 150, 0.95, curve=random.uniform(-0.06, 0.06))
        y += 78; k += 1
    layer = layer.filter(ImageFilter.GaussianBlur(0.4))
    im.paste(layer, (0, 0), layer)
    # puis les coups de brosse libres, par couleur
    for color, count, width, (ang, spread), length, load in sweeps:
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for _ in range(count):
            a = math.radians(ang + random.uniform(-spread, spread))
            L = length * random.uniform(0.6, 1.25)
            x = random.uniform(-0.1 * W, 1.1 * W); y = random.uniform(-0.05 * H, 1.05 * H)
            brush(layer, (x, y), (x + math.cos(a) * L, y + math.sin(a) * L), color, width * random.uniform(0.8, 1.2), load, curve=random.uniform(-0.15, 0.15))
        layer = layer.filter(ImageFilter.GaussianBlur(0.4))
        im.paste(layer, (0, 0), layer)
    return im

def paper_grain(im):
    """grain de la feuille sous la peinture + très léger relief"""
    noise = Image.effect_noise((W, H), 18).convert('L')
    g = Image.merge('RGB', (noise, noise, noise))
    return Image.blend(im, g, 0.06)

def sky_page():
    SKY = (86, 150, 214); LIGHT = (190, 222, 244); DEEP = (30, 70, 160); MAUVE = (170, 130, 215); WHITE = (246, 247, 250)
    im = painted_page(None, [
        (SKY, 46, 150, (0, 6), 900, 0.95), (LIGHT, 50, 120, (0, 8), 700, 0.85), (DEEP, 30, 110, (0, 5), 600, 0.9),
        (MAUVE, 10, 90, (0, 10), 500, 0.7), ((236, 180, 200), 8, 80, (0, 8), 420, 0.6),
    ])
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for cx, cy, s in ((330, 420, 1.0), (880, 700, 1.15), (420, 1230, 0.9), (930, 1480, 1.0)):
        for k in range(8):
            dab(layer, cx + (k - 3.5) * 58 * s, cy + (-30 if k % 2 else 12) * s + random.uniform(-8, 8), 92 * s * random.uniform(0.85, 1.1), WHITE, 0.97, texture=False)
        brush(layer, (cx - 230 * s, cy + 75 * s), (cx + 230 * s, cy + 80 * s), WHITE, 34, 0.9)
    im.paste(layer, (0, 0), layer)
    return paper_grain(im)

def grass_page():
    G1 = (70, 146, 62); G2 = (166, 210, 80); G3 = (20, 76, 46); YEL = (232, 216, 82); BROWN2 = (124, 94, 46)
    im = painted_page(None, [
        (G1, 34, 150, (0, 7), 900, 0.95), (G2, 38, 120, (0, 9), 700, 0.85), (G3, 20, 110, (0, 6), 600, 0.9),
        (YEL, 16, 80, (0, 12), 450, 0.7), (BROWN2, 12, 70, (0, 10), 400, 0.7),
    ])
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for _ in range(420):  # brins d'herbe au pinceau fin, vers le haut
        x = random.uniform(0, W); y = random.uniform(0, H)
        brush(layer, (x, y), (x + random.uniform(-18, 18), y - random.uniform(40, 110)), _jit(random.choice([G3, G1, (90, 160, 70)]), 14), 7, 0.9, bristles=3)
    for _ in range(34):  # petites fleurs : une touche de couleur
        x, y = random.uniform(40, W - 40), random.uniform(40, H - 40)
        dab(layer, x, y, random.uniform(14, 24), random.choice([YELLOW, PINK, (250, 250, 250), (240, 120, 60)]), 0.95)
    im.paste(layer, (0, 0), layer)
    return paper_grain(im)

def stripes_page():
    """bandes de couleur à la brosse large, une couleur par bande, bords qui bavent"""
    im = paper()
    cols = [RED, ORANGE, YELLOW, GREEN, BLUE, PURPLE, PINK, (60, 170, 160)]
    y = -30; i = 0
    while y < H + 30:
        h = random.randint(120, 200)
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        c = cols[i % len(cols)]
        for k in range(3):  # trois passages par bande, un peu décalés
            yy = y + h / 2 + random.uniform(-h * 0.18, h * 0.18)
            x0 = random.uniform(-80, 40)
            brush(layer, (x0, yy), (W + 60, yy + random.uniform(-14, 14)), c, h * random.uniform(0.6, 0.8), random.uniform(0.8, 1.0), curve=random.uniform(-0.1, 0.1))
        layer = layer.filter(ImageFilter.GaussianBlur(0.4))
        im.paste(layer, (0, 0), layer)
        y += h - 14; i += 1
    return paper_grain(im)

def night_page():
    NAVY = (20, 30, 90); IND = (110, 130, 210); VIOL = (150, 60, 160); TEAL = (40, 150, 150); PLUM = (214, 130, 70)
    im = painted_page(None, [
        (NAVY, 40, 150, (0, 8), 900, 1.0), (IND, 50, 120, (0, 10), 700, 0.9), (VIOL, 32, 100, (0, 12), 520, 0.75),
        (TEAL, 10, 90, (0, 10), 500, 0.6), (PLUM, 10, 90, (0, 10), 460, 0.7),
    ])
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for _ in range(30):  # étoiles : petites croix de pinceau fin, jaune chargé
        cx, cy = random.uniform(60, W - 60), random.uniform(60, H - 60); r = random.uniform(14, 34)
        for a in (0, math.pi / 2, math.pi / 4, -math.pi / 4):
            brush(layer, (cx - math.cos(a) * r, cy - math.sin(a) * r), (cx + math.cos(a) * r, cy + math.sin(a) * r), (250, 214, 70), 7, 1.0, bristles=3)
        dab(layer, cx, cy, r * 0.5, (252, 228, 110), 1.0)
    dab(layer, 900, 360, 150, (248, 236, 190), 1.0, texture=False)  # la lune, une grosse touche ronde
    im.paste(layer, (0, 0), layer)
    return paper_grain(im)

def earth_page():
    OCRE = (182, 122, 58); SIEN = (110, 52, 30); SAND = (236, 208, 140); RUST = (215, 55, 40); UMBER = (90, 100, 120); MOSS = (120, 150, 60)
    im = painted_page(None, [
        (OCRE, 30, 150, (12, 22), 700, 0.95), (SAND, 40, 120, (-8, 24), 600, 0.8), (SIEN, 22, 110, (20, 25), 520, 0.9),
        (MOSS, 16, 90, (-15, 25), 420, 0.75), (RUST, 14, 90, (10, 25), 440, 0.8), (UMBER, 10, 90, (-20, 20), 420, 0.8),
    ], base_angle=11)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for _ in range(40):  # cailloux : petits cercles au pinceau
        x, y = random.uniform(40, W - 40), random.uniform(40, H - 40); r = random.uniform(18, 50)
        pts = circle_pts(x, y, r, 14)
        for p, q in zip(pts, pts[1:] + pts[:1]): brush(layer, p, q, _jit((70, 44, 30), 20), 8, 0.9, bristles=3)
    im.paste(layer, (0, 0), layer)
    return paper_grain(im)

PAGES = [
    ('soleil', sun), ('maison', house), ('chat', cat), ('arc-en-ciel', rainbow), ('bonhomme', figure),
    ('fleur', flower), ('arbre', tree), ('bateau', boat), ('coeurs', hearts), ('papillon', butterfly),
    ('voiture', car), ('oiseau', bird), ('soleil-et-bonhomme', sun_and_cloud), ('escargot', snail),
]
BACKS = [('ciel-peint', sky_page), ('herbe-peinte', grass_page), ('rayures-peintes', stripes_page), ('nuit-peinte', night_page), ('terre-peinte', earth_page)]

manifest = {'base': 'samples/', 'pages': []}
for name, fn in PAGES:
    im = draw_on(fn).filter(ImageFilter.GaussianBlur(0.6))
    im.save(f'{name}.jpg', quality=82, optimize=True)
    manifest['pages'].append({'file': f'{name}.jpg', 'name': f'Exemple — {name.replace("-", " ")}'})
for name, fn in BACKS:
    im = fn()
    im.save(f'{name}.jpg', quality=88, optimize=True)
    manifest['pages'].append({'file': f'{name}.jpg', 'name': f'Exemple — {name.replace("-", " ")}'})
json.dump(manifest, open('manifest.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(manifest['pages']), 'pages')
