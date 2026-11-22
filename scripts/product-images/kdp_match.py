"""Match catalog products of Keurig Dr Pepper brands to kdpproductfacts.com product URLs (by slug words + size)."""
import json, re, sys
D = sys.argv[1]
products = json.load(open(f'{D}/../img/products.json'))
urls = re.findall(r'<loc>([^<]*)</loc>', open(f'{D}/kdp-products.xml').read())
slugs = [(u, u.rsplit('/', 1)[1]) for u in urls if u.endswith('-us')]

BRAND = {'Dr Pepper': ['dr', 'pepper'], '7UP': ['7up'], 'AW': ['aw'], 'Canada Dry': ['canada', 'dry'], 'Sunkist': ['sunkist'], 'Crush': ['crush'],
         'Snapple': ['snapple'], 'Schweeps': ['schweppes'], 'BAI': ['bai'], 'Core Water': ['core'], 'Yoo - Hoo': ['yoo', 'hoo']}
FIX = {'VANILA': 'VANILLA', 'RASBERRY': 'RASPBERRY', 'STARWBERRY': 'STRAWBERRY', 'STRAWBEERY': 'STRAWBERRY', 'LMND': 'LEMONADE', 'COCO': 'COCONUT',
       'BRASILIA': 'BRASILIA', 'GLS': 'GLASS', 'SODA': ''}
NOISE = {'CT', 'PK', 'PACK', 'CAN', 'CANS', 'GLASS', 'GL', 'OZ', 'FL', 'BOTTLE', 'SODA', 'WATER', 'DIET', 'ZERO', 'CLUB', 'TONIC', 'GINGER', 'ALE'}
KEEP = {'DIET', 'ZERO', 'CLUB', 'TONIC', 'GINGER', 'ALE', 'CREAM', 'SPORTS', 'SPORT'}

def size_tokens(p):
    if p['ml'] is None: return None
    oz = p['ml'] / 29.5735
    t = []
    if abs(p['ml'] - 2000) < 30: t.append('2-liter')
    if abs(p['ml'] - 1000) < 15: t += ['1-liter', '338-fl-oz']
    if abs(p['ml'] - 500) < 8 or abs(oz - 16.9) < 0.1: t.append('169-fl-oz')
    for v in (8, 10, 11.5, 12, 15.5, 16, 18, 20, 23.7, 24, 28, 32):
        if abs(oz - v) < 0.15: t.append(f"{str(v).replace('.', '')}-fl-oz")
    if abs(p['ml'] - 700) < 10: t += ['237-fl-oz', '700-ml']
    return t

out = {}
for p in products:
    if p['group'] not in BRAND: continue
    words = [FIX.get(w, w) for w in re.findall(r'[A-Z0-9&+]+', p['name'].upper())]
    flavor = [w.lower() for w in words if w and not re.match(r'^\d', w) and w.lower() not in BRAND[p['group']] and (w not in NOISE or w in KEEP)
              and w not in ('ARMOUR', 'D&G', 'AND', 'W', 'CAN', 'MEXICO')]
    if not [f for f in flavor if f not in ('diet', 'zero')]:
        flavor += {'Sunkist': ['orange'], '7UP': ['limelemon'], 'Crush': ['orange'], 'AW': ['root', 'beer'], 'Canada Dry': [] if {'club', 'tonic'} & set(flavor) else ['ginger', 'ale'], 'Schweeps': ['ginger', 'ale']}.get(p['group'], [])
    sz = size_tokens(p)
    cands = []
    for u, s in slugs:
        if not all(b in s.split('-') for b in BRAND[p['group']]): continue
        if sz is not None and not any(f'-{t}-' in f'-{s}-' for t in sz): continue
        sw = set(s.split('-'))
        hit = sum(1 for f in flavor if f in sw or f.rstrip('s') in sw)
        extra = len({'diet', 'zero', 'sugar', 'cherry', 'vanilla', 'cream', 'strawberry', 'blackberry', 'caffeine', 'free', 'fountain', 'mexico', 'mini', 'light', 'lite'} & sw - set(flavor) - {'sugar'} - ({'sugar'} if 'zero' in flavor else set()))
        if 'zero' in sw and 'zero' not in flavor and 'diet' not in flavor: extra += 1
        if 'fountain' in sw or 'syrup' in sw or 'bag' in sw or 'k-cup' in s: extra += 3
        if 'made-in-mexico' in s and 'MEXICO' not in p['name']: extra += 2
        GENERIC = {'flavored', 'soda', 'us', 'fl', 'oz', 'liter', 'juice', 'drink', 'tea', 'infusion', 'wonderwater', 'antioxidant', 'beverage', 'water', 'the', 'original', 'and', 'n'} | set(BRAND[p['group']])
        other = [w for w in sw if w not in GENERIC and not re.match(r'^\d', w) and w not in flavor and w.rstrip('s') not in flavor]
        score = 3 * hit - 2 * extra - len(other)
        cands.append((score, hit, u, s))
    cands.sort(reverse=True)
    good = [c for c in cands if c[1] == len(flavor)]
    out[p['id']] = {'name': p['name'], 'flavor': flavor, 'size': sz, 'best': [c[2] for c in (good or cands)[:3]], 'complete': bool(good)}
json.dump(out, open(f'{D}/kdp_match.json', 'w'), indent=1)
n = len(out); full = sum(1 for v in out.values() if v['complete'] and v['best'])
print('KDP-brand products', n, 'with a full-flavor+size page', full)
for v in list(out.values()):
    print(('OK ' if v['complete'] else '-- ') + v['name'][:36].ljust(36), '->', (v['best'][0].rsplit('/', 1)[1] if v['best'] else 'NONE'))
