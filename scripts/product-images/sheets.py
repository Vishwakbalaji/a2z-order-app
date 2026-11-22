"""Download top candidate images and build contact sheets (one row per product: name + up to 3 candidates).
usage: python3 sheets.py <workdir> <dl_dir> <sheet_dir> [rows_per_sheet]"""
import json, os, subprocess, sys, textwrap, concurrent.futures as cf
D, DL, SH = sys.argv[1], sys.argv[2], sys.argv[3]
ROWS = int(sys.argv[4]) if len(sys.argv) > 4 else 10
os.makedirs(DL, exist_ok=True); os.makedirs(SH, exist_ok=True)
products = {p['id']: p for p in json.load(open(f'{D}/products.json'))}
cands = json.load(open(f'{D}/cands.json'))
order = [p['id'] for p in json.load(open(f'{D}/products.json')) if cands.get(p['id'])]

def fetch(c):
    path = f"{DL}/{c['code']}.jpg"
    if not os.path.exists(path) or os.path.getsize(path) < 500:
        subprocess.run(['curl', '-s', '--max-time', '40', '-A', 'A2ZOrderPad/1.0', '-o', path, c['img']], check=False)
    return path
jobs = [c for pid in order for c in cands[pid][:3]]
with cf.ThreadPoolExecutor(6) as ex:
    list(ex.map(fetch, jobs))

def txt(text, w, h, pt):
    out = f'{SH}/_t_{abs(hash((text, w, h, pt)))}.png'
    subprocess.run(['convert', '-size', f'{w}x{h}', '-background', 'white', '-fill', 'black', '-font', 'DejaVu-Sans', '-pointsize', str(pt), f'caption:{text}', out], check=True)
    return out

index = {}
rows = []
for i, pid in enumerate(order, 1):
    p = products[pid]
    parts = [txt(f'#{i}\n{p["name"]}\n[{p["group"]}]', 250, 180, 15)]
    index[i] = {'id': pid, 'name': p['name'], 'codes': [c['code'] for c in cands[pid][:3]]}
    for L, c in zip('ABC', cands[pid][:3]):
        img = f"{DL}/{c['code']}.jpg"
        tile = f'{SH}/_tile_{c["code"]}.png'
        r = subprocess.run(['convert', img + '[0]', '-resize', '170x130', '-background', 'white', '-gravity', 'center', '-extent', '180x130', tile], capture_output=True)
        if r.returncode != 0:
            subprocess.run(['convert', '-size', '180x130', 'xc:#eee', tile], check=True)
        lab = txt(f'{L}: {c["name"][:42]} | {c["qty"][:16]}', 180, 50, 10)
        col = f'{SH}/_col_{i}_{L}.png'
        subprocess.run(['convert', tile, lab, '-append', col], check=True)
        parts.append(col)
    row = f'{SH}/_row_{i}.png'
    subprocess.run(['convert', *parts, '-background', 'white', '-gravity', 'north', '+append', '-bordercolor', '#999', '-border', '1', row], check=True)
    rows.append(row)
n = 0
for s in range(0, len(rows), ROWS):
    n += 1
    subprocess.run(['convert', *rows[s:s + ROWS], '-append', f'{SH}/sheet_{n:02d}.png'], check=True)
for f in os.listdir(SH):
    if f.startswith('_'): os.remove(os.path.join(SH, f))
json.dump(index, open(f'{D}/sheet_index.json', 'w'), indent=1)
print('products', len(order), 'sheets', n)
