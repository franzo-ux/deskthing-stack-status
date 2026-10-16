"""Draw "Rackbot", the default Stack Status mascot: a tiny pixel-art server
rack that walks along the bottom of the screen and falls over (sparks, dizzy
LEDs) when a service goes down.

Writes app/client/mascot/{walk_r0..7, walk_l0..7, fall0..5}.png with the
canvas sizes and anchors the client expects (walk 42x76, anchor 21; fall
67x77, anchor 35). Requires Pillow:  python tools/rackbot_frames.py
"""
import math
import os

from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "app", "client", "mascot")
SCALE = 3  # 14 x 25 pixel art -> 42 x 75

PAL = {
    "K": (27, 30, 36, 255),     # outline
    "S": (195, 202, 210, 255),  # case
    "s": (138, 147, 166, 255),  # case shade
    "d": (45, 51, 64, 255),     # bays / screen
    "c": (111, 227, 255, 255),  # face (cyan)
    "g": (60, 207, 127, 255),   # led on
    "o": (241, 190, 88, 255),   # led amber
    "r": (240, 144, 130, 255),  # led / face red
    "x": (255, 230, 120, 255),  # spark
}

BODY = [
    ".KKKKKKKKKKKK.",
    "KSSSSSSSSSSSSK",
    "KSKKKKKKKKKKsK",
    "KSKddddddddKsK",
    "KSKdEddddEdKsK",
    "KSKddddddddKsK",
    "KSKddMMMMddKsK",
    "KSKKKKKKKKKKsK",
    "KSSSSSSSSSSSsK",
    "KSddddddddddsK",
    "KSdLdLdLddddsK",
    "KSddddddddddsK",
    "KSSSSSSSSSSSsK",
    "KSddddddddddsK",
    "KSdLdLdLddddsK",
    "KSddddddddddsK",
    "KSSSSSSSSSSSsK",
    ".KKKKKKKKKKKK.",
]
LEGS = {
    0: ["...KK....KK...", "...KK....KK...", "..KKK...KKK..."],
    1: ["....KK..KK....", "....KK...KK...", "...KKK...KKK.."],
    2: ["...KK....KK...", "..KK......KK..", ".KKK......KKK."],
    3: ["....KK..KK....", "...KK....KK...", "..KKK....KKK.."],
}


def face(rows, eye, mouth, led_pattern):
    out = []
    li = 0
    for r in rows:
        r = r.replace("E", eye).replace("MMMM", mouth)
        while "L" in r:
            r = r.replace("L", led_pattern[li % len(led_pattern)], 1)
            li += 1
        out.append(r)
    return out


def to_img(rows, w, h, dx=0, dy=0):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            for yy in range(SCALE):
                for xx in range(SCALE):
                    X, Y = dx + x * SCALE + xx, dy + y * SCALE + yy
                    if 0 <= X < w and 0 <= Y < h:
                        px[X, Y] = PAL[ch]
    return img


def walk_frames():
    frames = []
    for i in range(8):
        leds = ["g", "g", "o", "g", "g", "g"]
        leds = leds[i % 6:] + leds[:i % 6]  # blinking LEDs
        rows = face(BODY, "c", "cccc" if i % 4 else "c..c".replace(".", "d"), leds)
        bob = 0 if i % 2 else 1
        rows = rows + LEGS[i % 4]
        img = to_img(rows, 42, 76, dx=0, dy=1 + bob)
        frames.append(img)
    return frames


def fall_frames():
    base = face(BODY, "c", "cccc", ["g"] * 6) + LEGS[0]
    stand = to_img(base, 42, 63 + 13)
    angles = [0, 8, 25, 55, 90, 90]
    out = []
    for i, a in enumerate(angles):
        canvas = Image.new("RGBA", (67, 77), (0, 0, 0, 0))
        body = stand
        if i >= 4:  # down: red face, dizzy
            body = to_img(face(BODY, "r", "rddr", ["r", "d", "r", "d", "r", "d"]) + LEGS[0], 42, 76)
        body = body.crop(body.getbbox())  # rotate the rack itself, not the empty canvas
        rot = body.rotate(-a, resample=Image.NEAREST, expand=True)
        if rot.width > 67:  # lying down: shrink a little to fit the canvas
            rot = rot.resize((67, round(rot.height * 67 / rot.width)), Image.NEAREST)
        # pivot on the front foot: the rack tips over forward (to the right)
        x = 35 - 21 + int(round(math.sin(math.radians(a)) * 18))
        y = 77 - rot.height
        canvas.alpha_composite(rot, (max(0, min(67 - rot.width, x)), max(0, y)))
        if i == 4:  # impact sparks
            for sx, sy in ((10, 40), (6, 48), (14, 36), (60, 44)):
                for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                    canvas.putpixel((sx + dx, sy + dy), PAL["x"])
        if i == 5:  # dizzy dots above
            for sx in (20, 30, 40):
                canvas.putpixel((sx, 38), PAL["o"])
                canvas.putpixel((sx + 1, 38), PAL["o"])
        out.append(canvas)
    return out


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for i, f in enumerate(walk_frames()):
        f.save(os.path.join(OUT, "walk_r%d.png" % i))
        f.transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(OUT, "walk_l%d.png" % i))
    for i, f in enumerate(fall_frames()):
        f.save(os.path.join(OUT, "fall%d.png" % i))
    print("Rackbot frames written to", os.path.abspath(OUT))
