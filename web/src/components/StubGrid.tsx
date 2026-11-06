import type { SortKey } from '../catalog/controller.ts';
import type { FilmView } from '../catalog/view.ts';
import { StubFace } from './Stub.tsx';

// The tidy layout: every stub once, flat, in sort order, scrolled by hand. The bottom padding
// lets the last row rise clear of the cloud.
interface Props {
  films: FilmView[];
  sort: SortKey;
  openKey?: string;
  onPick: (film: FilmView, key: string, element: HTMLElement) => void;
}

export function StubGrid({ films, sort, openKey, onPick }: Props) {
  return (
    <div className={`stub-grid${openKey ? ' is-paused' : ''}`}>
      {films.map((film) => {
        const key = `${film.id}|grid`;
        return (
          <button
            key={key}
            type="button"
            className={`stub${key === openKey ? ' is-out' : ''}`}
            aria-label={`${film.title}，查看详情`}
            onClick={(event) => onPick(film, key, event.currentTarget)}
          >
            <StubFace film={film} sort={sort} />
          </button>
        );
      })}
    </div>
  );
}
