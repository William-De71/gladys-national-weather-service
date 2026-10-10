// -----------------------------------------------------------------------------
// Houses of the Gladys instance, for the alert watcher, the scene actions and
// the widgets.
//
// The weather path never needs them: the core passes the coordinates of the
// house in every onWeatherGet call. But the alert watcher must check the
// official alerts on its own (the scene triggers fire without anyone asking),
// and the scene actions and widgets name a house. Hence `location: true` in
// the manifest and `getHouses()` here.
//
// There is no update event for the houses: they are re-read on every
// connection and on each round of the alert watcher (a local call).
//
// A house is named exactly as in Gladys, everywhere: the core matches the
// "House" filter of the triggers against the house name, character for
// character. Accepting a different case or the selector in the actions and
// widgets would let the user write a name that works there and silently
// never matches in a trigger; an action naming an unknown house fails with
// the list of the names to use instead.
// -----------------------------------------------------------------------------

/**
 * @description Create the house registry.
 * @param {object} options - Options.
 * @param {Function} options.fetchHouses - `() => Promise<Array<object>>`, the
 * SDK getHouses().
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @returns {object} The registry ({ refresh, list, resolve }).
 * @example
 * const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses() });
 */
function createHouseRegistry({ fetchHouses, logger = console }) {
  // Located houses only: an unlocated house has no weather.
  let located = [];

  /**
   * @description Re-read the houses from Gladys. A failure keeps the previous
   * list: a transient error must not blind the triggers.
   * @returns {Promise<Array<object>>} The located houses.
   * @example
   * await houses.refresh();
   */
  async function refresh() {
    try {
      const houses = await fetchHouses();
      located = (Array.isArray(houses) ? houses : []).filter(
        (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
      );
    } catch (err) {
      logger.warn(`Unable to read the houses of Gladys: ${err.message}`);
    }
    return located;
  }

  /**
   * @description The located houses, as last read.
   * @returns {Array<object>} `[{ id, name, selector, latitude, longitude }]`.
   * @example
   * houses.list();
   */
  function list() {
    return located;
  }

  /**
   * @description Find the house a scene action targets. An empty value means
   * "the house", i.e. the first located one — the common single-house case.
   * Otherwise the name is matched exactly (surrounding spaces ignored), as
   * the core matches the trigger filter.
   * @param {string|null|undefined} wanted - The house name.
   * @returns {object} The house.
   * @throws {Error} When no house is located or none matches.
   * @example
   * houses.resolve('Maison');
   */
  function resolve(wanted) {
    if (located.length === 0) {
      throw new Error('No house of Gladys has a location: set it in the house settings');
    }
    if (wanted === null || wanted === undefined || String(wanted).trim() === '') {
      return located[0];
    }
    const target = String(wanted).trim();
    const house = located.find((candidate) => candidate.name === target);
    if (house === undefined) {
      const names = located.map((candidate) => `"${candidate.name}"`).join(', ');
      throw new Error(`No located house named "${target}" (names are case-sensitive): ${names}`);
    }
    return house;
  }

  return { refresh, list, resolve };
}

export { createHouseRegistry };
