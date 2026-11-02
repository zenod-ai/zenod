#!/usr/bin/env python3
"""Build index.html from deck.src.html, embedding the house-style fonts (OFL) so the deck is self-contained.
Usage: python3 build.py [FONT_DIR]  (default: the house-diagram-style skill's assets/fonts)."""
import base64, pathlib, sys
here = pathlib.Path(__file__).resolve().parent
fonts = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path.home() / ".claude_seat2/skills/house-diagram-style/assets/fonts")
faces = [("Fraunces", "fraunces-600.woff2", 600), ("Inter", "inter-400.woff2", 400), ("Inter", "inter-600.woff2", 600)]
css = "".join(
    f"@font-face{{font-family:{fam};font-weight:{w};font-style:normal;font-display:swap;"
    f"src:url(data:font/woff2;base64,{base64.b64encode((fonts / f).read_bytes()).decode()}) format('woff2')}}\n"
    for fam, f, w in faces)
src = (here / "deck.src.html").read_text()
(here / "index.html").write_text(src.replace("/*FONTS*/", css))
print("wrote", here / "index.html")
