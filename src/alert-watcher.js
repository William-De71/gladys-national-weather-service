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
// warning, an updated text, but also an UPGRADE: the Hurricane Warning that
// replaces a Hurricane Watch references it). So:
//   - an alert whose id is already known, or that references a known alert
//     of the SAME event, is the CONTINUATION of an episode: no new
//     `alert_issued`;
//   - an alert that references a known alert of another event is an upgrade
//     (or a downgrade): `alert_ended` for the old one, `alert_issued` for the
//     new one, so a scene filtered on `level=warning` runs at the upgrade;
//   - an alert that disappears without being replaced has ENDED — once its
//     end time has passed, or once it has been missing for two checks in a
//     row AND for five minutes: a short outage of the API answering an empty
//     list must not end a tornado warning;
//   - replaced alerts are remembered for 6 hours, so an update that comes
//     back after a hiccup does not fire twice. Ended ones too, but an ended
//     alert that comes back fires `alert_issued` again: the scenes saw it end,
//     they must see it start — `alert_issued` and `alert_ended` always pair.
// The first check of a house after a start is a BASELINE (no event): a
// restart in the middle of a storm must not re-fire every scene — the rule of
// the core weather-alert trigger.
// -----------------------------------------------------------------------------

import { CATEGORY_LABELS, LEVEL_LABELS, localize } from './alerts.js';
import { formatDayTime } from './time.js';
import { inSentence } from './i18n.js';

const SCENE_TRIGGERS = {
  ALERT_ISSUED: 'alert_issued',
  ALERT_ENDED: 'alert_ended',
};

const MISSING_CHECKS_TO_END = 2;
const MISSING_MS_TO_END = 5 * 60 * 1000;
const ENDED_MEMORY_MS = 6 * 60 * 60 * 1000;
// Scene event strings are capped at 1000 characters by the core.
const MAX_EVENT_STRING = 1000;
// A house outside the NWS coverage is checked again after this delay.
const OUT_OF_COVERAGE_RETRY_MS = 24 * 60 * 60 * 1000;

const truncate = (text) =>
  typeof text === 'string' && text.length > MAX_EVENT_STRING
    ? `${text.slice(0, MAX_EVENT_STRING - 1)}…`
    : (text ?? null);

// The `summary` sentences, per language (English for any other). The NWS
// event name stays in English: it is the official name of the product.
const SUMMARIES = {
  en: {
    ended: ({ event, house }) => `The NWS ${event} for ${house} has ended.`,
    issued: ({ event, house, until, headline }) =>
      `NWS ${event} for ${house}${until ? ` until ${until}` : ''}${headline ? `: ${headline}` : '.'}`,
  },
  fr: {
    ended: ({ event, house }) => `Fin de l'alerte NWS « ${event} » pour ${house}.`,
    issued: ({ event, house, until, category, level }) =>
      `NWS « ${event} » (${category}, niveau ${level}) pour ${house}${until ? ` jusqu'à ${until}` : ''}.`,
  },
  de: {
    ended: ({ event, house }) => `Die NWS-Warnung „${event}“ für ${house} ist beendet.`,
    issued: ({ event, house, until, category, level }) =>
      `NWS „${event}“ (${category}, Stufe ${level}) für ${house}${until ? ` bis ${until}` : ''}.`,
  },
  es: {
    ended: ({ event, house }) => `Fin de la alerta NWS «${event}» para ${house}.`,
    issued: ({ event, house, until, category, level }) =>
      `NWS «${event}» (${category}, nivel ${level}) para ${house}${until ? ` hasta ${until}` : ''}.`,
  },
};

/**
 * @description Write the one-sentence summary of an issued or ended alert.
 * @param {object} alert - The readAlerts() alert.
 * @param {object} options - { house, ended, language, timeZone }.
 * @returns {string} The sentence.
 * @example
 * alertSummary(alert, { house: 'Home', ended: false, language: 'en', timeZone: 'America/Chicago' });
 */
function alertSummary(alert, { house, ended, language, timeZone }) {
  const say = SUMMARIES[language] ?? SUMMARIES.en;
  if (ended) {
    return say.ended({ event: alert.event, house });
  }
  return say.issued({
    event: alert.event,
    house,
    until: alert.end ? formatDayTime(alert.end, timeZone, language) : null,
    headline: alert.headline,
    category: inSentence(localize(CATEGORY_LABELS, alert.category, language), language),
    level: inSentence(localize(LEVEL_LABELS, alert.level, language), language),
  });
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
 * @returns {object} The watcher ({ check, start, stop }).
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
  // house id -> { tracked: Map<id, { alert, missing, missingSince }>, retired: Map<id, { at, event, ended }> }
  // `retired`: ids that left the list, with when, their event name, and
  // whether `alert_ended` was published for them (false: replaced).
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
    const fresh = (alert) => ({ alert, missing: 0, missingSince: null });

    if (state === undefined) {
      states.set(house.id, {
        tracked: new Map(alerts.map((alert) => [alert.id, fresh(alert)])),
        retired: new Map(),
      });
      logger.debug(`Alert baseline of house "${house.name}": ${alerts.length} alert(s)`);
      return;
    }

    const language = getLanguage();
    const context = { house: house.name, language, timeZone };
    const instant = now();
    let changed = false;

    // Forget the retired alerts past the memory delay.
    state.retired.forEach(({ at }, id) => {
      if (instant - at > ENDED_MEMORY_MS) {
        state.retired.delete(id);
      }
    });

    const retire = (id, entry, ended) => {
      state.tracked.delete(id);
      state.retired.set(id, { at: instant, event: entry.alert.event, ended });
      changed = true;
    };

    // Alerts that left the list: replaced by an update of the same event,
    // replaced by another event (upgrade), or ending.
    const referencedBy = new Map();
    alerts.forEach((alert) =>
      alert.references.forEach((id) => {
        referencedBy.set(id, [...(referencedBy.get(id) ?? []), alert.event]);
      }),
    );
    for (const [id, entry] of [...state.tracked]) {
      if (current.has(id)) {
        continue;
      }
      const replacements = referencedBy.get(id);
      if (replacements?.includes(entry.alert.event)) {
        // Replaced by an update: remembered, so the update reads as the
        // continuation of this episode just below.
        retire(id, entry, false);
        continue;
      }
      if (replacements === undefined) {
        entry.missing += 1;
        entry.missingSince ??= instant;
      }
      const expired = entry.alert.end !== null && Date.parse(entry.alert.end) <= instant;
      const gone =
        entry.missing >= MISSING_CHECKS_TO_END && instant - entry.missingSince >= MISSING_MS_TO_END;
      if (replacements !== undefined || expired || gone) {
        retire(id, entry, true);
        await safePublish(SCENE_TRIGGERS.ALERT_ENDED, buildEndedData(entry.alert, context));
      }
    }

    // Alerts in the list: known, continuing an episode, or new.
    for (const alert of alerts) {
      const entry = state.tracked.get(alert.id);
      if (entry !== undefined) {
        entry.alert = alert;
        entry.missing = 0;
        entry.missingSince = null;
        continue;
      }
      // Known: tracked, or retired without an `alert_ended` (replaced), and
      // of the same event — an upgrade starts a new episode.
      const known = (id) => {
        const retired = state.retired.get(id);
        const event =
          state.tracked.get(id)?.alert.event ?? (retired?.ended ? null : retired?.event);
        return event === alert.event;
      };
      const continuation = known(alert.id) || alert.references.some(known);
      state.tracked.set(alert.id, fresh(alert));
      changed = true;
      if (!continuation) {
        await safePublish(SCENE_TRIGGERS.ALERT_ISSUED, buildIssuedData(alert, context));
      }
    }

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

  return { check, start, stop };
}

export {
  SCENE_TRIGGERS,
  SUMMARIES,
  MISSING_CHECKS_TO_END,
  MISSING_MS_TO_END,
  ENDED_MEMORY_MS,
  alertSummary,
  buildIssuedData,
  buildEndedData,
  createAlertWatcher,
};
