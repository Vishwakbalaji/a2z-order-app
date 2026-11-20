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

## When the owner uploads a CATALOG (or an updated PRICE SHEET) in chat
Goal: products should appear under the catalog's names/departments/categories, priced from the price sheet.

1. Read the PDF: `node scripts/dump-items.mjs <file.pdf>` (positioned text) and render pages to PNG
   (`pdftoppm -r 110 -png`) and LOOK at them — text layers can misplace rows/prices.
2. Produce the rows two independent ways when possible (in-app parser `src/lib/pdf/catalogParser.ts`
   or `priceSheetParser.ts`, and a careful transcription from the page images) and reconcile every
   difference against the image. If the generic parser handles the layout badly, improve it and add
   a test with the PDF in `tests/fixtures/` (see `tests/priceSheetParser.test.ts`).
3. Save the data in `src/data/` (e.g. `a2zCatalog.ts`, rows of `CatalogRowInput`: department, category,
   brand, name, variation "500ML / 24CT", unitsPerCase, sku, raw = original text).
4. Run matching against the current price sheet (`matchProduct` in `src/lib/matching.ts`) in a throwaway
   vitest script and review every result. For links you have verified by reading both documents
   (same brand, size, case count, packaging), add `BundledMapping`s. Leave genuinely ambiguous ones out
   (they show as "Needs review" in the app) and list them for the owner.
5. Ship it by appending a new entry to `BUNDLED_DATASETS` in `src/data/bundled.ts` with
   `version = previous + 1` (kind 'catalog' or 'pricesheet'). Never edit/remove published entries.
   On his phone the app applies it on next start: names/prices update, carts move to catalog names
   where unambiguous, nothing is deleted.
6. `npm test`, `npm run build`, `npx playwright test --trace off` (e2e), then commit and push to `main`.
   Check the Actions run succeeded, open the live URL to confirm, and report: products added, matched,
   needing review, unmatched (with names), and anything you were unsure about.

## Useful commands
- `npm test` — unit tests (parser vs real PDF, matching, totals, backups, bundled updates)
- `npm run e2e` — Playwright, mobile Chrome, against a production build
- Live URL: https://vishwakbalaji.github.io/a2z-order-app/
