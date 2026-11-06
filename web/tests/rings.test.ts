import { expect, test } from 'vitest';
import { geometry } from '../src/components/StubRings.tsx';

// The lowest ring's foot, measured from the top of the wall.
const foot = (g: ReturnType<typeof geometry>) => 12 + g.rows * g.stubH + (g.rows - 1) * (g.pitch - g.stubH);

test('fits four rings in a tall wall and three in a short one, never past the cloud', () => {
  const tall = geometry(402, 668, 874);
  expect(tall.rows).toBe(4);
  const short = geometry(390, 400, 640);
  expect(short.rows).toBe(3);
  for (const [g, viewport] of [[tall, 874], [short, 640], [geometry(375, 280, 520), 520]] as const) {
    expect(foot(g)).toBeLessThanOrEqual(g.height - viewport * 0.11 + g.stubH * 0.12 + 0.5);
  }
});

test('keeps ring stubs the size of the tidy columns when they fit', () => {
  expect(geometry(390, 400, 640).stubW).toBeLessThanOrEqual((390 - 44) / 2);
  expect(geometry(402, 668, 874).stubW).toBeCloseTo((402 - 44) / 2);
});
