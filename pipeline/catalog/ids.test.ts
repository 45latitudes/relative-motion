import { expect, test } from 'vitest';
import { assignFilmId, emptyRegistry } from './ids.ts';

test('keeps a film ID across reruns and links a later TMDb confirmation to it', () => {
  const registry = emptyRegistry();
  const first = assignFilmId(registry, ['UA:1']);
  expect(assignFilmId(registry, ['UA:1'])).toBe(first);
  expect(assignFilmId(registry, ['tmdb:7', 'UA:1'])).toBe(first);
  expect(assignFilmId(registry, ['tmdb:7', 'CI:recA'])).toBe(first);
  expect(assignFilmId(registry, ['CA:image-2'])).not.toBe(first);
});

test('keeps the earliest ID and warns when keys point at different films', () => {
  const registry = emptyRegistry();
  const a = assignFilmId(registry, ['UA:1']);
  assignFilmId(registry, ['CI:recB']);
  const warnings: string[] = [];
  expect(assignFilmId(registry, ['UA:1', 'CI:recB'], warnings)).toBe(a);
  expect(warnings).toHaveLength(1);
  expect(assignFilmId(registry, ['CI:recB'], warnings)).toBe(a);
  expect(warnings).toHaveLength(1);
});
