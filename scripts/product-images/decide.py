"""Turn review notes into decisions.json.
Notes file lines:  <row#> <A|B|C> <v|a|r> [confidence] [note...]     (rows not listed = no picture)
v = verified (brand, flavor, packaging and size confirmed), a = accepted approximate (size not confirmed /
small presentation difference), r = needs review (plausible, not shown until the owner approves).
usage: python3 decide.py <workdir> <notes.txt> <sheet_index.json>   → appends/updates <workdir>/decisions.json"""
import json, sys, os
D, notes, idxf = sys.argv[1:4]
idx = json.load(open(idxf))
cands = json.load(open(f'{D}/cands.json'))
out_f = f'{D}/decisions.json'
dec = {d['id']: d for d in (json.load(open(out_f)) if os.path.exists(out_f) else [])}
DEF = {'v': 98, 'a': 95, 'r': 91}
ST = {'v': 'verified', 'a': 'approx', 'r': 'review'}
n = 0
for line in open(notes):
    line = line.strip()
    if not line or line.startswith('#'): continue
    parts = line.split()
    row, letter, s = parts[0], parts[1].upper(), parts[2]
    rest = parts[3:]
    conf = int(rest[0]) if rest and rest[0].isdigit() else DEF[s]
    note = ' '.join(rest[1:] if rest and rest[0].isdigit() else rest)
    e = idx[row]
    if len(letter) > 1:  # e.g. "261A": candidate A of row 261 (same product photographed in another row)
        src = idx[letter[:-1]]
        code = src['codes']['ABC'.index(letter[-1])]
        c = next(c for c in cands[src['id']] if c['code'] == code)
    else:
        code = e['codes']['ABC'.index(letter)]
        c = next(c for c in cands[e['id']] if c['code'] == code)
    dec[e['id']] = {'id': e['id'], 'name': e['name'], 'code': code, 'img': c['img'], 'status': ST[s], 'confidence': conf, **({'note': note} if note else {})}
    n += 1
json.dump(list(dec.values()), open(out_f, 'w'), indent=1)
print('recorded', n, 'total decisions', len(dec))
