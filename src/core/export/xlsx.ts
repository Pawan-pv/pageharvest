/**
 * Excel (.xlsx) export: Office Open XML written as a stored (uncompressed) ZIP, with no
 * library. It is its own module so the side panel loads it only when the user exports to
 * Excel; everything else in export stays in exporter.ts.
 */
import { ExtractedRecord, FieldDefinition } from '@/types';
import { resolveColumns, type XlsxExportOptions } from './exporter';

// ---------------------------------------------------------------------------
// XLSX export (Office Open XML, written as a stored (uncompressed) ZIP)
// ---------------------------------------------------------------------------

function escapeXml(value: unknown): string {
  return String(value)
    // Strip invalid XML 1.0 control characters before escaping entities.
    // eslint-disable-next-line no-control-regex -- control chars intentionally stripped
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnLetter(index: number): string {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function sanitizeSheetName(name: string | undefined): string {
  const base = (name ?? 'Sheet1').trim() || 'Sheet1';
  // Excel forbids: \ / ? * [ ] and limits to 31 chars.
  const cleaned = base.replace(/[\\/?*[\]]/g, ' ').slice(0, 31).trim();
  return cleaned || 'Sheet1';
}

function buildWorksheetXml(
  records: ExtractedRecord[],
  columns: string[]
): string {
  const rows: string[] = [];
  // Header row
  const headerCells = columns
    .map((col, ci) => {
      const ref = `${columnLetter(ci)}1`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(col)}</t></is></c>`;
    })
    .join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  records.forEach((record, ri) => {
    const rowNum = ri + 2;
    const cells = columns
      .map((col, ci) => {
        const ref = `${columnLetter(ci)}${rowNum}`;
        const value = record[col];
        if (value === null || value === undefined) {
          return `<c r="${ref}"/>`;
        }
        if (typeof value === 'boolean') {
          return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          return `<c r="${ref}"><v>${value}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
      })
      .join('');
    rows.push(`<row r="${rowNum}">${cells}</row>`);
  });

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>'
  );
}

// ---- Minimal synchronous ZIP writer (stored entries) ----

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

function strToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function createStoredZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  let offset = 0;
  const cdEntries: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const nameBytes = strToBytes(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20); // version needed
    writeUint16(localHeader, 6, 0x0800); // UTF-8 flag
    writeUint16(localHeader, 8, 0); // stored
    writeUint16(localHeader, 10, 0); // mod time
    writeUint16(localHeader, 12, 0); // mod date
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, size);
    writeUint32(localHeader, 22, size);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0); // extra length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader);
    localParts.push(data);

    cdEntries.push({ name: nameBytes, crc, size, offset });
    offset += localHeader.length + data.length;
  }

  // Central directory
  let cdSize = 0;
  const cdBuffers: Uint8Array[] = [];
  for (let i = 0; i < entries.length; i++) {
    const cdEntry = cdEntries[i];
    const nameBytes = cdEntry.name;
    const header = new Uint8Array(46 + nameBytes.length);
    writeUint32(header, 0, 0x02014b50);
    writeUint16(header, 4, 20); // version made by
    writeUint16(header, 6, 20); // version needed
    writeUint16(header, 8, 0x0800); // flags
    writeUint16(header, 10, 0); // method
    writeUint16(header, 12, 0); // mod time
    writeUint16(header, 14, 0); // mod date
    writeUint32(header, 16, cdEntry.crc);
    writeUint32(header, 20, cdEntry.size);
    writeUint32(header, 24, cdEntry.size);
    writeUint16(header, 28, nameBytes.length);
    writeUint16(header, 30, 0); // extra
    writeUint16(header, 32, 0); // comment
    writeUint16(header, 34, 0); // disk number
    writeUint16(header, 36, 0); // internal attr
    writeUint32(header, 38, 0); // external attr
    writeUint32(header, 42, cdEntry.offset);
    header.set(nameBytes, 46);
    cdBuffers.push(header);
    cdSize += header.length;
  }

  const cdOffset = offset;
  // End of central directory
  const eocd = new Uint8Array(22);
  writeUint32(eocd, 0, 0x06054b50);
  writeUint16(eocd, 4, 0); // disk number
  writeUint16(eocd, 6, 0); // disk with cd
  writeUint16(eocd, 8, entries.length);
  writeUint16(eocd, 10, entries.length);
  writeUint32(eocd, 12, cdSize);
  writeUint32(eocd, 16, cdOffset);
  writeUint16(eocd, 20, 0); // comment length

  // Assemble
  const totalSize =
    localParts.reduce((s, b) => s + b.length, 0) +
    cdBuffers.reduce((s, b) => s + b.length, 0) +
    eocd.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const b of localParts) {
    out.set(b, pos);
    pos += b.length;
  }
  for (const b of cdBuffers) {
    out.set(b, pos);
    pos += b.length;
  }
  out.set(eocd, pos);
  return out;
}

export function recordsToXlsx(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: XlsxExportOptions = {}
): Uint8Array {
  const columns = resolveColumns(records, fields, options);
  const sheetName = sanitizeSheetName(options.sheetName);
  const worksheetXml = buildWorksheetXml(
    records.length ? records : [],
    columns
  );

  // If no records, still emit header? resolveColumns may be empty; build empty sheet.
  // Ensure at least columns from fields? resolveColumns handles.

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: strToBytes(contentTypes) },
    { name: '_rels/.rels', data: strToBytes(rootRels) },
    { name: 'xl/workbook.xml', data: strToBytes(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: strToBytes(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: strToBytes(worksheetXml) },
  ];

  return createStoredZip(entries);
}

export function recordsToXlsxBuffer(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: XlsxExportOptions = {}
): ArrayBuffer {
  const bytes = recordsToXlsx(records, fields, options);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function recordsToXlsxBlob(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: XlsxExportOptions = {}
): Blob {
  const bytes = recordsToXlsx(records, fields, options);
  return new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Back-compat / convenience aliases
export const exportToXlsx = recordsToXlsx;
export const recordsToExcel = recordsToXlsx;
