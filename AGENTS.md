# ReadHD

Chrome/Edge MV3 extension that restyles Chinese text on web pages (alternating
word colors via the CSS Custom Highlight API + adjustable typography) to help
school-age children with reading difficulties.

## Commands

- Dev: `pnpm dev` (loads a dev browser via WXT; needs `MINIMAX_API_KEY` in env for the dev key fallback)
- Build: `pnpm build` → `.output/chrome-mv3/`
- Unit tests: `pnpm test` (Vitest + `wxt/testing` fake browser)
- Typecheck: `pnpm wxt prepare && pnpm compile` (`tsc --noEmit`)
- E2E smoke: `node scripts/e2e.mjs` (Playwright, needs a local Chromium/Chrome)

## Layout

- `src/entrypoints/content.ts` — collection/lazy processing/highlight rendering
- `src/entrypoints/background.ts` — cloud analysis batching worker (word/POS/chunk)
- `src/entrypoints/popup|options/` — React UI pages
- `src/lib/` — pure modules (settings, segment-align, analysis, marks,
  paragraphs, highlight, analyzer)
- `tests/` — unit tests

## Notes

- Cloud endpoint: `${apiBase}/v1/messages` (Anthropic-compatible), auth via
  `x-api-key`. Default apiBase `https://api.minimax.cn/anthropic`. The model
  returns per-paragraph chunk arrays of `[word, pos]` pairs
  (`ANALYZE_SYSTEM_PROMPT` in `src/lib/analyze-prompt.ts`).
- `process.env.MINIMAX_API_KEY` is inlined only in development builds; always
  empty in production.
