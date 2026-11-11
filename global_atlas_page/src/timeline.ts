export type DateRange = [number, number];
export type DateEndpoint = 'from' | 'to';

export const TIMELINE_START = Date.UTC(1960, 0, 1) / 86400000;
export const TIMELINE_END = Date.UTC(2025, 11, 31) / 86400000;
export const TIMELINE_PLAYBACK_MS = 66_000;
export const TIMELINE_YEARS = Array.from({ length: 66 }, (_, index) => 1960 + index);
export const TIMELINE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function displayDay(day: number) {
  return new Date(day * 86400000).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function selectTimelineMonth(range: DateRange, endpoint: DateEndpoint, year: number, month: number): DateRange {
  const start = Math.max(TIMELINE_START, Date.UTC(year, month, 1) / 86400000);
  const end = Math.min(TIMELINE_END, Date.UTC(year, month + 1, 0) / 86400000);
  return endpoint === 'from'
    ? [start, start > range[1] ? end : range[1]]
    : [end < range[0] ? start : range[0], end];
}

export function playbackEndDay(startingEnd: number, elapsedMs: number): number {
  return Math.min(TIMELINE_END, startingEnd + Math.floor(
    Math.max(0, elapsedMs) / TIMELINE_PLAYBACK_MS * (TIMELINE_END - TIMELINE_START),
  ));
}
