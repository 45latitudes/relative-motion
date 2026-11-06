// Stable local film IDs. Every key a film is known by (its confirmed TMDb ID and each airline
// record) points at one ID, so IDs survive reruns, new rounds and later confirmations.
export interface FilmIdRegistry {
  next: number;
  keys: Record<string, string>;
}

export const emptyRegistry = (): FilmIdRegistry => ({ next: 1, keys: {} });

export function assignFilmId(registry: FilmIdRegistry, keys: string[], warnings: string[] = []): string {
  const known = [...new Set(keys.map((key) => registry.keys[key]).filter((id): id is string => Boolean(id)))].sort();
  if (known.length > 1) warnings.push(`Keys ${keys.join(', ')} point at several films (${known.join(', ')}); kept ${known[0]}`);
  const id = known[0] ?? `rm-${String(registry.next++).padStart(5, '0')}`;
  // Merged records all point at the kept ID from now on, so the warning does not repeat.
  for (const key of keys) registry.keys[key] = id;
  return id;
}
