# Architecture

Meu Mangá is a local, single-user manga downloader. The backend is a Go
service following **Clean Architecture**; the frontend is a TanStack Start SPA.

## Layers

Dependencies point inward only. Inner layers never import outer ones.

```
domain      Entities + ports (interfaces). No third-party imports.
usecase     Application logic. Depends only on domain.
adapter     Site adapters (one package per site) + the registry.
infra       IO: browser (rod), cookies (Dia), http client, storage, http API.
cmd/server  Composition root — wires everything and starts the server.
```

- **domain** — `Manga`, `Chapter`, `Page`, `Job`, `Event`, and the ports:
  `Source`, `SessionProvider`, `PageSink`. Pure data + interfaces.
- **usecase** — `Library` (search, chapters), `Downloader` (job queue +
  progress), `Settings`, and the `EventBus`. Orchestrates ports; no site or IO
  detail leaks in.
- **adapter** — each site is a package (e.g. `adapter/sakura`) implementing
  `domain.Source`. The `registry` holds all sources by id and hands them to the
  use cases. Normalization happens here: whatever a site returns is mapped to
  the domain types so every source looks identical upstream.
- **infra** — concrete implementations: `browser` (headless Chromium via rod),
  `cookies` (reads + decrypts the Dia cookie store), `httpclient` (Chrome TLS
  fingerprint), `storage` (writes JPGs), `httpapi` (REST + SSE).

## The Source contract

Every site adapter implements one interface. New sites plug in without touching
`domain` or `usecase`.

```go
type Source interface {
    Info() SourceInfo
    Search(ctx, query string) ([]Manga, error)
    Chapters(ctx, slug string) (ChapterList, error)
    DownloadChapter(ctx, ch Chapter, sink PageSink) error
}
```

`Search` is expected to be cheap (plain HTTP where possible). `Chapters` and
`DownloadChapter` may drive a browser page. `DownloadChapter` streams each page
to `sink` as its bytes arrive, in order — the use case saves + reports progress.

## Registry / normalization

The registry maps `source id → Source`. Use cases look up a source by id and
call it; they only ever see domain types. Adding a site = implement `Source` +
`registry.Register(newAdapter(...))` in `cmd/server`.

## Cloudflare strategy (why a browser)

Sakura sits behind Cloudflare Turnstile. CDP automation (rod/Playwright) is
fingerprinted and loops forever even with a manual solve — the browser binary
does not matter. So we do **not** try to beat the challenge with automation.

Instead we reuse the session from the user's real browser (**Dia**, Chromium
150):

1. The user solves Turnstile once by visiting the site in Dia. This mints
   `cf_clearance` + `PHPSESSID` cookies in Dia's cookie store.
2. `infra/cookies` reads and decrypts them (Chromium v10 / macOS Keychain).
3. **Search** and other static requests use `infra/httpclient` — a Go HTTP
   client with a Chrome TLS fingerprint (`bogdanfinn/tls-client`) carrying the
   cookie + matching User-Agent. This passes Cloudflare directly.
4. **Chapter listing + reader** need anti-scraping tokens the site's JS
   generates. `infra/browser` launches headless Chromium, injects the same
   cookie, and lets the page's own JS run. Image bytes are captured via the
   CDP **Fetch domain at the response stage** (page images become `blob:` URLs,
   so the network body must be intercepted, not re-fetched).

When `cf_clearance` expires, the user revisits the site in Dia to refresh; the
backend re-reads it. See [sites/sakura.md](sites/sakura.md) for the full map.

## HTTP + SSE API (`:8080`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | `{status, session:{valid, source, detail}}` |
| GET | `/api/sources` | `[{id, name}]` |
| GET | `/api/search?source=&q=` | `[{source, mangaId, slug, title, thumbUrl, rating, status, demographic, year, url}]` |
| GET | `/api/manga/{source}/{slug}/chapters` | `{manga, chapters:[{id, number, title, url, date}]}` |
| POST | `/api/downloads` | body `{source, slug, title, chapters[]}` → `{jobId}` |
| GET | `/api/downloads` | job summaries |
| DELETE | `/api/downloads` | clear all finished jobs from history → `{removed}` |
| GET | `/api/downloads/{jobId}` | job detail (per-chapter status) |
| DELETE | `/api/downloads/{jobId}` | cancel a running job |
| POST | `/api/downloads/{jobId}/retry` | re-enqueue only the not-completed chapters → `{jobId}` |
| POST | `/api/downloads/{jobId}/remove` | drop a job from history (files on disk are kept) |
| POST | `/api/preview` | body `{source, chapter, count}` → `{images:[data:image/jpeg;base64,...]}` — first N pages as JPEG thumbnails |
| GET | `/api/events` | SSE stream of `{type, jobId, chapterNumber, page, totalPages, message, status}` |

`type` ∈ `progress` | `chapter_done` | `job_done` | `error`.

`/api/health` also returns a `block` object (or `null`): the active temporary
rate-limit block (`{active, until, rawTime, message}`), distinct from the
Cloudflare session.

## Persistence & rate-limit block

Two concerns survive a restart, both in a local SQLite DB
(`~/.meumanga/meumanga.db`, `infra/jobstore`):

- **History** — every `Job` (per-chapter status + volume covers) is saved on each
  state change. On boot the `Downloader` reloads it; jobs left "running" are
  downgraded to failed so the UI can offer **redo the missing chapters** (`Retry`
  rebuilds a request from the not-completed tasks only). Removing a job deletes
  the history row; the downloaded JPEGs on disk are untouched. Finished jobs can
  be wiped in bulk (`ClearHistory`), and jobs older than
  `MM_HISTORY_RETENTION_DAYS` (default 30, 0 = keep forever) are pruned on boot.
- **Block window** — a shared `domain.RateGate` holds the site's temporary block
  (see [sites/sakura.md](sites/sakura.md)). It's tripped by a `BlockedError`
  surfaced from `browser.Goto`, persisted, and consulted by `Library.Chapters`,
  `Previewer.Preview` and `Downloader.Enqueue`/`run` to short-circuit new work
  until the release time — the HTTP layer maps it to `503`.

A jittered `ChapterDelay` between chapters (`MM_CHAPTER_DELAY_MS`) paces
downloads to reduce how often the block triggers.

## Frontend

TanStack Start (React 19). Routes: search (`/`), obra detail
(`/obra/$source/$slug`), downloads (`/downloads`). It talks to the backend
through a Vite dev proxy (`/api`, `/events` → `:8080`), consumes the SSE stream
for live progress, and shows a session badge driven by `/api/health`. Open the
app in Dia so Cloudflare-protected thumbnails render.

## Data flow (download)

```
UI → POST /api/downloads → Downloader enqueues Job
Downloader → Source.DownloadChapter → browser page → capture image bytes
          → PageSink → storage writes NNN.jpg  → EventBus → SSE → UI progress
```
