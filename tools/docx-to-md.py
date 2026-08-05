#!/usr/bin/env python3
"""
docx-to-md.py -- one-off import tool. It converted the original
docs/implementation-plan.docx to Markdown a single time; that Markdown
file is now the source of truth and is edited directly. This script is
not part of any regular workflow and there is no docx left in the repo
to run it against. Kept for provenance and in case a future document
needs the same one-time treatment.

Uses only the standard library (no pandoc, no python-docx, no mammoth)
by reading word/document.xml directly.

Usage:
    python tools/docx-to-md.py <input.docx> <output.md>

Handles: heading styles (Heading1-6, Title), bold/italic/code runs,
bulleted and numbered lists, multi-row/column tables (rendered as
Markdown tables), and single-cell tables (rendered as blockquotes,
since in the source docx a 1x1 table was always a callout box).
"""
import sys
import zipfile
import xml.etree.ElementTree as ET
import re

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def qn(tag):
    return W + tag

def get_text_runs(p):
    """Extract runs with bold/italic/code formatting from a paragraph element."""
    parts = []
    for node in p.iter():
        if node.tag == qn('r'):
            # gather run properties
            rpr = node.find(qn('rPr'))
            bold = rpr is not None and rpr.find(qn('b')) is not None and rpr.find(qn('b')).get(qn('val')) != '0'
            italic = rpr is not None and rpr.find(qn('i')) is not None and rpr.find(qn('i')).get(qn('val')) != '0'
            # check monospace font (code)
            code = False
            if rpr is not None:
                rfonts = rpr.find(qn('rFonts'))
                if rfonts is not None:
                    fname = rfonts.get(qn('ascii')) or ''
                    if 'Consolas' in fname or 'Courier' in fname or 'Mono' in fname:
                        code = True
            text = ''
            for t in node.findall(qn('t')):
                text += t.text or ''
            if node.find(qn('tab')) is not None:
                text += '\t'
            if node.find(qn('br')) is not None:
                text += '\n'
            if text:
                parts.append((text, bold, italic, code))
    return parts

def runs_to_md(parts):
    out = []
    for text, bold, italic, code in parts:
        if not text:
            continue
        # CommonMark requires no whitespace adjacent to the inner side of
        # emphasis/code delimiters, so pull leading/trailing whitespace
        # outside the markers rather than wrapping it.
        stripped = text.strip(' ')
        lead = text[:len(text) - len(text.lstrip(' '))]
        trail = text[len(text.rstrip(' ')):]
        if not stripped:
            out.append(text)
            continue
        t = stripped
        if code:
            t = '`' + t + '`'
        else:
            if bold and italic:
                t = '***' + t + '***'
            elif bold:
                t = '**' + t + '**'
            elif italic:
                t = '*' + t + '*'
        out.append(lead + t + trail)
    return ''.join(out)

def split_leading_bold(runs):
    """Split a run list into (lead_runs, rest_runs), where lead_runs is the
    maximal run of leading bold runs and rest_runs is everything after.
    Returns ([], runs) if the paragraph doesn't start with bold, or if it's
    bold all the way through (nothing to split off)."""
    if not runs:
        return [], []
    i = 0
    while i < len(runs) and runs[i][1]:  # runs[i][1] is the bold flag
        i += 1
    if i == 0 or i == len(runs):
        return [], runs
    return runs[:i], runs[i:]

def get_style(p):
    ppr = p.find(qn('pPr'))
    if ppr is None:
        return None
    pstyle = ppr.find(qn('pStyle'))
    if pstyle is None:
        return None
    return pstyle.get(qn('val'))

def get_numpr(p):
    ppr = p.find(qn('pPr'))
    if ppr is None:
        return None
    numpr = ppr.find(qn('numPr'))
    if numpr is None:
        return None
    ilvl = numpr.find(qn('ilvl'))
    numid = numpr.find(qn('numId'))
    ilvl_val = int(ilvl.get(qn('val'))) if ilvl is not None else 0
    numid_val = numid.get(qn('val')) if numid is not None else None
    return (ilvl_val, numid_val)

HEADING_MAP = {
    'Heading1': 1, 'Heading2': 2, 'Heading3': 3, 'Heading4': 4,
    'Heading5': 5, 'Heading6': 6, 'Title': 1,
}

def load_numbering_types(zf):
    """Map numId -> 'bullet' or 'decimal' based on numbering.xml (best-effort)."""
    try:
        data = zf.read('word/numbering.xml')
    except KeyError:
        return {}
    root = ET.fromstring(data)
    abstract_fmt = {}
    for absnum in root.findall(qn('abstractNum')):
        aid = absnum.get(qn('abstractNumId'))
        lvl0 = absnum.find(qn('lvl'))
        fmt = None
        if lvl0 is not None:
            numfmt = lvl0.find(qn('numFmt'))
            if numfmt is not None:
                fmt = numfmt.get(qn('val'))
        abstract_fmt[aid] = fmt
    num_to_abstract = {}
    for num in root.findall(qn('num')):
        nid = num.get(qn('numId'))
        absid = num.find(qn('abstractNumId'))
        if absid is not None:
            num_to_abstract[nid] = absid.get(qn('val'))
    result = {}
    for nid, absid in num_to_abstract.items():
        result[nid] = abstract_fmt.get(absid, 'bullet')
    return result

def convert_single_cell_callout(tbl):
    """A 1x1 table in this source doc is always a callout box: a bold
    lead-in phrase followed by body text in the same paragraph. Render it
    as a blockquote with the lead-in on its own line."""
    tr = tbl.findall(qn('tr'))[0]
    tc = tr.findall(qn('tc'))[0]
    paragraphs = tc.findall(qn('p'))

    lines = []
    first = True
    for p in paragraphs:
        runs = get_text_runs(p)
        if not runs:
            continue
        if first:
            first = False
            lead_runs, rest_runs = split_leading_bold(runs)
            if lead_runs and rest_runs:
                lead_text = runs_to_md(lead_runs).strip()
                rest_text = runs_to_md(rest_runs).strip()
                lines.append(f'> {lead_text}')
                lines.append('>')
                lines.append(f'> {rest_text}')
                continue
        text = runs_to_md(runs).strip()
        if text:
            lines.append(f'> {text}')
    return '\n'.join(lines)

def convert_table(tbl):
    trs = tbl.findall(qn('tr'))
    if len(trs) == 1 and len(trs[0].findall(qn('tc'))) == 1:
        return convert_single_cell_callout(tbl)

    rows = []
    for tr in trs:
        cells = []
        for tc in tr.findall(qn('tc')):
            cell_text_parts = []
            for p in tc.findall(qn('p')):
                parts = get_text_runs(p)
                cell_text_parts.append(runs_to_md(parts))
            cell_text = ' '.join(x for x in cell_text_parts if x).strip()
            cell_text = cell_text.replace('|', '\\|').replace('\n', ' ')
            cells.append(cell_text)
        rows.append(cells)
    if not rows:
        return ''
    ncols = max(len(r) for r in rows)
    for r in rows:
        while len(r) < ncols:
            r.append('')
    lines = []
    lines.append('| ' + ' | '.join(rows[0]) + ' |')
    lines.append('| ' + ' | '.join(['---'] * ncols) + ' |')
    for r in rows[1:]:
        lines.append('| ' + ' | '.join(r) + ' |')
    return '\n'.join(lines)

def main(docx_path, out_path):
    zf = zipfile.ZipFile(docx_path)
    numfmt = load_numbering_types(zf)
    data = zf.read('word/document.xml')
    root = ET.fromstring(data)
    body = root.find(qn('body'))

    md_lines = []
    list_counters = {}  # numid -> counter (for decimal lists at ilvl 0)

    for child in body:
        tag = child.tag
        if tag == qn('p'):
            style = get_style(child)
            parts = get_text_runs(child)
            text = runs_to_md(parts)
            numpr = get_numpr(child)

            if not text.strip() and numpr is None:
                md_lines.append('')
                continue

            if style in HEADING_MAP:
                level = HEADING_MAP[style]
                md_lines.append('')
                md_lines.append('#' * level + ' ' + text.strip())
                md_lines.append('')
                continue

            if numpr is not None:
                ilvl, numid = numpr
                indent = '  ' * ilvl
                fmt = numfmt.get(numid, 'bullet')
                if fmt == 'decimal':
                    key = (numid, ilvl)
                    list_counters[key] = list_counters.get(key, 0) + 1
                    marker = f'{list_counters[key]}.'
                else:
                    marker = '-'
                md_lines.append(f'{indent}{marker} {text}')
                continue

            if text.strip():
                md_lines.append(text)
                md_lines.append('')
            else:
                md_lines.append('')

        elif tag == qn('tbl'):
            md_lines.append('')
            md_lines.append(convert_table(child))
            md_lines.append('')

    # collapse 3+ blank lines
    text_out = '\n'.join(md_lines)
    text_out = re.sub(r'\n{3,}', '\n\n', text_out)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(text_out.strip() + '\n')

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
