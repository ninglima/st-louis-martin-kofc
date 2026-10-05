const ZONE = 'America/Chicago';

/** YYYY-MM-DD of an instant in Chicago. */
export function chicagoDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** HH:MM (24-hour) of an instant in Chicago. */
export function chicagoTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function todayInChicago(): string {
  return chicagoDate(new Date().toISOString());
}

export function formatTime(iso: string): string {
  // Newer ICU puts a narrow no-break space (U+202F) before AM/PM.
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(/ /g, ' ');
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}
