import { expect, test } from 'vitest';
import { titleVariants } from './samples.ts';

test('splits airline title formatting into searchable titles', () => {
  expect(titleVariants('Moana (2026)')).toEqual(['Moana']);
  expect(titleVariants('Wild Heart - Ride to Freedom (Ponyherz)')).toEqual(['Wild Heart - Ride to Freedom', 'Ponyherz']);
  expect(titleVariants('Paper Horizon')).toEqual([]);
  expect(titleVariants('Paper Horizon (2001) (Papierhorizont)')).toEqual(['Paper Horizon (2001)', 'Papierhorizont']);
});
