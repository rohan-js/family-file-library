#!/usr/bin/env python3
"""
generate_fixtures.py - Synthetic Test Fixtures Generator

Zero external dependencies: uses exclusively Python standard library.
Generates all 19 deterministic synthetic test fixtures and fixtures_manifest.json
for Android TV Family File Library E2E testing track.
"""

import argparse
import hashlib
import io
import json
import os
import struct
import sys
import zipfile
import zlib
from pathlib import Path

# Deterministic ZIP entry timestamp: 2026-01-01 00:00:00
FIXED_ZIP_DATETIME = (2026, 1, 1, 0, 0, 0)

# Exact byte boundaries
EXACT_50MB_BYTES = 52428800  # 50 * 1024 * 1024
OVER_50MB_BYTES = 52428801   # EXACT_50MB_BYTES + 1


def write_zip_part(zf: zipfile.ZipFile, part_name: str, content: str | bytes) -> None:
    """Writes a part to a zipfile using deterministic timestamp and forward slashes."""
    normalized_path = part_name.replace('\\', '/')
    if isinstance(content, str):
        content_bytes = content.encode('utf-8')
    else:
        content_bytes = content
    zinfo = zipfile.ZipInfo(filename=normalized_path, date_time=FIXED_ZIP_DATETIME)
    zinfo.compress_type = zipfile.ZIP_DEFLATED
    zinfo.external_attr = 0o644 << 16
    zf.writestr(zinfo, content_bytes)


def create_pdf(pages_text: list[str], title: str = "Family File Library") -> bytes:
    """Generates a valid PDF-1.4 with cross-reference table and byte offsets."""
    pdf_parts = [b'%PDF-1.4\n', b'%\xe2\xe3\xcf\xd3\n']
    current_offset = len(pdf_parts[0]) + len(pdf_parts[1])

    body_objs = []
    num_pages = len(pages_text)

    # Obj 1: Catalog
    body_objs.append(b'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

    # Obj 2: Pages
    kids = " ".join(f"{3 + i} 0 R" for i in range(num_pages))
    body_objs.append(f'2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>\nendobj\n'.encode('ascii'))

    content_start_obj = 3 + num_pages
    font_obj = content_start_obj + num_pages

    # Page objects (3 to 3 + num_pages - 1)
    for i in range(num_pages):
        obj_id = 3 + i
        c_obj = content_start_obj + i
        page_str = (
            f'{obj_id} 0 obj\n'
            f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
            f'/Contents {c_obj} 0 R /Resources << /Font << /F1 {font_obj} 0 R >> >> >>\n'
            f'endobj\n'
        )
        body_objs.append(page_str.encode('ascii'))

    # Content streams
    for i, text in enumerate(pages_text):
        obj_id = content_start_obj + i
        escaped_text = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        stream_content = f'BT\n/F1 16 Tf\n50 720 Td\n({escaped_text}) Tj\nET\n'
        stream_bytes = stream_content.encode('utf-8')
        c_obj_str = (
            f'{obj_id} 0 obj\n'
            f'<< /Length {len(stream_bytes)} >>\n'
            f'stream\n'
            f'{stream_content}'
            f'endstream\n'
            f'endobj\n'
        )
        body_objs.append(c_obj_str.encode('utf-8'))

    # Font object
    body_objs.append(
        f'{font_obj} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'.encode('ascii')
    )

    obj_offsets = {}
    for idx, b in enumerate(body_objs, 1):
        obj_offsets[idx] = current_offset
        pdf_parts.append(b)
        current_offset += len(b)

    xref_offset = current_offset
    total_objs = font_obj + 1
    xref = [f'xref\n0 {total_objs}\n', '0000000000 65535 f \n']
    for idx in range(1, total_objs):
        xref.append(f'{obj_offsets[idx]:010d} 00000 n \n')
    xref_str = "".join(xref)
    trailer = f'trailer\n<< /Size {total_objs} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n'

    pdf_parts.append(xref_str.encode('ascii'))
    pdf_parts.append(trailer.encode('ascii'))
    return b"".join(pdf_parts)


def create_scanned_pdf() -> bytes:
    """Generates a valid PDF-1.4 representing a scanned document with 0 text operators."""
    pdf_parts = [b'%PDF-1.4\n', b'%\xe2\xe3\xcf\xd3\n']
    current_offset = len(pdf_parts[0]) + len(pdf_parts[1])

    # Obj 1: Catalog
    # Obj 2: Pages
    # Obj 3: Page (references Content 4 and XObject 5)
    # Obj 4: Content stream (paints image, ZERO BT...ET text operators)
    # Obj 5: Image XObject (raster 64x64 raw RGB)
    body_objs = []
    body_objs.append(b'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    body_objs.append(b'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
    body_objs.append(
        b'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
        b'/Contents 4 0 R /Resources << /XObject << /Img1 5 0 R >> >> >>\nendobj\n'
    )

    content_stream = b'q\n400 0 0 300 106 246 cm\n/Img1 Do\nQ\n'
    body_objs.append(
        f'4 0 obj\n<< /Length {len(content_stream)} >>\nstream\n'.encode('ascii')
        + content_stream + b'endstream\nendobj\n'
    )

    # 64x64 grayscale or RGB noise image
    img_data = b'\xcc' * (64 * 64 * 3)
    img_obj = (
        f'5 0 obj\n<< /Type /XObject /Subtype /Image /Width 64 /Height 64 '
        f'/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length {len(img_data)} >>\nstream\n'.encode('ascii')
        + img_data + b'\nendstream\nendobj\n'
    )
    body_objs.append(img_obj)

    obj_offsets = {}
    for idx, b in enumerate(body_objs, 1):
        obj_offsets[idx] = current_offset
        pdf_parts.append(b)
        current_offset += len(b)

    xref_offset = current_offset
    total_objs = 6
    xref = [f'xref\n0 {total_objs}\n', '0000000000 65535 f \n']
    for idx in range(1, total_objs):
        xref.append(f'{obj_offsets[idx]:010d} 00000 n \n')
    xref_str = "".join(xref)
    trailer = f'trailer\n<< /Size {total_objs} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n'

    pdf_parts.append(xref_str.encode('ascii'))
    pdf_parts.append(trailer.encode('ascii'))
    return b"".join(pdf_parts)


def create_docx(paragraphs: list[tuple[str, str]]) -> bytes:
    """
    Creates a minimal valid OpenXML DOCX.
    paragraphs is a list of (font_name, text).
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        # [Content_Types].xml
        content_types = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
            '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
            '  <Default Extension="xml" ContentType="application/xml"/>\n'
            '  <Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n'
            '</Types>'
        )
        write_zip_part(zf, '[Content_Types].xml', content_types)

        # _rels/.rels
        rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '  <Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/>\n'
            '</Relationships>'
        )
        write_zip_part(zf, '_rels/.rels', rels)

        # word/document.xml
        p_xml = []
        for font_name, text in paragraphs:
            p_xml.append(
                f'    <w:p>\n'
                f'      <w:r>\n'
                f'        <w:rPr>\n'
                f'          <w:rFonts w:ascii="{font_name}" w:hAnsi="{font_name}" w:cs="{font_name}"/>\n'
                f'        </w:rPr>\n'
                f'        <w:t>{text}</w:t>\n'
                f'      </w:r>\n'
                f'    </w:p>'
            )
        doc_body = "\n".join(p_xml)
        doc_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
            '  <w:body>\n'
            f'{doc_body}\n'
            '  </w:body>\n'
            '</w:document>'
        )
        write_zip_part(zf, 'word/document.xml', doc_xml)

    return buf.getvalue()


def create_pptx(slides_content: list[tuple[str, list[str]]]) -> bytes:
    """Creates a minimal valid OpenXML PPTX with given slides [(title, [bullets])]."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        num_slides = len(slides_content)

        # [Content_Types].xml
        types = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '  <Default Extension="xml" ContentType="application/xml"/>',
            '  <Override PartName="/ppt/presentation.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
        ]
        for i in range(1, num_slides + 1):
            types.append(
                f'  <Override PartName="/ppt/slides/slide{i}.xml" '
                f'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
            )
        types.append('</Types>')
        write_zip_part(zf, '[Content_Types].xml', "\n".join(types))

        # _rels/.rels
        rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '  <Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="ppt/presentation.xml"/>\n'
            '</Relationships>'
        )
        write_zip_part(zf, '_rels/.rels', rels)

        # ppt/_rels/presentation.xml.rels
        p_rels = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        ]
        for i in range(1, num_slides + 1):
            p_rels.append(
                f'  <Relationship Id="rId{i}" '
                f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" '
                f'Target="slides/slide{i}.xml"/>'
            )
        p_rels.append('</Relationships>')
        write_zip_part(zf, 'ppt/_rels/presentation.xml.rels', "\n".join(p_rels))

        # ppt/presentation.xml
        sld_ids = []
        for i in range(1, num_slides + 1):
            sld_ids.append(f'    <p:sldId id="{255 + i}" r:id="rId{i}"/>')
        pres = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n'
            '  <p:sldIdLst>\n'
            + "\n".join(sld_ids) + "\n"
            '  </p:sldIdLst>\n'
            '  <p:sldSz cx="9144000" cy="6858000"/>\n'
            '</p:presentation>'
        )
        write_zip_part(zf, 'ppt/presentation.xml', pres)

        # Slides
        for i, (title, bullets) in enumerate(slides_content, 1):
            bullets_xml = []
            for b in bullets:
                bullets_xml.append(
                    f'            <a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>{b}</a:t></a:r></a:p>'
                )
            slide_xml = (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">\n'
                '  <p:cSld>\n'
                '    <p:spTree>\n'
                '      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\n'
                '      <p:grpSpPr/>\n'
                '      <p:sp>\n'
                '        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>\n'
                '        <p:spPr/>\n'
                '        <p:txBody>\n'
                '          <a:bodyPr/>\n'
                '          <a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>' + title + '</a:t></a:r></a:p>\n'
                + "\n".join(bullets_xml) + "\n"
                '        </p:txBody>\n'
                '      </p:sp>\n'
                '    </p:spTree>\n'
                '  </p:cSld>\n'
                '</p:sld>'
            )
            write_zip_part(zf, f'ppt/slides/slide{i}.xml', slide_xml)

    return buf.getvalue()


def create_xlsx(num_cols: int = 15, num_rows: int = 20) -> bytes:
    """Creates a minimal valid OpenXML XLSX with num_cols (wide sheet) and num_rows."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        # [Content_Types].xml
        types = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
            '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
            '  <Default Extension="xml" ContentType="application/xml"/>\n'
            '  <Override PartName="/xl/workbook.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n'
            '  <Override PartName="/xl/worksheets/sheet1.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n'
            '</Types>'
        )
        write_zip_part(zf, '[Content_Types].xml', types)

        # _rels/.rels
        rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '  <Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/>\n'
            '</Relationships>'
        )
        write_zip_part(zf, '_rels/.rels', rels)

        # xl/_rels/workbook.xml.rels
        wb_rels = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            '  <Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet1.xml"/>\n'
            '</Relationships>'
        )
        write_zip_part(zf, 'xl/_rels/workbook.xml.rels', wb_rels)

        # xl/workbook.xml
        wb = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n'
            '  <sheets>\n'
            '    <sheet name="FamilyCatalog" sheetId="1" r:id="rId1"/>\n'
            '  </sheets>\n'
            '</workbook>'
        )
        write_zip_part(zf, 'xl/workbook.xml', wb)

        # xl/worksheets/sheet1.xml
        col_names = [chr(ord('A') + i) for i in range(num_cols)]
        rows_xml = []
        # Header row
        header_cells = [f'<c r="{col}1" t="inlineStr"><is><t>Col_{col}</t></is></c>' for col in col_names]
        rows_xml.append(f'    <row r="1">{"".join(header_cells)}</row>')

        for r in range(2, num_rows + 2):
            cells = []
            for c_idx, col in enumerate(col_names):
                val = (r * 100) + c_idx
                cells.append(f'<c r="{col}{r}"><v>{val}</v></c>')
            rows_xml.append(f'    <row r="{r}">{"".join(cells)}</row>')

        sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n'
            '  <sheetData>\n'
            + "\n".join(rows_xml) + "\n"
            '  </sheetData>\n'
            '</worksheet>'
        )
        write_zip_part(zf, 'xl/worksheets/sheet1.xml', sheet_xml)

    return buf.getvalue()


def create_png(width: int, height: int, r: int = 0, g: int = 229, b: int = 255) -> bytes:
    """Generates a valid PNG with given width and height."""
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_body = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = struct.pack('>I', len(ihdr_body)) + b'IHDR' + ihdr_body + struct.pack('>I', zlib.crc32(b'IHDR' + ihdr_body))

    pixel = bytes([r, g, b])
    row = b'\x00' + (pixel * width)
    raw = row * height
    comp = zlib.compress(raw, 9)
    idat = struct.pack('>I', len(comp)) + b'IDAT' + comp + struct.pack('>I', zlib.crc32(b'IDAT' + comp))
    iend = b'\x00\x00\x00\x00IEND\xae\x42\x60\x82'
    return sig + ihdr + idat + iend


def create_photo_jpeg(width: int = 16, height: int = 16) -> bytes:
    """Generates a valid baseline JFIF JPEG."""
    q = bytes([
        16, 11, 10, 16, 24, 40, 51, 61,
        12, 12, 14, 19, 26, 58, 60, 55,
        14, 13, 16, 24, 40, 57, 69, 56,
        14, 17, 22, 29, 51, 87, 80, 62,
        18, 22, 37, 56, 68, 109, 103, 77,
        24, 35, 55, 64, 81, 104, 113, 92,
        49, 64, 78, 87, 103, 121, 120, 101,
        72, 92, 95, 98, 112, 100, 103, 99
    ])
    dqt = b'\xff\xdb\x00\x43\x00' + q
    sof = b'\xff\xc0\x00\x0b\x08' + struct.pack('>HH', height, width) + b'\x01\x01\x11\x00'
    dht_dc = (
        b'\xff\xc4\x00\x1f\x00'
        b'\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00'
        b'\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b'
    )
    dht_ac = (
        b'\xff\xc4\x00\x1e\x10'
        b'\x00\x02\x02\x03\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
        b'\x01\x02\x03\x04\x05\x06\x07\x08\x09'
    )
    sos = b'\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00'
    # Minimal scan entropy payload
    payload = b'\x00\x00\x00\x00\xff\x00'
    app0 = b'\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    return b'\xff\xd8' + app0 + dqt + sof + dht_dc + dht_ac + sos + payload + b'\xff\xd9'


def write_boundary_file(path: Path, target_bytes: int) -> None:
    """Streams deterministic data in 1MB buffer chunks up to target_bytes."""
    chunk_size = 1024 * 1024  # 1 MB
    base_pattern = b"FamilyFileLibrary50MBBoundaryData-0123456789ABCDEF"  # 50 bytes
    repeat_count = (chunk_size // len(base_pattern)) + 1
    full_buf = (base_pattern * repeat_count)[:chunk_size]  # Exactly 1,048,576 bytes
    assert len(full_buf) == chunk_size, f"full_buf must be {chunk_size} bytes"

    bytes_written = 0
    with open(path, 'wb') as f:
        while bytes_written + chunk_size <= target_bytes:
            f.write(full_buf)
            bytes_written += chunk_size
        remainder = target_bytes - bytes_written
        if remainder > 0:
            f.write(full_buf[:remainder])
            bytes_written += remainder
    assert path.stat().st_size == target_bytes, f"Expected {target_bytes} bytes, wrote {path.stat().st_size}"


def compute_sha256(path: Path) -> str:
    """Computes SHA-256 checksum of a file using 1MB streaming buffer."""
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def generate_all_fixtures(output_dir: Path, include_large: bool = True, quiet: bool = False) -> list[dict]:
    """Generates all 19 synthetic fixtures and returns catalog records."""
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_items = []

    def log(msg: str):
        if not quiet:
            print(msg)

    # 1. sample_document.pdf
    f1 = output_dir / "sample_document.pdf"
    f1_bytes = create_pdf([
        "Family File Library - Document Page 1\nStandard PDF reader verification.\nKey Features: D-pad navigation, RGB_565 rendering.",
        "Family File Library - Document Page 2\nSecond page verification.\nKey Features: 3-page LRU sliding window, Coroutine Mutex."
    ])
    f1.write_bytes(f1_bytes)
    log(f"Generated: {f1.name} ({len(f1_bytes)} bytes)")
    manifest_items.append({
        "name": f1.name,
        "path": f"tests/fixtures/{f1.name}",
        "mime_type": "application/pdf",
        "category": "pdf",
        "size_bytes": len(f1_bytes),
        "sha256": compute_sha256(f1),
        "extractable_text": True,
        "features": ["F33", "F50"]
    })

    # 2. sample_scanned.pdf
    f2 = output_dir / "sample_scanned.pdf"
    f2_bytes = create_scanned_pdf()
    f2.write_bytes(f2_bytes)
    log(f"Generated: {f2.name} ({len(f2_bytes)} bytes)")
    manifest_items.append({
        "name": f2.name,
        "path": f"tests/fixtures/{f2.name}",
        "mime_type": "application/pdf",
        "category": "pdf",
        "size_bytes": len(f2_bytes),
        "sha256": compute_sha256(f2),
        "extractable_text": False,
        "features": ["F37", "F45"]
    })

    # 3. sample_indic_malayalam.docx
    f3 = output_dir / "sample_indic_malayalam.docx"
    f3_bytes = create_docx([
        ("Rachana", "കുടുംബ ഫയൽ ലൈബ്രറി - പരിശോധനാ രേഖ"),
        ("Meera", "സ്വതന്ത്ര മലയാളം കമ്പ്യൂട്ടിങ്ങ് - രചന, മീര ഫോണ്ടുകൾ"),
        ("Helvetica", "Malayalam Family Document verification for LibreOffice headless conversion.")
    ])
    f3.write_bytes(f3_bytes)
    log(f"Generated: {f3.name} ({len(f3_bytes)} bytes)")
    manifest_items.append({
        "name": f3.name,
        "path": f"tests/fixtures/{f3.name}",
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "category": "office",
        "size_bytes": len(f3_bytes),
        "sha256": compute_sha256(f3),
        "language": "malayalam",
        "target_fonts": ["Rachana", "Meera"],
        "features": ["F43", "F44", "F50"]
    })

    # 4. sample_indic_malayalam.pdf
    f4 = output_dir / "sample_indic_malayalam.pdf"
    f4_bytes = create_pdf([
        "കുടുംബ ഫയൽ ലൈബ്രറി - പരിശോധനാ രേഖ (Family File Library Malayalam Verification Document)",
        "സ്വതന്ത്ര മലയാളം കമ്പ്യൂട്ടിങ്ങ് - രചന, മീര ഫോണ്ടുകൾ (SMC Rachana Meera fonts verification)"
    ])
    f4.write_bytes(f4_bytes)
    f4.write_bytes(f4_bytes)
    log(f"Generated: {f4.name} ({len(f4_bytes)} bytes)")
    manifest_items.append({
        "name": f4.name,
        "path": f"tests/fixtures/{f4.name}",
        "mime_type": "application/pdf",
        "category": "pdf",
        "size_bytes": len(f4_bytes),
        "sha256": compute_sha256(f4),
        "language": "malayalam",
        "features": ["F26", "F33", "F44"]
    })

    # 5. sample_indic_devanagari.docx
    f5 = output_dir / "sample_indic_devanagari.docx"
    f5_bytes = create_docx([
        ("Lohit Devanagari", "परिवार फ़ाइल लाइब्रेरी - परीक्षण दस्तावेज़"),
        ("Lohit Devanagari", "लोहित देवनागरी - संयुक्त अक्षर: क्ष, त्र, ज्ञ, श्र, प्र"),
        ("Helvetica", "Hindi Devanagari test document for font conversion pipeline.")
    ])
    f5.write_bytes(f5_bytes)
    log(f"Generated: {f5.name} ({len(f5_bytes)} bytes)")
    manifest_items.append({
        "name": f5.name,
        "path": f"tests/fixtures/{f5.name}",
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "category": "office",
        "size_bytes": len(f5_bytes),
        "sha256": compute_sha256(f5),
        "language": "devanagari",
        "target_fonts": ["Lohit Devanagari"],
        "features": ["F43", "F44", "F50"]
    })

    # 6. sample_indic_devanagari.pdf
    f6 = output_dir / "sample_indic_devanagari.pdf"
    f6_bytes = create_pdf([
        "परिवार फ़ाइल लाइब्रेरी - परीक्षण दस्तावेज़ (Family File Library Devanagari Verification Document)",
        "लोहित देवनागरी - संयुक्त अक्षर: क्ष, त्र, ज्ञ, श्र, प्र (Lohit Devanagari Ligatures)"
    ])
    f6.write_bytes(f6_bytes)
    log(f"Generated: {f6.name} ({len(f6_bytes)} bytes)")
    manifest_items.append({
        "name": f6.name,
        "path": f"tests/fixtures/{f6.name}",
        "mime_type": "application/pdf",
        "category": "pdf",
        "size_bytes": len(f6_bytes),
        "sha256": compute_sha256(f6),
        "language": "devanagari",
        "features": ["F26", "F33", "F44"]
    })

    # 7. sample_slides.pptx
    f7 = output_dir / "sample_slides.pptx"
    f7_bytes = create_pptx([
        ("Family File Library Overview", ["Unified access across TV, Web, and Mobile", "Zero cloud lock-in"]),
        ("Core Architecture", ["Supabase Backend with Row Level Security", "Low-memory Android TV Compose UI", "LibreOffice CI/CD conversion"]),
        ("Verified Features", ["Indic font rendering (Malayalam / Devanagari)", "50MB drag and drop upload", "500MB local LRU cache with pinned files"])
    ])
    f7.write_bytes(f7_bytes)
    log(f"Generated: {f7.name} ({len(f7_bytes)} bytes)")
    manifest_items.append({
        "name": f7.name,
        "path": f"tests/fixtures/{f7.name}",
        "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "category": "office",
        "size_bytes": len(f7_bytes),
        "sha256": compute_sha256(f7),
        "slide_count": 3,
        "features": ["F43", "F50"]
    })

    # 8. sample_sheet.xlsx
    f8 = output_dir / "sample_sheet.xlsx"
    f8_bytes = create_xlsx(num_cols=15, num_rows=20)
    f8.write_bytes(f8_bytes)
    log(f"Generated: {f8.name} ({len(f8_bytes)} bytes)")
    manifest_items.append({
        "name": f8.name,
        "path": f"tests/fixtures/{f8.name}",
        "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "category": "office",
        "size_bytes": len(f8_bytes),
        "sha256": compute_sha256(f8),
        "column_count": 15,
        "features": ["F43", "F50"]
    })

    # 9. sample_text.txt
    f9 = output_dir / "sample_text.txt"
    f9_content = (
        "Android TV Family File Library - Plain Text Document\n"
        "====================================================\n\n"
        "This is a high-legibility plain text document intended for the 28sp TV viewer.\n"
        "Navigation is optimized for D-pad directional controls:\n"
        "- Up/Down: Smooth vertical line scrolling\n"
        "- Left/Right: Page jump scrolling\n"
        "- Center/OK: Toggle controls overlay\n"
        "- Back: Return to shelf view\n\n"
        "Features validated:\n"
        "1. 5% overscan margins compliance (48dp H, 27dp V)\n"
        "2. Clean word-wrapping without horizontal truncation\n"
        "3. UTF-8 international characters rendering\n"
    )
    f9_bytes = f9_content.encode('utf-8')
    f9.write_bytes(f9_bytes)
    log(f"Generated: {f9.name} ({len(f9_bytes)} bytes)")
    manifest_items.append({
        "name": f9.name,
        "path": f"tests/fixtures/{f9.name}",
        "mime_type": "text/plain",
        "category": "text",
        "size_bytes": len(f9_bytes),
        "sha256": compute_sha256(f9),
        "features": ["F36"]
    })

    # 10. sample_markdown.md
    f10 = output_dir / "sample_markdown.md"
    f10_content = (
        "# Family File Library Guide\n\n"
        "Welcome to the **Android TV Family File Library** system.\n\n"
        "## Key Capabilities\n\n"
        "- *Secure Device Pairing*: Scan QR or enter 6-digit code.\n"
        "- *Indic Regional Languages*: Native Malayalam and Devanagari text rendering.\n"
        "- *Resource Protection*: 50MB storage limit and 500MB local cache ceiling.\n\n"
        "> The system is designed to run within free-tier constraints while maintaining high performance.\n\n"
        "```text\n"
        "TV Remote Mapping: DPAD_LEFT = Prev Page, DPAD_RIGHT = Next Page\n"
        "```\n"
    )
    f10_bytes = f10_content.encode('utf-8')
    f10.write_bytes(f10_bytes)
    log(f"Generated: {f10.name} ({len(f10_bytes)} bytes)")
    manifest_items.append({
        "name": f10.name,
        "path": f"tests/fixtures/{f10.name}",
        "mime_type": "text/markdown",
        "category": "text",
        "size_bytes": len(f10_bytes),
        "sha256": compute_sha256(f10),
        "features": ["F36"]
    })

    # 11. sample_photo.jpg
    f11 = output_dir / "sample_photo.jpg"
    f11_bytes = create_photo_jpeg(width=16, height=16)
    f11.write_bytes(f11_bytes)
    log(f"Generated: {f11.name} ({len(f11_bytes)} bytes)")
    manifest_items.append({
        "name": f11.name,
        "path": f"tests/fixtures/{f11.name}",
        "mime_type": "image/jpeg",
        "category": "image",
        "size_bytes": len(f11_bytes),
        "sha256": compute_sha256(f11),
        "features": ["F35"]
    })

    # 12. sample_image.png
    f12 = output_dir / "sample_image.png"
    f12_bytes = create_png(64, 64, r=0, g=229, b=255)
    f12.write_bytes(f12_bytes)
    log(f"Generated: {f12.name} ({len(f12_bytes)} bytes)")
    manifest_items.append({
        "name": f12.name,
        "path": f"tests/fixtures/{f12.name}",
        "mime_type": "image/png",
        "category": "image",
        "size_bytes": len(f12_bytes),
        "sha256": compute_sha256(f12),
        "dimensions": {"width": 64, "height": 64},
        "features": ["F35"]
    })

    # 13. sample_photo_12mp.png
    f13 = output_dir / "sample_photo_12mp.png"
    f13_bytes = create_png(4000, 3000, r=15, g=23, b=42)
    f13.write_bytes(f13_bytes)
    log(f"Generated: {f13.name} ({len(f13_bytes)} bytes, 4000x3000 12MP)")
    manifest_items.append({
        "name": f13.name,
        "path": f"tests/fixtures/{f13.name}",
        "mime_type": "image/png",
        "category": "image",
        "size_bytes": len(f13_bytes),
        "sha256": compute_sha256(f13),
        "dimensions": {"width": 4000, "height": 3000, "megapixels": 12.0},
        "features": ["F35", "F50"]
    })

    # 14. sample_50mb_boundary.bin (exact 52,428,800 bytes)
    f14 = output_dir / "sample_50mb_boundary.bin"
    if include_large:
        log(f"Writing {f14.name} (exact {EXACT_50MB_BYTES} bytes)...")
        write_boundary_file(f14, EXACT_50MB_BYTES)
        f14_size = f14.stat().st_size
        f14_sha = compute_sha256(f14)
        log(f"Generated: {f14.name} ({f14_size} bytes)")
    else:
        log(f"Skipping large fixture {f14.name} (--skip-large)")
        f14_size = EXACT_50MB_BYTES
        f14_sha = "SKIPPED_DUE_TO_CLI_FLAG"

    manifest_items.append({
        "name": f14.name,
        "path": f"tests/fixtures/{f14.name}",
        "mime_type": "application/octet-stream",
        "category": "boundary",
        "size_bytes": f14_size,
        "sha256": f14_sha,
        "expected_acceptance": True,
        "features": ["F17", "F21"]
    })

    # 15. sample_over_50mb.bin (exact 52,428,801 bytes)
    f15 = output_dir / "sample_over_50mb.bin"
    if include_large:
        log(f"Writing {f15.name} (exact {OVER_50MB_BYTES} bytes)...")
        write_boundary_file(f15, OVER_50MB_BYTES)
        f15_size = f15.stat().st_size
        f15_sha = compute_sha256(f15)
        log(f"Generated: {f15.name} ({f15_size} bytes)")
    else:
        log(f"Skipping large fixture {f15.name} (--skip-large)")
        f15_size = OVER_50MB_BYTES
        f15_sha = "SKIPPED_DUE_TO_CLI_FLAG"

    manifest_items.append({
        "name": f15.name,
        "path": f"tests/fixtures/{f15.name}",
        "mime_type": "application/octet-stream",
        "category": "boundary",
        "size_bytes": f15_size,
        "sha256": f15_sha,
        "expected_acceptance": False,
        "features": ["F17", "F21"]
    })

    # 16. sample_zero_byte.txt (0 bytes)
    f16 = output_dir / "sample_zero_byte.txt"
    f16.write_bytes(b'')
    log(f"Generated: {f16.name} (0 bytes)")
    manifest_items.append({
        "name": f16.name,
        "path": f"tests/fixtures/{f16.name}",
        "mime_type": "text/plain",
        "category": "null_case",
        "size_bytes": 0,
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "expected_acceptance": False,
        "features": ["F21", "F43"]
    })

    # 17. sample_corrupt.pdf
    f17 = output_dir / "sample_corrupt.pdf"
    f17_bytes = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\nCORRUPTED_STREAM_DATA_NO_VALID_XREF_AND_MISSING_EOF_MARKER\n"
    f17.write_bytes(f17_bytes)
    log(f"Generated: {f17.name} ({len(f17_bytes)} bytes)")
    manifest_items.append({
        "name": f17.name,
        "path": f"tests/fixtures/{f17.name}",
        "mime_type": "application/pdf",
        "category": "corrupt",
        "size_bytes": len(f17_bytes),
        "sha256": compute_sha256(f17),
        "expected_acceptance": False,
        "features": ["F33", "F43"]
    })

    # 18. sample_corrupt.docx
    f18 = output_dir / "sample_corrupt.docx"
    f18_bytes = b"PK\x03\x04\x14\x00\x00\x00\x08\x00CORRUPT_NON_ZIP_STRUCTURE_PAYLOAD_CAUSING_LIBREOFFICE_ERROR"
    f18.write_bytes(f18_bytes)
    log(f"Generated: {f18.name} ({len(f18_bytes)} bytes)")
    manifest_items.append({
        "name": f18.name,
        "path": f"tests/fixtures/{f18.name}",
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "category": "corrupt",
        "size_bytes": len(f18_bytes),
        "sha256": compute_sha256(f18),
        "expected_acceptance": False,
        "features": ["F43", "F50"]
    })

    # 19. sample_null_bytes.txt
    f19 = output_dir / "sample_null_bytes.txt"
    f19_bytes = (
        b"Standard Family Text Document\n"
        b"Pre-null text segment\x00Injected null byte character\x00Trailing text segment\n"
        b"PostgreSQL text column null sanitizer test case."
    )
    f19.write_bytes(f19_bytes)
    log(f"Generated: {f19.name} ({len(f19_bytes)} bytes)")
    manifest_items.append({
        "name": f19.name,
        "path": f"tests/fixtures/{f19.name}",
        "mime_type": "text/plain",
        "category": "sanitization",
        "size_bytes": len(f19_bytes),
        "sha256": compute_sha256(f19),
        "features": ["F07", "F45"]
    })

    # Generate fixtures_manifest.json
    manifest_path = output_dir / "fixtures_manifest.json"
    manifest_data = {
        "generator_version": "1.0.0",
        "generated_at": "2026-11-11T16:00:00Z",
        "fixtures_count": len(manifest_items),
        "fixtures": manifest_items
    }
    manifest_path.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")
    log(f"Generated: {manifest_path.name} ({len(manifest_items)} fixtures indexed)")

    return manifest_items


def verify_fixtures(output_dir: Path) -> bool:
    """Verifies all fixture files exist and match their manifest checksum and size."""
    manifest_path = output_dir / "fixtures_manifest.json"
    if not manifest_path.exists():
        print(f"Error: Manifest not found at {manifest_path}", file=sys.stderr)
        return False

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    fixtures = manifest.get("fixtures", [])
    print(f"\nVerifying {len(fixtures)} fixtures against {manifest_path.name}...")

    all_passed = True
    for item in fixtures:
        name = item["name"]
        path = output_dir / name
        if not path.exists():
            print(f"  [FAIL] Missing file: {name}", file=sys.stderr)
            all_passed = False
            continue

        actual_size = path.stat().st_size
        expected_size = item["size_bytes"]
        if actual_size != expected_size:
            print(f"  [FAIL] Size mismatch for {name}: expected {expected_size}, got {actual_size}", file=sys.stderr)
            all_passed = False
            continue

        if item.get("sha256") and item["sha256"] != "SKIPPED_DUE_TO_CLI_FLAG":
            actual_sha = compute_sha256(path)
            expected_sha = item["sha256"]
            if actual_sha != expected_sha:
                print(f"  [FAIL] SHA-256 mismatch for {name}:\n    expected: {expected_sha}\n    got:      {actual_sha}", file=sys.stderr)
                all_passed = False
                continue

        print(f"  [OK] {name} ({actual_size:,} bytes) - SHA-256 match")

    if all_passed:
        print("\nAll fixtures passed verification successfully.")
    else:
        print("\nOne or more fixtures failed verification.", file=sys.stderr)

    return all_passed


def main():
    parser = argparse.ArgumentParser(description="Deterministic Synthetic Fixture Generator")
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parent),
        help="Target directory for fixtures (default: tests/fixtures)"
    )
    parser.add_argument(
        "--include-large",
        dest="include_large",
        action="store_true",
        default=True,
        help="Generate large 50MB boundary files (default: True)"
    )
    parser.add_argument(
        "--skip-large",
        dest="include_large",
        action="store_false",
        help="Skip generating large 50MB boundary files"
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove existing fixtures before generation"
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run integrity verification after generation"
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress progress output"
    )

    args = parser.parse_args()
    output_dir = Path(args.output_dir).resolve()

    if args.clean and output_dir.exists():
        for p in output_dir.iterdir():
            if p.name != "generate_fixtures.py":
                if p.is_file():
                    p.unlink()

    generate_all_fixtures(output_dir, include_large=args.include_large, quiet=args.quiet)

    if args.verify:
        success = verify_fixtures(output_dir)
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
