"""
Recorta folhas de sprites com fundo xadrez "falso" (cinza, gravado no JPG)
e gera um atlas PNG transparente + metadados JS para o jogo.

Uso:  python tools/extract_sprites.py archer mage:glow goblin@0.35
      (":glow" = tira o halo de brilho · ":split" = separa quadros grudados em todas as linhas · "@0.35" = escala, padrão 0.5)
      (lê assets/src/<nome>.jpg, grava assets/<nome>.png e js/sprites-data.js)

Layout esperado da folha: linhas de frames separadas por espaço vazio.
  linha 1 = parado (idle) · linha 2 = ataque (virado p/ direita) · linha 3 = outros ângulos
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SCALE = 0.5          # frames saem com ~metade do tamanho original (~100px de altura)
PAD = 2


# Tons do xadrez (casa escura / clara) medidos na borda de cada folha — algumas vêm com xadrez mais escuro.
T = {'dark': 77.0, 'light': 116.0}


def measure_tones(a):
    e = np.concatenate([a[:12].reshape(-1, 3), a[-12:].reshape(-1, 3), a[:, :12].reshape(-1, 3), a[:, -12:].reshape(-1, 3)])
    v = e.mean(1)
    mid = (np.percentile(v, 5) + np.percentile(v, 95)) / 2
    T['dark'], T['light'] = float(np.median(v[v < mid])), float(np.median(v[v >= mid]))
    T['mid'] = (T['dark'] + T['light']) / 2
    T['lo'], T['hi'] = T['dark'] - 12, T['light'] + 16   # faixa "parece fundo" (o contorno preto fica abaixo)


def background_mask(a):
    """Fundo = pixels cinza-neutros conectados à borda (o contorno preto do personagem barra o avanço)."""
    sat = a.max(2) - a.min(2)
    v = a.mean(2)
    cand = (sat <= 14) & (v >= T['lo']) & (v <= T['hi'])
    bg = np.zeros_like(cand)
    bg[0], bg[-1], bg[:, 0], bg[:, -1] = cand[0], cand[-1], cand[:, 0], cand[:, -1]
    n = bg.sum()
    while True:
        d = bg.copy()
        d[1:] |= bg[:-1]; d[:-1] |= bg[1:]; d[:, 1:] |= bg[:, :-1]; d[:, :-1] |= bg[:, 1:]
        d &= cand
        m = d.sum()
        if m == n:
            return d
        bg, n = d, m


def grow(seed, allowed):
    """Expande seed por vizinhança-4 dentro de allowed até estabilizar."""
    bg, n = seed & allowed | seed, seed.sum()
    while True:
        d = bg.copy()
        d[1:] |= bg[:-1]; d[:-1] |= bg[1:]; d[:, 1:] |= bg[:, :-1]; d[:, :-1] |= bg[:, 1:]
        d = (d & allowed) | seed
        m = d.sum()
        if m == n:
            return d
        bg, n = d, m


def label(mask):
    """Rotula componentes conexos (vizinhança-4) propagando o menor índice."""
    lab = np.where(mask, np.arange(mask.size).reshape(mask.shape) + 1, 0).astype(np.int64)
    big = np.int64(mask.size + 10)
    while True:
        cur = np.where(mask, lab, big)
        m = cur.copy()
        m[1:] = np.minimum(m[1:], cur[:-1]); m[:-1] = np.minimum(m[:-1], cur[1:])
        m[:, 1:] = np.minimum(m[:, 1:], cur[:, :-1]); m[:, :-1] = np.minimum(m[:, :-1], cur[:, 1:])
        new = np.where(mask, m, 0)
        if (new == lab).all():
            return lab
        lab = new


def checker_model(a, bg):
    """Estima a grade do xadrez (tamanho/fase das casas) pela borda da imagem.
    Devolve (casa_clara_esperada, perto_da_divisa)."""
    v = a.mean(2)

    def fit(profile):
        idx = np.where(np.abs(np.diff(profile)) > 15)[0]
        pts = []
        for i in idx:
            if not pts or i - pts[-1] > 3:
                pts.append(i)
        pts = np.array(pts, float)
        k = np.round((pts - pts[0]) / np.median(np.diff(pts)))
        s, o = np.polyfit(k, pts, 1)
        return s, o + 0.5

    sx, x0 = fit(v[3])
    sy, y0 = fit(v[:, 3])
    yy, xx = np.mgrid[0:v.shape[0], 0:v.shape[1]]
    fx, fy = (xx - x0) / sx, (yy - y0) / sy
    light = ((np.floor(fx) + np.floor(fy)) % 2).astype(bool)
    if (light == (v > T['mid']))[bg].mean() < 0.5:
        light = ~light
    near = (np.minimum(fx % 1, 1 - fx % 1) * sx < 2.5) | (np.minimum(fy % 1, 1 - fy % 1) * sy < 2.5)
    return light, near


def enclosed_checker(a, bg):
    """Buracos fechados (ex.: entre o arco e a corda) cujo cinza bate com a casa do xadrez naquela posição."""
    sat = a.max(2) - a.min(2)
    v = a.mean(2)
    cand = (sat <= 14) & (v >= T['lo']) & (v <= T['hi']) & ~bg
    light, near = checker_model(a, bg)
    dark = (sat <= 10) & (v >= T['dark'] - 12) & (v <= T['dark'] + 14)
    lite = (sat <= 10) & (v >= T['light'] - 13) & (v <= T['light'] + 13)
    tone = np.where(near, (sat <= 10) & (v >= T['dark'] - 12) & (v <= T['light'] + 13), np.where(light, lite, dark))
    lab = label(cand)
    ids, inv = np.unique(lab, return_inverse=True)
    inv = inv.reshape(lab.shape)
    total = np.maximum(np.bincount(inv.ravel()), 1)
    frac = lambda m: np.bincount(inv.ravel(), weights=m.ravel()) / total
    g, d, l = frac(tone), frac(dark), frac(lite)
    # xadrez = tem os dois tons (barba/metal cinza tem quase só um) ou casa muito bem com a grade
    ok = (((np.minimum(d, l) >= 0.25) & (d + l >= 0.8)) | (g >= 0.9)) & (ids > 0)
    return ok[inv]


def dilate(m, r):
    for _ in range(r):
        d = m.copy()
        d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
        m = d
    return m


def strip_glow(a, bg):
    """Halo semitransparente (brilho azulado sobre o xadrez) perto do cristal e encostado no fundo vira fundo."""
    sat = a.max(2) - a.min(2)
    v = a.mean(2)
    crystal = (v >= 205) & (a[..., 2] >= a[..., 0])
    near = dilate(crystal, 55)
    glowish = near & (v >= 100) & (v <= 215) & (a[..., 2] >= a[..., 0] + 4) & (sat <= 70)
    return grow(bg, glowish | bg)


def clean_fringe(a, bg, passes=2):
    """Tira a franja acinzentada do JPG que gruda no contorno."""
    sat = a.max(2) - a.min(2)
    v = a.mean(2)
    grayish = (sat <= 24) & (v >= max(T['dark'] - 28, 42)) & (v <= T['light'] + 28)
    for _ in range(passes):
        near = np.zeros_like(bg)
        near[1:] |= bg[:-1]; near[:-1] |= bg[1:]; near[:, 1:] |= bg[:, :-1]; near[:, :-1] |= bg[:, 1:]
        bg = bg | (near & grayish)
    return bg


def runs(profile, min_val, merge_gap):
    """Faixas contíguas onde profile > min_val, unindo buracos menores que merge_gap."""
    on = profile > min_val
    out, start = [], None
    for i, x in enumerate(on):
        if x and start is None:
            start = i
        elif not x and start is not None:
            out.append([start, i]); start = None
    if start is not None:
        out.append([start, len(on)])
    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] < merge_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return merged


def make_frame(mask, X0, Y0):
    """Quadro a partir de uma máscara (região começando em X0,Y0): recorta justo e acha o pé."""
    ys, xs = np.where(mask)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    m = mask[by0:by1, bx0:bx1]
    feet = m[-max(8, m.shape[0] // 8):]
    ax = float(np.where(feet.any(0))[0].mean()) if feet.any() else m.shape[1] / 2
    return {'box': (X0 + bx0, Y0 + by0, X0 + bx1, Y0 + by1), 'ax': ax, 'mask': m}


def split_region(sub, n):
    """Separa n personagens que ficaram no mesmo retângulo (asas/armas se sobrepondo na horizontal).
    Usa as partes conectadas da imagem: as grandes viram personagens, as pequenas vão p/ o mais próximo."""
    lab = label(sub)
    ids, inv = np.unique(lab, return_inverse=True)
    inv = inv.reshape(sub.shape)
    counts = np.bincount(inv.ravel())
    cx = np.bincount(inv.ravel(), weights=np.indices(sub.shape)[1].ravel()) / np.maximum(counts, 1)
    comps = sorted((i for i in range(len(ids)) if ids[i] != 0), key=lambda i: -counts[i])
    big = [i for i in comps if counts[i] >= 0.1 * counts[comps[0]]]
    groups = [[i] for i in big]
    gcx = lambda g: sum(cx[i] * counts[i] for i in g) / sum(counts[i] for i in g)
    while len(groups) > n:                     # junta as partes grandes mais próximas
        groups.sort(key=gcx)
        j = min(range(len(groups) - 1), key=lambda k: gcx(groups[k + 1]) - gcx(groups[k]))
        groups[j] += groups.pop(j + 1)
    if len(groups) < n:                        # personagens encostados: corta no vale da projeção
        prof = sub.sum(0)
        w = sub.shape[1]
        cuts = []
        for k in range(1, n):
            c, r = int(w * k / n), max(4, w // (3 * n))
            cuts.append(c - r + int(np.argmin(prof[c - r:c + r])))
        edges = [0] + cuts + [w]
        out = []
        for a_, b_ in zip(edges, edges[1:]):
            m = np.zeros_like(sub); m[:, a_:b_] = sub[:, a_:b_]; out.append(m)
        return out
    for i in comps:
        if i not in big:
            min(groups, key=lambda g: abs(gcx(g) - cx[i])).append(i)
    groups.sort(key=gcx)
    return [np.isin(inv, g) for g in groups]


def extract(name, glow=False, scale=SCALE, split_all=False):
    src = ROOT / 'assets' / 'src' / f'{name}.jpg'
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.int16)
    measure_tones(a)
    bg = background_mask(a)
    bg |= enclosed_checker(a, bg)
    if glow:
        bg = strip_glow(a, bg)
        bg |= enclosed_checker(a, bg)
    bg = clean_fringe(a, bg)
    fg = ~bg
    # ponto mais brilhante (cristal) — o jogo desenha o brilho ali
    v = a.mean(2)
    bright = fg & (v >= 205) & (a[..., 2] >= a[..., 0])
    rgba = np.dstack([a.astype(np.uint8), np.where(fg, 255, 0).astype(np.uint8)])

    bands = [(y0, y1) for y0, y1 in runs(fg.sum(1), 2, 20) if y1 - y0 >= 60]
    rows = []
    for ri, (y0, y1) in enumerate(bands):
        spans = [(x0, x1) for x0, x1 in runs(fg[y0:y1].sum(0), 0, 14) if fg[y0:y1, x0:x1].sum() >= 1500]
        if not spans:
            continue
        med = float(np.median([x1 - x0 for x0, x1 in spans]))
        frames = []
        for x0, x1 in spans:
            sub = fg[y0:y1, x0:x1]
            # retângulo largo demais na 1ª linha (caminhada) ou na última (poses/morto) = 2+ personagens grudados
            n = round((x1 - x0) / med) if len(spans) > 1 else 1
            parts = split_region(sub, n) if n >= 2 and (x1 - x0) > 1.6 * med and (split_all or ri in (0, len(bands) - 1)) else [sub]
            for m in parts:
                if m.sum() < 1500:
                    continue
                f = make_frame(m, x0, y0)
                if glow:
                    bx0, by0, bx1, by1 = f['box']
                    by, bx = np.where(bright[by0:by1, bx0:bx1] & f['mask'])
                    if len(bx) >= 8:
                        f['g'] = (float(bx.mean()), float(by.mean()))
                frames.append(f)
        if frames:
            rows.append(frames)

    # monta o atlas (uma linha do atlas por linha da folha)
    imgs = []
    for frames in rows:
        line = []
        for f in frames:
            x0, y0, x1, y1 = f['box']
            px = rgba[y0:y1, x0:x1].copy()
            px[..., 3] = np.where(f['mask'], 255, 0)   # só o personagem deste quadro (sem pedaço do vizinho)
            im = Image.fromarray(px, 'RGBA').convert('RGBa')
            w, h = max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale))
            im = im.resize((w, h), Image.LANCZOS).convert('RGBA')
            line.append((im, f['ax'] * scale, f.get('g')))
        imgs.append(line)
    W = max(sum(im.width + PAD for im, _, _ in line) for line in imgs) + PAD
    H = sum(max(im.height for im, _, _ in line) + PAD for line in imgs) + PAD
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    meta, y = [], PAD
    for line in imgs:
        x, mrow = PAD, []
        lh = max(im.height for im, _, _ in line)
        for im, ax, g in line:
            atlas.paste(im, (x, y))
            fm = {'x': x, 'y': y, 'w': im.width, 'h': im.height, 'ax': round(ax, 1), 'ay': im.height}
            if g:
                fm['gx'], fm['gy'] = round(g[0] * scale, 1), round(g[1] * scale, 1)
            mrow.append(fm)
            x += im.width + PAD
        meta.append(mrow)
        y += lh + PAD
    atlas.save(ROOT / 'assets' / f'{name}.png', optimize=True)
    print(f'{name}: {[len(r) for r in meta]} frames por linha, atlas {W}x{H}')
    return {'src': f'assets/{name}.png', 'rows': meta}


def main(names):
    data_file = ROOT / 'js' / 'sprites-data.js'
    data = {}
    if data_file.exists():
        txt = data_file.read_text(encoding='utf-8')
        data = json.loads(txt[txt.index('{'):txt.rindex('}') + 1])
    for n in names:
        # "mage:glow" = remove o halo do cristal e registra a posição dele em cada frame
        # "goblin@0.35" = escala de saída (inimigos aparecem menores, atlas mais leve)
        n, _, sc = n.partition('@')
        key, _, opt = n.partition(':')
        opts = opt.split(':')
        data[key] = extract(key, glow='glow' in opts, scale=float(sc) if sc else SCALE, split_all='split' in opts)
        # grava a cada folha: se parar no meio, o que já foi feito fica salvo
        data_file.write_text(
            '// Gerado por tools/extract_sprites.py — não editar à mão.\n'
            f'const SPRITE_DATA = {json.dumps(data, ensure_ascii=False)};\n', encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv[1:] or ['archer', 'mage:glow'])
