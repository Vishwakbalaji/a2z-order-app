/**
 * Database-level import / matching operations. Nothing here ever deletes stores,
 * orders or drafts, and every import takes an automatic snapshot first.
 */
import { db, uid } from './db';
import { takeSnapshot } from './backup';
import type { Mapping, PriceItem, Product } from '../types';
import { matchProduct } from '../lib/matching';
import { displayName, mappingKey, priceItemKey, unitsFromText } from '../lib/products';
import { A2Z_COMPANY, A2Z_PRICE_ROWS, A2Z_SOURCE_FILE } from '../data/a2zPriceSheet';
import { parseMoneyToCents } from '../lib/money';

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
    id: uid('p_'),
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
export async function applyPriceSheet(rows: PriceRowInput[], fileName: string, opts: { snapshot?: boolean } = {}) {
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
          id: uid('pi_'),
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
    await db.imports.add({
      id: uid('imp_'),
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
export async function applyCatalog(rows: CatalogRowInput[], fileName: string) {
  await takeSnapshot(`Before catalog import: ${fileName}`);
  const now = Date.now();
  const summary = { added: 0, updated: 0, matched: 0, review: 0, unmatched: 0 };
  await db.transaction('rw', [db.priceItems, db.products, db.imports, db.mappings], async () => {
    const all = await db.products.toArray();
    const catalog = all.filter((p) => p.origin === 'catalog');
    const byKey = new Map(catalog.map((p) => [mappingKey(p), p]));
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
      const old = byKey.get(key);
      if (old) {
        summary.updated++;
        await db.products.put({ ...old, ...base, updatedAt: now });
      } else {
        summary.added++;
        const p: Product = {
          id: uid('p_'),
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
    await rematchCatalogProducts();
    const after = await db.products.where('origin').equals('catalog').toArray();
    for (const p of after) summary[p.matchStatus]++;
    await db.imports.add({
      id: uid('imp_'),
      kind: 'catalog',
      fileName,
      at: now,
      summary: `${summary.added} new, ${summary.updated} updated products — ${summary.matched} matched, ${summary.review} need review, ${summary.unmatched} unmatched`,
      rawLines: rows.map((r) => r.raw),
    });
  });
  return summary;
}

/** Re-run matching for catalog/manual products that were not confirmed by hand. */
export async function rematchCatalogProducts() {
  const items = await db.priceItems.toArray();
  const mappings = new Map((await db.mappings.toArray()).map((m) => [m.key, m]));
  const products = (await db.products.toArray()).filter((p) => p.origin !== 'pricesheet');
  const now = Date.now();
  const itemIds = new Set(items.map((i) => i.id));
  for (const p of products) {
    // respect decisions made by hand, unless the chosen price line no longer exists
    if (p.matchMethod === 'manual' && (!p.priceItemId || itemIds.has(p.priceItemId))) continue;
    const r = matchProduct(p, items, mappings);
    await db.products.put({
      ...p,
      matchStatus: r.status,
      priceItemId: r.priceItemId,
      suggestedPriceItemId: r.suggestedPriceItemId,
      matchMethod: r.method,
      matchScore: r.score,
      updatedAt: now,
    });
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

/** First run: load the A2Z price sheet that was supplied with the app. */
export async function seedIfEmpty(): Promise<boolean> {
  const s = await db.settings.get('app');
  if (s) return false;
  const now = Date.now();
  await db.transaction('rw', [db.priceItems, db.products, db.settings, db.imports, db.mappings], async () => {
    if (await db.settings.get('app')) return;
    await applyPriceSheet(
      A2Z_PRICE_ROWS.map(([section, brand, desc, price]) => ({
        section,
        brand,
        desc,
        priceCents: parseMoneyToCents(price)!,
        raw: `${brand} | ${desc} | $${price}`,
      })),
      A2Z_SOURCE_FILE,
      { snapshot: false },
    );
    await db.settings.put({
      id: 'app',
      ...A2Z_COMPANY,
      repName: 'Vishwak',
      repPhone: '',
      logoDataUrl: null,
      selectedStoreId: null,
      orderSeq: 0,
      seededAt: now,
    });
  });
  return true;
}

export { displayName };
