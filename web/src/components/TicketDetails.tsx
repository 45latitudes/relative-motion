import { useEffect, useRef, useState, type ReactNode } from 'react';
import { minimumTmdbVotes, scoreSources } from '../catalog/controller.ts';
import { languageLabel, type FilmView } from '../catalog/view.ts';
import { formatDate } from '../format.ts';
import { FilmLinks } from './FilmLinks.tsx';

const overviewSource = (language: string) => (language === 'en' ? 'TMDb 英文简介' : 'TMDb 中文简介');
const scoreOrder = (source: string) => {
  const index = (scoreSources as readonly string[]).indexOf(source);
  return index === -1 ? scoreSources.length : index;
};

// A column that scrolls on its own; while more text lies below, its last line fades out.
function Scroller({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setMore(element.scrollHeight - element.scrollTop - element.clientHeight > 2);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);
  return <div ref={ref} className={`${className}${more ? ' has-more' : ''}`}>{children}</div>;
}

// The overview opens as a single line and can be expanded and folded again.
function Overview({ text, language }: { text: string; language: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`details-overview${open ? ' is-open' : ''}`}>
      <p lang={language}>{text}</p>
      <button type="button" className="text-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起简介' : '展开简介'}
      </button>
      <span className="credit">{overviewSource(language)}</span>
    </div>
  );
}

// Wikidata awards: a count that opens into one line per award, wins before nominations.
function Awards({ awards }: { awards: NonNullable<FilmView['awards']> }) {
  if (awards.wins + awards.nominations === 0) return null;
  const items = awards.items ?? [];
  // Without a list at all, none of the names could be read.
  const unnamed = items.length ? awards.unnamed ?? 0 : awards.wins + awards.nominations;
  const summary = [awards.wins ? `获奖 ${awards.wins} 项` : '', awards.nominations ? `提名 ${awards.nominations} 项` : ''].filter(Boolean).join(' · ');
  return (
    <details className="awards">
      <summary>{summary}</summary>
      <ul>
        {items.map((entry, index) => (
          <li key={index} className={`award is-${entry.kind}`}>
            <span className="award-year">{entry.year ?? '—'}</span>
            <span className="award-kind">{entry.kind === 'win' ? '获奖' : '提名'}</span>
            <span className="award-name">
              {entry.award}
              {entry.recipients && <span className="award-who">{entry.recipients.join('、')}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="credit">
        {unnamed > 0 && `另有 ${unnamed} 项未能读取名称。`}来自 Wikidata，{formatDate(awards.fetchedAt)}读取
      </p>
    </details>
  );
}

// The film's particulars, written onto the left half of the ticket once its stub is chosen:
// the film on the left like a passenger and route, scores and carriers in a narrow column.
// The poster is printed on the stub.
export function TicketDetails({ film }: { film: FilmView }) {
  const fields: [string, string, string | undefined][] = [
    ['导演', 'Director', film.directors.join('、') || undefined],
    ['年份', 'Year', film.year ? String(film.year) : undefined],
    ['片长', 'Runtime', film.runtime ? `${film.runtime} 分钟` : undefined],
    ['语言', 'Language', languageLabel(film.language)],
  ];
  const ratings = [...film.ratings].sort((a, b) => scoreOrder(a.source) - scoreOrder(b.source));
  return (
    <div className="details">
      <Scroller className="details-main">
        <h2 className="details-title">{film.title}</h2>
        {film.alternateTitles.map((alt) => (
          <p key={alt.text} className={`details-alt${alt.latin ? ' latin' : ''}`}>{alt.text}</p>
        ))}
        {film.differences.map((text) => <p key={text} className="details-note">≈ {text}</p>)}
        {!film.confirmed && (
          <p className="details-note">还没能确认是哪一部电影（{film.unconfirmedReason}），这里只列出航司片单里的信息。</p>
        )}
        <dl className="fields">
          {fields.map(([label, latin, value]) => (
            <div key={label}>
              <dt>{label}<span lang="en">{latin}</span></dt>
              <dd>{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
        {(film.genres.length > 0 || film.cast.length > 0) && (
          <p className="details-line">{[film.genres.join('／'), film.cast.length ? `主演 ${film.cast.join('、')}` : ''].filter(Boolean).join('　·　')}</p>
        )}
        {film.awards && <Awards awards={film.awards} />}
        {film.overview && <Overview text={film.overview.text} language={film.overview.language} />}
      </Scroller>
      <Scroller className="details-side">
        {ratings.length > 0 && (
          <dl className="scores">
            {ratings.map((rating) => (
              <div key={rating.source}>
                <dt>{rating.label}</dt>
                <dd>
                  {rating.display}
                  {!rating.display.endsWith('%') && <span className="scale">/{rating.scale.max}</span>}
                  {rating.votes !== undefined && (
                    <small>{rating.source === 'tmdb' && rating.votes < minimumTmdbVotes ? `仅 ${rating.votes} 票` : `${rating.votes} 票`}</small>
                  )}
                  <span className="score-date">
                    {rating.ratedOn ? `评分日期 ${formatDate(rating.ratedOn)}` : `评分日期未知，${formatDate(rating.fetchedOn)}读取`}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <ul className="carriers">
          {film.airlines.map((entry) => (
            <li key={entry.code}>
              <span className="code">{entry.code}</span>{entry.name}
              <span className="carrier-note">
                片单名「{entry.rawTitle}」 · {formatDate(entry.observedAt)}观测
                {entry.audioLanguages && entry.audioLanguages.length > 0 && ` · 音轨 ${entry.audioLanguages.join(' / ')}`}
              </span>
            </li>
          ))}
        </ul>
        <FilmLinks film={film} />
      </Scroller>
    </div>
  );
}
