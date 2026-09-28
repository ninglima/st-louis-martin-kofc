import { IsoDate } from '../schemas';

/**
 * One data row the officer's CSV asked to load, already normalised: the date
 * is ISO no matter which of the two accepted shapes it arrived in, and the
 * membership number is trimmed. `line` is the 1-based physical line the row
 * came from (the header is line 1), so an officer chasing a problem can find
 * it in the spreadsheet they uploaded -- the same reasoning `SheetRow` in
 * `roster-reader.ts` gives for keeping a row number attached to its data
 * rather than re-deriving it from array position.
 */
export interface PaidThroughRow {
  line: number;
  membershipNumber: string;
  paidThrough: string;
  duesLevel?: string;
}

export type CsvIssueKind =
  | 'missing_column'
  | 'bad_date'
  | 'duplicate'
  | 'suspicious_date'
  | 'blank';

export interface CsvIssue {
  line: number;
  membershipNumber?: string;
  kind: CsvIssueKind;
  message: string;
}

const REQUIRED_COLUMNS = ['membership_number', 'paid_through'] as const;

/** More than two years ahead of "today" is treated as suspicious. */
const SUSPICIOUS_AHEAD_DAYS = 730;
/** More than five years back of "today" is treated as suspicious. */
const SUSPICIOUS_BEHIND_DAYS = 1826;

interface CsvRecord {
  fields: string[];
  line: number;
}

/**
 * A small hand-written splitter rather than a library: this file has three
 * columns and no embedded newlines to speak of, unlike the Officers Online
 * exports `roster-reader.ts` reads through ExcelJS. It still has to cope with
 * the same real-world csv shapes that file found -- quoted fields, doubled
 * quotes escaping a literal `"`, and CRLF line endings -- so it is a proper
 * character scanner, not a `split(',')`.
 *
 * Scanning runs over the whole text rather than splitting into lines first:
 * splitting on `\n` before parsing quotes would cut a quoted field that
 * happens to contain a newline into two records. `\r` is dropped unconditionally
 * (inside or outside quotes) rather than kept as data, since every real
 * export here uses it only as half of a CRLF pair.
 */
function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];

  let field = '';
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let touched = false;

  const endField = () => {
    fields.push(field);
    field = '';
  };

  const endRecord = () => {
    endField();
    records.push({ fields, line: recordStartLine });
    fields = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      touched = true;
    } else if (ch === ',') {
      endField();
      touched = true;
    } else if (ch === '\r') {
      // half of a CRLF pair (or a lone CR); never data.
    } else if (ch === '\n') {
      endRecord();
      line++;
      recordStartLine = line;
    } else {
      field += ch;
      touched = true;
    }
  }

  // A final record with no trailing newline.
  if (touched || field !== '' || fields.length > 0) {
    endRecord();
  }

  return records;
}

/** Normalises `YYYY-MM-DD` (unchanged) or `M/D/YYYY` to ISO. Anything else is `null`. */
function normalizeDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);

  if (!us) return null;

  const [, month, day, year] = us;

  return `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}`;
}

function toUtcDays(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);

  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 0) / 86_400_000;
}

/**
 * Parses the Financial Secretary's one-off paid-through CSV.
 *
 * Every row is judged independently: a bad date on line 40 does not stop
 * line 41 from loading, and every rejection is reported as an issue rather
 * than thrown, so the officer sees the whole picture in one preview instead
 * of fixing the file one error at a time.
 *
 * `today` is passed in (rather than read from the clock here) so callers use
 * the same council-local "today" everywhere -- see `chicagoToday()`'s doc
 * comment for why the server's own clock is the wrong source.
 */
export function parsePaidThroughCsv(
  text: string,
  today: string,
): { rows: PaidThroughRow[]; issues: CsvIssue[] } {
  // Strip a leading byte-order mark: Excel and some bank/roster exports write
  // one, and left in place it would silently attach itself to the first
  // header name (`﻿membership_number`), making that column look missing.
  const stripped = text.startsWith('﻿') ? text.slice(1) : text;

  const records = parseCsvRecords(stripped);
  const issues: CsvIssue[] = [];

  const header = records[0];

  if (!header) {
    issues.push({
      line: 1,
      kind: 'missing_column',
      message: `Missing required column(s): ${REQUIRED_COLUMNS.join(', ')}.`,
    });

    return { rows: [], issues };
  }

  const headerNames = header.fields.map((f) => f.trim().toLowerCase());
  const columnIndex = (name: string) => headerNames.indexOf(name);

  const membershipIdx = columnIndex('membership_number');
  const paidThroughIdx = columnIndex('paid_through');
  const duesLevelIdx = columnIndex('dues_level');

  const missing = REQUIRED_COLUMNS.filter((name) => columnIndex(name) === -1);

  if (missing.length > 0) {
    issues.push({
      line: header.line,
      kind: 'missing_column',
      message: `Missing required column(s): ${missing.join(', ')}.`,
    });

    return { rows: [], issues };
  }

  const rows: PaidThroughRow[] = [];
  const seen = new Set<string>();
  const todayDays = toUtcDays(today);

  for (const record of records.slice(1)) {
    // A wholly blank physical line -- a single, empty field -- is scenery
    // from the export, not a row the officer wrote. It is skipped silently:
    // an issue here would bury the real ones under noise on every re-upload.
    if (record.fields.length === 1 && (record.fields[0] ?? '').trim() === '') {
      continue;
    }

    const membershipNumber = (record.fields[membershipIdx] ?? '').trim();
    const paidThroughRaw = (record.fields[paidThroughIdx] ?? '').trim();
    const duesLevelRaw =
      duesLevelIdx === -1 ? '' : (record.fields[duesLevelIdx] ?? '').trim();

    if (membershipNumber === '') {
      issues.push({
        line: record.line,
        kind: 'blank',
        message: 'Missing membership number.',
      });
      continue;
    }

    if (paidThroughRaw === '') {
      issues.push({
        line: record.line,
        membershipNumber,
        kind: 'blank',
        message: 'Missing paid-through date.',
      });
      continue;
    }

    const normalized = normalizeDate(paidThroughRaw);
    const valid = normalized !== null && IsoDate.safeParse(normalized).success;

    if (!valid || normalized === null) {
      issues.push({
        line: record.line,
        membershipNumber,
        kind: 'bad_date',
        message: `"${paidThroughRaw}" is not a date in YYYY-MM-DD or M/D/YYYY form.`,
      });
      continue;
    }

    if (seen.has(membershipNumber)) {
      issues.push({
        line: record.line,
        membershipNumber,
        kind: 'duplicate',
        message: `Membership number ${membershipNumber} appears more than once; only the first is kept.`,
      });
      continue;
    }

    seen.add(membershipNumber);

    const diffDays = toUtcDays(normalized) - todayDays;

    if (
      diffDays > SUSPICIOUS_AHEAD_DAYS ||
      diffDays < -SUSPICIOUS_BEHIND_DAYS
    ) {
      issues.push({
        line: record.line,
        membershipNumber,
        kind: 'suspicious_date',
        message: `${normalized} is unusually far from today -- double-check before loading it.`,
      });
    }

    rows.push({
      line: record.line,
      membershipNumber,
      paidThrough: normalized,
      ...(duesLevelRaw !== '' ? { duesLevel: duesLevelRaw } : {}),
    });
  }

  return { rows, issues };
}
