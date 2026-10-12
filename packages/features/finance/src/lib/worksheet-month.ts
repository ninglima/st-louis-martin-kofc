/** Previous calendar month, as YYYY-MM-01. January 2000 stays January 2000. */
export function defaultWorksheetMonth(today: string): string {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const previous =
    month === 1
      ? `${year - 1}-12-01`
      : `${year}-${String(month - 1).padStart(2, '0')}-01`;

  return previous < '2000-01-01' ? '2000-01-01' : previous;
}

/** First-of-month dates from the current month back through 2000-01-01. */
export function worksheetMonthOptions(today: string): string[] {
  const current = `${today.slice(0, 7)}-01`;
  const months: string[] = [];
  let cursor = current;

  while (cursor >= '2000-01-01') {
    months.push(cursor);
    const [year, month] = cursor.split('-').map(Number) as [number, number];
    cursor =
      month === 1
        ? `${year - 1}-12-01`
        : `${year}-${String(month - 1).padStart(2, '0')}-01`;
  }

  return months;
}

export function worksheetMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}T00:00:00Z`));
}
