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

# ---------- pages de fond (entièrement peintes) ----------
def wash(color, color2, strokes=80, blur=5, extra=()):
    """aplat de peinture : larges coups de brosse dans une gamme de couleurs assez variée
    (comme une vraie page peinte, où aucune teinte ne domine tout à fait)"""
    im = Image.new('RGB', (W, H), color); d = ImageDraw.Draw(im)
    fam = [color, color2] + list(extra)
    for _ in range(strokes):
        y = random.randrange(-50, H + 50); x = random.randrange(-200, W)
        a, b = random.sample(fam, 2)
        c = tuple(int(u + (v - u) * random.random()) for u, v in zip(a, b))
        d.line([(x, y), (x + random.randint(300, 900), y + random.randint(-60, 60))], fill=c, width=random.randint(40, 110))
    return im.filter(ImageFilter.GaussianBlur(blur))

def sky_page():
    im = wash((90, 150, 215), (175, 210, 240), 110, 5, extra=[(140, 120, 200), (230, 170, 190), (250, 225, 150)])
    d = ImageDraw.Draw(im); d._image = im
    for cx, cy in ((300, 400), (900, 650), (500, 1250), (950, 1450)):
        for k in range(5):
            p = circle_pts(cx + (k - 2) * 75, cy + (0 if k % 2 else 40), 90, 24)
            ImageDraw.Draw(im).ellipse((p[0][0] - 90, cy - 90, p[0][0] + 90, cy + 90), fill=(246, 248, 252))
        stroke(d, [(cx - 230, cy + 85), (cx + 230, cy + 85)], (235, 240, 248), 20)
    return im

def grass_page():
    im = wash((60, 135, 60), (150, 200, 80), 130, 4, extra=[(220, 200, 60), (120, 90, 40), (90, 170, 140)])
    d = ImageDraw.Draw(im); d._image = im
    for _ in range(400):
        x = random.randrange(W); y = random.randrange(H)
        stroke(d, [(x, y), (x + random.randint(-15, 15), y - random.randint(30, 80))], (40 + random.randint(0, 40), 100 + random.randint(0, 60), 40), 6, amp=1, passes=1)
    for _ in range(30):
        x, y = random.randrange(W), random.randrange(H)
        stroke(d, circle_pts(x, y, 14, 12), random.choice([YELLOW, PINK, (250, 250, 250)]), 10, closed=True, passes=1)
    return im

def stripes_page():
    im = Image.new('RGB', (W, H), (250, 248, 240)); d = ImageDraw.Draw(im); d._image = im
    cols = [RED, ORANGE, YELLOW, GREEN, BLUE, PURPLE, PINK]
    y = -40
    i = 0
    while y < H + 40:
        h = random.randint(110, 190)
        poly = [(-30, y), (W + 30, y + random.randint(-20, 20)), (W + 30, y + h), (-30, y + h + random.randint(-20, 20))]
        crayon_fill(d, poly, cols[i % len(cols)], spacing=10, angle=random.choice([0, 90, 35]), width=10)
        y += h - 10; i += 1
    return im

def night_page():
    im = wash((25, 35, 90), (80, 70, 170), 170, 3, extra=[(140, 60, 150), (30, 120, 150), (210, 130, 70), (60, 160, 120)])
    d = ImageDraw.Draw(im); d._image = im
    for _ in range(26):
        cx, cy = random.randrange(80, W - 80), random.randrange(80, H - 80); r = random.randint(25, 60)
        pts = [(cx + (r if k % 2 == 0 else r * 0.45) * math.cos(-math.pi / 2 + k * math.pi / 5), cy + (r if k % 2 == 0 else r * 0.45) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]
        felt_fill(d, pts, YELLOW); stroke(d, pts, (250, 220, 90), 5, closed=True, passes=1)
    moon = circle_pts(900, 350, 150); felt_fill(d, moon, (250, 240, 200))
    ImageDraw.Draw(im).ellipse((860, 190, 1150, 480), fill=(28, 38, 95))
    return im

def earth_page():
    im = wash((150, 95, 55), (220, 170, 100), 170, 3, extra=[(200, 70, 50), (235, 205, 90), (80, 55, 40), (120, 150, 70)])
    d = ImageDraw.Draw(im); d._image = im
    for _ in range(60):
        x, y = random.randrange(W), random.randrange(H)
        stroke(d, circle_pts(x, y, random.randint(20, 60), 16), (110 + random.randint(0, 40), 70, 40), 8, closed=True, passes=1)
    return im

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
    im = fn().filter(ImageFilter.GaussianBlur(0.6))
    im.save(f'{name}.jpg', quality=80, optimize=True)
    manifest['pages'].append({'file': f'{name}.jpg', 'name': f'Exemple — {name.replace("-", " ")}'})
json.dump(manifest, open('manifest.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(manifest['pages']), 'pages')
