import type { Release } from '../../shared/schema.ts';

// The part of a month's catalogue that is kept in Git as history: what each airline listed and
// when, and which film each listing is (the local film ID, the match result and the film's
// Wikidata item, which is CC0). TMDb details, poster paths and scores are left out; they live
// only in the replaceable published snapshot (see DESIGN, "历史与当前快照").
export interface MonthHistory {
  month: string;
  issue: string;
  airlines: Release['airlines'];
  collections: Release['collections'];
  films: { id: string; match: Release['films'][number]['match']; wikidataId?: string }[];
  listings: Release['listings'];
}

export function historyOf(release: Release, month: string): MonthHistory {
  return {
    month,
    issue: release.issue,
    airlines: release.airlines,
    collections: release.collections,
    films: release.films.map((film) => ({ id: film.id, match: film.match, wikidataId: film.externalIds.wikidataId })),
    listings: release.listings,
  };
}
