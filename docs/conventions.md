# Conventions

## Language

- **Code, identifiers, docs, commits: English.**
- **Comments: pt-BR**, short, and only when they add information the code does
  not. No comment that just restates the next line. Prefer a good name over a
  comment.
- User-facing UI strings are pt-BR (this is a personal tool for a pt-BR user).

## Markdown

- Every `.md` file ≤ **400 lines**. Split a growing doc rather than let it sprawl.

## Go (backend)

- Idiomatic Go. `gofmt` clean (`make fmt`). Package names short and lowercase.
- Clean Architecture boundaries are load-bearing:
  - `domain` imports nothing but the stdlib.
  - `usecase` imports only `domain`.
  - `adapter` / `infra` implement domain ports; site detail stays in the adapter.
- Constructors return concrete types or interfaces named `New...`. Wire
  everything in `cmd/server` (composition root), not in package `init`.
- Errors: wrap with context (`fmt.Errorf("...: %w", err)`); sentinel errors in
  `domain/errors.go`. Never panic in library code; the composition root may
  `log.Fatal` on unrecoverable startup errors.
- Context: every IO-bound method takes `ctx context.Context` first and honors
  cancellation (download jobs must stop when canceled).
- Concurrency: guard shared state (the job store, the event bus) with a mutex or
  channels. No data races (`go test -race`).

## TypeScript / React (frontend)

- TanStack Start file-based routes under `src/routes`. Shared UI in
  `src/components`, API access in `src/api`, hooks in `src/hooks`.
- Prefer function components + hooks. No `any` where a real type fits.
- Data fetching is client-side via the typed `api` client; SSE via
  `useDownloadEvents`. Keep the API types (`src/api/client.ts`) in sync with the
  backend contract in [architecture.md](architecture.md).
- Tailwind for styling; keep class lists readable. Prettier clean (`make fmt`).

## Testing

- Minimum **90%** coverage, enforced by `make test`. See [testing.md](testing.md).
- Table-driven tests in Go. Mock ports (browser, cookies, http) — never hit the
  live site in unit tests.

## Adding a site

Follow the `add-site` skill: recon → adapter package → register in `cmd/server`
→ tests ≥90% → `docs/sites/<name>.md`. Never leak the new site's quirks outside
its adapter package.
