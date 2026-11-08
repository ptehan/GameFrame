"""Package unedited app screenshots in their documented workflow order."""
import json
import sys
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from xml.sax.saxutils import escape
from pypdf import PdfReader

repo = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else repo / 'demo-output' / 'screen-sequence'
manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
entries = manifest['entries']
entries = [e for e in entries if e['group'] != 'Capture problems']
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold', 'C:/Windows/Fonts/arialbd.ttf'))
destination = repo / 'output' / 'pdf'
destination.mkdir(parents=True, exist_ok=True)
dest = destination / (sys.argv[2] if len(sys.argv)>2 else 'GameFrame-screen-sequence.pdf')
doc = canvas.Canvas(str(dest), pagesize=(1440, 1040), pageCompression=1)
doc.setTitle(manifest.get('title', 'GameFrame - screen sequence'))
doc.setAuthor('GameFrame')
style = ParagraphStyle('note', fontName='Arial', fontSize=14, leading=18, textColor=HexColor('#536258'))
last_group = None
for index, entry in enumerate(entries, 1):
    doc.setFillColor(HexColor('#172d22'))
    doc.setFont('ArialBold', 23)
    doc.drawString(30, 1005, f"{index}. {entry['title']}")
    doc.setFont('Arial', 15)
    doc.setFillColor(HexColor('#166b51'))
    doc.drawString(30, 975, entry['group'])
    doc.setFillColor(HexColor('#536258'))
    doc.drawRightString(1410, 1008, f'{index} / {len(entries)}')
    note = entry.get('note', '')
    if note:
        p = Paragraph(escape(note), style)
        _, height = p.wrap(1380, 70)
        p.drawOn(doc, 30, 955-height)
    doc.drawImage(ImageReader(str(folder / entry['file'])), 30, 30, width=1380, height=862.5, preserveAspectRatio=True)
    key = f'page-{index}'
    doc.bookmarkPage(key)
    if entry['group'] != last_group:
        doc.addOutlineEntry(entry['group'], key, level=0)
        last_group = entry['group']
    doc.addOutlineEntry(entry['title'], key, level=1)
    doc.showPage()
doc.save()
reader = PdfReader(str(dest))
assert len(reader.pages) == len(entries)
for index, (page, entry) in enumerate(zip(reader.pages, entries), 1):
    assert str(index) in page.extract_text()
    assert page.images, f'Screenshot missing on page {index}'
print(json.dumps({'pdf':str(dest),'pages':len(reader.pages),'bytes':dest.stat().st_size}))
