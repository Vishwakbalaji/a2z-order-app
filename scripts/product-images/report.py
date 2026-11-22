"""Writes product-images-report.md from src/data/productImages.ts and the exported product list.
usage: python3 scripts/product-images/report.py <products.json> <out.md>"""
import json, re, sys, collections
products = json.load(open(sys.argv[1]))
src = open('src/data/productImages.ts').read()
img = {k: json.loads(v) for k, v in re.findall(r'^  "(p_[^"]+)": (\{.*\}),$', src, re.M)}
c = collections.Counter(e['status'] for e in img.values())
total = len(products)
none = [p for p in products if p['id'] not in img]
acc = c['verified'] + c['approx']
L = ['# Product image report', '',
     '| Metric | Actual result |', '|---|---|',
     f'| Total catalog products | {total} |',
     f'| Verified product images | {c["verified"]} |',
     f'| Accepted approximate images | {c["approx"]} |',
     f'| Images requiring review (not shown until you approve) | {c["review"]} |',
     f'| Images not found | {len(none)} |',
     f'| Overall image coverage (accepted only) | {acc / total * 100:.1f}% |', '',
     'Source: Open Food Facts (CC BY-SA 3.0). Every picture was checked by eye for brand, flavor, packaging and size.',
     '"Verified" = size confirmed (label or listed volume); "approximate" = same product and packaging, size not shown in the photo.', '',
     f'## Needs your review ({c["review"]}) — Settings › Manage Product Images › Needs review', '']
for e in sorted((e for e in img.values() if e['status'] == 'review'), key=lambda e: e['name']):
    L.append(f'- {e["name"]} — {e.get("note", "")}')
L += ['', f'## Accepted approximate ({c["approx"]})', '']
for e in sorted((e for e in img.values() if e['status'] == 'approx'), key=lambda e: e['name']):
    L.append(f'- {e["name"]}' + (f' — {e["note"]}' if e.get('note') else ''))
L += ['', f'## No reliable picture found ({len(none)}) — shown with a placeholder; you can add a photo in the app', '']
by = collections.defaultdict(list)
for p in none: by[p['group']].append(p['name'])
for g in sorted(by, key=str.lower):
    L.append(f'**{g}** ({len(by[g])}): ' + '; '.join(sorted(by[g])))
    L.append('')
open(sys.argv[2], 'w').write('\n'.join(L))
print(dict(c), 'none', len(none))
