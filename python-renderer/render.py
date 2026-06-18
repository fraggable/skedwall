from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]

    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue

    raise RuntimeError(
        "No TrueType font found. Install fonts-dejavu-core or provide Segoe/Arial fonts."
    )


def cover_resize(image: Image.Image, width: int, height: int) -> Image.Image:
    source_width, source_height = image.size
    scale = max(width / source_width, height / source_height)
    resized = image.resize(
        (round(source_width * scale), round(source_height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip()
        box = draw.textbbox((0, 0), candidate, font=font)
        if box[2] <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines


def text_height(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[3] - box[1]


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def ellipsize_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
) -> str:
    if text_width(draw, text, font) <= max_width:
        return text

    suffix = "..."
    trimmed = text
    while trimmed and text_width(draw, f"{trimmed}{suffix}", font) > max_width:
        trimmed = trimmed[:-1]

    return f"{trimmed.rstrip()}{suffix}" if trimmed else suffix


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def rounded_rect_sdf(width: int, height: int, radius: float) -> np.ndarray:
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    px = xx + 0.5 - width / 2.0
    py = yy + 0.5 - height / 2.0
    qx = np.abs(px) - (width / 2.0 - radius)
    qy = np.abs(py) - (height / 2.0 - radius)
    outside = np.sqrt(np.maximum(qx, 0.0) ** 2 + np.maximum(qy, 0.0) ** 2)
    inside = np.minimum(np.maximum(qx, qy), 0.0)
    return outside + inside - radius


def bilinear_sample(image: np.ndarray, sample_x: np.ndarray, sample_y: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    x = np.clip(sample_x, 0.0, width - 1.0)
    y = np.clip(sample_y, 0.0, height - 1.0)

    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.clip(x0 + 1, 0, width - 1)
    y1 = np.clip(y0 + 1, 0, height - 1)

    wx = (x - x0)[..., None]
    wy = (y - y0)[..., None]

    top = image[y0, x0] * (1.0 - wx) + image[y0, x1] * wx
    bottom = image[y1, x0] * (1.0 - wx) + image[y1, x1] * wx
    return top * (1.0 - wy) + bottom * wy


def choose_text_palette(glass_rgb: np.ndarray, alpha: np.ndarray, detail: float) -> dict[str, tuple[int, int, int, int]]:
    covered = alpha > 0.72
    if np.any(covered):
        luminance = (
            glass_rgb[..., 0] * 0.2126
            + glass_rgb[..., 1] * 0.7152
            + glass_rgb[..., 2] * 0.0722
        )
        mean_luminance = float(np.mean(luminance[covered]) / 255.0)
    else:
        mean_luminance = 0.45

    if mean_luminance > 0.78 and detail < 0.14:
        return {
            "primary": (28, 30, 35, 240),
            "secondary": (62, 64, 70, 210),
            "muted": (74, 76, 82, 186),
            "shadow": (255, 255, 255, 82),
        }

    return {
        "primary": (255, 255, 255, 248),
        "secondary": (232, 232, 234, 220),
        "muted": (205, 205, 208, 180),
        "shadow": (0, 0, 0, 84),
    }


def draw_text(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
    shadow_fill: tuple[int, int, int, int],
) -> None:
    x, y = position
    draw.text((x, y + 2), text, fill=shadow_fill, font=font)
    draw.text((x, y), text, fill=fill, font=font)


def draw_soft_shadow(
    overlay: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    opacity: int,
) -> None:
    shadow = Image.new("RGBA", overlay.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (box[0] + 5, box[1] + 18, box[2] - 5, box[3] + 20),
        radius=radius,
        fill=(0, 0, 0, opacity),
    )
    overlay.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(36)))


def render_liquid_glass_pane(
    canvas: Image.Image,
    overlay: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
) -> dict[str, tuple[int, int, int, int]]:
    pane_width = box[2] - box[0]
    pane_height = box[3] - box[1]
    crop = canvas.crop(box)

    sharp = np.asarray(crop, dtype=np.float32)
    mild = np.asarray(crop.filter(ImageFilter.GaussianBlur(9)), dtype=np.float32)
    strong = np.asarray(crop.filter(ImageFilter.GaussianBlur(32)), dtype=np.float32)

    luminance = sharp[..., 0] * 0.2126 + sharp[..., 1] * 0.7152 + sharp[..., 2] * 0.0722
    mean_luminance = float(np.mean(luminance) / 255.0)
    detail = float(np.std(luminance) / 255.0)

    sdf = rounded_rect_sdf(pane_width, pane_height, float(radius))
    alpha = smoothstep(1.25, -1.25, sdf)
    yy, xx = np.mgrid[0:pane_height, 0:pane_width].astype(np.float32)

    grad_y, grad_x = np.gradient(sdf)
    grad_len = np.sqrt(grad_x * grad_x + grad_y * grad_y) + 1e-5
    normal_x = grad_x / grad_len
    normal_y = grad_y / grad_len

    edge = np.exp(-((sdf / 30.0) ** 2)) * alpha
    rim = np.exp(-((sdf / 2.2) ** 2)) * alpha
    inner_rim = np.exp(-(((sdf + 8.0) / 11.0) ** 2)) * alpha
    center = smoothstep(-6.0, -min(pane_width, pane_height) * 0.38, sdf) * alpha
    thickness = np.clip((pane_width * pane_height) / (980.0 * 560.0), 0.72, 1.38)

    wave = np.sin(xx / 76.0 + yy / 119.0) * edge * 4.0
    displacement = (edge * 34.0 + center * 5.0) * thickness
    sample_x = xx + normal_x * displacement - normal_y * wave
    sample_y = yy + normal_y * displacement + normal_x * wave
    refracted = bilinear_sample(sharp, sample_x, sample_y)

    mild_weight = np.clip(center * 0.54 + edge * 0.26, 0.0, 0.82)
    strong_weight = np.clip(center * 0.14 + edge * 0.58, 0.0, 0.86)
    glass = (
        refracted
        + mild * mild_weight[..., None]
        + strong * strong_weight[..., None]
    ) / (1.0 + mild_weight[..., None] + strong_weight[..., None])

    tint_rgb = np.array([255.0, 255.0, 255.0], dtype=np.float32)
    if mean_luminance > 0.68:
        tint_rgb = np.array([238.0, 239.0, 241.0], dtype=np.float32)
    tint_strength = (
        0.035 + (1.0 - mean_luminance) * 0.055 + detail * 0.045
    ) * (center * 0.70 + edge * 0.42) * alpha
    glass = glass * (1.0 - tint_strength[..., None]) + tint_rgb * tint_strength[..., None]

    surface_strength = np.clip(edge * 1.2 + inner_rim * 0.42 + center * 0.10, 0.0, 1.45)
    normal_z = np.full_like(surface_strength, 0.88)
    surface_normal = np.stack(
        (-normal_x * surface_strength, -normal_y * surface_strength, normal_z),
        axis=-1,
    )
    surface_normal /= np.linalg.norm(surface_normal, axis=-1, keepdims=True) + 1e-5
    light = np.array([-0.42, -0.66, 0.62], dtype=np.float32)
    light /= np.linalg.norm(light)
    light_dot = np.clip(np.sum(surface_normal * light, axis=-1), 0.0, 1.0)
    opposite_dot = np.clip(np.sum(surface_normal * -light, axis=-1), 0.0, 1.0)

    specular = (light_dot ** 18.0) * (edge * 0.92 + inner_rim * 0.45)
    broad_light = (light_dot ** 2.2) * (center * 0.15 + edge * 0.34)
    edge_shadow = (opposite_dot ** 1.8) * (edge * 0.25 + inner_rim * 0.18)
    top_sheen = np.exp(-yy / max(1.0, pane_height * 0.23)) * alpha * 0.09
    left_sheen = np.exp(-xx / max(1.0, pane_width * 0.19)) * edge * 0.10

    glass += (specular * 115.0 + broad_light * 34.0 + rim * 62.0 + top_sheen * 255.0 + left_sheen * 255.0)[..., None]
    glass -= (edge_shadow * 44.0 + inner_rim * 14.0)[..., None]

    corner_lens = (
        np.exp(-(((xx - pane_width * 0.08) / (pane_width * 0.18)) ** 2 + ((yy - pane_height * 0.10) / (pane_height * 0.24)) ** 2))
        + np.exp(-(((xx - pane_width * 0.91) / (pane_width * 0.16)) ** 2 + ((yy - pane_height * 0.88) / (pane_height * 0.18)) ** 2))
    ) * alpha
    glass += corner_lens[..., None] * 32.0

    final = sharp * (1.0 - alpha[..., None]) + np.clip(glass, 0.0, 255.0) * alpha[..., None]
    canvas.paste(Image.fromarray(np.uint8(np.clip(final, 0.0, 255.0))), box)

    shadow_opacity = int(np.clip(36 + detail * 72 + mean_luminance * 28, 42, 92))
    draw_soft_shadow(overlay, box, radius, shadow_opacity)

    return choose_text_palette(glass, alpha, detail)


def normalize_days(payload: dict[str, Any]) -> list[dict[str, Any]]:
    days = payload.get("days")
    if isinstance(days, list) and days:
        return days[:3]

    label = f"{payload.get('weekday', 'TODAY')}, {payload.get('date', '')}".strip(", ").upper()
    return [
        {
            "label": label,
            "events": payload.get("events", []),
        }
    ]


def build_calendar_blocks(
    days: list[dict[str, Any]],
    available_height: int,
) -> tuple[list[dict[str, Any]], int, int]:
    header_h = 54
    empty_h = 58
    section_h = 44
    event_h = 112
    more_h = 48
    after_header_gap = 34
    section_gap = 38
    event_gap = 14
    more_gap = 18

    total_events = sum(len(day.get("events", [])) for day in days)
    blocks: list[dict[str, Any]] = []
    used = 0
    shown_events = 0

    def add(block: dict[str, Any]) -> None:
        nonlocal used
        used += int(block["gap"]) + int(block["height"])
        blocks.append(block)

    def recompute() -> int:
        return sum(int(block["gap"]) + int(block["height"]) for block in blocks)

    def first_future_event_count(start_day_index: int) -> int:
        return sum(len(day.get("events", [])) for day in days[start_day_index:])

    def add_event_blocks(events: list[dict[str, Any]], first_gap: int) -> bool:
        nonlocal shown_events, used
        added_any = False
        for event in events:
            remaining_if_added = total_events - shown_events - 1
            reserve_more = more_gap + more_h if remaining_if_added > 0 else 0
            gap = first_gap if not added_any else event_gap
            if used + gap + event_h + reserve_more > available_height:
                return added_any
            add({"kind": "event", "event": event, "gap": gap, "height": event_h})
            shown_events += 1
            added_any = True
        return added_any

    first_label = str(days[0].get("label", "TODAY")).upper()
    add({"kind": "header", "label": first_label, "gap": 0, "height": header_h})

    today_events = days[0].get("events", [])
    if today_events:
        add_event_blocks(today_events, after_header_gap)
    else:
        add({"kind": "empty", "text": "No Events Today", "gap": after_header_gap, "height": empty_h})

    for day_index, day in enumerate(days[1:], start=1):
        events = day.get("events", [])
        if not events:
            continue
        remaining_after_one = total_events - shown_events - 1
        reserve_more = more_gap + more_h if remaining_after_one > 0 else 0
        minimum = section_gap + section_h + event_gap + event_h + reserve_more
        if used + minimum > available_height:
            break
        add({"kind": "section", "label": str(day.get("label", "")).upper(), "gap": section_gap, "height": section_h})
        if not add_event_blocks(events, event_gap):
            break
        if first_future_event_count(day_index + 1) and used + section_gap + section_h + event_gap + event_h > available_height:
            break

    hidden = total_events - shown_events
    while hidden > 0 and blocks and used + more_gap + more_h > available_height:
        removed = blocks.pop()
        if removed["kind"] == "event":
            shown_events -= 1
        while blocks and blocks[-1]["kind"] == "section":
            blocks.pop()
        used = recompute()
        hidden = total_events - shown_events

    if hidden > 0 and used + more_gap + more_h <= available_height:
        add({"kind": "more", "count": hidden, "gap": more_gap, "height": more_h})

    return blocks, used, hidden


def draw_meet_icon(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    color: tuple[int, int, int, int],
) -> None:
    draw.rounded_rectangle((x, y + 5, x + 29, y + 24), radius=4, outline=color, width=3)
    draw.polygon(
        [(x + 31, y + 10), (x + 43, y + 4), (x + 43, y + 25), (x + 31, y + 19)],
        outline=color,
        fill=None,
    )
    draw.line([(x + 31, y + 10), (x + 43, y + 4), (x + 43, y + 25), (x + 31, y + 19), (x + 31, y + 10)], fill=color, width=3)


def draw_event_card(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    event: dict[str, Any],
    fonts: dict[str, ImageFont.ImageFont],
    palette: dict[str, tuple[int, int, int, int]],
) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(
        box,
        radius=15,
        fill=(255, 255, 255, 26),
        outline=(255, 255, 255, 24),
        width=1,
    )
    draw.rounded_rectangle((x0 + 16, y0 + 15, x0 + 25, y1 - 15), radius=4, fill=palette["primary"])

    title_x = x0 + 40
    start_text = str(event.get("start", ""))
    end_text = str(event.get("end", ""))
    time_right = x1 - 24
    time_width = max(
        text_width(draw, start_text, fonts["time"]),
        text_width(draw, end_text, fonts["time"]) if end_text else 0,
    )
    time_left = time_right - time_width
    title_width = max(80, time_left - title_x - 24)
    title = ellipsize_text(draw, str(event.get("title", "Busy")), fonts["event_title"], title_width)
    draw_text(draw, (title_x, y0 + 17), title, fonts["event_title"], palette["primary"], palette["shadow"])

    if event.get("hasMeet"):
        meet_y = y0 + 60
        draw_meet_icon(draw, title_x + 2, meet_y + 1, palette["secondary"])
        draw_text(draw, (title_x + 54, meet_y - 2), "Meet", fonts["meta"], palette["secondary"], palette["shadow"])

    if start_text:
        draw_text(
            draw,
            (time_right - text_width(draw, start_text, fonts["time"]), y0 + 18),
            start_text,
            fonts["time"],
            palette["primary"],
            palette["shadow"],
        )
    if end_text:
        draw_text(
            draw,
            (time_right - text_width(draw, end_text, fonts["time"]), y0 + 59),
            end_text,
            fonts["time"],
            palette["secondary"],
            palette["shadow"],
        )


def draw_calendar_blocks(
    overlay: Image.Image,
    blocks: list[dict[str, Any]],
    pane_box: tuple[int, int, int, int],
    padding_x: int,
    padding_y: int,
    palette: dict[str, tuple[int, int, int, int]],
    fonts: dict[str, ImageFont.ImageFont],
) -> None:
    draw = ImageDraw.Draw(overlay)
    x = pane_box[0] + padding_x
    y = pane_box[1] + padding_y
    content_width = pane_box[2] - pane_box[0] - padding_x * 2

    for block in blocks:
        y += int(block["gap"])
        kind = block["kind"]
        if kind == "header":
            draw_text(draw, (x, y), str(block["label"]), fonts["header"], palette["primary"], palette["shadow"])
        elif kind == "empty":
            draw_text(draw, (x, y), str(block["text"]), fonts["empty"], palette["muted"], palette["shadow"])
        elif kind == "section":
            draw_text(draw, (x, y), str(block["label"]), fonts["section"], palette["muted"], palette["shadow"])
        elif kind == "event":
            draw_event_card(
                draw,
                (x, y, x + content_width, y + int(block["height"])),
                block["event"],
                fonts,
                palette,
            )
        elif kind == "more":
            count = int(block["count"])
            label = f"{count} more event" if count == 1 else f"{count} more events"
            draw.rounded_rectangle((x + 16, y + 3, x + 25, y + 42), radius=4, fill=palette["primary"])
            draw_text(draw, (x + 40, y - 2), label, fonts["more"], palette["muted"], palette["shadow"])
        y += int(block["height"])


def render_wallpaper(payload: dict[str, Any], output_path: Path) -> None:
    width = int(payload.get("width", 1290))
    height = int(payload.get("height", 2796))
    base_path = Path(payload["baseWallpaperPath"])

    if base_path.exists():
        image = Image.open(base_path).convert("RGB")
        canvas = cover_resize(image, width, height)
    else:
        canvas = Image.new("RGB", (width, height), (150, 150, 156))

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    fonts = {
        "header": load_font(43, bold=True),
        "empty": load_font(48),
        "section": load_font(39, bold=True),
        "event_title": load_font(38, bold=True),
        "meta": load_font(35),
        "time": load_font(37),
        "more": load_font(36),
    }

    pane_margin = 78
    pane_width = width - pane_margin * 2
    pane_padding_x = 58
    pane_padding_y = 56

    safe_top = max(round(height * 0.34), 920)
    safe_bottom = min(round(height * 0.70), height - 720)
    safe_height = safe_bottom - safe_top
    available_content_height = safe_height - pane_padding_y * 2

    days = normalize_days(payload)
    blocks, content_height, _hidden = build_calendar_blocks(days, available_content_height)
    pane_height = content_height + pane_padding_y * 2
    pane_top = safe_top + max(0, (safe_height - pane_height) // 2)
    pane_box = (pane_margin, pane_top, pane_margin + pane_width, pane_top + pane_height)

    palette = render_liquid_glass_pane(canvas, overlay, pane_box, radius=58)
    draw_calendar_blocks(overlay, blocks, pane_box, pane_padding_x, pane_padding_y, palette, fonts)

    composed = Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    composed.save(output_path, "JPEG", quality=92, optimize=True)


def render_clean_wallpaper(payload: dict[str, Any], output_path: Path) -> None:
    width = int(payload.get("width", 1290))
    height = int(payload.get("height", 2796))
    base_path = Path(payload["baseWallpaperPath"])

    if base_path.exists():
        image = Image.open(base_path).convert("RGB")
        canvas = cover_resize(image, width, height)
    else:
        canvas = Image.new("RGB", (width, height), (150, 150, 156))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, "JPEG", quality=92, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Render only the normalized base wallpaper without schedule overlay.",
    )
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8-sig") as file:
        payload = json.load(file)

    if args.clean:
        render_clean_wallpaper(payload, Path(args.output))
    else:
        render_wallpaper(payload, Path(args.output))


if __name__ == "__main__":
    main()