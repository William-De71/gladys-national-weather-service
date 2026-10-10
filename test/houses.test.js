import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHouseRegistry } from '../src/houses.js';

const silent = { debug() {}, info() {}, warn() {} };
const HOUSES = [
  { id: 'h1', name: 'Maison', selector: 'maison', latitude: 39.7, longitude: -97.1 },
  { id: 'h2', name: 'Chalet', selector: 'chalet', latitude: 40.1, longitude: -105.2 },
  { id: 'h3', name: 'Garage', selector: 'garage', latitude: null, longitude: null },
];

test('keeps the located houses and the last list on a failure', async () => {
  let fail = false;
  const houses = createHouseRegistry({
    fetchHouses: async () => {
      if (fail) throw new Error('down');
      return HOUSES;
    },
    logger: silent,
  });
  assert.deepEqual(
    (await houses.refresh()).map((house) => house.id),
    ['h1', 'h2'],
  );
  fail = true;
  assert.equal((await houses.refresh()).length, 2);
});

test('resolves a house by its exact name, like the trigger filter', async () => {
  const houses = createHouseRegistry({ fetchHouses: async () => HOUSES, logger: silent });
  assert.throws(() => houses.resolve('Maison'), /No house of Gladys has a location/);
  await houses.refresh();
  assert.equal(houses.resolve('').id, 'h1');
  assert.equal(houses.resolve(null).id, 'h1');
  assert.equal(houses.resolve(' Chalet ').id, 'h2');
  assert.throws(() => houses.resolve('chalet'), /"Maison", "Chalet"/);
  assert.throws(() => houses.resolve('Garage'), /No located house named "Garage"/);
});
