const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType,
} = require('docx');

const GREEN = '16A34A';
const CODE = 'B91C1C';
const HEADER_BG = 'F4F4F5';

const src = fs.readFileSync('docs/inhand-realtime-data-request.md', 'utf8');
const lines = src.split('\n');

function parseInline(text) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index) }));
    const tok = m[0];
    if (tok.startsWith('**')) runs.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    else runs.push(new TextRun({ text: tok.slice(1, -1), font: 'Courier New', color: CODE }));
    last = re.lastIndex;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last) }));
  if (runs.length === 0) runs.push(new TextRun({ text: '' }));
  return runs;
}

function cells(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

const children = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];

  // table
  if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[\s:\-|]+\|$/.test(lines[i + 1])) {
    const head = cells(line); i += 2;
    const rows = [];
    while (i < lines.length && /^\|.*\|$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
    const tableRows = [];
    tableRows.push(new TableRow({
      tableHeader: true,
      children: head.map(h => new TableCell({
        shading: { type: ShadingType.CLEAR, fill: HEADER_BG },
        children: [new Paragraph({ children: parseInline(h).map(r => { r.options ? r.options.bold = true : null; return r; }) })],
      })),
    }));
    // rebuild header bold cleanly
    tableRows[0] = new TableRow({
      tableHeader: true,
      children: head.map(h => new TableCell({
        shading: { type: ShadingType.CLEAR, fill: HEADER_BG },
        children: [new Paragraph({ children: [new TextRun({ text: h.replace(/[`*]/g, ''), bold: true })] })],
      })),
    });
    for (const r of rows) {
      tableRows.push(new TableRow({
        children: r.map(c => new TableCell({ children: [new Paragraph({ children: parseInline(c) })] })),
      }));
    }
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }));
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    continue;
  }

  if (/^---\s*$/.test(line)) {
    children.push(new Paragraph({ border: { bottom: { color: 'D4D4D8', style: BorderStyle.SINGLE, size: 6 } }, spacing: { after: 160, before: 80 } }));
    i++; continue;
  }

  let h;
  if ((h = line.match(/^(#{1,6})\s+(.*)$/))) {
    const n = h[1].length;
    if (n === 1) {
      children.push(new Paragraph({
        children: [new TextRun({ text: h[2], bold: true, size: 36, color: '111111' })],
        spacing: { after: 80 },
        border: { bottom: { color: GREEN, style: BorderStyle.SINGLE, size: 18 } },
      }));
    } else {
      children.push(new Paragraph({
        children: parseInline(h[2]),
        heading: n === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
      }));
    }
    i++; continue;
  }

  if (/^>\s?/.test(line)) {
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
    children.push(new Paragraph({
      children: parseInline(buf.join(' ')),
      shading: { type: ShadingType.CLEAR, fill: 'F0FDF4' },
      border: { left: { color: GREEN, style: BorderStyle.SINGLE, size: 18 } },
      spacing: { before: 80, after: 80 }, indent: { left: 200 },
    }));
    continue;
  }

  if (/^\s*[-*]\s+/.test(line)) {
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
      children.push(new Paragraph({ children: parseInline(lines[i].replace(/^\s*[-*]\s+/, '')), bullet: { level: 0 } }));
      i++;
    }
    continue;
  }

  if (/^\s*\d+\.\s+/.test(line)) {
    while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
      children.push(new Paragraph({ children: parseInline(lines[i].replace(/^\s*\d+\.\s+/, '')), numbering: { reference: 'num', level: 0 } }));
      i++;
    }
    continue;
  }

  if (/^\s*$/.test(line)) { i++; continue; }

  // paragraph
  const buf = [line]; i++;
  while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) &&
    !/^>/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) &&
    !/^---\s*$/.test(lines[i]) && !/^\|.*\|$/.test(lines[i])) {
    buf.push(lines[i]); i++;
  }
  children.push(new Paragraph({ children: parseInline(buf.join(' ')), spacing: { after: 120 } }));
}

const doc = new Document({
  numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] },
  styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('docs/inhand-realtime-data-request.docx', buf);
  console.log('Wrote docs/inhand-realtime-data-request.docx (' + buf.length + ' bytes)');
});
