# A2Z Order Pad — instructions for Claude

Mobile ordering PWA for a sales rep (Vishwak) taking store orders for A2Z Beverage Distributors.
React + TypeScript + Vite + Tailwind, IndexedDB (Dexie), jsPDF. No backend.
Live on GitHub Pages; every push to `main` runs `.github/workflows/deploy.yml` (tests → build → deploy).

## Hard rules (from the owner)
- Never invent products, sizes or prices. Every value must come from a document he supplied.
- Never auto-assign an uncertain price. Ambiguous matches stay "Needs review".
- Never delete or overwrite user data (stores, carts, orders, his own matching decisions).
- Completed orders are immutable snapshots.
- The distributor PDF ("Order PDF") must never contain prices.
- "NEW STORE — FIRST ORDER" only on a new store's first FINALIZED order (stored in the order
  snapshot + Store.firstOrderId, set inside the finalize transaction). Never on existing stores.
- Weekly reports (Sat–Fri, America/New_York, week 1 = 2026-11-21): finalized reports are immutable
  snapshots with unique ids (WR-YYYY-MM-DD, revisions -R1…); corrections = new revision, never edits.
- Commission = 1% of confirmed sales (orders with missing prices / voided orders excluded).

## When the owner uploads a CATALOG (or an updated PRICE SHEET) in chat
Goal: products should appear under the catalog's names/departments/categories, priced from the price sheet.

1. Read the PDF: `node scripts/dump-items.mjs <file.pdf>` (positioned text) and render pages to PNG
   (`pdftoppm -r 110 -png`) and LOOK at them — text layers can misplace rows/prices.
   For the A2Z catalog layout (Description | Group, two columns) use
   `OUT=/tmp/x.json npx vitest run tests/tool-catalog-extract.test.ts` and cross-check with
   `pdftotext -bbox-layout` (that is how the 11.20.26 catalog was verified: 546 rows, identical).
2. Produce the rows two independent ways when possible (in-app parser `src/lib/pdf/catalogParser.ts`
   or `priceSheetParser.ts`, and a careful transcription from the page images) and reconcile every
   difference against the image. If the generic parser handles the layout badly, improve it and add
   a test with the PDF in `tests/fixtures/` (see `tests/priceSheetParser.test.ts`).
3. Save the data in `src/data/` (e.g. `a2zCatalog.ts`, rows of `CatalogRowInput`: department, category,
   brand, name, variation "500ML / 24CT", unitsPerCase, sku, raw = original text).
4. Run matching against the current price sheet: `OUT=/tmp/r.txt npx vitest run tests/tool-match-report.test.ts`
   (edit it to use the new rows) and review EVERY automatic match. For links you have verified by reading both documents
   (same brand, size, case count, packaging), add `BundledMapping`s. Leave genuinely ambiguous ones out
   (they show as "Needs review" in the app) and list them for the owner.
5. Ship it by appending a new entry to `BUNDLED_DATASETS` in `src/data/bundled.ts` with
   `version = previous + 1` (kind 'catalog' or 'pricesheet'). Never edit/remove published entries.
   On his phone the app applies it on next start: names/prices update, carts move to catalog names
   where unambiguous, nothing is deleted.
6. `npm test`, `npm run build`, `npx playwright test --trace off` (e2e), then commit and push to `main`.
   Check the Actions run succeeded, open the live URL to confirm, and report: products added, matched,
   needing review, unmatched (with names), and anything you were unsure about.

## Current data (bundled datasets in src/data/bundled.ts)
- v1 price sheet `A2Z_Beverages_Price_Deals_A4_2.pdf` (131 lines)
- v2 catalog `A2Z_Beverages_Product_List_11.20.26_.pdf` (543 printed rows → 542 products; 334 auto-priced,
  139 review, 69 not on the price sheet)
- v3 settings: rep phone +1 561-552-6556 (fills an empty field only)
Next free version: 4.

## Cloud sync (Cloudflare Worker + D1) — `worker/`
- `worker/src/index.ts`: /status, /claim (first phone sets the key hash), /sync (push outbox + pull by seq),
  /rotate, /run-reports; cron "2 4,5 * * 6" + daily catch-up finalizes weekly reports (same
  `buildReportRecord` as the phone). Merge rules: `src/sync/protocol.ts` (`mergeRecord`).
- Phone: `src/sync/client.ts`; outbox written atomically by Dexie middleware in `src/db/db.ts`.
  Records from documents use `stableId` so every phone creates the same ids.
- Deploy: `cd worker && npx wrangler d1 migrations apply a2z-order-sync --remote && npx wrangler deploy`
  (token = network secret for api.cloudflare.com; set CLOUDFLARE_API_TOKEN=proxy-injected).
  The Worker URL goes in `src/config.ts` (SYNC_URL). Tests: `e2e/sync.spec.ts` runs a local Worker.

## Useful commands
- `npm test` — unit tests (parser vs real PDF, matching, totals, backups, bundled updates)
- `npm run e2e` — Playwright, mobile Chrome, against a production build
- Live URL: https://vishwakbalaji.github.io/a2z-order-app/
