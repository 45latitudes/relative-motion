# 相对运动 Relative Motion

坐飞机有时有一种额外的乐趣：在面前那块小屏幕里，发现若干从没听说过的好电影。然而为了遇见它们，先把自己运到一万米的高处，想来有些周折。

【相对运动】收集各家航司的片单，配上你熟悉的评分与影评，把“坐飞机才偶遇”的体验带到日常生活中，相对于掠过云端的椅背屏幕，在地面完成一次次光影间的飞行。

**Site:** https://45latitudes.github.io/relative-motion/

> This README was generated automatically by Claude.

## What it is

Relative Motion is a non-profit, open-source static site. It shows this month's in-flight film catalogues from several airlines — currently United Airlines (UA), China Airlines (CI) and Air China (CA) — with film details from TMDb and scores from Rotten Tomatoes, Metacritic (both as recorded on Wikidata) and TMDb. It is meant for browsing and chance discovery, not as a film database or a recommender.

The project is not affiliated with any airline or rating site. An airline listing a film does not mean it is shown on every route.

## How the data is made

The maintainer runs the pipeline locally, once per catalogue period:

1. **Collect** each airline's public catalogue page (at most once every 14 days per airline, at least 2 seconds between requests to a domain; collection stops on a captcha or firewall).
2. **Match** each airline entry to a film on TMDb and Wikidata. A film is confirmed only on independent evidence — for example a matching director, or matching titles plus runtime — and entries that cannot be confirmed are shown as the airline printed them, without borrowed details or scores.
3. **Read award names** from Wikidata for the award and nomination statements of matched films.
4. **Export** the month. The full catalogue for the site (with TMDb details) goes to `web/public/data/<month>.json`, with `latest.json` naming the current month; it is not committed, but uploaded to the replaceable `catalog-snapshot` release, from which the site is built and where old months can be deleted. The month's history — what each airline listed, and which film each listing is — goes to `data/history/<month>.json` and is committed, so past months accumulate.

Raw responses, caches and per-airline working copies stay in the maintainer's `local/` folder and are never committed.

Posters are not stored. The catalogue keeps only each film's TMDb poster path, and the browser loads the image from TMDb's image server when the film is opened.

## Running it

Requires Node 26 and pnpm (see `.nvmrc` and `packageManager` in `package.json`).

```sh
pnpm install
pnpm test          # strict type checks and Vitest (synthetic fixtures only, no network)
pnpm -C web dev    # local preview (needs an exported catalogue in web/public/data)
pnpm -C web build
```

Maintainer pipeline (needs a TMDb credential in `.env` as `TMDB_READ_ACCESS_TOKEN` or `TMDB_API_KEY`):

```sh
pnpm collect                          # airline catalogues; skips airlines collected in the last 14 days
pnpm match                            # match and enrich; resumable, `-- --offline` reads only the cache
pnpm award-labels                     # award and recipient names from Wikidata
pnpm export:catalog -- --month 2026-11  # write the month's release; `--airlines UA,CI` to include only some
```

Then publish the month:

```sh
gh release upload catalog-snapshot web/public/data/latest.json web/public/data/2026-11.json --clobber
git add data/history && git commit -m "data: 2026-11 catalogue" && git push
gh workflow run pages.yml   # if nothing was pushed
```

Every push to `main` runs the tests and publishes the site to GitHub Pages (`.github/workflows/pages.yml`), using the snapshot from the release.

## Layout

- `pipeline/` — collection, matching, enrichment and export.
- `shared/` — the catalogue schema (Zod), shared by the pipeline and the site.
- `web/` — the site (React and Vite).
- `fixtures/` — synthetic test data.
- `data/history/` — each month's airline listings and the film each one is. Stable film IDs are reused across months from a registry the maintainer keeps.

## Sources and licences

- Code: MIT, see `LICENSE`.
- Film details, posters and TMDb scores come from [TMDb](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
- External IDs, awards and the Rotten Tomatoes and Metacritic scores come from [Wikidata](https://www.wikidata.org/) (CC0).
- Airline catalogue listings belong to their airlines.

Contact, corrections and removal requests: relativemotion@icloud.com
