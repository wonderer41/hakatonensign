import random, math, sys

def hexmix(a, b, t):
    a = [int(a[i:i+2], 16) for i in (1, 3, 5)]
    b = [int(b[i:i+2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02X}' for x, y in zip(a, b))

def pick(rng, weights):
    t = rng.uniform(0, sum(w for _, w in weights))
    for c, w in weights:
        t -= w
        if t <= 0:
            return c
    return weights[-1][0]

DARK = [("#173A44", 3), ("#1F4E5A", 3), ("#2A5C66", 2), ("#24493A", 3), ("#2E3A5E", 2), ("#3D3A6B", 2), ("#33503A", 2)]
MID = [("#3E6A3E", 3), ("#4F7A4B", 3), ("#5B5296", 2), ("#7C70B8", 2), ("#2E6B73", 2), ("#6B8F6A", 1)]
BRIGHT = [("#E59AB5", 3), ("#9C8FD0", 3), ("#E8C77A", 2), ("#E9DCC0", 1), ("#C98AA5", 2)]
STREAK = ["#E9DCC0", "#9C8FD0", "#4F7A4B", "#0E1A1F", "#E59AB5", "#2E6B73"]

def gen(W, H, seed, scale=1.0, prefix="k"):
    rng = random.Random(seed)
    swipes = []
    A = (W * H) / (720 * 450)
    def add(col, cx, cy, th, L, Wd, kind):
        if rng.random() < 0.5:
            th += math.pi
        swipes.append((col, cx, cy, th, L * scale, Wd * scale, kind))
    # 1. water: long, flat, horizontal knife passes in deep teal and indigo
    WATER = [("#173A44", 3), ("#1F4E5A", 3), ("#2A5C66", 2), ("#24493A", 2), ("#2E3A5E", 2), ("#3D3A6B", 1)]
    y = -10.0
    while y < H + 20:
        x = rng.uniform(-90, -20)
        while x < W + 60:
            L = rng.uniform(110, 200)
            add(pick(rng, WATER), x + L / 2, y + rng.uniform(-5, 5), rng.gauss(0, 0.05), L, rng.uniform(34, 56), "water")
            x += L * rng.uniform(0.55, 0.8)
        y += rng.uniform(27, 35)
    # 2. vertical reflections of willows: dark columns of downward strokes
    REFL = [("#1A2C2A", 3), ("#24493A", 2), ("#2E3A5E", 2), ("#3D3A6B", 2), ("#173A44", 1)]
    for _ in range(max(3, int(5 * A))):
        x = rng.uniform(0, W)
        yy = rng.uniform(-40, H * 0.25)
        for _ in range(rng.randint(4, 7)):
            L = rng.uniform(60, 120)
            add(pick(rng, REFL), x + rng.uniform(-14, 14), yy + L / 2, math.pi / 2 + rng.gauss(0, 0.07), L, rng.uniform(22, 38), "refl")
            yy += L * rng.uniform(0.6, 0.85)
    # 3. sky reflections: lighter lilac and blue patches laid horizontally
    SKY = [("#7C70B8", 3), ("#9C8FD0", 2), ("#5B5296", 2), ("#8FA9C4", 2), ("#B7ACEB", 1)]
    for _ in range(max(2, int(3 * A))):
        cx0, cy0 = rng.uniform(W * 0.1, W * 0.9), rng.uniform(H * 0.1, H * 0.9)
        for _ in range(rng.randint(5, 9)):
            add(hexmix(pick(rng, SKY), "#0E1A1F", rng.uniform(0.1, 0.35)), cx0 + rng.gauss(0, 50), cy0 + rng.gauss(0, 14), rng.gauss(0, 0.08), rng.uniform(60, 130), rng.uniform(20, 36), "sky")
    # 4. lily pad rafts: foreshortened horizontal clusters, smaller toward the top
    PAD = [("#3E6A3E", 3), ("#4F7A4B", 3), ("#6B8F6A", 2), ("#33503A", 2), ("#8FA35A", 1)]
    FLOWER = [("#E59AB5", 3), ("#F4C3D5", 2), ("#E9DCC0", 1), ("#C98AA5", 2)]
    centres = []
    for k in range(max(5, int(7 * A))):
        t = (k + rng.uniform(0, 0.8)) / max(5, int(7 * A))
        centres.append((W * (0.05 + 0.9 * t) + rng.uniform(-40, 40), H * (0.85 - 0.6 * t) + rng.uniform(-50, 50)))
    centres.append((rng.uniform(W * 0.6, W * 0.95), rng.uniform(H * 0.6, H * 0.9)))
    for cx0, cy0 in centres:
        sz = 0.55 + 0.6 * max(0, min(1, cy0 / H))
        rx, ry = 95 * sz, 26 * sz
        for _ in range(rng.randint(8, 14)):
            a, r = rng.uniform(0, 2 * math.pi), math.sqrt(rng.random())
            add(pick(rng, PAD), cx0 + math.cos(a) * rx * r, cy0 + math.sin(a) * ry * r, rng.gauss(0, 0.12), rng.uniform(30, 60) * sz, rng.uniform(18, 34) * sz, "pad")
        for _ in range(rng.randint(1, 3)):
            a, r = rng.uniform(0, 2 * math.pi), math.sqrt(rng.random()) * 0.6
            add(pick(rng, FLOWER), cx0 + math.cos(a) * rx * r, cy0 + math.sin(a) * ry * r - 4 * sz, rng.uniform(-0.6, 0.6), rng.uniform(14, 24) * sz, rng.uniform(12, 20) * sz, "flower")
    def tr(cx, cy, th, L):
        c, s = math.cos(th), math.sin(th)
        ox, oy = cx - c * L / 2, cy - s * L / 2
        return lambda u, v: (ox + u * c - v * s, oy + u * s + v * c)

    def poly(pts):
        return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + 'Z'

    color, height, grads = [], [], []
    smears = []
    for i, (col, cx, cy, th, L, Wd, kind) in enumerate(swipes):
        T0 = tr(cx, cy, th, L)
        wamp = rng.uniform(0.02, 0.14) * Wd
        wf = rng.uniform(0.8, 2.4) * 2 * math.pi / max(L, 1)
        wph = rng.uniform(0, 2 * math.pi)
        T = lambda u, v, T0=T0, wamp=wamp, wf=wf, wph=wph: T0(u, v + wamp * math.sin(wf * u + wph))
        hw = Wd / 2
        cu = L - hw  # centre of the rounded end
        rw = rng.uniform(0.06, 0.3) * Wd * rng.choice([0.6, 1.0, 1.0, 1.5])
        ridge_h = rng.uniform(0.66, 1.0)
        has_ridge = rng.random() > 0.2
        pw = rng.uniform(0.5, 0.75)
        bulge = rng.uniform(0.0, 0.18)
        def prof(u):
            t = max(0.0, min(1.0, u / cu))
            return hw * (t ** pw) * (1 + bulge * math.sin(math.pi * t))
        n_side = 6
        us = [cu * k / n_side for k in range(n_side + 1)]
        top = [(u, -prof(u) + rng.uniform(-1, 1) * scale) for u in us]
        bot = [(u, prof(u) + rng.uniform(-1, 1) * scale) for u in us]
        tip = (rng.uniform(-2, 2), rng.uniform(-1.5, 1.5))
        # end shape varies per stroke: flat to long, round to squarish, sheared, lopsided
        ax_top = hw * rng.uniform(0.3, 1.25)
        ax_bot = ax_top * rng.uniform(0.6, 1.5)
        sq = rng.uniform(1.3, 3.6)
        shear = rng.uniform(-0.45, 0.45)
        R = hw * (1 + bulge)
        def endp(ang, k=1.0):
            c, sn = math.cos(ang), math.sin(ang)
            ce = math.copysign(abs(c) ** (2 / sq), c)
            se = math.copysign(abs(sn) ** (2 / sq), sn)
            axv = ax_top if sn < 0 else ax_bot
            return (cu + k * (axv * ce + shear * R * se), k * R * se)
        n_arc = 10
        notch = rng.randint(1, n_arc - 1) if rng.random() < 0.3 else -1
        arc_out = []
        for k in range(n_arc + 1):
            ang = -math.pi / 2 + math.pi * k / n_arc
            u, v = endp(ang, 1 + rng.uniform(-0.03, 0.08))
            if k == notch:
                u -= rng.uniform(4, 10) * scale
            arc_out.append((u, v))
        plane = [T(*tip)] + [T(*q) for q in top[1:]] + [T(*q) for q in arc_out[1:-1]] + [T(*q) for q in bot[:0:-1]]
        # ridge covers only part of the end, thickest near its own middle
        a0 = math.radians(rng.uniform(-90, -25))
        a1 = math.radians(rng.uniform(25, 90))
        if rng.random() < 0.3:
            a0, a1 = sorted([math.radians(rng.uniform(-90, 90)) for _ in range(2)])
            if a1 - a0 < 0.6:
                a1 = min(math.pi / 2, a0 + 0.8)
        rk = 9
        r_out, r_in = [], []
        for k in range(rk + 1):
            ang = a0 + (a1 - a0) * k / rk
            u, v = endp(ang, 1.02)
            mid = math.sin(math.pi * k / rk) ** rng.uniform(0.6, 1.4)
            th_ = rw * (0.2 + 0.8 * mid) * rng.uniform(0.7, 1.3)
            dx, dy = u - cu, v
            dl = math.hypot(dx, dy) or 1
            r_out.append((u, v))
            r_in.append((u - dx / dl * th_, v - dy / dl * th_))
        ridge = [T(*q) for q in r_out] + [T(*q) for q in r_in[::-1]]
        lipw = rng.uniform(1.5, 3) * scale
        lip1 = [T(u, -prof(u)) for u in us[3:]] + [T(u, -prof(u) + lipw) for u in us[:2:-1]]
        lip2 = [T(u, prof(u)) for u in us[4:]] + [T(u, prof(u) - lipw) for u in us[:3:-1]]
        def band(t0, t1, ufrom):
            ub = [ufrom + (cu - ufrom) * k / 6 for k in range(7)]
            e0 = endp(math.asin(max(-0.99, min(0.99, t0))), 0.9)
            e1 = endp(math.asin(max(-0.99, min(0.99, t1))), 0.9)
            side0 = [(u, t0 * prof(u)) for u in ub]
            side1 = [(u, t1 * prof(u)) for u in ub]
            return [T(*q) for q in side0 + [e0, e1] + side1[::-1]]
        streaks = []
        for _ in range(rng.randint(1, 3)):
            t0 = rng.uniform(-0.75, 0.6)
            streaks.append(band(t0, t0 + rng.uniform(0.06, 0.22), rng.uniform(cu * 0.05, cu * 0.4)))
        lines = []
        for _ in range(rng.randint(1, 3)):
            t0 = rng.uniform(-0.85, 0.85)
            lines.append(band(t0, t0 + rng.uniform(0.02, 0.05), rng.uniform(cu * 0.1, cu * 0.5)))
        gid = f'{prefix}g{i}'
        sx, sy = T(0, 0)
        ex, ey = T(L, 0)
        grads.append(f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{sx:.1f}" y1="{sy:.1f}" x2="{ex:.1f}" y2="{ey:.1f}"><stop offset="0" stop-color="{col}" stop-opacity="0"></stop><stop offset="0.38" stop-color="{col}" stop-opacity="0.9"></stop><stop offset="1" stop-color="{hexmix(col, "#FFFFFF", 0.06)}" stop-opacity="1"></stop></linearGradient>')
        sc = hexmix(col, rng.choice(STREAK), rng.uniform(0.3, 0.6))
        color.append(f'<path d="{poly(plane)}" fill="url(#{gid})"></path>')
        for st in streaks:
            color.append(f'<path d="{poly(st)}" fill="{sc}" opacity="0.85"></path>')
        if has_ridge:
            color.append(f'<path d="{poly(ridge)}" fill="{hexmix(col, "#E9DCC0", rng.uniform(0.04, 0.16))}"></path>')
        if kind != "water" or rng.random() < 0.25:
            under = hexmix(col, "#1F4E5A" if kind != "refl" else "#24493A", 0.5)
            ex2, ey2 = T(L - hw * 0.4, 0)
            sx2, sy2 = T(cu * 0.25, 0)
            deg = math.degrees(th)
            smears.append(f'<ellipse cx="{ex2:.1f}" cy="{ey2:.1f}" rx="{hw * 1.05:.1f}" ry="{hw * 0.55:.1f}" transform="rotate({deg:.1f} {ex2:.1f} {ey2:.1f})" fill="{hexmix(col, "#E9DCC0", 0.08)}"></ellipse>')
            smears.append(f'<ellipse cx="{sx2:.1f}" cy="{sy2:.1f}" rx="{cu * 0.35:.1f}" ry="{hw * 0.35:.1f}" transform="rotate({deg:.1f} {sx2:.1f} {sy2:.1f})" fill="{under}"></ellipse>')
        hv = lambda x: f'#{round(x*255):02X}{round(x*255):02X}{round(x*255):02X}'
        height.append(f'<path d="{poly(plane)}" fill="{hv(rng.uniform(0.34, 0.5))}"></path>')
        for ln in lines:
            height.append(f'<path d="{poly(ln)}" fill="{hv(0.52)}"></path>')
        if rng.random() < 0.7:
            height.append(f'<path d="{poly(lip1)}" fill="{hv(rng.uniform(0.5, 0.7))}"></path>')
        if rng.random() < 0.7:
            height.append(f'<path d="{poly(lip2)}" fill="{hv(rng.uniform(0.5, 0.7))}"></path>')
        if has_ridge:
            height.append(f'<path d="{poly(ridge)}" fill="{hv(ridge_h)}"></path>')
    return grads, color, height, smears

def svg(W, H, seed, prefix, scale=1.0, view=None, extra_style=""):
    grads, color, height, smears = gen(W, H, seed, scale, prefix)
    vb = view or f'width="{W}" height="{H}"'
    return f'''<svg aria-hidden="true" {vb} viewBox="0 0 {W} {H}" style="position: absolute; left: 0; top: 0; display: block{extra_style}">
<defs>
{chr(10).join(grads)}
<filter id="{prefix}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="40"></feGaussianBlur></filter>
<filter id="{prefix}light" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.011 0.028" numOctaves="2" seed="17" result="wv"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="wv" scale="{11 * scale:.1f}" xChannelSelector="R" yChannelSelector="G" result="src"></feDisplacementMap>
<feColorMatrix in="src" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="h0"></feColorMatrix>
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="grain"></feTurbulence>
<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.09 0 0 0 0" result="grainA"></feColorMatrix>
<feComposite in="h0" in2="grainA" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="h1"></feComposite>
<feGaussianBlur in="h1" stdDeviation="0.7" result="h"></feGaussianBlur>
<feDiffuseLighting in="h" surfaceScale="{6 * scale:.1f}" diffuseConstant="0.87" lighting-color="#ffffff" result="diff"><feDistantLight azimuth="225" elevation="35"></feDistantLight></feDiffuseLighting>
<feComponentTransfer in="h0" result="ridgeMask"><feFuncA type="linear" slope="2.6" intercept="-1.6"></feFuncA></feComponentTransfer>
<feGaussianBlur in="ridgeMask" stdDeviation="{2.5 * scale:.1f}" result="rb"></feGaussianBlur>
<feOffset in="rb" dx="{4 * scale:.1f}" dy="{5 * scale:.1f}" result="ro"></feOffset>
<feColorMatrix in="ro" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0" result="cast"></feColorMatrix>
<feMerge><feMergeNode in="diff"></feMergeNode><feMergeNode in="cast"></feMergeNode></feMerge>
</filter>
<filter id="{prefix}spec" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.011 0.028" numOctaves="2" seed="17" result="wv"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="wv" scale="{11 * scale:.1f}" xChannelSelector="R" yChannelSelector="G" result="src"></feDisplacementMap>
<feColorMatrix in="src" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="h0"></feColorMatrix>
<feGaussianBlur in="h0" stdDeviation="0.7" result="h"></feGaussianBlur>
<feSpecularLighting in="h" surfaceScale="{6 * scale:.1f}" specularConstant="0.7" specularExponent="28" lighting-color="#FFF4E2"><feDistantLight azimuth="225" elevation="35"></feDistantLight></feSpecularLighting>
</filter>
<filter id="{prefix}blend" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.06" numOctaves="2" seed="8" result="w"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="w" scale="{14 * scale:.1f}" xChannelSelector="R" yChannelSelector="G" result="d"></feDisplacementMap><feGaussianBlur in="d" stdDeviation="{5 * scale:.1f}"></feGaussianBlur></filter>
<g id="{prefix}height"><rect width="{W}" height="{H}" fill="#000000"></rect>
{chr(10).join(height)}
</g>
<filter id="{prefix}wave" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.028" numOctaves="2" seed="17" result="wv"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="wv" scale="{11 * scale:.1f}" xChannelSelector="R" yChannelSelector="G" result="src"></feDisplacementMap></filter>
<pattern id="{prefix}weave" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="2.5" fill="#FFFFFF" opacity="0.035"></rect><rect width="2.5" height="5" fill="#000000" opacity="0.06"></rect></pattern>
</defs>
<rect width="{W}" height="{H}" fill="#0E1A1F"></rect>
<g filter="url(#{prefix}soft)">
<ellipse cx="{W*0.24:.0f}" cy="{H*0.16:.0f}" rx="{W*0.42:.0f}" ry="{H*0.29:.0f}" fill="#1F4E5A"></ellipse>
<ellipse cx="{W*0.82:.0f}" cy="{H*0.29:.0f}" rx="{W*0.3:.0f}" ry="{H*0.29:.0f}" fill="#3D3A6B" opacity="0.8"></ellipse>
<ellipse cx="{W*0.5:.0f}" cy="{H*0.89:.0f}" rx="{W*0.6:.0f}" ry="{H*0.35:.0f}" fill="#24493A"></ellipse>
</g>
<rect width="{W}" height="{H}" fill="url(#{prefix}weave)"></rect>
<g filter="url(#{prefix}wave)">
{chr(10).join(color)}
</g>
<g filter="url(#{prefix}blend)" opacity="0.5">
{chr(10).join(smears)}
</g>
<g filter="url(#{prefix}light)" style="mix-blend-mode: overlay" opacity="0.9"><use href="#{prefix}height"></use></g>
<g filter="url(#{prefix}spec)" style="mix-blend-mode: screen" opacity="0.55"><use href="#{prefix}height"></use></g>
<rect width="{W}" height="{H}" fill="#0E1A1F" opacity="0.16"></rect>
</svg>'''

if __name__ == "__main__":
    p = sys.argv[1]
    s = open(p).read()
    start = s.index('<svg aria-hidden="true"')
    end = s.index('</svg>', start) + len('</svg>')
    new = svg(720, 450, 5, "b")
    s = s[:start] + new + s[end:]
    import re
    s = re.sub(r"Background B · [^<]*", "Background B · Palette knife v7 · after Water Lilies", s)
    open(p, "w").write(s)
    print(len(new))
