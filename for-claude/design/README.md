# design/

- `reference/Layout.dc.html` — the approved page from the design canvas. It is a design-tool component file: plain HTML/CSS markup with `{{holes}}`, `<sc-for>` loops, `<sc-if>` branches, and a `class Component extends DCLogic` script at the bottom that holds the mock data and interactions (banner slides, timeline auto-scroll, card open/close, checklist, Hermes scheduling bubble with conflict logic, Seerr bubble). Read it for exact values and behavior; don't ship it. The inline background SVG was removed (see `assets/`).
- `reference/StyleTile.dc.html` — palette, type and edge treatment (the "Option D" tile). Its background is an older dotted pattern; use `assets/` instead.
- `assets/background-palette-knife-2560.webp` — final background, 2560×1600.
- `assets/background-palette-knife-portrait-1200.webp` — portrait/phone version, 1200×1920.
- `tools/generate_background.py` — the generator for the background (Python 3 standard library). Example:

```python
import sys; sys.path.insert(0, "design/tools")
import generate_background as g
svg = g.svg(1422, 889, 5, "R", 1.0, view='width="2560" height="1600" preserveAspectRatio="xMidYMid slice"')
# wrap `svg` in an HTML page, screenshot it in headless Chromium, convert to WebP
```

Live canvas with every option and the interactive layout: https://claude.ai/code/artifact/79aed0f8-7a38-4d44-ba5a-8db835ce0125
