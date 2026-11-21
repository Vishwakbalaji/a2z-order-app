/**
 * Database-level import / matching operations. Nothing here ever deletes stores,
 * orders or drafts, and every import takes an automatic snapshot first.
 */
import { db, stableId, uid } from './db';
import { takeSnapshot } from './backup';
import type { DraftLine, Mapping, PriceItem, Product, Settings } from '../types';
import { matchProduct, buildSiblingCounts, DEFAULT_CONTEXT } from '../lib/matching';
import { displayName, mappingKey, priceItemKey, unitsFromText } from '../lib/products';
import { A2Z_COMPANY } from '../data/a2zPriceSheet';
import { BUNDLED_DATASETS, type BundledMapping } from '../data/bundled';
import { normText } from '../lib/normalize';

export interface PriceRowInput {
  section: string;
  brand: string;
  desc: string;
  sku?: string;
  priceCents: number;
  raw: string;
}
export interface CatalogRowInput {
  department: string;
  category: string;
  brand: string;
  name: string;
  variation: string;
  unitsPerCase: number | null;
  sku: string;
  raw: string;
}

export type DiffStatus = 'new' | 'changed' | 'same';
export interface PriceDiff {
  rows: { row: PriceRowInput; status: DiffStatus; oldCents: number | null }[];
  missing: PriceItem[]; // currently known lines that are not in this sheet
  duplicates: string[];
}

export async function diffPriceSheet(rows: PriceRowInput[]): Promise<PriceDiff> {
  const existing = await db.priceItems.toArray();
  const byKey = new Map(existing.map((i) => [i.key, i]));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const out: PriceDiff['rows'] = rows.map((row) => {
    const key = priceItemKey(row.brand, row.desc);
    if (seen.has(key)) duplicates.push(`${row.brand} ${row.desc}`);
    seen.add(key);
    const old = byKey.get(key);
    if (!old) return { row, status: 'new', oldCents: null };
    return { row, status: old.priceCents === row.priceCents ? 'same' : 'changed', oldCents: old.priceCents };
  });
  return { rows: out, missing: existing.filter((i) => !seen.has(i.key)), duplicates };
}

function newPriceSheetProduct(item: PriceItem, now: number): Product {
  return {
    id: stableId('p_ps_', item.key),
    origin: 'pricesheet',
    department: item.section,
    category: '',
    brand: item.brand,
    name: '',
    variation: item.desc,
    unitsPerCase: unitsFromText(item.desc),
    sku: item.sku,
    catalogName: '',
    priceItemId: item.id,
    priceOverrideCents: null,
    matchStatus: 'matched',
    matchMethod: 'pricesheet',
    matchScore: 1,
    suggestedPriceItemId: null,
    active: true,
    order: item.order,
    createdAt: now,
    updatedAt: now,
  };
}

/** Add / update price lines. Existing lines not in the sheet are kept and flagged, never deleted. */
export async function applyPriceSheet(rows: PriceRowInput[], fileName: string, opts: { snapshot?: boolean; importId?: string } = {}) {
  if (opts.snapshot !== false) await takeSnapshot(`Before price sheet import: ${fileName}`);
  const now = Date.now();
  const summary = { added: 0, changed: 0, same: 0, missing: 0 };
  await db.transaction('rw', [db.priceItems, db.products, db.imports, db.mappings], async () => {
    const existing = await db.priceItems.toArray();
    const byKey = new Map(existing.map((i) => [i.key, i]));
    let order = existing.reduce((m, i) => Math.max(m, i.order), 0);
    const seen = new Set<string>();
    for (const r of rows) {
      const key = priceItemKey(r.brand, r.desc);
      if (seen.has(key)) continue; // duplicate line in the same sheet: first wins (shown in preview)
      seen.add(key);
      const old = byKey.get(key);
      if (old) {
        const changed = old.priceCents !== r.priceCents;
        if (changed) summary.changed++;
        else summary.same++;
        await db.priceItems.put({
          ...old,
          section: r.section || old.section,
          sku: r.sku || old.sku,
          priceCents: r.priceCents,
          prevPriceCents: changed ? old.priceCents : old.prevPriceCents,
          raw: r.raw,
          sourceFile: fileName,
          importedAt: now,
          missingFromLatest: false,
        });
      } else {
        summary.added++;
        const item: PriceItem = {
          id: stableId('pi_', key),
          key,
          section: r.section,
          brand: r.brand,
          desc: r.desc,
          sku: r.sku || '',
          priceCents: r.priceCents,
          prevPriceCents: null,
          raw: r.raw,
          sourceFile: fileName,
          importedAt: now,
          missingFromLatest: false,
          order: (order += 10),
        };
        await db.priceItems.add(item);
        await db.products.add(newPriceSheetProduct(item, now));
      }
    }
    for (const old of existing) {
      if (!seen.has(old.key)) {
        summary.missing++;
        if (!old.missingFromLatest) await db.priceItems.put({ ...old, missingFromLatest: true });
      }
    }
    await db.imports.put({
      id: opts.importId ?? uid('imp_'),
      kind: 'pricesheet',
      fileName,
      at: now,
      summary: `${summary.added} new, ${summary.changed} price changes, ${summary.same} unchanged, ${summary.missing} not on this sheet`,
      rawLines: rows.map((r) => r.raw),
    });
    await rematchCatalogProducts();
  });
  return summary;
}

/** Add / update catalog products and match them to price lines. Nothing is deleted. */
/** `complete` = the file is the whole catalog, so products missing from it are flagged (never deleted). */
export async function applyCatalog(rows: CatalogRowInput[], fileName: string, opts: { complete?: boolean; importId?: string } = {}) {
  const complete = opts.complete ?? true;
  await takeSnapshot(`Before catalog import: ${fileName}`);
  const now = Date.now();
  const summary: CatalogSummary = { total: 0, added: 0, updated: 0, unchanged: 0, duplicates: 0, discontinued: 0, matched: 0, review: 0, unmatched: 0 };
  await db.transaction('rw', [db.priceItems, db.products, db.imports, db.mappings], async () => {
    const all = await db.products.toArray();
    const catalog = all.filter((p) => p.origin === 'catalog');
    const byKey = new Map(catalog.map((p) => [mappingKey(p), p]));
    const seen = new Set<string>();
    let order = all.reduce((m, p) => Math.max(m, p.order), 0);
    for (const r of rows) {
      const base = {
        department: r.department.trim(),
        category: r.category.trim(),
        brand: r.brand.trim(),
        name: r.name.trim(),
        variation: r.variation.trim(),
        unitsPerCase: r.unitsPerCase,
        sku: r.sku.trim(),
        catalogName: r.raw.trim() || [r.brand, r.name, r.variation].join(' ').trim(),
      };
      const key = mappingKey(base);
      if (seen.has(key)) {
        summary.duplicates++; // the same product twice in one catalog: keep one
        continue;
      }
      seen.add(key);
      const old = byKey.get(key);
      if (old) {
        const changed = (Object.keys(base) as (keyof typeof base)[]).some((k) => old[k] !== base[k]) || old.missingFromCatalog;
        if (changed) summary.updated++;
        else summary.unchanged++;
        if (changed) await db.products.put({ ...old, ...base, missingFromCatalog: false, updatedAt: now });
      } else {
        summary.added++;
        const p: Product = {
          id: stableId('p_c_', key),
          origin: 'catalog',
          ...base,
          priceItemId: null,
          priceOverrideCents: null,
          matchStatus: 'unmatched',
          matchMethod: '',
          matchScore: 0,
          suggestedPriceItemId: null,
          active: true,
          order: (order += 10),
          createdAt: now,
          updatedAt: now,
        };
        await db.products.add(p);
        byKey.set(key, p);
      }
    }
    // products from an earlier catalog that are not in this one: flagged, never deleted
    for (const p of complete ? catalog : []) {
      if (seen.has(mappingKey(p)) || p.missingFromCatalog) continue;
      summary.discontinued++;
      await db.products.put({ ...p, missingFromCatalog: true, updatedAt: now });
    }
    await rematchCatalogProducts();
    const after = (await db.products.where('origin').equals('catalog').toArray()).filter((p) => p.active && !p.missingFromCatalog);
    summary.total = after.length;
    for (const p of after) summary[p.matchStatus]++;
    await db.imports.put({
      id: opts.importId ?? uid('imp_'),
      kind: 'catalog',
      fileName,
      at: now,
      summary: catalogSummaryText(summary),
      rawLines: rows.map((r) => r.raw),
    });
  });
  return summary;
}

export interface CatalogSummary {
  total: number; // active products in the catalog after this import
  added: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  discontinued: number; // in an earlier catalog but not in this one (flagged, kept)
  matched: number;
  review: number;
  unmatched: number;
}
export function catalogSummaryText(s: CatalogSummary): string {
  return [
    `${s.total} catalog products: ${s.matched} priced automatically, ${s.review} need review, ${s.unmatched} not on the price sheet.`,
    `${s.added} new, ${s.updated} updated, ${s.unchanged} unchanged${s.discontinued ? `, ${s.discontinued} no longer in the catalog (kept, flagged)` : ''}${s.duplicates ? `, ${s.duplicates} duplicate rows skipped` : ''}.`,
  ].join(' ');
}

/** Pricing audit counts. Coverage = (verified + confirmed by you) ÷ total; suggestions don't count. */
export function auditCounts(catalog: Product[]) {
  const manual = catalog.filter((p) => p.priceOverrideCents != null || (p.matchStatus === 'matched' && p.matchMethod === 'manual')).length;
  const verified = catalog.filter((p) => p.priceOverrideCents == null && p.matchStatus === 'matched' && p.matchMethod !== 'manual').length;
  const review = catalog.filter((p) => p.priceOverrideCents == null && p.matchStatus === 'review').length;
  const unmatched = catalog.filter((p) => p.priceOverrideCents == null && p.matchStatus === 'unmatched').length;
  const total = catalog.length;
  return { total, verified, manual, review, unmatched, coverage: total ? Math.round(((verified + manual) / total) * 1000) / 10 : 0 };
}

/** Re-run matching for catalog/manual products that were not confirmed by hand. */
export async function rematchCatalogProducts() {
  const items = await db.priceItems.toArray();
  const mappings = new Map((await db.mappings.toArray()).map((m) => [m.key, m]));
  const products = (await db.products.toArray()).filter((p) => p.origin !== 'pricesheet');
  const now = Date.now();
  const itemIds = new Set(items.map((i) => i.id));
  const ctx = { ...DEFAULT_CONTEXT, items, siblings: buildSiblingCounts(products.filter((p) => p.active)) };
  for (const p of products) {
    // respect decisions made by hand, unless the chosen price line no longer exists
    if (p.matchMethod === 'manual' && (!p.priceItemId || itemIds.has(p.priceItemId))) continue;
    const r = matchProduct(p, items, mappings, ctx);
    const next = {
      ...p,
      matchStatus: r.status,
      priceItemId: r.priceItemId,
      suggestedPriceItemId: r.suggestedPriceItemId,
      matchMethod: r.method,
      matchScore: r.score,
      matchBasis: r.basis,
      matchFlags: r.flags,
      matchNotes: r.notes,
    };
    // unchanged products are not rewritten (keeps cloud sync quiet)
    const same = (['matchStatus', 'priceItemId', 'suggestedPriceItemId', 'matchMethod', 'matchScore', 'matchBasis'] as const).every((k) => (p[k] ?? null) === (next[k] ?? null)) && JSON.stringify(p.matchFlags ?? []) === JSON.stringify(r.flags) && JSON.stringify(p.matchNotes ?? []) === JSON.stringify(r.notes);
    if (!same) await db.products.put({ ...next, updatedAt: now });
  }
}

/** User confirmed a product → price line mapping (remembered for future imports). */
export async function confirmMatch(productId: string, priceItemId: string) {
  await db.transaction('rw', [db.products, db.priceItems, db.mappings], async () => {
    const p = await db.products.get(productId);
    const it = await db.priceItems.get(priceItemId);
    if (!p || !it) throw new Error('Product or price line not found');
    const m: Mapping = { key: mappingKey(p), priceItemKey: it.key, updatedAt: Date.now() };
    await db.mappings.put(m);
    await db.products.put({ ...p, priceItemId: it.id, matchStatus: 'matched', matchMethod: 'manual', matchScore: 1, suggestedPriceItemId: null, updatedAt: Date.now() });
  });
}

export async function leaveUnmatched(productId: string) {
  await db.transaction('rw', [db.products, db.mappings], async () => {
    const p = await db.products.get(productId);
    if (!p) return;
    await db.mappings.put({ key: mappingKey(p), priceItemKey: null, updatedAt: Date.now() });
    await db.products.put({ ...p, priceItemId: null, matchStatus: 'unmatched', matchMethod: 'manual', suggestedPriceItemId: null, updatedAt: Date.now() });
  });
}

/**
 * Applies data shipped with the app (src/data/bundled.ts) that this phone has not
 * applied yet. First run = the A2Z price sheet. Later versions (e.g. the catalog) are
 * applied on the next start after the app is updated — stores, carts and orders untouched.
 */
export async function syncBundledData(): Promise<number[]> {
  const run = async () => {
    const applied: number[] = [];
    await db.transaction('rw', db.settings, async () => {
      if (await db.settings.get('app')) return;
      await db.settings.put({
        id: 'app',
        ...A2Z_COMPANY,
        repName: 'Vishwak',
        repPhone: '',
        logoDataUrl: null,
        selectedStoreId: null,
        orderSeq: 0,
        seededAt: Date.now(),
        bundledVersion: 0,
      });
    });
    for (const ds of [...BUNDLED_DATASETS].sort((a, b) => a.version - b.version)) {
      const s = (await db.settings.get('app'))!;
      const done = s.bundledVersion ?? (s.seededAt ? 1 : 0); // installs from before versioning had v1
      if (ds.version <= done) continue;
      let notice: Settings['dataNotice'] | undefined;
      if (ds.kind === 'pricesheet') {
        await applyPriceSheet(ds.rows, ds.fileName, { snapshot: done > 0, importId: `imp_bundled_v${ds.version}` });
      } else if (ds.kind === 'catalog') {
        await addBundledMappings(ds.mappings || []);
        const summary = await applyCatalog(ds.rows, ds.fileName, { importId: `imp_bundled_v${ds.version}` });
        await moveDraftsToCatalogNames();
        notice = { title: 'Product catalog updated', text: catalogSummaryText(summary), at: Date.now(), review: summary.review + summary.unmatched };
      } else if (ds.kind === 'mappings') {
        const before = (await db.products.toArray()).filter((p) => p.origin === 'catalog' && p.active && p.matchStatus === 'matched').length;
        await addBundledMappings(ds.mappings);
        await rematchCatalogProducts();
        await moveDraftsToCatalogNames();
        const cat = (await db.products.toArray()).filter((p) => p.origin === 'catalog' && p.active && !p.missingFromCatalog);
        const matched = cat.filter((p) => p.matchStatus === 'matched').length;
        const review = cat.filter((p) => p.matchStatus === 'review').length;
        const unmatched = cat.filter((p) => p.matchStatus === 'unmatched').length;
        notice = {
          title: 'Suggested prices accepted (90% or higher)',
          text: `${matched - before} more products now have a price. ${matched} of ${cat.length} catalog products are priced; ${review} suggestions below 90% wait for your review and ${unmatched} are not on the price sheet. Accepted ones are marked "accepted by your 90% rule" in Review price matching, where you can change any of them.`,
          at: Date.now(),
          review: review + unmatched,
        };
      }
      if (ds.kind === 'rematch') {
        const prev = new Map((await db.products.toArray()).map((p) => [p.id, p]));
        await rematchCatalogProducts();
        await moveDraftsToCatalogNames();
        const cat = (await db.products.toArray()).filter((p) => p.origin === 'catalog' && p.active && !p.missingFromCatalog);
        const a = auditCounts(cat);
        const lost = cat.filter((p) => prev.get(p.id)?.matchStatus === 'matched' && p.matchStatus !== 'matched').length;
        const gained = cat.filter((p) => prev.get(p.id)?.matchStatus !== 'matched' && p.matchStatus === 'matched').length;
        notice = {
          title: 'Prices re-checked with your verification rules',
          text: `${a.verified} catalog products verified${a.manual ? ` and ${a.manual} confirmed by you` : ''} (coverage ${a.coverage}%). ${a.review} wait for your confirmation and ${a.unmatched} have no price line.${lost ? ` ${lost} prices were taken back for your confirmation (e.g. alkaline, variety pack, multi-pack or a different case count).` : ''}${gained ? ` ${gained} newly verified.` : ''} Products waiting for confirmation are not counted in totals.`,
          at: Date.now(),
          review: a.review + a.unmatched,
        };
      }
      const cur = (await db.settings.get('app'))!;
      const next: Settings = { ...cur, bundledVersion: ds.version, ...(notice ? { dataNotice: notice } : {}) };
      if (ds.kind === 'settings') {
        for (const [k, v] of Object.entries(ds.fillEmpty) as [keyof typeof ds.fillEmpty, string][]) if (!String(next[k] ?? '').trim()) next[k] = v;
      }
      await db.settings.put(next);
      applied.push(ds.version);
    }
    return applied;
  };
  // one tab at a time, so two open tabs never import the same data twice
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('a2z-bundled-data', run) : run();
}

/**
 * Draft carts may hold price-sheet products that a catalog product now replaces.
 * Move those lines to the catalog product — only when exactly ONE active catalog
 * product is matched to that price line (e.g. "COKE / FANTA / SPRITE" lines that
 * several catalog flavours share are left as they are). Completed orders never change.
 */
export async function moveDraftsToCatalogNames() {
  const products = await db.products.toArray();
  const byItem = new Map<string, Product[]>();
  for (const p of products) {
    if (p.origin === 'pricesheet' || !p.active || p.matchStatus !== 'matched' || !p.priceItemId) continue;
    byItem.set(p.priceItemId, [...(byItem.get(p.priceItemId) || []), p]);
  }
  const replace = new Map<string, string>();
  for (const p of products) {
    const c = p.origin === 'pricesheet' && p.priceItemId ? byItem.get(p.priceItemId) : undefined;
    if (c && c.length === 1) replace.set(p.id, c[0].id);
  }
  if (!replace.size) return;
  for (const d of await db.drafts.toArray()) {
    if (!d.lines.some((l) => replace.has(l.productId))) continue;
    const merged = new Map<string, DraftLine>();
    for (const l of d.lines) {
      const id = replace.get(l.productId) || l.productId;
      const prev = merged.get(id);
      merged.set(id, prev ? { ...prev, qty: prev.qty + l.qty, note: [prev.note, l.note].filter(Boolean).join('; ') || undefined } : { ...l, productId: id });
    }
    await db.drafts.put({ ...d, lines: [...merged.values()], updatedAt: d.updatedAt + 1 });
  }
}

/** Verified mappings shipped with a catalog. Decisions you made in the app are never overwritten. */
async function addBundledMappings(list: BundledMapping[]) {
  const now = Date.now();
  for (const m of list) {
    const key = m.sku ? `SKU:${m.sku.trim().toUpperCase()}` : `N:${normText(m.catalogRaw)}`;
    if (await db.mappings.get(key)) continue;
    await db.mappings.put({ key, priceItemKey: m.priceBrand == null || m.priceDesc == null ? null : priceItemKey(m.priceBrand, m.priceDesc), updatedAt: now, ...(m.source ? { source: m.source } : {}) });
  }
}

export { displayName };
