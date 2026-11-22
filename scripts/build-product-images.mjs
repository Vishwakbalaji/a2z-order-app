#!/usr/bin/env node
/**
 * Builds the product pictures shipped with the app from the reviewed decisions.
 *
 *   node scripts/build-product-images.mjs <decisions.json> <downloaded-originals-dir>
 *
 * decisions.json: [{ id, name, code, status: 'verified'|'approx'|'review', confidence, note? }]
 *   (one entry per catalog product that got a picture after checking it by eye; see src/lib/images.ts)
 * For each entry it reads <dir>/<code>.full.jpg (or <code>.jpg), trims plain borders, and writes
 *   public/products/t/<id>.webp  (fits 160×160, thumbnail for the lists)
 *   public/products/l/<id>.webp  (fits 480×480, the tap-to-enlarge preview)
 * and regenerates src/data/productImages.ts. Pictures the owner approved/rejected/replaced in the app
 * are stored on his phone and are never touched by this script.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [decisionsFile, srcDir] = process.argv.slice(2);
if (!decisionsFile || !srcDir) {
  console.error('usage: node scripts/build-product-images.mjs <decisions.json> <originals-dir>');
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outT = path.join(root, 'public/products/t'), outL = path.join(root, 'public/products/l');
fs.mkdirSync(outT, { recursive: true });
fs.mkdirSync(outL, { recursive: true });
const decisions = JSON.parse(fs.readFileSync(decisionsFile, 'utf8'));
const today = new Date().toISOString().slice(0, 10);

const entries = {};
let bytesT = 0, bytesL = 0;
for (const d of decisions) {
  const full = path.join(srcDir, `${d.code}.full.jpg`), small = path.join(srcDir, `${d.code}.jpg`);
  const have = (f) => fs.existsSync(f) && fs.statSync(f).size > 500;
  const src = have(full) ? full : have(small) ? small : null;
  if (!src) throw new Error(`missing original for ${d.name} (${d.code})`);
  // Note: Open Food Facts stores many pictures already upright but still tagged "rotate 90°" (EXIF 6), so the
  // tag is NOT applied — pixels are used as stored (exactly as they were checked by eye). Output has no EXIF.
  const base = sharp(src, { failOn: 'none' }).flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 18 });
  const buf = await base.toBuffer();
  const file = `${d.id}.webp`;
  const t = await sharp(buf).resize(160, 160, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 74, effort: 5 }).toBuffer();
  const l = await sharp(buf).resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 5 }).toBuffer();
  fs.writeFileSync(path.join(outT, file), t);
  fs.writeFileSync(path.join(outL, file), l);
  bytesT += t.length;
  bytesL += l.length;
  entries[d.id] = {
    file,
    name: d.name,
    status: d.status,
    confidence: d.confidence,
    source: 'Open Food Facts',
    sourceUrl: `https://world.openfoodfacts.org/product/${d.code}`,
    credit: 'Open Food Facts contributors, CC BY-SA 3.0',
    license: 'CC BY-SA 3.0',
    verifiedAt: d.verifiedAt || today,
    ...(d.note ? { note: d.note } : {}),
  };
}
// remove files of products that no longer have a shipped picture
for (const dir of [outT, outL]) for (const f of fs.readdirSync(dir)) if (!entries[f.replace(/\.webp$/, '')]) fs.unlinkSync(path.join(dir, f));

const header = fs.readFileSync(path.join(root, 'src/data/productImages.ts'), 'utf8').split('export const PRODUCT_IMAGES')[0];
const body = Object.entries(entries)
  .sort((a, b) => a[1].name.localeCompare(b[1].name))
  .map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e)},`)
  .join('\n');
fs.writeFileSync(path.join(root, 'src/data/productImages.ts'), `${header}export const PRODUCT_IMAGES: Record<string, BundledImage> = {\n${body}\n};\n`);
console.log(`${Object.keys(entries).length} pictures · thumbnails ${(bytesT / 1024).toFixed(0)} KB · previews ${(bytesL / 1024).toFixed(0)} KB`);
