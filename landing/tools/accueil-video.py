#!/usr/bin/env python3
"""Vidéo de tête de la page d'accueil (16:9, 25 s), tirée du réel Instagram de présentation.

Le réel (vertical, 1080 × 1920) fournit l'animation : sa zone visuelle (dessins qui s'empilent,
l'atelier à l'écran) est recadrée image par image et posée à droite, à même le fond, bords nets
(l'ombre de l'ordinateur, coupée par le bord du réel, s'éteint avant le bord) ; les légendes du
réel sont réécrites à gauche, en Playfair, aux mêmes instants. Deux écarts avec le réel :
- son gros plan sur la toile (10,3 s – 14,5 s, le poisson qui tourne) est réincrusté dans l'écran
  de l'ordinateur, sans zoom : la correspondance (échelle, position) entre chaque image du gros
  plan et l'écran tel qu'il est à 14,6 s est mesurée par corrélation (accueil-video-zoom.json,
  calculé une fois, --track pour le refaire) ;
- sa fin (le tableau encadré sur un mur beige, puis son carton) est remplacée par le même tableau
  accroché dans la chambre d'enfant de l'atelier (collage/assets/chambre.webp, éclairé par sa carte
  de lumière), sans carton de fin.
Entrées : le réel (hors dépôt), les polices du site, le tableau encadré tiré du réel
(accueil-video-tableau.jpg) et la chambre. Sorties : img/accueil-video-fr.mp4, -en.mp4 (1280 × 720),
l'affiche accueil-video-poster.webp et, avec --hd, une version 1920 × 1080.
Usage : python3 tools/accueil-video.py --reel <mp4> --fonts <dossier> [--ffmpeg <binaire>] [--hd <sortie.mp4>] [--track]
"""
import argparse, json, os, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FPS = 30
REEL_W, REEL_H = 1080, 1920
REEL_END = 25.0          # le carton de fin du réel n'est pas repris
CROP_Y0, CROP_Y1 = 500, 1560  # zone visuelle du réel, sous ses légendes
INK, INK2 = (43, 42, 34), (78, 76, 62)
BG = (244, 240, 232)      # le crème du réel autour de ses légendes
ZOOM_REF = 14.6           # l'écran de l'ordinateur, juste après le dézoom du réel : référence du réincrust
ZOOM_T0, ZOOM_T1 = 10.0, 14.7  # fenêtre où le gros plan est mesuré
SCREEN = (132, 776, 1045, 1404)  # la scène de l'atelier (à droite du panneau) dans l'écran de l'image de référence
ZOOM_START = 10.13        # juste après le fondu blanc du réel : dès là, l'écran est celui de la référence
BED_T = 18.3              # à partir de là : le tableau dans la chambre (fondu depuis l'ordinateur)
BED_FADE = 0.5
HERE = os.path.dirname(os.path.abspath(__file__))

# légendes (début, fin, runs [(texte, italique)]) — aux instants du réel
CAPTIONS = {
    'fr': [
        (0.3, 2.1, [('Les dessins de vos enfants', False)]),
        (2.4, 4.1, [('méritent mieux qu’un tiroir.', True)]),
        (4.4, 5.2, [('Importez leurs dessins', False)]),
        (5.5, 6.8, [('L’atelier les découpe ', False), ('à leur taille réelle', True)]),
        (7.2, 10.2, [('et compose ', False), ('votre tableau', True)]),
        (10.5, 13.7, [('Déplacez, tournez', False)]),
        (14.0, 16.5, [('changez le fond', False)]),
        (16.9, 18.2, [('Tout s’ajuste', True), (' à votre guise.', False)]),
        (18.5, 20.5, [('Imprimé, encadré, ', False), ('accroché.', True)]),
        (20.9, 22.2, [('Ou réalisé à la main, ', False), ('avec les originaux', True)]),
        (22.5, 24.9, [('grâce à un guide ', False), ('pas à pas.', True)]),
    ],
    'en': [
        (0.3, 2.1, [('Your children’s drawings', False)]),
        (2.4, 4.1, [('deserve better than a drawer.', True)]),
        (4.4, 5.2, [('Import their drawings', False)]),
        (5.5, 6.8, [('The studio cuts them out ', False), ('at their real size', True)]),
        (7.2, 10.2, [('and composes ', False), ('your artwork', True)]),
        (10.5, 13.7, [('Move, rotate', False)]),
        (14.0, 16.5, [('change the background', False)]),
        (16.9, 18.2, [('Everything adjusts', True), (' as you like.', False)]),
        (18.5, 20.5, [('Printed, framed, ', False), ('hung.', True)]),
        (20.9, 22.2, [('Or made by hand, ', False), ('with the originals', True)]),
        (22.5, 24.9, [('with a ', False), ('step-by-step guide.', True)]),
    ],
}
def ease(t): return 1 - (1 - t) ** 3

# ---------- le gros plan du réel, mesuré contre l'écran de référence ----------
def reel_frames(ffmpeg, reel, t0, t1, w, h, fmt='rgb24'):
    n = 3 if fmt == 'rgb24' else 1
    p = subprocess.Popen([ffmpeg, '-loglevel', 'error', '-ss', str(t0), '-t', str(t1 - t0), '-i', reel, '-vf', f'fps={FPS},scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', fmt, '-'], stdout=subprocess.PIPE)
    i = 0
    try:
        while True:
            b = p.stdout.read(w * h * n)
            if len(b) < w * h * n: break
            yield t0 + i / FPS, np.frombuffer(b, np.uint8).reshape((h, w, 3) if n == 3 else (h, w)); i += 1
    finally:
        if p.poll() is None: p.kill()
        p.wait()
def reel_frame(ffmpeg, reel, t, w, h, fmt='rgb24'):
    """une seule image du réel"""
    return next(iter(reel_frames(ffmpeg, reel, t, t + 0.05, w, h, fmt)))[1]

def track_zoom(ffmpeg, reel, out_json):
    """Pour chaque image entre ZOOM_T0 et ZOOM_T1 : échelle s et position (x, y), dans l'image de
    référence, de la zone que l'image couvre (corrélation normalisée, en demi-résolution)."""
    from scipy.signal import fftconvolve
    D = 2; W, H = REEL_W // D, REEL_H // D
    def ncc(R, T):
        T = T - T.mean(); tn = np.sqrt((T * T).sum()) + 1e-6
        h, w = T.shape; ones = np.ones_like(T)
        num = fftconvolve(R, T[::-1, ::-1], mode='valid')
        s1 = fftconvolve(R, ones, mode='valid'); s2 = fftconvolve(R * R, ones, mode='valid')
        c = num / (np.sqrt(np.maximum(s2 - s1 * s1 / (h * w), 1e-6)) * tn)
        k = np.unravel_index(np.argmax(c), c.shape)
        return float(c[k]), int(k[0]), int(k[1])
    R = reel_frame(ffmpeg, reel, ZOOM_REF, W, H, 'gray').astype(np.float32)
    out = []
    for t, Z in reel_frames(ffmpeg, reel, ZOOM_T0, ZOOM_T1, W, H, 'gray'):
        best = None
        for s in np.arange(1.0, 1.7, 0.01):
            tw, th = int(round(W / s)), int(round(H / s))
            T = np.asarray(Image.fromarray(Z).resize((tw, th), Image.BILINEAR), np.float32)
            sc, y, x = ncc(R, T)
            if best is None or sc > best[0]: best = (sc, float(s), x * D, y * D)
        out.append({'t': round(t, 3), 's': round(best[1], 3), 'x': best[2], 'y': best[3], 'score': round(best[0], 3)})
        print(f'  {t:6.2f} s={best[1]:.2f} x={best[2]} y={best[3]} ({best[0]:.2f})', flush=True)
    json.dump(out, open(out_json, 'w'))
    return out

def zoom_table(track):
    """Le relevé, lissé (médiane sur 5 images) : {image: (s, x, y)} pour les images zoomées."""
    s = np.array([r['s'] for r in track]); x = np.array([r['x'] for r in track], float); y = np.array([r['y'] for r in track], float)
    def med(a):
        b = a.copy()
        for i in range(len(a)): b[i] = np.median(a[max(0, i - 2):i + 3])
        return b
    s, x, y = med(s), med(x), med(y)
    ok = [i for i, r in enumerate(track) if s[i] > 1.005 and r['score'] >= 0.8]  # (score faible : le fondu blanc avant le gros plan)
    tab = {}
    for i, r in enumerate(track):
        f = int(round(r['t'] * FPS))
        if f < int(round(ZOOM_START * FPS)) or i > ok[-1]: continue
        tab[f] = (float(s[i]), float(x[i]), float(y[i])) if i in ok else (1.0, 0.0, 0.0)
    return tab

def wrap(runs, fonts, max_w):
    words = []
    for text, it in runs:
        parts = text.split(' ')
        for i, p in enumerate(parts):
            if p: words.append((p, it))
            if i < len(parts) - 1: words.append((' ', it))
    lines, cur, cur_w = [], [], 0
    for w, it in words:
        ww = fonts[it].getlength(w)
        if w != ' ' and cur_w + ww > max_w and cur:
            while cur and cur[-1][0] == ' ': cur.pop()
            lines.append(cur); cur, cur_w = [], 0
        if w == ' ' and not cur: continue
        cur.append((w, it)); cur_w += ww
    if cur: lines.append(cur)
    return lines

class Renderer:
    def __init__(self, out_w, out_h, fonts_dir):
        self.W, self.H = out_w, out_h
        k = self.k = out_w / 1920
        self.fonts = {False: ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay[wght].ttf'), int(64 * k)),
                      True: ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay-Italic[wght].ttf'), int(64 * k))}
        # zone visuelle du réel : hauteur 1000 (sur 1080), à droite
        self.vis_h = int(1000 * k); self.vis_w = int(self.vis_h * REEL_W / (CROP_Y1 - CROP_Y0))
        self.vis_x = self.W - self.vis_w - int(50 * k); self.vis_y = int(40 * k)
        self.col_x0, self.col_x1 = int(90 * k), self.vis_x - int(60 * k)
        # l'ombre de l'ordinateur atteint les bords gauche et droit du réel : elle s'éteint sur les
        # 200 derniers pixels (seuls les pixels proches du fond sont ramenés au fond, pas l'ordinateur)
        xs = np.arange(REEL_W)
        self.taper = np.clip(1 - np.minimum(xs, xs[::-1]) / 200.0, 0, 1)[None, :, None]
        self.bed = None

    def background(self):
        return Image.new('RGB', (self.W, self.H), BG)
    def crop(self, reel):
        """La zone visuelle du réel, bords nets, l'ombre coupée ramenée au fond près des bords."""
        c = reel[CROP_Y0:CROP_Y1].astype(np.float32)
        d = np.abs(c - np.array(BG, np.float32)).max(axis=2, keepdims=True)
        m = np.clip(1 - (d - 10) / 30.0, 0, 1)
        c = c + (np.array(BG, np.float32) - c) * self.taper * m
        return Image.fromarray(c.round().astype(np.uint8), 'RGB').resize((self.vis_w, self.vis_h), Image.LANCZOS)
    def unzoom(self, reel, ref, s, x, y):
        """Le gros plan (reel) réincrusté dans l'écran de référence : l'image entière du gros plan
        couvre, dans ref, la zone (x, y, REEL_W / s, REEL_H / s). Seule sa zone visuelle (sous les
        légendes du réel) est reprise, et seulement là où elle tombe dans l'écran : la lunette de
        l'ordinateur et tout le reste viennent de ref (pas de double contour pendant le zoom)."""
        w, h = int(round(REEL_W / s)), int(round((CROP_Y1 - CROP_Y0) / s))
        px, py = int(round(x)), int(round(y + CROP_Y0 / s))
        small = Image.fromarray(reel[CROP_Y0:CROP_Y1], 'RGB').resize((w, h), Image.LANCZOS)
        x0, y0, x1, y1 = max(px, SCREEN[0]), max(py, SCREEN[1]), min(px + w, SCREEN[2]), min(py + h, SCREEN[3])
        out = ref.copy()
        if x1 > x0 and y1 > y0: out.paste(small.crop((x0 - px, y0 - py, x1 - px, y1 - py)), (x0, y0))
        return np.asarray(out)
    def bedroom(self, assets, artwork, t):
        """La chambre d'enfant de l'atelier, le tableau du réel accroché au-dessus de l'étagère (il
        apparaît en fondu), éclairé par la carte de lumière de la pièce."""
        if self.bed is None:
            room = Image.open(os.path.join(assets, 'chambre.webp')).convert('RGB')
            light = Image.open(os.path.join(assets, 'chambre-lumiere.webp')).convert('L').resize(room.size, Image.BILINEAR)
            art = Image.open(artwork).convert('RGB')
            aw = 440; ah = int(round(art.height * aw / art.width))
            art = art.resize((aw, ah), Image.LANCZOS)
            ax, ay = 654 - aw // 2, 617 - ah  # centré sur l'étagère, 70 px au-dessus
            la = np.asarray(light.crop((ax, ay, ax + aw, ay + ah)), np.float32) / 255.0
            lit = np.asarray(art, np.float32) * (0.72 + 0.28 * la)[:, :, None]
            art = Image.fromarray(lit.round().astype(np.uint8), 'RGB')
            shadow = Image.new('RGBA', room.size, (0, 0, 0, 0))
            ImageDraw.Draw(shadow).rectangle((ax + 4, ay + 10, ax + aw + 4, ay + ah + 10), fill=(40, 25, 10, 110))
            shadow = shadow.filter(ImageFilter.GaussianBlur(16))
            over = Image.new('RGBA', room.size, (0, 0, 0, 0))
            over.alpha_composite(shadow); over.paste(art, (ax, ay))
            # recadrée à la proportion de la zone visuelle, centrée sur l'étagère
            cw = int(room.height * self.vis_w / self.vis_h); cx0 = max(0, min(room.width - cw, 654 - cw // 2))
            box = (cx0, 0, cx0 + cw, room.height)
            self.bed = (room.crop(box).resize((self.vis_w, self.vis_h), Image.LANCZOS), over.crop(box).resize((self.vis_w, self.vis_h), Image.LANCZOS))
        room, over = self.bed
        a = ease(min(1, max(0, (t - (BED_T + 0.2)) / 0.6)))
        img = room.copy()
        if a > 0:
            o = over.copy()
            if a < 1: o.putalpha(o.split()[3].point(lambda p: int(p * a)))
            img.paste(o, (0, 0), o)
        return img

    def caption(self, img, t, caps):
        for t0, t1, runs in caps:
            if t < t0 or t > t1 + 0.3: continue
            a = ease(min(1, max(0, (t - t0) / 0.3))) * ease(min(1, max(0, ((t1 + 0.3) - t) / 0.3)))
            if a <= 0: continue
            lines = wrap(runs, self.fonts, self.col_x1 - self.col_x0)
            lh = int(self.fonts[False].size * 1.25)
            y = (self.H - len(lines) * lh) // 2 + int((1 - a) * 14 * self.k)
            d = ImageDraw.Draw(img, 'RGBA')
            for li, line in enumerate(lines):
                tw = sum(self.fonts[it].getlength(w) for w, it in line)
                x = self.col_x0 + (self.col_x1 - self.col_x0 - tw) / 2
                for w, it in line:
                    d.text((x, y + li * lh), w, font=self.fonts[it], fill=(INK2 if it else INK) + (int(255 * a),))
                    x += self.fonts[it].getlength(w)

    def frame(self, vis, t, caps):
        img = self.background()
        img.paste(vis, (self.vis_x, self.vis_y))
        self.caption(img, t, caps)
        return img

def render(reel_path, lang, out_w, out_h, out_mp4, poster, fonts_dir, ffmpeg, zoom, artwork, assets):
    R = Renderer(out_w, out_h, fonts_dir)
    enc = subprocess.Popen([ffmpeg, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{out_w}x{out_h}', '-r', str(FPS), '-i', '-',
                            '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out_mp4], stdin=subprocess.PIPE)
    ref = Image.fromarray(reel_frame(ffmpeg, reel_path, ZOOM_REF, REEL_W, REEL_H), 'RGB')
    caps = CAPTIONS[lang]
    prev = None  # la dernière image de l'ordinateur, pour les fondus
    for i, (t, reel) in enumerate(reel_frames(ffmpeg, reel_path, 0, REEL_END, REEL_W, REEL_H)):
        z = zoom.get(i)
        if t >= BED_T:
            vis = R.bedroom(assets, artwork, t)
            a = ease(min(1, (t - BED_T) / BED_FADE))
            if a < 1 and prev is not None: vis = Image.blend(prev, vis, a)
        else:
            vis = R.crop(R.unzoom(reel, ref, *z) if z else reel)
            prev = vis
        img = R.frame(vis, t, caps)
        if poster and i == 0: img.save(poster, quality=82, method=6)
        enc.stdin.write(img.tobytes())
    enc.stdin.close(); enc.wait()
    n = i + 1
    print(f'{lang} {out_w}x{out_h} {n / FPS:.1f} s {os.path.getsize(out_mp4) // 1024} Ko')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--reel', required=True); ap.add_argument('--fonts', required=True); ap.add_argument('--ffmpeg', default='ffmpeg')
    ap.add_argument('--img', default=os.path.join(HERE, '..', 'img')); ap.add_argument('--hd')
    ap.add_argument('--track', action='store_true', help='remesurer le gros plan (accueil-video-zoom.json)')
    ap.add_argument('--assets', default=os.path.join(HERE, '..', '..', 'collage', 'assets'))
    a = ap.parse_args()
    zoom_json = os.path.join(HERE, 'accueil-video-zoom.json')
    track = track_zoom(a.ffmpeg, a.reel, zoom_json) if a.track or not os.path.exists(zoom_json) else json.load(open(zoom_json))
    zoom = zoom_table(track)
    artwork = os.path.join(HERE, 'accueil-video-tableau.jpg')
    render(a.reel, 'fr', 1280, 720, os.path.join(a.img, 'accueil-video-fr.mp4'), os.path.join(a.img, 'accueil-video-poster.webp'), a.fonts, a.ffmpeg, zoom, artwork, a.assets)
    render(a.reel, 'en', 1280, 720, os.path.join(a.img, 'accueil-video-en.mp4'), None, a.fonts, a.ffmpeg, zoom, artwork, a.assets)
    if a.hd: render(a.reel, 'fr', 1920, 1080, a.hd, None, a.fonts, a.ffmpeg, zoom, artwork, a.assets)
