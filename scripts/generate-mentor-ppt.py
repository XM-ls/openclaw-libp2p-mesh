#!/usr/bin/env python3
import tempfile
import zipfile
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt


OUT = Path("docs/presentations/p2p-mesh-mentor-2026-06-15.pptx")
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)

COLORS = {
    "bg": RGBColor(248, 250, 252),
    "text": RGBColor(15, 23, 42),
    "muted": RGBColor(71, 85, 105),
    "line": RGBColor(148, 163, 184),
    "primary": RGBColor(15, 118, 110),
    "primary_soft": RGBColor(204, 251, 241),
    "success": RGBColor(22, 163, 74),
    "warning": RGBColor(217, 119, 6),
    "danger": RGBColor(220, 38, 38),
    "white": RGBColor(255, 255, 255),
}

FONT = "Aptos"
MONO = "Cascadia Mono"
SLIDE_W = 13.333
SLIDE_H = 7.5


def add_bg(slide):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = COLORS["bg"]


def add_title(slide, title, subtitle=None, section=None):
    box = slide.shapes.add_textbox(Inches(0.55), Inches(0.32), Inches(8.5), Inches(0.55))
    p = box.text_frame.paragraphs[0]
    p.text = title
    p.font.name = FONT
    p.font.size = Pt(30)
    p.font.bold = True
    p.font.color.rgb = COLORS["text"]

    if subtitle:
        sub = slide.shapes.add_textbox(Inches(0.58), Inches(0.9), Inches(8.8), Inches(0.32))
        sp = sub.text_frame.paragraphs[0]
        sp.text = subtitle
        sp.font.name = FONT
        sp.font.size = Pt(13)
        sp.font.color.rgb = COLORS["muted"]

    if section:
        tag = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(10.2), Inches(0.42), Inches(2.45), Inches(0.34))
        tag.fill.solid()
        tag.fill.fore_color.rgb = COLORS["primary_soft"]
        tag.line.color.rgb = COLORS["primary_soft"]
        tp = tag.text_frame.paragraphs[0]
        tp.text = section
        tp.font.name = FONT
        tp.font.size = Pt(10)
        tp.font.bold = True
        tp.font.color.rgb = COLORS["primary"]
        tp.alignment = PP_ALIGN.CENTER


def add_footer(slide, page, section):
    box = slide.shapes.add_textbox(Inches(0.55), Inches(7.08), Inches(8.0), Inches(0.25))
    p = box.text_frame.paragraphs[0]
    p.text = f"{section} / {page:02d}"
    p.font.name = FONT
    p.font.size = Pt(9)
    p.font.color.rgb = COLORS["muted"]


def add_text_box(slide, x, y, w, h, lines, font_size=17):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.clear()
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        p.font.name = FONT
        p.font.size = Pt(font_size)
        p.font.color.rgb = COLORS["text"]
        p.space_after = Pt(8)
        p.level = 0
    return box


def card(slide, x, y, w, h, title, body=None, accent="primary"):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = COLORS["white"]
    shape.line.color.rgb = COLORS["line"]
    shape.line.width = Pt(1)

    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(0.08), Inches(h))
    bar.fill.solid()
    bar.fill.fore_color.rgb = COLORS[accent]
    bar.line.color.rgb = COLORS[accent]

    t = slide.shapes.add_textbox(Inches(x + 0.22), Inches(y + 0.18), Inches(w - 0.42), Inches(0.3))
    p = t.text_frame.paragraphs[0]
    p.text = title
    p.font.name = FONT
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = COLORS["text"]

    if body:
        b = slide.shapes.add_textbox(Inches(x + 0.22), Inches(y + 0.58), Inches(w - 0.42), Inches(h - 0.75))
        tf = b.text_frame
        tf.word_wrap = True
        tf.clear()
        for i, line in enumerate(body):
            bp = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            bp.text = line
            bp.font.name = FONT
            bp.font.size = Pt(12)
            bp.font.color.rgb = COLORS["muted"]
            bp.space_after = Pt(5)
    return shape


def tag(slide, x, y, text, color="primary"):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(1.55), Inches(0.32))
    shape.fill.solid()
    shape.fill.fore_color.rgb = COLORS["primary_soft"] if color == "primary" else COLORS["white"]
    shape.line.color.rgb = COLORS[color]
    p = shape.text_frame.paragraphs[0]
    p.text = text
    p.font.name = MONO
    p.font.size = Pt(9)
    p.font.bold = True
    p.font.color.rgb = COLORS[color]
    p.alignment = PP_ALIGN.CENTER
    return shape


def arrow(slide, x1, y1, x2, y2, color="line"):
    line = slide.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    line.line.color.rgb = COLORS[color]
    line.line.width = Pt(2)
    line.line.end_arrowhead = True
    return line


def bullet_slide(prs, page, title, section, bullets, subtitle=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide)
    add_title(slide, title, subtitle=subtitle, section=section)
    add_text_box(slide, 0.85, 1.45, 7.4, 4.8, bullets, font_size=19)
    add_footer(slide, page, section)
    return slide


def build_presentation():
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W)
    prs.slide_height = Inches(SLIDE_H)
    return prs


def normalize_pptx_zip(path: Path) -> None:
    with zipfile.ZipFile(path, "r") as source:
        entries = [(info, source.read(info.filename)) for info in source.infolist()]

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".pptx", delete=False) as temp_file:
            temp_path = Path(temp_file.name)

        with zipfile.ZipFile(temp_path, "w") as target:
            for source_info, data in entries:
                target_info = zipfile.ZipInfo(source_info.filename, ZIP_TIMESTAMP)
                target_info.compress_type = source_info.compress_type
                target_info.comment = source_info.comment
                target_info.extra = source_info.extra
                target_info.external_attr = source_info.external_attr
                target_info.internal_attr = source_info.internal_attr
                target_info.create_system = source_info.create_system
                target_info.create_version = source_info.create_version
                target_info.extract_version = source_info.extract_version
                target_info.flag_bits = source_info.flag_bits
                target_info.volume = source_info.volume
                target.writestr(target_info, data)

        temp_path.replace(path)
    except Exception:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise


def main():
    prs = build_presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide)
    add_title(slide, "OpenClaw libp2p-mesh 跨实例消息通信机制", "PPTX generator skeleton", "概览")
    add_text_box(slide, 0.9, 1.7, 10.8, 1.0, ["Task 3 will replace this one-slide skeleton with the full 12-slide deck."], 20)
    add_footer(slide, 1, "概览")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    normalize_pptx_zip(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
