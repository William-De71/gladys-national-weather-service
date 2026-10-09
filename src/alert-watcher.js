// -----------------------------------------------------------------------------
// Alert watcher: checks the official NWS alerts of every located house and
// publishes the scene triggers `alert_issued` and `alert_ended`.
//
// Why a watcher of our own when the core has a generic weather-alert trigger:
//   - the core checks every 30 minutes; a Tornado Warning lasts 30 to 45
//     minutes. Checking every minute (the user's `alert_check_interval`) and
//     nudging the core on every change (`requestWeatherRefresh`) brings the
//     core trigger down to seconds too;
//   - the pivot alert types have no tornado nor hurricane, and no notion of
//     Watch vs Warning: the NWS trigger filters on both (see alerts.js).
//
// Following an alert through its life. The NWS never edits an alert: it
// issues a new one whose `references` list the ones it replaces (an extended
// warning, an updated text). So:
//   - an alert whose id, or one of whose references, is already known is the
//     CONTINUATION of an episode: no new `alert_issued`;
//   - an alert that disappears without being replaced has ENDED — once it
//     has been missing for two checks in a row, or once its end time has
//     passed: one empty answer of the API must not end a tornado warning;
//   - ended and replaced alerts are remembered for 6 hours, so an alert that
//     comes back after a hiccup does not fire twice.
// The first check of a house after a start is a BASELINE (no event): a
// restart in the middle of a storm must not re-fire every scene — the rule of
// the core weather-alert trigger.
// -----------------------------------------------------------------------------

import { CATEGORY_LABELS, LEVEL_LABELS, localize } from './alerts.js';
import { formatDayTime } from './time.js';

const SCENE_TRIGGERS = {
  ALERT_ISSUED: 'alert_issued',
  ALERT_ENDED: 'alert_ended',
};

const MISSING_CHECKS_TO_END = 2;
const ENDED_MEMORY_MS = 6 * 60 * 60 * 1000;
// Scene event strings are capped at 1000 characters by the core.
const MAX_EVENT_STRING = 1000;
// A house outside the NWS coverage is checked again after this delay.
const OUT_OF_COVERAGE_RETRY_MS = 24 * 60 * 60 * 1000;

const truncate = (text) =>
  typeof text === 'string' && text.length > MAX_EVENT_STRING
    ? `${text.slice(0, MAX_EVENT_STRING - 1)}…`
    : (text ?? null);

/**
 * @description Write the one-sentence summary of an issued or ended alert.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, ended, language, timeZone }.
 * @returns {string} The sentence.
 * @example
 * alertSummary(alert, { house: 'Home', ended: false, language: 'en', timeZone: 'America/Chicago' });
 */
function alertSummary(alert, { house, ended, language, timeZone }) {
  const until = alert.end ? formatDayTime(alert.end, timeZone, language) : null;
  if (language === 'fr') {
    if (ended) {
      return `Fin de l'alerte NWS « ${alert.event} » pour ${house}.`;
    }
    const category = localize(CATEGORY_LABELS, alert.category, 'fr').toLowerCase();
    const level = localize(LEVEL_LABELS, alert.level, 'fr').toLowerCase();
    return `NWS « ${alert.event} » (${category}, niveau ${level}) pour ${house}${until ? ` jusqu'à ${until}` : ''}.`;
  }
  if (ended) {
    return `The NWS ${alert.event} for ${house} has ended.`;
  }
  return `NWS ${alert.event} for ${house}${until ? ` until ${until}` : ''}${alert.headline ? `: ${alert.headline}` : '.'}`;
}

/**
 * @description Build the data of an `alert_issued` event.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, language, timeZone }.
 * @returns {object} The flat event data.
 * @example
 * buildIssuedData(alert, { house: 'Home', language: 'en', timeZone: 'America/Chicago' });
 */
function buildIssuedData(alert, { house, language, timeZone }) {
  return {
    house,
    event: alert.event,
    category: alert.category,
    category_label: localize(CATEGORY_LABELS, alert.category, language),
    level: alert.level,
    level_label: localize(LEVEL_LABELS, alert.level, language),
    severity: alert.severity,
    urgency: alert.urgency,
    certainty: alert.certainty,
    headline: truncate(alert.headline),
    area: truncate(alert.area),
    onset: alert.start ? formatDayTime(alert.start, timeZone, language) : null,
    ends: alert.end ? formatDayTime(alert.end, timeZone, language) : null,
    instruction: truncate(alert.instruction),
    description: truncate(alert.description),
    summary: truncate(alertSummary(alert, { house, ended: false, language, timeZone })),
  };
}

/**
 * @description Build the data of an `alert_ended` event.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, language, timeZone }.
 * @returns {object} The flat event data.
 * @example
 * buildEndedData(alert, { house: 'Home', language: 'en', timeZone: null });
 */
function buildEndedData(alert, { house, language, timeZone }) {
  return {
    house,
    event: alert.event,
    category: alert.category,
    category_label: localize(CATEGORY_LABELS, alert.category, language),
    level: alert.level,
    level_label: localize(LEVEL_LABELS, alert.level, language),
    severity: alert.severity,
    area: truncate(alert.area),
    summary: truncate(alertSummary(alert, { house, ended: true, language, timeZone })),
  };
}

/**
 * @description Create the alert watcher.
 * @param {object} options - Options.
 * @param {object} options.houses - The house registry (houses.js).
 * @param {Function} options.loadAlerts - `(house) => Promise<{ alerts, timeZone }>`:
 * the readAlerts() alerts of the house, fetched fresh, and its time zone.
 * @param {Function} options.publish - `(key, data) => Promise`, the SDK publishSceneEvent.
 * @param {Function} options.onChange - `(house) => void`: the alerts of a house changed.
 * @param {Function} options.getLanguage - `() => string`.
 * @param {Function} options.getIntervalMs - `() => number`, read before every round.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {Function} [options.now] - `() => number` in ms (for the tests).
 * @returns {object} The watcher ({ check, start, stop, activeAlerts }).
 * @example
 * const watcher = createAlertWatcher({ houses, loadAlerts, publish, onChange, getLanguage, getIntervalMs });
 */
function createAlertWatcher({
  houses,
  loadAlerts,
  publish,
  onChange,
  getLanguage,
  getIntervalMs,
  logger = console,
  now = () => Date.now(),
}) {
  // house id -> { tracked: Map<id, { alert, missing }>, retired: Map<id, ms>, alerts, timeZone }
  // `retired`: ids that left the list (ended or replaced), with when.
  const states = new Map();
  // house id -> ms until which the house is not checked (outside the NWS)
  const skippedUntil = new Map();
  let timer = null;
  let started = false;
  let running = false;

  /**
   * @description Publish an event, never throwing out of a check.
   * @param {string} key - The trigger key.
   * @param {object} data - The event data.
   * @example
   * await safePublish('alert_issued', data);
   */
  async function safePublish(key, data) {
    try {
      await publish(key, data);
      logger.info(`Scene event ${key}: ${data.summary}`);
    } catch (err) {
      logger.warn(`Unable to publish the scene event ${key}: ${err.message}`);
    }
  }

  /**
   * @description Check the alerts of one house and fire what changed.
   * @param {object} house - The house.
   * @example
   * await checkHouse(house);
   */
  async function checkHouse(house) {
    if ((skippedUntil.get(house.id) ?? 0) > now()) {
      return;
    }
    let loaded;
    try {
      loaded = await loadAlerts(house);
    } catch (err) {
      if (err.name === 'OutOfCoverageError') {
        logger.warn(`House "${house.name}" is outside the NWS coverage: alerts not checked`);
        skippedUntil.set(house.id, now() + OUT_OF_COVERAGE_RETRY_MS);
      } else {
        logger.warn(`Unable to check the NWS alerts of house "${house.name}": ${err.message}`);
      }
      return;
    }
    const { alerts, timeZone = null } = loaded;
    const current = new Map(alerts.map((alert) => [alert.id, alert]));
    const state = states.get(house.id);

    if (state === undefined) {
      states.set(house.id, {
        tracked: new Map(alerts.map((alert) => [alert.id, { alert, missing: 0 }])),
        retired: new Map(),
        alerts,
        timeZone,
      });
      logger.debug(`Alert baseline of house "${house.name}": ${alerts.length} alert(s)`);
      return;
    }

    const language = getLanguage();
    const context = { house: house.name, language, timeZone };
    const instant = now();
    let changed = false;

    // Forget the retired alerts past the memory delay.
    state.retired.forEach((endedAt, id) => {
      if (instant - endedAt > ENDED_MEMORY_MS) {
        state.retired.delete(id);
      }
    });

    // Alerts that left the list: replaced by an update, or ending.
    const referenced = new Set(alerts.flatMap((alert) => alert.references));
    for (const [id, entry] of [...state.tracked]) {
      if (current.has(id)) {
        continue;
      }
      if (referenced.has(id)) {
        // Replaced by an update: remembered, so the update reads as the
        // continuation of this episode just below.
        state.tracked.delete(id);
        state.retired.set(id, instant);
        changed = true;
        continue;
      }
      entry.missing += 1;
      const expired = entry.alert.end !== null && Date.parse(entry.alert.end) <= instant;
      if (entry.missing >= MISSING_CHECKS_TO_END || expired) {
        state.tracked.delete(id);
        state.retired.set(id, instant);
        changed = true;
        await safePublish(SCENE_TRIGGERS.ALERT_ENDED, buildEndedData(entry.alert, context));
      }
    }

    // Alerts in the list: known, continuing an episode, or new.
    for (const alert of alerts) {
      const entry = state.tracked.get(alert.id);
      if (entry !== undefined) {
        entry.alert = alert;
        entry.missing = 0;
        continue;
      }
      const known = (id) => state.tracked.has(id) || state.retired.has(id);
      const continuation = known(alert.id) || alert.references.some(known);
      state.tracked.set(alert.id, { alert, missing: 0 });
      changed = true;
      if (!continuation) {
        await safePublish(SCENE_TRIGGERS.ALERT_ISSUED, buildIssuedData(alert, context));
      }
    }

    state.alerts = alerts;
    state.timeZone = timeZone;
    if (changed) {
      onChange(house);
    }
  }

  /**
   * @description One round: every located house, one after the other.
   * @example
   * await watcher.check();
   */
  async function check() {
    if (running) {
      return;
    }
    running = true;
    try {
      const list = await houses.refresh();
      for (const house of list) {
        await checkHouse(house);
      }
      // Forget the houses that were removed or unlocated.
      const ids = new Set(list.map((house) => house.id));
      [...states.keys()].filter((id) => !ids.has(id)).forEach((id) => states.delete(id));
    } finally {
      running = false;
    }
  }

  /**
   * @description Schedule the next round.
   * @example
   * schedule();
   */
  function schedule() {
    timer = setTimeout(async () => {
      try {
        await check();
      } catch (err) {
        logger.warn(`Alert check failed: ${err.message}`);
      }
      if (started) {
        schedule();
      }
    }, getIntervalMs());
  }

  /**
   * @description Start the watcher: a baseline round now, then every interval.
   * @example
   * watcher.start();
   */
  function start() {
    stop();
    started = true;
    check()
      .catch((err) => logger.warn(`Alert baseline failed: ${err.message}`))
      .finally(() => {
        if (started) {
          schedule();
        }
      });
  }

  /**
   * @description Stop the watcher (the known alerts are kept).
   * @example
   * watcher.stop();
   */
  function stop() {
    started = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * @description The alerts last seen for a house, when it is watched.
   * @param {string} houseId - The house id.
   * @returns {Array<object>|null} The alerts, or null when unknown.
   * @example
   * watcher.activeAlerts(house.id);
   */
  function activeAlerts(houseId) {
    return states.get(houseId)?.alerts ?? null;
  }

  return { check, start, stop, activeAlerts };
}

export {
  SCENE_TRIGGERS,
  MISSING_CHECKS_TO_END,
  ENDED_MEMORY_MS,
  alertSummary,
  buildIssuedData,
  buildEndedData,
  createAlertWatcher,
};
