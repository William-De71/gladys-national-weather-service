// -----------------------------------------------------------------------------
// The languages of the integration.
//
// Gladys runs in English, French, German or Spanish: every text this
// integration writes exists in the four (test/i18n.test.js), any other
// language falls back to English. The NWS writes in English only: its own
// texts (event names, narratives, alert bodies) stay as they are.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * @description A label inside a sentence: lower-cased, except in German, where
 * nouns keep their capital ("Regen", not "regen").
 * @param {string} label - The label ("Rain", "Regen").
 * @param {string} language - The language.
 * @returns {string} The label to put in a sentence.
 * @example
 * inSentence('Heavy rain', 'en'); // -> 'heavy rain'
 */
function inSentence(label, language) {
  return language === 'de' ? label : label.toLowerCase();
}

/**
 * @description A percentage: "40%" in English, "40 %" in the other languages.
 * @param {number} value - The value.
 * @param {string} language - The language.
 * @returns {string} The percentage.
 * @example
 * formatPercent(40, 'fr'); // -> '40 %'
 */
function formatPercent(value, language) {
  return language === 'en' || !LANGUAGES.includes(language) ? `${value}%` : `${value} %`;
}

export { LANGUAGES, inSentence, formatPercent };
