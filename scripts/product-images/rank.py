"""Rank Open Food Facts hits for each catalog product. Writes cands.json: {productId: [cand,...]}"""
import json, re, sys, subprocess
D = sys.argv[1] if len(sys.argv) > 1 else '.'
products = json.load(open(f'{D}/products.json'))
hits = json.load(open(f'{D}/hits.json'))
import os
if os.path.exists(f'{D}/hits2.json'): hits.update(json.load(open(f'{D}/hits2.json')))
# the same queries the search used
q = json.loads(subprocess.check_output(['node', '-e', '''
import('./search.mjs').then(m=>{const ps=JSON.parse(require('fs').readFileSync('products.json'));
const o={};for(const p of ps){const r=m.queryFor(p);o[p.id]={q:r.q,q2:[r.brand,...r.words.map(w=>w.toLowerCase())].join(' '),brand:r.brand,words:r.words}};console.log(JSON.stringify(o))})'''], cwd=D))

ML = {'ml': 1, 'cl': 10, 'l': 1000, 'fl oz': 29.5735, 'floz': 29.5735, 'oz': 29.5735, 'fl. oz': 29.5735, 'fl.oz': 29.5735}
def qty_ml(s):
    if not s: return None
    s = s.lower().replace(',', '.')
    m = re.search(r'(\d+(?:\.\d+)?)\s*(fl\.? ?oz|floz|ml|cl|l\b|oz)', s)
    if not m: return None
    return float(m[1]) * ML[m[2].replace('fl. oz', 'fl oz').replace('fl.oz', 'fl oz')] if m[2] in ML or m[2].replace('.', '') in ML else None

VARIANT = {'ZERO', 'DIET', 'SUGAR', 'FREE', 'LIGHT', 'LITE', 'ULTRA', 'CAFFEINE', 'DECAF', 'MINI', 'SPARKLING', 'STILL', 'ALKALINE', 'VARIETY', 'LOW', 'CARB', 'PLUS', 'MAX', 'LYTE', 'PROTEIN', 'ELITE', 'SPORT', 'UNSWEETENED', 'CHERRY', 'VANILLA', 'LIME', 'LEMON', 'ORANGE', 'GRAPE', 'MANGO', 'PEACH', 'STRAWBERRY', 'RASPBERRY', 'BERRY', 'WATERMELON', 'PINEAPPLE', 'COCONUT', 'TROPICAL', 'PUNCH', 'CHOCOLATE', 'CARAMEL', 'MOCHA', 'GREEN', 'BLUE', 'RED', 'PINK', 'WHITE', 'BLACK', 'APPLE', 'CRANBERRY', 'KIWI', 'LEMONADE', 'TEA', 'GINGER', 'CREAM', 'ROOT', 'BEER'}
def norm_words(s):
    s = s.upper().replace('&', ' ').replace('-', ' ')
    return [w.rstrip('S') if len(w) > 4 else w for w in re.findall(r'[A-Z0-9]+', s)]

out = {}
for p in products:
    if p['group'] == 'Plastic bags': continue
    qq = q[p['id']]
    pool = {}
    for key in (qq['q'], qq['q2']):
        for h in hits.get(key, []):
            pool.setdefault(h['code'], h)
    want = set(norm_words(' '.join(qq['words'])))
    brand_words = set(norm_words(qq['brand'])) - {'SODA', 'WATER'}
    cands = []
    for h in pool.values():
        name = h.get('product_name') or ''
        brands = ' '.join(h.get('brands') or []) if isinstance(h.get('brands'), list) else (h.get('brands') or '')
        hw = set(norm_words(name))
        bw = set(norm_words(brands)) | hw
        brand_ok = bool(brand_words) and brand_words <= bw or (brand_words and len(brand_words & bw) >= max(1, len(brand_words) - 1))
        flav = len(want & hw) / len(want) if want else 1.0
        extra = (hw & VARIANT) - want - brand_words
        hml = qty_ml(h.get('quantity')) or qty_ml(name)
        size = 0
        if p['ml'] and hml:
            r = abs(hml - p['ml']) / p['ml']
            size = 1 if r <= 0.03 else (-0.5 if r <= 0.08 else -2)
        us = 0.5 if 'en:united-states' in (h.get('countries_tags') or []) else 0
        score = (3 if brand_ok else -3) + 4 * flav + size + us - 1.5 * len(extra)
        cands.append({'code': h['code'], 'name': name, 'brands': brands, 'qty': h.get('quantity') or '', 'img': h['image_front_url'],
                      'score': round(score, 2), 'flav': round(flav, 2), 'size': size, 'extra': sorted(extra), 'brand_ok': bool(brand_ok), 'us': bool(us)})
    cands.sort(key=lambda c: -c['score'])
    plausible = [c for c in cands if c['brand_ok'] and c['flav'] >= 0.5 and c['size'] > -2 and not c['extra']]
    out[p['id']] = plausible[:4]
json.dump(out, open(f'{D}/cands.json', 'w'), indent=1)
n_any = sum(1 for v in out.values() if v)
n_good = sum(1 for v in out.values() if v and v[0]['brand_ok'] and v[0]['flav'] >= 0.99 and v[0]['size'] >= 0 and not v[0]['extra'])
print('products', len(out), 'with any candidate', n_any, 'strong top candidate', n_good)
