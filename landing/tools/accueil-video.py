#!/usr/bin/env python3
"""Vidéo de tête de la page d'accueil (16:9, moins de 30 s), tirée du réel Instagram de présentation.

Le réel (vertical, 1080 × 1920) fournit l'animation : sa zone visuelle (dessins qui s'empilent,
l'atelier à l'écran, le tableau encadré) est recadrée image par image et posée à droite ; les
légendes du réel sont réécrites à gauche, en Playfair, aux mêmes instants ; un carton de fin (logo,
promesse, adresse) termine. Deux langues. Entrées : le réel (hors dépôt), les polices du site et
img/logo-mark.png. Sorties : img/accueil-video-fr.mp4, -en.mp4 (1280 × 720), l'affiche
accueil-video-poster.webp et, avec --hd, une version 1920 × 1080.
Usage : python3 tools/accueil-video.py --reel <mp4> --fonts <dossier> [--ffmpeg <binaire>] [--hd <sortie.mp4>]
"""
import argparse, os, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FPS = 30
REEL_W, REEL_H = 1080, 1920
REEL_END = 25.0          # le carton de fin du réel n'est pas repris
CROP_Y0, CROP_Y1 = 500, 1560  # zone visuelle du réel, sous ses légendes
END_S = 3.0               # carton de fin
INK, INK2 = (43, 42, 34), (78, 76, 62)

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
END = {
    'fr': ('Les dessins d’enfants deviennent des œuvres d’art.', 'Gratuit pour composer · Votre tableau à partir de 14,90 €'),
    'en': ('Children’s drawings become works of art.', 'Free to compose · Your artwork from €14.90'),
}

def ease(t): return 1 - (1 - t) ** 3

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
    def __init__(self, out_w, out_h, fonts_dir, logo):
        self.W, self.H = out_w, out_h
        k = self.k = out_w / 1920
        self.fonts = {False: ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay[wght].ttf'), int(64 * k)),
                      True: ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay-Italic[wght].ttf'), int(64 * k))}
        self.f_brand = ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay[wght].ttf'), int(124 * k))
        self.f_tag = ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay-Italic[wght].ttf'), int(46 * k))
        self.f_small = ImageFont.truetype(os.path.join(fonts_dir, 'Montserrat[wght].ttf'), int(27 * k))
        self.f_kicker = ImageFont.truetype(os.path.join(fonts_dir, 'Montserrat[wght].ttf'), int(26 * k))
        self.f_pill = ImageFont.truetype(os.path.join(fonts_dir, 'Montserrat[wght].ttf'), int(34 * k))
        self.logo = Image.open(logo).convert('RGBA')
        # zone visuelle du réel : hauteur 1000 (sur 1080), à droite
        self.vis_h = int(1000 * k); self.vis_w = int(self.vis_h * REEL_W / (CROP_Y1 - CROP_Y0))
        self.vis_x = self.W - self.vis_w - int(50 * k); self.vis_y = int(40 * k)
        self.col_x0, self.col_x1 = int(90 * k), self.vis_x - int(60 * k)
        self.shadow = None

    def background(self, reel):
        """Un fond uni : la couleur du réel autour de ses légendes (crème, ou le mur beige à la fin)."""
        bg = tuple(int(v) for v in reel[150:300, 10:60].reshape(-1, 3).mean(axis=0))
        return Image.new('RGB', (self.W, self.H), bg)
    def card(self, vis):
        """La zone visuelle du réel, en carte aux coins arrondis avec une ombre douce."""
        k = self.k; r = int(26 * k); pad = int(50 * k)
        mask = Image.new('L', vis.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, vis.width - 1, vis.height - 1), radius=r, fill=255)
        if self.shadow is None:
            sh = Image.new('RGBA', (vis.width + 2 * pad, vis.height + 2 * pad), (0, 0, 0, 0))
            ImageDraw.Draw(sh).rounded_rectangle((pad, pad + int(18 * k), pad + vis.width, pad + vis.height + int(18 * k)), radius=r, fill=(40, 25, 10, 60))
            self.shadow = sh.filter(ImageFilter.GaussianBlur(int(22 * k)))
        out = self.shadow.copy()
        v = vis.convert('RGBA'); v.putalpha(mask)
        out.alpha_composite(v, (pad, pad))
        return out, pad

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

    def frame(self, reel, t, caps):
        img = self.background(reel)
        vis = Image.fromarray(reel[CROP_Y0:CROP_Y1], 'RGB').resize((self.vis_w, self.vis_h), Image.LANCZOS)
        c, pad = self.card(vis)
        img.paste(c, (self.vis_x - pad, self.vis_y - pad), c)
        self.caption(img, t, caps)
        return img

    def end_card(self, t, lang, bg):
        k = self.k
        img = Image.new('RGB', (self.W, self.H), bg)
        a = ease(min(1, t / 0.5))
        layer = Image.new('RGBA', (self.W, self.H), bg + (0,))
        d = ImageDraw.Draw(layer)
        cx = self.W // 2
        logo = self.logo.resize((int(150 * k), int(150 * k)), Image.LANCZOS)
        y = int(165 * k)
        layer.alpha_composite(logo, (cx - logo.width // 2, y)); y += logo.height + int(26 * k)
        kick = 'A T E L I E R'
        d.text((cx - self.f_kicker.getlength(kick) / 2, y), kick, font=self.f_kicker, fill=INK + (255,)); y += int(44 * k)
        d.text((cx - self.f_brand.getlength('Gribouille') / 2, y), 'Gribouille', font=self.f_brand, fill=INK + (255,)); y += int(150 * k)
        tag, small = END[lang]
        d.text((cx - self.f_tag.getlength(tag) / 2, y), tag, font=self.f_tag, fill=INK2 + (255,)); y += int(76 * k)
        d.text((cx - self.f_small.getlength(small) / 2, y), small, font=self.f_small, fill=INK2 + (255,)); y += int(70 * k)
        pw, ph = int(self.f_pill.getlength('ateliergribouille.art') + 70 * k), int(66 * k)
        d.rounded_rectangle((cx - pw // 2, y, cx + pw // 2, y + ph), radius=ph // 2, fill=INK + (255,))
        d.text((cx - self.f_pill.getlength('ateliergribouille.art') / 2, y + int(15 * k)), 'ateliergribouille.art', font=self.f_pill, fill=(248, 245, 239, 255))
        if a < 1: layer.putalpha(layer.split()[3].point(lambda p: int(p * a)))
        img.paste(layer, (0, 0), layer)
        return img

def render(reel_path, lang, out_w, out_h, out_mp4, poster, fonts_dir, ffmpeg, logo):
    R = Renderer(out_w, out_h, fonts_dir, logo)
    dec = subprocess.Popen([ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', reel_path, '-t', str(REEL_END), '-r', str(FPS), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{REEL_W}x{REEL_H}', '-'], stdout=subprocess.PIPE)
    enc = subprocess.Popen([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{out_w}x{out_h}', '-r', str(FPS), '-i', '-',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out_mp4], stdin=subprocess.PIPE)
    n = REEL_W * REEL_H * 3
    i = 0; bg = None
    while True:
        buf = dec.stdout.read(n)
        if len(buf) < n: break
        reel = np.frombuffer(buf, np.uint8).reshape(REEL_H, REEL_W, 3)
        if bg is None: bg = tuple(int(v) for v in reel[300, 6])
        img = R.frame(reel, i / FPS, CAPTIONS[lang])
        if poster and i == int(1.2 * FPS): img.save(poster, 'WEBP', quality=84, method=6)
        enc.stdin.write(img.tobytes()); i += 1
    dec.wait()
    for j in range(int(END_S * FPS)):
        enc.stdin.write(R.end_card(j / FPS, lang, bg).tobytes()); i += 1
    enc.stdin.close(); enc.wait()
    print(lang, f'{out_w}x{out_h}', round(i / FPS, 1), 's', os.path.getsize(out_mp4) // 1024, 'Ko')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--reel', required=True); ap.add_argument('--fonts', required=True); ap.add_argument('--ffmpeg', default='ffmpeg')
    ap.add_argument('--img', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img')); ap.add_argument('--hd')
    a = ap.parse_args()
    logo = os.path.join(a.img, 'logo-mark.png')
    render(a.reel, 'fr', 1280, 720, os.path.join(a.img, 'accueil-video-fr.mp4'), os.path.join(a.img, 'accueil-video-poster.webp'), a.fonts, a.ffmpeg, logo)
    render(a.reel, 'en', 1280, 720, os.path.join(a.img, 'accueil-video-en.mp4'), None, a.fonts, a.ffmpeg, logo)
    if a.hd: render(a.reel, 'fr', 1920, 1080, a.hd, None, a.fonts, a.ffmpeg, logo)
