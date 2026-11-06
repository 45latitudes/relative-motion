import { useLayoutEffect, useRef } from 'react';
import { scoreSources, shownRating, type SortKey } from '../catalog/controller.ts';
import { ratingLabel, type FilmView } from '../catalog/view.ts';
import { Poster } from './Poster.tsx';

// The narrow right-hand part of a torn ticket: one film. Sized in em so the same markup can be
// scaled up when it joins the left half; once joined, the poster is printed over the title.
export function StubFace({ film, sort, joined = false }: { film: FilmView; sort: SortKey; joined?: boolean }) {
  const rating = film.confirmed ? shownRating(film, sort) : undefined;
  // A missing score still names the source being sorted by, so the dash reads as "no score here".
  const label = rating?.label ?? ((scoreSources as readonly string[]).includes(sort) ? ratingLabel(sort) : undefined);
  const alt = film.alternateTitles[0];
  const bodyRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  // On a joined stub the title is never cut: it steps down in size until it fits in full, and
  // fits again whenever the space for it changes (a resized window, a poster that fails to load).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const title = titleRef.current;
    if (!joined || !body || !title) return;
    let size = '';
    const fit = () => {
      size = `${body.clientWidth}x${body.clientHeight}`;
      title.style.fontSize = '';
      const base = Number.parseFloat(getComputedStyle(title).fontSize);
      for (let scale = 1; scale > 0.45 && (body.scrollHeight > body.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1); ) {
        scale *= 0.92;
        title.style.fontSize = `${base * scale}px`;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (`${body.clientWidth}x${body.clientHeight}` !== size) fit(); });
    observer.observe(body);
    return () => observer.disconnect();
  }, [joined, film.id]);
  return (
    <>
      <span className="stub-codes">{film.airlines.map((entry) => entry.code).join(' · ')}</span>
      <span ref={bodyRef} className="stub-body">
        <span ref={titleRef} className="stub-title">{film.title}</span>
        {alt && <span className={`stub-alt${alt.latin ? ' latin' : ''}`}>{alt.text}</span>}
        {joined && film.posterPath && <span className="stub-poster"><Poster path={film.posterPath} title={film.title} /></span>}
      </span>
      <span className="stub-meta">
        {[film.year, film.runtime ? `${film.runtime}′` : undefined].filter(Boolean).join(' · ') || '—'}
      </span>
      <span className={`stub-score${film.confirmed ? '' : ' is-unconfirmed'}`}>
        {film.confirmed ? (rating ? rating.display : '—') : '未确认'}
        {film.confirmed && label && <small>{label}</small>}
      </span>
    </>
  );
}
