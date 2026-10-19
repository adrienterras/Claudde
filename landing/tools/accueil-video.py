#!/usr/bin/env python3
"""Vidéo de tête de la page d'accueil : les six tableaux de la vidéo de présentation, en paysage.

Entrées : landing/img/accueil-*.webp (les visuels, 1200 × 900, tirés de la vidéo de présentation) et
les polices du site (Playfair Display, Montserrat). Sorties : landing/img/accueil-video-fr.mp4,
accueil-video-en.mp4 et accueil-video-poster.webp. Usage : python3 tools/accueil-video.py --fonts <dossier> [--ffmpeg <binaire>]
"""
import argparse, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1600, 1000, 30
SCENE_S, FADE_S = 4.2, 0.55           # durée d'un tableau, fondu entre deux tableaux
INK, INK2 = (43, 42, 34), (78, 76, 62)
SCENES = [
    ('tiroir', [('Les dessins de vos enfants ', False), ('méritent mieux qu’un tiroir.', True)], [('Your children’s drawings ', False), ('deserve better than a drawer.', True)]),
    ('importer', [('Importez leurs dessins : ', False), ('l’atelier les découpe', True), (' à leur taille réelle', False)], [('Import their drawings: ', False), ('the studio cuts them out', True), (' at their real size', False)]),
    ('composer', [('et ', False), ('compose votre tableau.', True)], [('and ', False), ('composes your artwork.', True)]),
    ('ajuster', [('Déplacez, tournez, changez le fond : ', False), ('tout s’ajuste', True), (' à votre guise.', False)], [('Move, rotate, change the background: ', False), ('everything adjusts', True), (' as you like.', False)]),
    ('encadre', [('Imprimé, encadré, ', False), ('accroché.', True)], [('Printed, framed, ', False), ('hung.', True)]),
    ('originaux', [('Ou réalisé à la main, ', False), ('avec les originaux,', True), (' grâce à un guide pas à pas.', False)], [('Or made by hand, ', False), ('with the originals,', True), (' with a step-by-step guide.', False)]),
]

def ease(t):  # sortie douce
    return 1 - (1 - t) ** 3

def wrap(runs, fonts, max_w):
    """Coupe des runs (texte, italique) en lignes de largeur max_w ; rend [[(mot, italique)…]…]."""
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
            if w == ' ': continue
        if w == ' ' and not cur: continue
        cur.append((w, it)); cur_w += ww
    if cur: lines.append(cur)
    return lines

def draw_caption(img, lines, fonts, y, alpha):
    d = ImageDraw.Draw(img, 'RGBA')
    lh = int(fonts[False].size * 1.22)
    for li, line in enumerate(lines):
        tw = sum(fonts[it].getlength(w) for w, it in line)
        x = (W - tw) / 2
        for w, it in line:
            col = (INK2 if it else INK) + (int(255 * alpha),)
            d.text((x, y + li * lh), w, font=fonts[it], fill=col)
            x += fonts[it].getlength(w)
    return len(lines) * lh

def card(visual, scale):
    """Le visuel, agrandi de scale, coins arrondis et ombre douce."""
    vw, vh = int(visual.width * scale), int(visual.height * scale)
    v = visual.resize((vw, vh), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (vw, vh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, vw - 1, vh - 1), radius=int(28 * scale), fill=255)
    v.putalpha(mask)
    pad = 60
    sh = Image.new('RGBA', (vw + 2 * pad, vh + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 22, pad + vw, pad + vh + 22), radius=int(28 * scale), fill=(40, 25, 10, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    sh.alpha_composite(v, (pad, pad))
    return sh, pad

def scene_frames(visual, caption, fonts, bg):
    n = int(SCENE_S * FPS)
    lines = wrap(caption, fonts, W - 240)
    cap_h = len(lines) * int(fonts[False].size * 1.22)
    top = 70
    avail = H - top - cap_h - 50 - 60
    base_scale = min((W - 320) / visual.width, avail / visual.height)
    frames = []
    for i in range(n):
        t = i / FPS
        img = Image.new('RGB', (W, H), bg)
        a_cap = ease(min(1, t / 0.5)); rise_cap = (1 - a_cap) * 18
        draw_caption(img, lines, fonts, top + rise_cap, a_cap)
        a_vis = ease(min(1, max(0, t - 0.15) / 0.6)); rise_vis = (1 - a_vis) * 40
        zoom = 1 + 0.03 * (t / SCENE_S)
        c, pad = card(visual, base_scale * zoom)
        cx = (W - c.width) // 2
        cy = int(top + cap_h + 40 + (avail - visual.height * base_scale) / 2 - pad + rise_vis - (visual.height * base_scale * (zoom - 1)) / 2)
        if a_vis < 1:
            al = c.split()[3].point(lambda p: int(p * a_vis)); c.putalpha(al)
        img.paste(c, (cx, cy), c)
        frames.append(img)
    return frames

def render(lang, out_mp4, poster, fonts_dir, ffmpeg, img_dir):
    fonts = {False: ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay[wght].ttf'), 62),
             True: ImageFont.truetype(os.path.join(fonts_dir, 'PlayfairDisplay-Italic[wght].ttf'), 62)}
    visuals = [Image.open(os.path.join(img_dir, f'accueil-{k}.webp')).convert('RGB') for k, _, _ in SCENES]
    bg = visuals[0].getpixel((6, 6))
    scenes = [scene_frames(v, fr if lang == 'fr' else en, fonts, bg) for v, (_, fr, en) in zip(visuals, SCENES)]
    nf = int(FADE_S * FPS)
    seq = []
    for si, fr in enumerate(scenes):
        nxt = scenes[(si + 1) % len(scenes)]
        body = fr[:len(fr) - nf]
        seq.extend(body)
        # fondu enchaîné vers le tableau suivant (le dernier revient au premier : la boucle est continue)
        for j in range(nf):
            k = ease(j / nf)
            seq.append(Image.blend(fr[len(fr) - nf + j], nxt[j], k))
    seq = seq[nf:]  # le début du premier tableau est déjà dans le fondu final
    if poster: scenes[0][int(1.2 * FPS)].save(poster, 'WEBP', quality=84, method=6)
    cmd = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out_mp4]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in seq: p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
    print(lang, len(seq) / FPS, 's', os.path.getsize(out_mp4) // 1024, 'Ko')

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--fonts', required=True); ap.add_argument('--ffmpeg', default='ffmpeg'); ap.add_argument('--img', default=os.path.join(os.path.dirname(__file__), '..', 'img'))
    a = ap.parse_args()
    render('fr', os.path.join(a.img, 'accueil-video-fr.mp4'), os.path.join(a.img, 'accueil-video-poster.webp'), a.fonts, a.ffmpeg, a.img)
    render('en', os.path.join(a.img, 'accueil-video-en.mp4'), None, a.fonts, a.ffmpeg, a.img)
