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
    return buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => padRow(line.split(',').map((cell) => cell.trim())));
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

  const rows: string[][] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    // ExcelJS row values are 1-based with a leading hole at index 0.
    for (
      let column = 1;
      column <= Math.max(sheet.columnCount, MIN_COLUMNS);
      column++
    ) {
      values.push(cellToString(row.getCell(column).value));
    }
    rows.push(padRow(values));
  });

  return rows;
}
