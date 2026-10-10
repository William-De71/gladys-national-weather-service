// -----------------------------------------------------------------------------
// NWS alerts: reading, classifying, and mapping to the Gladys pivot format.
//
// The NWS publishes its watches, warnings and advisories in CAP (Common
// Alerting Protocol), the very standard the Gladys pivot alerts are built on
// (contract B.18): `severity` maps one to one, the `event` name is kept as is.
// Two things are added here:
//
//   - a CATEGORY (tornado, hurricane, flood, winter, heat…) read from the event
//     name, for the scene trigger filter and the widget. The pivot `type` enum
//     is coarser and has no tornado nor hurricane, so it is derived from the
//     category (tornado -> thunderstorm, hurricane -> wind);
//   - a LEVEL read from the suffix of the event name, the scale every American
//     knows: Warning (act now) > Watch (be prepared) > Advisory > Statement.
//
// An update of an alert is a new alert whose `references` point to the one it
// replaces: the "episode" of an alert is followed through them, so an update
// never reads as a new alert (see alert-watcher.js).
// -----------------------------------------------------------------------------

const SEVERITIES = ['extreme', 'severe', 'moderate', 'minor'];
const SEVERITY_RANK = { unknown: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };

const LEVELS = ['warning', 'watch', 'advisory', 'statement', 'other'];
const LEVEL_RANK = { other: 0, statement: 1, advisory: 2, watch: 3, warning: 4 };

const MAX_PIVOT_ALERTS = 10;
const MAX_PIVOT_DESCRIPTION = 5000;

// Category rules, in priority order: the first pattern matching the event
// name wins. `pivot` is the type of the Gladys alert (undefined: untyped,
// rendered from the event name alone).
const CATEGORY_RULES = [
  { category: 'tornado', pattern: /tornado/i, pivot: 'thunderstorm' },
  { category: 'hurricane', pattern: /storm surge/i, pivot: 'coastal' },
  { category: 'hurricane', pattern: /hurricane|tropical storm|typhoon/i, pivot: 'wind' },
  { category: 'thunderstorm', pattern: /thunderstorm/i, pivot: 'thunderstorm' },
  { category: 'flood', pattern: /coastal flood|lakeshore flood/i, pivot: 'coastal' },
  { category: 'flood', pattern: /flood|hydrologic/i, pivot: 'flood' },
  { category: 'winter', pattern: /avalanche/i, pivot: 'avalanche' },
  {
    category: 'winter',
    pattern: /winter|blizzard|ice storm|snow|sleet|freezing rain|freezing spray|lake effect/i,
    pivot: 'snow',
  },
  { category: 'cold', pattern: /cold|wind chill|freeze|frost/i, pivot: 'cold' },
  { category: 'heat', pattern: /heat/i, pivot: 'heat' },
  { category: 'fire', pattern: /fire|red flag/i, pivot: undefined },
  { category: 'fog', pattern: /fog/i, pivot: 'fog' },
  { category: 'air', pattern: /air quality|air stagnation|smoke|ashfall|dust/i, pivot: undefined },
  {
    category: 'marine',
    pattern:
      /surf|rip current|beach|tsunami|marine|small craft|gale|seas|swell|low water|brisk wind/i,
    pivot: 'coastal',
  },
  { category: 'wind', pattern: /wind/i, pivot: 'wind' },
];

const CATEGORIES = [
  'tornado',
  'hurricane',
  'thunderstorm',
  'flood',
  'winter',
  'cold',
  'heat',
  'wind',
  'fire',
  'fog',
  'air',
  'marine',
  'other',
];

const CATEGORY_LABELS = {
  tornado: { en: 'Tornado', fr: 'Tornade' },
  hurricane: { en: 'Hurricane / tropical', fr: 'Ouragan / tropical' },
  thunderstorm: { en: 'Severe thunderstorm', fr: 'Orage violent' },
  flood: { en: 'Flood', fr: 'Inondation' },
  winter: { en: 'Winter storm', fr: 'Tempête hivernale' },
  cold: { en: 'Cold / freeze', fr: 'Froid / gel' },
  heat: { en: 'Heat', fr: 'Chaleur' },
  wind: { en: 'Wind', fr: 'Vent' },
  fire: { en: 'Fire weather', fr: 'Risque d’incendie' },
  fog: { en: 'Fog', fr: 'Brouillard' },
  air: { en: 'Air quality', fr: 'Qualité de l’air' },
  marine: { en: 'Marine / coast', fr: 'Mer / littoral' },
  other: { en: 'Other', fr: 'Autre' },
};

const LEVEL_LABELS = {
  warning: { en: 'Warning', fr: 'Alerte' },
  watch: { en: 'Watch', fr: 'Veille' },
  advisory: { en: 'Advisory', fr: 'Avis' },
  statement: { en: 'Statement', fr: 'Bulletin' },
  other: { en: 'Notice', fr: 'Information' },
};

const SEVERITY_LABELS = {
  extreme: { en: 'Extreme', fr: 'Extrême' },
  severe: { en: 'Severe', fr: 'Sévère' },
  moderate: { en: 'Moderate', fr: 'Modéré' },
  minor: { en: 'Minor', fr: 'Mineur' },
  unknown: { en: 'Unknown', fr: 'Inconnu' },
};

const localize = (labels, key, language) => {
  const entry = labels[key] ?? labels.other ?? labels.unknown;
  return entry[language] ?? entry.en;
};

/**
 * @description Read the category of an NWS event name.
 * @param {string} event - The event name ("Tornado Warning").
 * @returns {{ category: string, pivot: string|undefined }} The category and pivot type.
 * @example
 * classifyEvent('Excessive Heat Warning'); // -> { category: 'heat', pivot: 'heat' }
 */
function classifyEvent(event) {
  const rule = CATEGORY_RULES.find(({ pattern }) => pattern.test(String(event)));
  return rule === undefined
    ? { category: 'other', pivot: undefined }
    : { category: rule.category, pivot: rule.pivot };
}

/**
 * @description Read the level of an NWS event name from its suffix.
 * @param {string} event - The event name.
 * @returns {string} warning | watch | advisory | statement | other.
 * @example
 * readLevel('Tornado Watch'); // -> 'watch'
 */
function readLevel(event) {
  const match = /(warning|watch|advisory|statement)$/i.exec(String(event).trim());
  return match === null ? 'other' : match[1].toLowerCase();
}

/**
 * @description Read the CAP severity, lower-cased; anything outside the CAP
 * scale (the NWS "Unknown") is 'unknown'.
 * @param {string} severity - The CAP severity.
 * @returns {string} The severity.
 * @example
 * readSeverity('Severe'); // -> 'severe'
 */
function readSeverity(severity) {
  const value = String(severity ?? '').toLowerCase();
  return SEVERITIES.includes(value) ? value : 'unknown';
}

const textOrNull = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * @description The end of the EVENT an alert describes. `ends` when the NWS
 * gives it. Otherwise it depends on the product: a VTEC product (watches,
 * warnings, advisories) with no `ends` runs until further notice — a river
 * Flood Warning — and its `expires` is only the time of the next message, so
 * there is no end; a product without VTEC (Special Weather Statement…) ends
 * when its message expires.
 * @param {object} properties - The alert properties.
 * @returns {string|null} The end, null for "until further notice".
 * @example
 * eventEnd({ ends: null, expires: '2026-10-09T18:45:00-05:00', parameters: {} });
 */
function eventEnd(properties) {
  const ends = textOrNull(properties.ends);
  if (ends !== null) {
    return ends;
  }
  const vtec = properties.parameters?.VTEC;
  return Array.isArray(vtec) && vtec.length > 0 ? null : textOrNull(properties.expires);
}

/**
 * @description Normalize the alert features of /alerts/active: actual alerts
 * only (no tests, no exercises), cancellations and ended ones dropped, sorted
 * the most serious first. `end` is the end of the event (see eventEnd()), null
 * until further notice.
 * @param {Array<object>} features - The GeoJSON features.
 * @param {number} [now] - Current time in ms.
 * @returns {Array<object>} The alerts.
 * @example
 * const alerts = readAlerts(payload.features);
 */
function readAlerts(features, now = Date.now()) {
  const alerts = (Array.isArray(features) ? features : [])
    .map((feature) => feature?.properties)
    .filter(
      (properties) =>
        properties &&
        typeof properties.id === 'string' &&
        typeof properties.event === 'string' &&
        properties.status === 'Actual' &&
        properties.messageType !== 'Cancel',
    )
    .map((properties) => {
      const { category, pivot } = classifyEvent(properties.event);
      const end = eventEnd(properties);
      return {
        id: properties.id,
        references: (Array.isArray(properties.references) ? properties.references : [])
          .map((reference) => reference?.identifier)
          .filter((identifier) => typeof identifier === 'string'),
        event: properties.event.trim(),
        category,
        pivotType: pivot,
        level: readLevel(properties.event),
        severity: readSeverity(properties.severity),
        urgency: textOrNull(properties.urgency),
        certainty: textOrNull(properties.certainty),
        headline:
          textOrNull(properties.parameters?.NWSheadline?.[0]) ?? textOrNull(properties.headline),
        description: textOrNull(properties.description),
        instruction: textOrNull(properties.instruction),
        area: textOrNull(properties.areaDesc),
        sender: textOrNull(properties.senderName),
        start: textOrNull(properties.onset) ?? textOrNull(properties.effective),
        end,
      };
    })
    .filter((alert) => alert.end === null || !(Date.parse(alert.end) <= now));

  return alerts.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
      String(a.start).localeCompare(String(b.start)),
  );
}

/**
 * @description Map the alerts to the pivot format of Gladys (≤ 10, the most
 * serious first). An NWS "Unknown" severity (air quality alerts, mostly) is
 * sent as 'minor': CAP has no lower step, and dropping the alert would hide it.
 * @param {Array<object>} alerts - The readAlerts() alerts.
 * @returns {Array<object>} The pivot alerts.
 * @example
 * weather.alerts = toPivotAlerts(alerts);
 */
function toPivotAlerts(alerts) {
  return alerts.slice(0, MAX_PIVOT_ALERTS).map((alert) => {
    const description = [alert.headline, alert.description, alert.instruction]
      .filter(Boolean)
      .join('\n\n');
    const pivot = {
      severity: alert.severity === 'unknown' ? 'minor' : alert.severity,
      event: alert.event,
    };
    if (description) {
      pivot.description = description.slice(0, MAX_PIVOT_DESCRIPTION);
    }
    if (alert.pivotType) {
      pivot.type = alert.pivotType;
    }
    if (alert.start) {
      pivot.start = alert.start;
    }
    if (alert.end) {
      pivot.end = alert.end;
    }
    return pivot;
  });
}

/**
 * @description Count the alerts by level.
 * @param {Array<object>} alerts - The readAlerts() alerts.
 * @returns {{ warning: number, watch: number, advisory: number, statement: number, other: number }}
 * The counts.
 * @example
 * countByLevel(alerts).warning;
 */
function countByLevel(alerts) {
  const counts = Object.fromEntries(LEVELS.map((level) => [level, 0]));
  alerts.forEach((alert) => {
    counts[alert.level] += 1;
  });
  return counts;
}

export {
  SEVERITIES,
  SEVERITY_RANK,
  LEVELS,
  LEVEL_RANK,
  CATEGORIES,
  CATEGORY_LABELS,
  LEVEL_LABELS,
  SEVERITY_LABELS,
  localize,
  classifyEvent,
  readLevel,
  readSeverity,
  eventEnd,
  readAlerts,
  toPivotAlerts,
  countByLevel,
};
