"""Build the RuStore article from reviewed text and actual supplied images.

Run with the bundled Python using -I to exclude the user's Python packages.
Run the documents skill artifact marker once before the first build.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image


HEADINGS = {
    "Как из одного набора получаются разные слова",
    "Что происходит с ошибками и дополнительными словами",
    "Как продолжить, если слово не находится",
    "Что открывается между головоломками",
    "Как устроен Марафон слов",
    "Часто задаваемые вопросы",
    "Что нужно сделать для прохождения уровня",
    "Нужно ли использовать весь набор букв",
    "Почему игра приняла слово, но клетки остались пустыми",
    "Можно ли проиграть из-за долгого поиска или ошибки",
    "Что дают перемешивание и подсказка",
    "Нужно ли входить каждый день ради марафона",
}


def load_inputs(folder: Path) -> tuple[dict, list[str], list[dict]]:
    metadata = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
    article = (folder / "article.txt").read_text(encoding="utf-8-sig")
    manifest = json.loads((folder / "images.json").read_text(encoding="utf-8"))
    blocks = article.strip().split("\n\n")
    if len(article) > 10000:
        raise ValueError(f"Review exceeds 10000 characters: {len(article)}")
    if len(metadata["seoTitle"]) > 70 or len(metadata["description"]) > 170:
        raise ValueError("SEO metadata exceeds RuStore limits")
    if metadata["title"] == metadata["seoTitle"]:
        raise ValueError("SEO title must differ from the article title")
    if metadata["description"] == blocks[2]:
        raise ValueError("Description must differ from the introduction")
    if metadata["category"] != "Игры":
        raise ValueError("The requested category is Игры")
    if blocks[1] != metadata["title"]:
        raise ValueError("Article title and metadata differ")
    app_url = metadata.get("appUrl")
    if not app_url or urlparse(app_url).hostname not in {"rustore.ru", "www.rustore.ru"}:
        raise ValueError("Supply the verified public RuStore app URL before the final build")
    if urlparse(app_url).scheme != "https":
        raise ValueError("Use the verified HTTPS RuStore app URL")
    faq_start = blocks.index("Часто задаваемые вопросы") + 1
    faq = blocks[faq_start:]
    if len(faq) % 2 or not 5 <= len(faq) // 2 <= 10:
        raise ValueError("FAQ must contain 5–10 question and answer pairs")
    if any(len(answer) > 500 for answer in faq[1::2]):
        raise ValueError("An FAQ answer exceeds 500 characters")
    images = manifest["images"]
    if not 1 <= len(images) <= 10:
        raise ValueError("Supply the actual article images before the final build")
    required = {item["filename"]: item for item in manifest["required"]}
    if not set(required).issubset({item["filename"] for item in images}):
        raise ValueError("A required article image is missing")
    for item in images:
        path = folder / item["filename"]
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            raise ValueError(f"Unsupported image format: {path.name}")
        if path.stat().st_size > 5 * 1024 * 1024:
            raise ValueError(f"Image exceeds 5 MB: {path.name}")
        rules = required.get(item["filename"], item)
        with Image.open(path) as im:
            width, height = im.size
            if width < rules.get("minimumWidth", 0) or height < rules.get("minimumHeight", 0):
                raise ValueError(f"Image below RuStore minimum dimensions: {path.name}, {width}×{height}")
        if not item.get("source"):
            raise ValueError(f"Record the source of the actual image: {path.name}")
        item.update({key: value for key, value in rules.items() if key not in item})
    return metadata, blocks, images


def configure_styles(document: Document) -> None:
    section = document.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.7)
    section.bottom_margin = Inches(1.15)
    section.left_margin = Inches(0.85)
    section.right_margin = Inches(0.85)
    for name in ["Normal", "Heading 1", "Caption"]:
        style = document.styles[name]
        style.font.name = "Arial"
        style.font.color.rgb = RGBColor(0, 0, 0)
        fonts = style.element.get_or_add_rPr().get_or_add_rFonts()
        for script in ["ascii", "hAnsi", "eastAsia", "cs"]:
            fonts.set(qn(f"w:{script}"), "Arial")
        for theme in ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"]:
            fonts.attrib.pop(qn(f"w:{theme}"), None)
    normal = document.styles["Normal"]
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.12
    normal.paragraph_format.widow_control = True
    heading = document.styles["Heading 1"]
    heading.font.size = Pt(15)
    heading.font.bold = True
    heading.paragraph_format.space_before = Pt(12)
    heading.paragraph_format.space_after = Pt(6)
    heading.paragraph_format.keep_with_next = True
    heading.paragraph_format.keep_together = True
    document.styles["Caption"].font.size = Pt(10)
    document.styles["Caption"].font.italic = False


def add_link(paragraph, text: str, url: str) -> None:
    from docx.opc.constants import RELATIONSHIP_TYPE as RT

    relation_id = paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relation_id)
    run = OxmlElement("w:r")
    properties = OxmlElement("w:rPr")
    fonts = OxmlElement("w:rFonts")
    fonts.set(qn("w:ascii"), "Arial")
    fonts.set(qn("w:hAnsi"), "Arial")
    properties.append(fonts)
    run.append(properties)
    node = OxmlElement("w:t")
    node.text = text
    run.append(node)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def add_images(document: Document, folder: Path, images: list[dict], anchor: str) -> None:
    for item in images:
        if item["insertAfter"] != anchor:
            continue
        path = folder / item["filename"]
        with Image.open(path) as im:
            width, height = im.size
        is_portrait = height > width
        display_width = 2.3 if is_portrait else 6.8
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.keep_with_next = bool(item.get("caption"))
        shape = paragraph.add_run().add_picture(str(path), width=Inches(display_width))
        shape._inline.docPr.set("descr", item.get("alt", item.get("caption", "Обложка статьи о поиске слов")))
        if item.get("caption"):
            document.add_paragraph(item["caption"], style="Caption")


def build(folder: Path, output: Path) -> None:
    metadata, blocks, images = load_inputs(folder)
    document = Document()
    configure_styles(document)
    document.core_properties.title = metadata["title"]
    document.core_properties.subject = "Обзор игры для блога RuStore"
    document.core_properties.author = "Слова"
    document.core_properties.keywords = "слова из букв, кроссворд, поиск слов"
    for line in blocks[0].splitlines():
        document.add_paragraph(line)
    for index, block in enumerate(blocks[1:], start=1):
        if block == "Часто задаваемые вопросы":
            document.add_section(WD_SECTION_START.NEW_PAGE)
        if block == metadata["title"] or block in HEADINGS:
            document.add_paragraph(block, style="Heading 1")
        elif block.startswith("Скачать «"):
            paragraph = document.add_paragraph()
            add_link(paragraph, block, metadata["appUrl"])
        elif index == 2:
            paragraph = document.add_paragraph()
            prefix, app_name, suffix = block.partition(f"«{metadata['appName']}»")
            paragraph.add_run(prefix)
            if not app_name:
                raise ValueError("The app name is missing from the introduction")
            paragraph.add_run("«")
            add_link(paragraph, "Слова из букв", metadata["appUrl"])
            paragraph.add_run(" — кроссворды»")
            paragraph.add_run(suffix)
        else:
            document.add_paragraph(block)
        if index == 2:
            add_images(document, folder, images, "intro")
        if block.startswith("Последняя Т в слове"):
            add_images(document, folder, images, "lettersExample")
        if block.startswith("Решать по три головоломки каждый день"):
            add_images(document, folder, images, "marathon")
    if sum(len(p.text) for p in document.paragraphs) + len(metadata["appName"]) + 2 > 10000:
        raise ValueError("The final DOCX text exceeds 10000 characters")
    output.parent.mkdir(parents=True, exist_ok=True)
    document.save(output)
    if output.stat().st_size > 5_000_000:
        raise ValueError(f"The final DOCX exceeds 5 MB: {output.stat().st_size} bytes")
    print(f"Created {output}")
    print(f"Source characters including metadata and FAQ: {len((folder / 'article.txt').read_text(encoding='utf-8'))}")
    print(f"FAQ answers: {metadata['faqCount']}; embedded images: {len(images)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--output", type=Path)
    options = parser.parse_args()
    build(options.folder, options.output or options.folder / "article.docx")
