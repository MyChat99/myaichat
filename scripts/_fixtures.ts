/**
 * Real Office files, built here rather than committed as binary blobs.
 *
 * A fixture nobody can read is a fixture nobody can check. These are a few
 * dozen lines of ZIP and XML, and what they contain is visible in the source —
 * which matters more than usual here, because the code under test is a parser
 * and a wrong fixture would "prove" a wrong parser correct.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipMember = { name: string; body: string | Buffer };

/**
 * A ZIP with a proper central directory.
 *
 * `declaredSize` exists so a test can lie about how much a member inflates to —
 * which is the whole shape of a zip bomb, and the one thing the extractor has
 * to refuse before allocating anything.
 */
export function buildZip(
  members: ZipMember[],
  options: { declaredSize?: (name: string) => number } = {},
): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const raw = Buffer.isBuffer(member.body) ? member.body : Buffer.from(member.body, 'utf8');
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw);
    const uncompressed = options.declaredSize?.(member.name) ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, deflated]));

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(uncompressed, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, name]));

    offset += 30 + name.length + deflated.length;
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, eocd]);
}

/** A .docx whose body is the paragraphs given, in order. */
export function buildDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map(
      (p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`,
    )
    .join('');
  return buildZip([
    {
      name: '[Content_Types].xml',
      body: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    {
      name: 'word/document.xml',
      body: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    },
  ]);
}

export type SheetSpec = { name: string; rows: string[][] };

/**
 * A .xlsx built the way Excel builds one: every string in a shared table, cells
 * referring to it by index, and sheets reached through the relationship file
 * rather than by guessing the filename from the order.
 */
export function buildXlsx(sheets: SheetSpec[]): Buffer {
  const shared: string[] = [];
  const indexOf = (value: string) => {
    const at = shared.indexOf(value);
    if (at >= 0) return at;
    shared.push(value);
    return shared.length - 1;
  };

  const column = (n: number) => {
    let s = '';
    let x = n + 1;
    while (x > 0) {
      const r = (x - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };

  const sheetFiles = sheets.map((sheet, i) => {
    const rows = sheet.rows
      .map((cells, r) => {
        const body = cells
          .map((value, c) =>
            value === '' ? '' : `<c r="${column(c)}${r + 1}" t="s"><v>${indexOf(value)}</v></c>`,
          )
          .join('');
        return `<row r="${r + 1}">${body}</row>`;
      })
      .join('');
    return {
      name: `xl/worksheets/sheet${i + 1}.xml`,
      body: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    };
  });

  const sharedXml = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}">${shared
    .map((v) => `<si><t>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`)
    .join('')}</sst>`;

  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;

  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')}</Relationships>`;

  return buildZip([
    {
      name: '[Content_Types].xml',
      body: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    { name: 'xl/workbook.xml', body: workbook },
    { name: 'xl/_rels/workbook.xml.rels', body: rels },
    { name: 'xl/sharedStrings.xml', body: sharedXml },
    ...sheetFiles,
  ]);
}

/** A real PNG, for "this .docx is actually an image" checks. */
export function buildPng(size = 16): Buffer {
  const raw: number[] = [];
  for (let y = 0; y < size; y++) {
    raw.push(0);
    for (let x = 0; x < size; x++) raw.push(((x + y) & 1) * 255, 40, 90);
  }
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateRawSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A minimal but genuinely valid PDF, so the vision/document path can be driven. */
export function buildPdf(line: string): Buffer {
  const content = `BT /F1 24 Tf 72 700 Td (${line.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
