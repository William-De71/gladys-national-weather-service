/**
 * @description Build an alert feature.
 * @param {object} properties - Properties overriding the defaults.
 * @returns {object} The feature.
 * @example
 * feature({ event: 'Tornado Warning' });
 */
export function feature(properties) {
  return {
    properties: {
      id: 'urn:oid:1',
      event: 'Tornado Warning',
      status: 'Actual',
      messageType: 'Alert',
      severity: 'Extreme',
      urgency: 'Immediate',
      certainty: 'Observed',
      references: [],
      onset: '2026-10-09T18:00:00-05:00',
      expires: '2026-10-09T18:45:00-05:00',
      ends: null,
      headline: 'Tornado Warning issued October 9',
      description: 'A tornado was observed.',
      instruction: 'TAKE COVER NOW!',
      areaDesc: 'Washington, KS',
      ...properties,
    },
  };
}
