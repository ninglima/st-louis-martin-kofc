// Mirrors @kit/events/lib/format (Chicago formatting) to avoid a package cycle.
const ZONE = 'America/Chicago';

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
