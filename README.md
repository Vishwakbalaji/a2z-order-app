# A2Z Order Pad

A mobile-first ordering app for taking store orders on products from **A2Z Beverage Distributors**. It opens straight to the product list, with no login. You pick a store, search, tap **+ / −** to set case quantities, review the cart, and download a professional PDF to send to the distributor.

- **Real data:**
  - **Catalog:** the 542 products from `A2Z_Beverages_Product_List_11.20.26_.pdf`, under the catalog's own names, departments and brand groups.
  - **Prices:** case prices from the 131-line `A2Z_Beverages_Price_Deals_A4_2.pdf`.
  - **Matching:** 334 products are priced automatically (same brand, size and case count). 139 have a suggested price waiting for your one-tap confirmation, and 69 aren't on the price sheet.
- **Works offline:** after the first visit it is an installable PWA.
- **No server and no database account:** everything is stored on your phone in IndexedDB, with backup and restore to a file.
- **Free hosting:** it is a static website (Cloudflare Pages recommended).

---

## Daily use

1. Open the app link (or the home-screen icon).
2. Tap **Select a store** at the top, pick a store or **Add New Store**. Every store keeps its own separate draft order.
3. Search (for example `500 water`, `red bull 12`, `zeph`) or tap a department chip.
4. Tap **+ / −**. Each step is **one case**. Tap the number to type a quantity. Anything above 0 is in the cart automatically.
5. **Cart** shows Total Products, Total Cases and Total Order Value. Use **Add note** to give details such as flavors ("2 Coke, 1 Sprite"); the note is printed under the product name in the PDF.
6. Choose one of the two PDFs:
   - **Download Order PDF**: for the distributor. Columns are S.No / Product Name / Quantity (Cases), with **no prices**.
   - **Download Detailed Order PDF**: your copy, with Price/Case, line totals and the order value.
   - The **share** button next to each opens WhatsApp, Gmail and other apps directly.
7. **Finalize Order** saves a permanent snapshot in **Orders** and empties that store's cart. From Orders you can re-download either PDF, or use **Copy to new draft**.

Prices are always per case. A product without a reliable price shows **"Price not available"**. It can still be ordered, but the cart warns you and leaves it out of the total.

---

## New stores

**Add New Store** has a **Mark as New Store** toggle, on by default. Untick it for a store you already serve. The date added is recorded automatically.

- The **first finalized order** of a new store prints **NEW STORE — FIRST ORDER** under the store details in the distributor PDF.
- Later orders for that store never show it, and other stores are not affected.
- A PDF downloaded from the cart before finalizing also shows the label but doesn't use it up. Only **Finalize Order** does.
- Re-downloading that first order from Order History always shows the label again.
- The status is saved in the database and in backups, so it survives refreshes, app updates and restoring on a new phone.

## Weekly Reports (Orders → Weekly Reports)

Your private sales and commission report. It is never sent to the distributor.

- **Week:** Saturday 12:00 AM to Friday 11:59:59 PM, New York time. Week 1 is Nov 21–27, 2026.
- **What counts:** only finalized orders, counted in the week they were finalized.
  - **Voided orders** don't count. Use "Void order" on the order's page.
  - **Orders with a missing price** are listed as flagged and left out of confirmed sales until you add the price. Tap "N/A — add" on the order's page.
- **Contents:**
  - a summary;
  - A. new stores added (stores marked "New Store");
  - B. orders per store (several orders from one store are combined, and the store is counted once);
  - C. total sales and cases;
  - D. active stores that didn't order, from Week 2 onward;
  - E. your **1% commission**, rounded to the cent.
- **Generate Weekly Report** shows the current week as **provisional**. Nothing is saved until the week ends.
- **Finalized reports:** each week becomes a permanent report with a unique ID (e.g. `WR-2026-11-21`). It is never recalculated.
  - If something changes later, the report shows a notice. **Create revised report** makes `WR-…-R1` and keeps the original, with an audit trail.
- **Download Weekly Report PDF**, e.g. `Weekly_Sales_Report_2026-11-21_to_2026-11-27.pdf`.

**About "automatic every Friday":** the app is a free static website with no server. Your orders live only on your phone, so no cloud job can see them. Instead, the app finalizes every week that has ended:
- when you open it;
- every minute while it's open;
- when you switch back to it.

So if your phone is off at midnight on Friday, the report is created the next time you open the app, with exactly the same numbers. A week can never be finalized twice.

## Hosting: GitHub Pages (current setup)

The app is published from this repository by `.github/workflows/deploy.yml`. Every push to `main` runs the unit tests, builds the app and deploys it to:

**https://vishwakbalaji.github.io/a2z-order-app/**

GitHub Pages is free for public repositories and never puts a site to sleep. The repository holds only code and the A2Z price list; your stores, carts and orders stay on your phone and are never uploaded. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

**Catalog and price-sheet updates:** send the file to Claude. It adds the data as a new versioned entry in `src/data/bundled.ts` and pushes. On your phone, the app applies the update on its next start: product names follow the catalog, prices follow the price sheet, nothing is deleted, and your stores, carts and order history stay as they are. The steps Claude follows are in `CLAUDE.md`. You can also still upload files yourself under Settings.

## Alternative hosting (free): Cloudflare Pages

Cloudflare Pages' free plan serves static sites with unlimited bandwidth and never puts the site to sleep. Free plans and limits can change; check Cloudflare's pricing page.

### Option A: GitHub + Cloudflare Pages (recommended, gives easy future updates)

1. Create a free GitHub account and a new **private** repository (for example `a2z-order-app`). Put this project folder in it (or ask Claude to push it for you).
2. Go to <https://dash.cloudflare.com>, then **Workers & Pages → Create → Pages → Connect to Git**, and pick the repository.
3. Build settings:
   - Framework preset: **Vite** (or "None")
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22`
4. Click **Save and Deploy**. After about a minute you get a permanent link such as `https://a2z-order-app.pages.dev`.

Every later change pushed to GitHub redeploys automatically. The phone picks up the new version on its next visit. Your data is not affected.

### Option B: direct upload (no GitHub)

1. Build once (`npm install && npm run build`), or use the ready-made `deploy/a2z-order-app-site.zip`.
2. In Cloudflare, go to **Workers & Pages → Create → Pages → Upload assets**, name the project, and upload the zip (or the `dist` folder).
3. To update later, upload a new zip to the same project.

Netlify and Vercel also work: the build command is `npm run build` and the output folder is `dist`.

---

## Install it on your phone

- **Android (Chrome):** open the link, then tap **⋮ → Add to Home screen / Install app**.
- **iPhone:** open the link in Safari (or in Chrome on iOS 16.4 or later), tap **Share → Add to Home Screen**.

The installed app opens full-screen and works without internet. You need to be online only to load new versions.

---

## Your data: where it lives and how to keep it safe

All stores, carts, orders, products, prices, matches and settings are stored **in the browser on this phone** (IndexedDB). Nothing is sent to any server.

**Strengths**
- Fast and offline.
- Free.
- Random visitors who open the link get their own empty copy. They can never see or change your stores or orders.

**Limitations (honest)**
- Data does **not** sync between devices automatically.
- Clearing Chrome's site data or uninstalling the browser deletes it.
- Very rarely, a phone that is extremely low on storage may evict it. On iPhone, Safari may clear data for sites that are **not** added to the home screen and go unused for about 7 days.

**What to do**
- Install the app to the home screen. The app also asks the browser for persistent storage; you can see whether it was granted under Settings → About.
- Make a **backup** regularly: **Settings → Backup & restore → Share backup**, then save it to Google Drive or iCloud, or email it to yourself.
- To move to a new phone: open the app there, then **Restore from backup file**.
- Before every import or restore, the app keeps an automatic **safety snapshot** on the phone (the last 6), which you can roll back to.

**Cloud storage and server-side Friday reports (optional upgrade, not set up yet).** Automatic cloud saving and a true server-side Friday job need a small online database. A suitable free setup is a Cloudflare Worker with a D1 database and a scheduled trigger every Friday night. It would need your own free Cloudflare account and a private device key stored on your phones, so it still needs no login, but strangers couldn't read or change your data. No secrets would be in the website. It isn't included yet because it needs that account. Backup files cover moving between phones today.

---

## Updating products and prices

All of this is under **Settings**:

- **Upload price sheet** (PDF or CSV): every extracted line is shown before import, with **New**, **Price change (was $X)** or **Unchanged** markers. You can edit or untick lines. Lines missing from the new sheet are **kept and flagged, never deleted**. Draft carts use the new prices; completed orders keep their original prices.
- **Upload product catalog** (PDF or CSV, with a CSV template provided): products are organized by department and category and matched to the price sheet:
  1. A saved manual decision
  2. The same SKU
  3. Brand + size + case count (+ glass/can/plastic, still/sparkling…)
  4. Fuzzy name similarity

  A price is applied automatically **only** when exactly one price line is a strong, unambiguous match. Everything else goes to **Review price matching** (Confirm Match / Choose Different Product / Leave Unmatched / Enter price). Your decisions are remembered for future uploads.
- **Products & prices:** search, edit details, add products manually, disable discontinued items, set a manual case price, or change a price-sheet line's price.
- **Scanned (image-only) PDFs** can't be read on the phone. The app detects this and tells you. Use the original PDF, a CSV, or have the PDF converted first.

---

## Updating the app itself

The code is a standard React + TypeScript + Vite project:

```
src/
  data/a2zPriceSheet.ts    the price sheet that ships with the app
  lib/pdf/                 PDF text extraction, price-sheet parser, catalog parser
  lib/matching.ts          catalog ⇄ price matching rules
  lib/search.ts            product search
  lib/pdfExport.ts         the two order PDFs
  db/                      IndexedDB schema, imports, backup/restore
  state/store.ts           app state, carts (with crash-safe journaling), orders
  screens/                 Products, Cart, Orders, Stores, Settings, admin screens
```

```bash
npm install
npm run dev        # local preview at http://localhost:5173
npm test           # unit tests (parser vs. real PDF, matching, totals, backup…)
npm run e2e        # end-to-end tests in mobile Chrome (includes PDF checks)
npm run build      # production build in dist/
```

Database changes go in a new `this.version(2)` block in `src/db/db.ts` (Dexie migrations), so existing data on the phone is upgraded, not lost.

---

## Security notes

- **No login, by design.** The app has no backend and no cloud write access, so there is nothing a visitor could modify. Your data exists only on your phone.
- The site is marked `noindex` so search engines don't list it.
- The bundled A2Z price list (a distributor flyer) is part of the public site files. If you'd rather keep even that private, you can put **Cloudflare Access** in front of the site (free for small teams). It asks for a one-time email code per device. This is optional and off by default.
