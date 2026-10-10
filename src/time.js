// -----------------------------------------------------------------------------
// Local dates and times of the house.
//
// The NWS gives every location its IANA time zone (/points `timeZone`), and
// its periods carry their local offset ("2026-10-09T18:00:00-05:00"). The
// pivot payload is made of instants, which the core formats itself; the
// texts this integration writes (scene summaries, widget subtitles) need the
// local wall-clock time of the house, formatted here.
// -----------------------------------------------------------------------------

const LOCALES = { fr: 'fr-FR', en: 'en-US' };

const localeOf = (language) => LOCALES[language] ?? LOCALES.en;

/**
 * @description Build an Intl formatter, falling back to UTC on an unknown zone.
 * @param {string} locale - The locale.
 * @param {object} options - Intl options.
 * @param {string|null} timeZone - The IANA time zone.
 * @returns {Intl.DateTimeFormat} The formatter.
 * @example
 * formatter('en-US', { hour: 'numeric' }, 'America/Chicago');
 */
function formatter(locale, options, timeZone) {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: timeZone || 'UTC' });
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  }
}

/**
 * @description The local calendar date of an instant.
 * @param {number|string|Date} instant - The instant.
 * @param {string|null} timeZone - The IANA time zone.
 * @returns {string} YYYY-MM-DD.
 * @example
 * localDate(Date.parse('2026-10-10T03:00:00Z'), 'America/Chicago'); // -> '2026-10-09'
 */
function localDate(instant, timeZone) {
  return formatter('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }, timeZone).format(
    new Date(instant),
  );
}

/**
 * @description The local date part of an NWS period time (it carries its offset).
 * @param {string} isoWithOffset - "2026-10-09T18:00:00-05:00".
 * @returns {string} YYYY-MM-DD.
 * @example
 * periodDate('2026-10-09T18:00:00-05:00'); // -> '2026-10-09'
 */
function periodDate(isoWithOffset) {
  return String(isoWithOffset).slice(0, 10);
}

/**
 * @description Add days to a YYYY-MM-DD date.
 * @param {string} date - The date.
 * @param {number} days - Days to add.
 * @returns {string} The new date.
 * @example
 * addDays('2026-10-31', 1); // -> '2026-11-01'
 */
function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * @description Format a local time: "5:12 PM" in English, "17:12" in French.
 * @param {number|string|Date} instant - The instant.
 * @param {string|null} timeZone - The IANA time zone.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} The time.
 * @example
 * formatTime('2026-10-09T22:12:00Z', 'America/Chicago', 'en'); // -> '5:12 PM'
 */
function formatTime(instant, timeZone, language) {
  return formatter(localeOf(language), { hour: 'numeric', minute: '2-digit' }, timeZone).format(
    new Date(instant),
  );
}

/**
 * @description Format a short local day and time: "Sat 6:00 PM", "sam. 18:00".
 * @param {number|string|Date} instant - The instant.
 * @param {string|null} timeZone - The IANA time zone.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} The day and time.
 * @example
 * formatDayTime('2026-10-10T23:00:00Z', 'America/Chicago', 'en'); // -> 'Sat 6:00 PM'
 */
function formatDayTime(instant, timeZone, language) {
  return formatter(
    localeOf(language),
    { weekday: 'short', hour: 'numeric', minute: '2-digit' },
    timeZone,
  ).format(new Date(instant));
}

/**
 * @description The local weekday name of a YYYY-MM-DD date.
 * @param {string} date - The date.
 * @param {string} language - 'fr' or 'en'.
 * @returns {string} "Saturday", "samedi".
 * @example
 * weekdayName('2026-10-10', 'fr'); // -> 'samedi'
 */
function weekdayName(date, language) {
  const [year, month, day] = date.split('-').map(Number);
  return formatter(localeOf(language), { weekday: 'long' }, 'UTC').format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}

export { localDate, periodDate, addDays, formatTime, formatDayTime, weekdayName };
