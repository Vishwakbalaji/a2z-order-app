// Searches Open Food Facts for each catalog product; caches raw hits in hits.json (resumable).
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const products = JSON.parse(fs.readFileSync(dir + 'products.json', 'utf8'));
const cacheFile = dir + 'hits.json';
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

export const BRAND = {
  Coke: 'coca-cola', AW: 'a&w', Schweeps: 'schweppes', 'Yoo - Hoo': 'yoo-hoo', BEVERAGE: 'dole', 'Body Armor': 'bodyarmor',
  'Sports shake': 'sports shake', 'Foco Coco': 'foco', 'Pure Life': 'pure life', 'Malta India': 'malta india', 'Vita Malta': 'vitamalt',
  'D&G': 'd&g', 'Blue Water': 'blue water', 'Core Water': 'core', 'Core Power': 'core power', 'Vitamin Water': 'vitaminwater',
  Watermelon: 'watermelon soda', Perrier: 'perrier', Essentia: 'essentia', 'Plastic bags': '',
};
const NOISE = /^(\d+(\.\d+)?(OZ|ML|L|GAL|G|GR|GM|CT|C|P|PK|FL)?|\d+\/\d+.*|\d+-\d+.*|CT|PK|PACK|CAN|CANS|GLASS|GL|GLS|PET|PLASTIC|BOTTLE|OZ|FL|WATER|ENERGY|DRINK|LITER|GALLON|CASE|CS|N|W|O|\.\d+.*)$/;
const FIX = { VANILA: 'VANILLA', CAREMAL: 'CARAMEL', FRAPPUCHINE: 'FRAPPUCCINO', FRAPPUCINO: 'FRAPPUCCINO', RASBERRY: 'RASPBERRY', RASBEERY: 'RASPBERRY',
  STRAWBEERY: 'STRAWBERRY', STRWABERRY: 'STRAWBERRY', STARWBERRY: 'STRAWBERRY', PINAPPLE: 'PINEAPPLE', HAWAIAN: 'HAWAIIAN', ARTIC: 'ARCTIC',
  COCONUR: 'COCONUT', APPRICOT: 'APRICOT', POMOGRANATE: 'POMEGRANATE', TROPICCAL: 'TROPICAL', COTTAN: 'COTTON', MOCAH: 'MOCHA', CHOT: 'SHOT',
  DBL: 'DOUBLE', GRREN: 'GREEN', ALKLINE: 'ALKALINE', SMOOTHY: 'SMOOTHIE', TAMARINOO: 'TAMARINDO', CHILZICLE: 'CHILLZICLE', BLIS: 'BLISS',
  SPARKING: 'SPARKLING', VANILABERRY: 'VANILLA BERRY', ENERGYCHERRY: 'CHERRY', ENERGYJUICY: 'JUICY', ENERGYSUMMER: 'SUMMER', HAZE16OZ: 'HAZE', LMND: 'LEMONADE', VRTY: 'VARIETY', VPK: 'VARIETY' };
export function queryFor(p) {
  const b = BRAND[p.group] ?? p.group.toLowerCase();
  const brandWords = new Set(b.toUpperCase().split(/[\s&-]+/).concat(p.group.toUpperCase().split(/[\s&-]+/), ['BODY', 'ARMOUR', 'D&G', 'ESSENTIAL']));
  const words = p.name.toUpperCase().replace(/[()]/g, ' ').split(/\s+/).map((w) => FIX[w] ?? w).join(' ').split(' ').filter((w) => w && !NOISE.test(w) && !brandWords.has(w));
  const size = p.size ? p.size.replace(/(\d)(OZ)$/, '$1 fl oz').replace(/ML$/, ' ml').replace(/(\d)L$/, '$1 l') : '';
  return { brand: b, words, q: [b, ...words.map((w) => w.toLowerCase()), size].filter(Boolean).join(' ') };
}

const FIELDS = 'code,product_name,brands,quantity,image_front_url,countries_tags,product_quantity,product_quantity_unit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function search(q) {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=24&fields=${FIELDS}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'A2ZOrderPad/1.0 (product image lookup)' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
      const j = await r.json();
      return (j.hits || []).filter((h) => h.image_front_url);
    } catch (e) { await sleep(3000 * (attempt + 1)); }
  }
  return null;
}
if (process.argv[2] === 'run') {
  let n = 0;
  for (const p of products) {
    if (p.group === 'Plastic bags') continue;
    const { q, brand, words } = queryFor(p);
    const qs = [q, [brand, ...words.map((w) => w.toLowerCase())].join(' ')]; // with and without size
    for (const qq of qs) {
      if (cache[qq]) continue;
      const hits = await search(qq);
      if (hits) cache[qq] = hits;
      n++;
      if (n % 20 === 0) { fs.writeFileSync(cacheFile, JSON.stringify(cache)); console.log(n, 'queries'); }
      await sleep(700);
    }
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  console.log('done', Object.keys(cache).length);
}
