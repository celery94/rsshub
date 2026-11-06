/**
 * Time-zone helpers. Dates that drive the pipeline are kept as local calendar
 * strings (`YYYY-MM-DD`) and compared as strings, so daylight-saving changes
 * never move an article between two daily reports.
 * @module rss-brief/time
 */

/** @returns whether an IANA time zone is usable by Intl. */
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Calendar fields of one instant in a time zone.
 * @param date - instant.
 * @param timeZone - IANA zone.
 * @returns numeric year, month, day, hour, minute, second.
 */
export function localParts(date, timeZone) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Local calendar date of one instant.
 * @param date - instant.
 * @param timeZone - IANA zone.
 * @returns `YYYY-MM-DD`.
 */
export function localDate(date, timeZone) {
  const parts = localParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * Add whole days to a calendar date without involving a time zone.
 * @param value - `YYYY-MM-DD`.
 * @param days - signed day count.
 * @returns shifted `YYYY-MM-DD`.
 */
export function addDateDays(value, days) {
  const [year, month, day] = String(value).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/**
 * The calendar day before `now` in a time zone.
 * @param now - instant.
 * @param timeZone - IANA zone.
 * @returns `YYYY-MM-DD`.
 */
export function previousLocalDate(now, timeZone) {
  return addDateDays(localDate(now, timeZone), -1);
}

/**
 * Parse `HH:MM`.
 * @param value - configured report time.
 * @returns normalized text and minutes of day, or null.
 */
export function parseHHMM(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { text: `${pad2(hour)}:${pad2(minute)}`, minutes: hour * 60 + minute };
}

/** Minutes elapsed since local midnight. */
export function minutesOfDay(date, timeZone) {
  const parts = localParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
}

/**
 * Whether the previous local day still needs a report. At 08:00 the report for
 * yesterday becomes due; once it is recorded, the next due time is tomorrow.
 * @param now - current instant.
 * @param lastReportDate - most recently generated scheduled date.
 * @param reportAt - `HH:MM`.
 * @param timeZone - IANA zone.
 * @returns true when a scheduled report is due now.
 */
export function reportDue(now, lastReportDate, reportAt, timeZone) {
  const time = parseHHMM(reportAt);
  if (time === null) return false;
  const previous = previousLocalDate(now, timeZone);
  return lastReportDate !== previous && minutesOfDay(now, timeZone) >= time.minutes;
}

/**
 * Human-readable next scheduled report time, for status surfaces.
 * @returns a local date-time label, or a phrase for "the next check".
 */
export function nextReportLabel(now, lastReportDate, reportAt, timeZone) {
  const time = parseHHMM(reportAt);
  if (time === null) return null;
  const today = localDate(now, timeZone);
  if (minutesOfDay(now, timeZone) < time.minutes) return `${today} ${time.text}`;
  if (lastReportDate !== previousLocalDate(now, timeZone)) return "下一次检查时";
  return `${addDateDays(today, 1)} ${time.text}`;
}

/**
 * ISO timestamp found `days` days before now.
 * @param days - day count.
 * @param now - reference instant.
 * @returns ISO string.
 */
export function isoDaysAgo(days, now = new Date()) {
  return new Date(now.getTime() - days * 86400000).toISOString();
}

/**
 * Validate a `YYYY-MM-DD` calendar date.
 * @param value - candidate text.
 * @returns true for a real Gregorian date.
 */
export function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Local clock time of an ISO instant, for report metadata.
 * @param iso - ISO instant.
 * @param timeZone - IANA zone.
 * @returns `HH:MM`, or an empty string for invalid input.
 */
export function formatLocalTime(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/**
 * Local date and time of an ISO instant, for headers and footers.
 * @returns `YYYY-MM-DD HH:MM`.
 */
export function formatLocalDateTime(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = localParts(date, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Zero-pad to two digits. */
function pad2(value) {
  return String(value).padStart(2, "0");
}
