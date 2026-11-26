# A2Z Order Pad — instructions for Claude

Mobile ordering PWA for a sales rep (Vishwak) taking store orders for A2Z Beverage Distributors.
React + TypeScript + Vite + Tailwind, IndexedDB (Dexie), jsPDF. No backend.
Live on GitHub Pages; every push to `main` runs `.github/workflows/deploy.yml` (tests → build → deploy).

## Hard rules (from the owner)
- Never invent products, sizes or prices. Every value must come from a document he supplied.
- Never auto-assign an uncertain price. Ambiguous matches stay "Needs review".
- Owner VERIFICATION POLICY (2026-11-21, bundled v5 — replaces the earlier blanket "accept ≥90%" rule v4;
  rule90 mappings are ignored by the matcher). Implemented in `src/lib/matching.ts` (`assessCandidate`):
  brand first (catalog Group) → product type/variation → size → case count. Size: exact, or ≤0.3 oz =
  strong candidate (flagged, max 92); more = review. Case count must be identical (cut-off counts only
  when the visible digits or ALL same-size siblings confirm it). Material differences are never verified:
  alkaline, variety pack, sport cap, still/sparkling, multi-pack vs loose case, a different product line
  ("MINUTE MAID JUICE"), a generic type line that doesn't name the brand, two lines that both fit.
  Confidence: ≥95 with no flags = verified (priced); 75–94 = suggestion (NOT priced, not in totals);
  <75 = unmatched (closest line shown as info). One brand line with no flavor named (e.g. "CELSIUS 12OZ /
  12CT") prices all flavors at that size+count (`brandLevelFlavors`, the owner can be asked to change it).
  Hand decisions (Mapping without source) always win. Owner decision 2026-11-21 (v6): every suggestion
  ABOVE 80% (81–94) accepted as his confirmation (src/data/acceptedMatches.ts ACCEPTED_80, Mapping.source
  'owner80', method 'owner80', counted as "confirmed by you"); 80% and below stay for review. Ask him
  before applying the 80% rule to a future catalog/price sheet.
  A later bundled owner decision (e.g. 'ownerdoc') may replace an earlier bundled one (rule90/owner80),
  never a decision made by hand in the app (Mapping without source). Coverage = (verified + confirmed by owner) ÷ total.
  Audit: `OUT=/tmp/audit npx vitest run tests/tool-audit.test.ts` → /tmp/audit.md (+ .json). Apply the same
  policy to future catalogs/price sheets; report the audit table to the owner.
- Never delete or overwrite user data (stores, carts, orders, his own matching decisions).
- Completed orders are immutable snapshots.
- The distributor PDF ("Order PDF") must never contain prices.
- "NEW STORE — FIRST ORDER" only on a new store's first FINALIZED order (stored in the order
  snapshot + Store.firstOrderId, set inside the finalize transaction). Never on existing stores.
- Weekly reports (Sat–Fri, America/New_York, week 1 = 2026-11-21): finalized reports are immutable
  snapshots with unique ids (WR-YYYY-MM-DD, revisions -R1…); corrections = new revision, never edits.
- Commission = 1% of confirmed sales (orders with missing prices / voided orders excluded).

## Product pictures — REMOVED (owner request 2026-11-22, 3rd)
- The owner asked to remove product images entirely: text-only compact rows (name, size / count, price, − qty +).
  Keep the A2Z logo (header + PDFs). Do not re-add pictures unless he asks. The Dexie table `productImages` is
  dropped (db v5); the Worker still accepts it (LEGACY_SYNCED_TABLES in src/sync/protocol.ts) so old outboxes drain.

## Price statuses (owner request 2026-11-22, bundled v8)
- `priceInfo(p)` in src/lib/products.ts: owner's own price/confirmation (priceOverrideCents) → green Confirmed;
  his price list `p.supplement` (src/data/supplementPrices.ts, from A2Z_Mismatch_With_Prices.pdf: red text =
  confirmed, orange = approximate, grey = not listed, a range = 'select' → "Needs price selection" with options);
  verified price-sheet match → Confirmed; suggestion → Needs review; else gray "Price Not Listed".
- UI: `src/components/PriceLabel.tsx` (color AND words). Settings → Prices to check (`src/screens/admin/PriceStatus.tsx`):
  confirm orange prices, choose between prices, enter missing ones, undo. Never auto-upgrade orange to green.
- Approximate prices ARE in totals, marked: cart note, "≈" line totals, "~" in the detailed PDF, `OrderLine.priceStatus`.
  Unpriced lines are never counted as $0.
- Standardized display names: `src/lib/naming.ts` (`standardName`) from the original catalog line (typos, OZ/ML/L/CT,
  "(2 × 12)" multipacks; 36CT stays 36). The printed catalog text stays the key (mappingKey) and stays searchable.
  Size/count corrections with evidence: `src/data/catalogCorrections.ts` (Red Bull Amber = 8.4 oz, redbull.com).

## Categories & speed (owner request 2026-11-26)
- Products screen: section chips (price-sheet sections) → brand-heading chips (`src/lib/categories.ts`: each catalog
  Group goes under the price-sheet heading most of its products are priced from, e.g. "Coke / Fanta / Sprite & Flavors";
  brands not on the sheet keep their name). List ordered section → heading (price-sheet order). Search works inside the
  chosen category, with "Show N results in all departments" when nothing matches there.
- Speed: price info computed once per data change (`state.priceInfoById`, rows stay memoized); secondary screens are
  React.lazy; bundled documents are loaded only when `settings.bundledVersion < BUNDLED_VERSION`.

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
4. Run the audit against the current price sheet: `OUT=/tmp/audit npx vitest run tests/tool-audit.test.ts`
   (edit it to use the new rows) and review EVERY verified match. For links you have verified by reading both documents
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
- v4 mappings: 72 suggestions ≥90% accepted (src/data/acceptedMatches.ts) — superseded by v5
- v5 rematch: owner verification policy → 389 verified (71.8%), 80 suggestions for review, 73 unmatched;
  20 of the v4 acceptances taken back (alkaline, variety, sport, multi-pack, count cut off/differs)
- v6 mappings: 54 suggestions above 80% accepted by the owner → 443 priced (389 verified + 54 confirmed,
  coverage 81.7%), 26 review (all at 80%), 73 unmatched
- v7 mappings: owner's "A2Z_Catalog_Matched_Prices.pdf" (tests/fixtures; checked with tests/tool-reconcile.test.ts):
  433 rows already agreed; 20 priced from it (each = its price-sheet line), 7 NO PRICE in it → unpriced
  (source 'ownerdoc'); NOT applied: San Pellegrino Glass 11OZ ($26.99 = Perrier line) and Saratoga Sparkling
  Glass 12OZ (STILL line). → 456 priced (coverage 84.1%), 86 show "Price not added" (owner's wording for
  every product without a price). His list skipped 7 catalog products (left as they were).
- v8 supplement: owner's "A2Z_Mismatch_With_Prices.pdf" (50 rows → exact catalog lines, tests/supplement.test.ts;
  safety snapshot first; his own prices win) → 482 confirmed, 44 approximate, 5 needs review (3 price selection),
  11 Price Not Listed.
- v9 supplement: owner's price NOTES written on the catalog PDF (FreeText annotations, pages 1–2;
  tests/fixtures/A2Z_Beverages_Product_List_11.20.26_notes.pdf; src/data/catalogPriceNotes.ts, tests/catalogNotes.test.ts):
  group prices by size/count (Coke·Sprite·Fanta, Canada Dry, Pepsi·Dew·Dr Pepper, Sunkist·Crush·Schweeps, Gatorade,
  A&W·7UP) + his picks for Canada Dry Ginger Ale/Tonic Zero. Applied only on identical size+count(+multipack) → 118
  products confirmed. Pepsi/Dew/Dr Pepper 2L: note $13.99 ≠ price sheet $21.50 → note used (told the owner).
  Not covered: Sprite Mexico 330ML, Fanta Pineapple/Strawberry Mexico 335ML (note says 355 ML). → 495 confirmed,
  34 approximate, 3 needs review, 10 not listed. List for the owner: `OUT=… npx vitest run tests/tool-unconfirmed.test.ts`.
Next free version: 10 (also set BUNDLED_VERSION in src/data/bundledVersion.ts — a test checks they match).

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
