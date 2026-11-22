"""Official Shopify brand stores → candidate product pictures per catalog product (brand + flavor + size words)."""
import json, glob, re, sys
D = sys.argv[1]
products = json.load(open(f'{D}/../img/products.json'))
STORES = {'Alani': 'www.alaninu.com', 'Ghost': 'www.ghostlifestyle.com', 'Arizona': 'www.drinkarizona.com', 'C4': 'www.cellucor.com'}
FIX = {'VANILA': 'VANILLA', 'HAWAIAN': 'HAWAIIAN', 'COTTAN': 'COTTON', 'SPTK': 'SOUR', 'GRREN': 'GREEN', 'TALLBOY': 'TALL', 'ENE': 'ENERGY'}
SKIP = {'CT', 'PK', 'P', 'C', 'CAN', 'CANS', 'OZ', 'FL', 'GL', 'ULT', 'TEA', 'JUICE', 'ICE', 'ENERGY'}

def entries(store):
    prods = {}
    for f in glob.glob(f'{D}/shop_{store}_*.json'):
        try:
            for p in json.load(open(f)).get('products', []): prods[p['id']] = p
        except Exception: pass
    out = []
    for p in prods.values():
        imgs = {i['id']: i for i in p.get('images', [])}
        first = p['images'][0]['src'] if p.get('images') else None
        for v in p.get('variants', []):
            im = (v.get('featured_image') or {}).get('src')
            if not im:
                im = next((i['src'] for i in p.get('images', []) if v['id'] in i.get('variant_ids', [])), first)
            if im: out.append({'text': f"{p['title']} {v.get('title', '')}", 'img': im, 'handle': p['handle'], 'store': store})
        if not p.get('variants') and first: out.append({'text': p['title'], 'img': first, 'handle': p['handle'], 'store': store})
    return out

res = {}
for brand, store in STORES.items():
    E = entries(store)
    for p in products:
        if p['group'] != brand: continue
        words = [FIX.get(w, w) for w in re.findall(r'[A-Z0-9]+', p['name'].upper())]
        flav = [w.lower() for w in words if w not in SKIP and not re.match(r'^\d', w) and w.lower() != brand.lower()]
        size = None
        m = re.search(r'(\d+)\s?O', p['name'].upper())
        if m: size = m.group(1)
        cands = []
        for e in E:
            t = e['text'].lower()
            tw = set(re.findall(r'[a-z0-9]+', t))
            if any(k in t for k in ('pre-workout', 'pre workout', 'powder', 'stick', 'stix', 'hoodie', 'shirt', 'hat', 'pillow', 'blanket', 'hard ', 'zero', 'ornament', 'sleeve', 'lite ', 'bundle item', 'variety', 'sampler', 'mix', 'creatine', 'protein', 'greens', 'bcaa', 'enhancer', 'tumbler', 'skateboard')) and not ('zero' in flav):
                continue
            hit = sum(1 for f in flav if f in tw or f.rstrip('s') in tw)
            if not hit and flav: continue
            sz_ok = 1 if size and re.search(rf'\b{size}\s?oz', t) else 0
            cands.append((hit + sz_ok, e))
        cands.sort(key=lambda x: -x[0])
        uniq, seen = [], set()
        for sc, e in cands:
            if e['img'] in seen: continue
            seen.add(e['img']); uniq.append({**e, 'score': sc})
        if uniq: res[p['id']] = {'name': p['name'], 'cands': uniq[:3]}
json.dump(res, open(f'{D}/shop_match.json', 'w'), indent=1)
print('products with official store candidates', len(res))
for v in res.values(): print(v['name'][:38].ljust(38), '->', v['cands'][0]['text'][:60])
