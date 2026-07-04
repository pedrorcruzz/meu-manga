# Testing

## The rule

Minimum **90%** test coverage on the backend, enforced by `make test` (it fails
the build below the threshold). Aim higher on pure logic (`domain`, `usecase`,
parsers, cookie crypto, storage).

```
make test    # go test ./... -coverprofile, then asserts total >= 90%
make cover   # opens the HTML coverage report
```

## Strategy

Unit tests are fast and hermetic — **never hit the live site or a real browser**.
Depend on ports and mock them:

- **`domain.Source`** — fake adapter returning canned `Manga`/`Chapter`/pages, to
  test `usecase` (search, chapters, the download queue, cancellation, events).
- **browser `Page`** — a stub implementing `Goto/Eval/Scroll/CaptureImages` that
  replays recorded DOM/JSON and pushes fixed image bytes, to test the sakura
  adapter's chapter-loading loop and page ordering without Chromium.
- **`SessionProvider` / http fetcher** — return fixed cookies / canned HTTP
  bodies (real captured JSON fixtures) to test parsers and the search path.
- **`storage`** — write to `t.TempDir()` and assert files, names, ordering.

### What to cover hard

- `infra/cookies` — the v10 decrypt (known key/ciphertext vectors), padding,
  domain-hash-prefix stripping, plaintext fallback.
- `adapter/sakura/parse` — search JSON → `Manga`, chapters JSON/DOM → `Chapter`,
  page-index parsing from image URLs, ordering.
- `usecase/download` — queue, per-chapter progress, cancellation, error paths,
  event emission.
- `httpapi` — handlers via `httptest` (routing, status codes, JSON shapes, SSE
  framing).

### Hard to unit-test

`infra/browser` (rod) and `infra/dialog` (native picker) are thin IO shells.
Keep logic out of them (in pure helpers that ARE tested). Cover the rod glue
with a build-tagged integration test (`//go:build integration`) that is excluded
from the coverage gate and run manually against a live session.

## Frontend

`make check` runs `tsc --noEmit`. Component/logic tests can be added with Vitest;
keep the API client types aligned with the backend contract.

## Conventions

- Table-driven tests, `t.Run` subtests, `testdata/` fixtures for captured
  payloads. Run `go test -race` for anything concurrent.
