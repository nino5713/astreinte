"""Génère les icônes PWA SOCOM : un éclair (astreinte électrique) sur
fond bleu SOCOM, en variantes standard et 'maskable'."""
from PIL import Image, ImageDraw

SOCOM = (30, 58, 138)      # #1E3A8A
SOCOM_FONCE = (20, 38, 87)
BLANC = (255, 255, 255)


def eclair(dessin, cx, cy, ech, couleur):
    """Trace un éclair centré, mis à l'échelle par `ech` (demi-hauteur)."""
    pts = [
        (0.10, -1.00), (-0.55, 0.12), (-0.10, 0.12),
        (-0.22, 1.00), (0.55, -0.20), (0.08, -0.20),
    ]
    poly = [(cx + x * ech, cy + y * ech) for (x, y) in pts]
    dessin.polygon(poly, fill=couleur)


def fond_arrondi(img, dr, taille, rayon, couleur):
    dr.rounded_rectangle([0, 0, taille, taille], radius=rayon, fill=couleur)


def faire_icone(taille, maskable=False):
    img = Image.new("RGBA", (taille, taille), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    if maskable:
        # zone de sécurité : fond plein, éclair plus petit (~60%)
        dr.rectangle([0, 0, taille, taille], fill=SOCOM)
        eclair(dr, taille / 2, taille / 2, taille * 0.30, BLANC)
    else:
        rayon = int(taille * 0.22)
        fond_arrondi(img, dr, taille, rayon, SOCOM)
        # léger dégradé simulé par un halo plus foncé en bas
        halo = Image.new("RGBA", (taille, taille), (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        hd.rounded_rectangle([0, taille * 0.5, taille, taille], radius=rayon, fill=(*SOCOM_FONCE, 90))
        img.alpha_composite(halo)
        eclair(dr, taille / 2, taille / 2, taille * 0.42, BLANC)
    return img


for t in (192, 512):
    faire_icone(t).save(f"static/icone-{t}.png")
faire_icone(512, maskable=True).save("static/icone-maskable-512.png")
faire_icone(180).save("static/apple-touch-icon.png")
# favicon
faire_icone(64).save("static/favicon.png")
print("Icônes générées :", [f"icone-{t}.png" for t in (192, 512)],
      "+ maskable, apple-touch, favicon")
