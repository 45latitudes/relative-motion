import type { FilmView } from '../catalog/view.ts';
import { PlaneIcon } from './PlaneIcon.tsx';

// Outbound links, each marked with the small printed aircraft; dotted underlines mark searches
// where no confirmed ID exists.
export function FilmLinks({ film }: { film: FilmView }) {
  return (
    <p className="film-links">
      {film.trailerUrl && (
        <a href={film.trailerUrl} target="_blank" rel="noreferrer"><PlaneIcon />预告片</a>
      )}
      {film.links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          data-kind={link.kind}
          title={link.kind === 'search' ? `在 ${link.label} 搜索这部片` : undefined}
        >
          <PlaneIcon />{link.label}
        </a>
      ))}
    </p>
  );
}
