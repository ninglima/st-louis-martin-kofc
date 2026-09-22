import { Readable } from 'node:stream';

import ExcelJS from 'exceljs';

export class RosterReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterReadError';
  }
}

/** Widest column index the extract uses, so short rows stay index-aligned. */
const MIN_COLUMNS = 27;

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value)
    return String(value.text ?? '');
  if (typeof value === 'object' && 'result' in value)
    return String(value.result ?? '');
  return String(value);
}

function padRow(row: string[]): string[] {
  while (row.length < MIN_COLUMNS) row.push('');
  return row;
}

/**
 * Reads every row of a worksheet's used range as string arrays, padded to
 * MIN_COLUMNS. The loop only walks the sheet's own column count — padRow is
 * what actually guarantees the floor, so a sheet narrower than MIN_COLUMNS
 * (a short CSV with a short header, for instance) still comes back aligned.
 */
function readSheetRows(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    // ExcelJS row values are 1-based with a leading hole at index 0.
    for (let column = 1; column <= sheet.columnCount; column++) {
      values.push(cellToString(row.getCell(column).value));
    }
    rows.push(padRow(values));
  });

  return rows;
}

/**
 * Reads a CSV buffer through ExcelJS's own CSV reader (fast-csv underneath)
 * rather than a hand-rolled `split(',')`, so quoted commas, escaped quotes,
 * and quoted empty fields are handled by a solved parser instead of silently
 * shifting every subsequent column.
 */
async function readCsv(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();

  let sheet: ExcelJS.Worksheet;

  try {
    sheet = await workbook.csv.read(Readable.from(buffer), {
      // Identity map: skip fast-csv's default number/date coercion so every
      // cell stays a string, matching the .xlsx path's contract.
      map: (value: string) => value,
      parserOptions: { trim: true },
    });
  } catch {
    throw new RosterReadError(
      'That file could not be read as CSV. Re-export it from Officers Online and try again.',
    );
  }

  return readSheetRows(sheet);
}

/**
 * First sheet only, header row included. Every cell is returned as a string:
 * a membership number is an identifier, not a quantity, and letting Excel
 * hand back `1000001` as a number invites precision and formatting surprises.
 */
export async function readRoster(
  buffer: Buffer,
  filename: string,
): Promise<string[][]> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.csv')) {
    return readCsv(buffer);
  }

  if (!lower.endsWith('.xlsx')) {
    throw new RosterReadError(
      `Unsupported file type. Upload the Officers Online export as .xlsx or .csv, not "${filename}".`,
    );
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new RosterReadError(
      'That file could not be read as a spreadsheet. Re-export it from Officers Online and try again.',
    );
  }

  const sheet = workbook.worksheets[0];

  if (!sheet) {
    throw new RosterReadError('That spreadsheet has no sheets.');
  }

  return readSheetRows(sheet);
}
