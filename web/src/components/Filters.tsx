import type { Release } from '../../../shared/schema.ts';
import { sortOptions, type useCatalogController } from '../catalog/controller.ts';

// Pieces shared by the wide board and the phone layout, so their wording and behaviour stay
// the same: the filter chips, the attribution and the notice about partial collections.
type Controller = ReturnType<typeof useCatalogController>;

// Choosing an airline or an order also lays the stubs out tidily (`onChoose`).
export function AirlineChips({ catalog, onChoose }: { catalog: Controller; onChoose: () => void }) {
  return catalog.airlines.map((airline) => (
    <button
      key={airline.code}
      type="button"
      className="chip"
      aria-pressed={catalog.state.airlines.includes(airline.code)}
      title={`${airline.name}，${airline.count} 部`}
      onClick={() => { catalog.toggleAirline(airline.code); onChoose(); }}
    >
      {airline.code}<small>{airline.count}</small>
    </button>
  ));
}

export function SortChips({ catalog, onChoose }: { catalog: Controller; onChoose: () => void }) {
  return sortOptions.map((option) => (
    <button
      key={option.key}
      type="button"
      className="chip"
      aria-pressed={catalog.state.sort === option.key}
      onClick={() => { catalog.setSort(option.key); onChoose(); }}
    >
      {option.label}
    </button>
  ));
}

export const isPartial = (release: Release) => release.collections.some((collection) => collection.status !== 'success');
export const partialNotice = '部分片单还在匹配资料，尚未确认的影片会陆续补上。';

export function Credits() {
  return (
    <p>非盈利开源项目，与各航司及评分网站均无隶属关系；航司收录不代表每条航线都能观看。
      资料、海报与 TMDb 评分来自 <a href="https://www.themoviedb.org/">TMDb</a>，外部编号与历史分数来自 <a href="https://www.wikidata.org/">Wikidata</a>（CC0）。
      {' '}<a href="mailto:relativemotion@icloud.com">relativemotion@icloud.com</a>
      <span lang="en">This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
    </p>
  );
}
