"""Merge reviewed official brand photos into decisions.json (an official photo replaces the earlier one for that product).
usage: python3 merge_official.py <off_index.json> <official-notes.txt> <offdl dir> <decisions.json>"""
import json, sys, hashlib
idxf, notes, dl, decf = sys.argv[1:5]
idx = json.load(open(idxf))
dec = {d['id']: d for d in json.load(open(decf))}
ST = {'v': 'verified', 'a': 'approx', 'r': 'review'}
CREDIT = {
    'Keurig Dr Pepper Product Facts': ('© Keurig Dr Pepper (kdpproductfacts.com)', 'Official brand product image'),
    'www.alaninu.com': ('© Alani Nu (alaninu.com)', 'Official brand product image'),
    'www.drinkarizona.com': ('© AriZona Beverages (drinkarizona.com)', 'Official brand product image'),
    'www.cellucor.com': ('© Cellucor / C4 (cellucor.com)', 'Official brand product image'),
}
n = 0
for line in open(notes):
    line = line.strip()
    if not line or line.startswith('#'): continue
    parts = line.split()
    row, letter, s = parts[0], parts[1].upper(), parts[2]
    rest = parts[3:]
    conf = int(rest[0]) if rest and rest[0].isdigit() else {'v': 98, 'a': 95, 'r': 91}[s]
    note = ' '.join(rest[1:] if rest and rest[0].isdigit() else rest)
    e = idx[row]
    c = e['cands']['ABC'.index(letter)]
    credit, lic = CREDIT[c['src']]
    dec[e['id']] = {
        'id': e['id'], 'name': e['name'], 'file': f"{dl}/{hashlib.sha1(c['img'].encode()).hexdigest()[:16]}.img",
        'status': ST[s], 'confidence': conf, 'official': True,
        'source': c['src'].replace('www.', '') if c['src'].startswith('www.') else c['src'], 'sourceUrl': c['page'], 'credit': credit, 'license': lic,
        **({'note': note} if note else {}),
    }
    n += 1
json.dump(list(dec.values()), open(decf, 'w'), indent=1)
print('official photos', n, '· total pictures', len(dec), '· official in total', sum(1 for d in dec.values() if d.get('official')))
