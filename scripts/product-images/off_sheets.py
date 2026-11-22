"""Download official candidates (KDP Scene7 + brand Shopify stores) and build review sheets:
row = product name | CURRENT picture (if any) | official candidates A/B/C."""
import json, os, re, subprocess, hashlib, concurrent.futures as cf, sys
D = sys.argv[1]; DL = sys.argv[2]; SH = sys.argv[3]; REPO = sys.argv[4]
os.makedirs(DL, exist_ok=True); os.makedirs(SH, exist_ok=True)
products = {p['id']: p for p in json.load(open(f'{D}/../img/products.json'))}
kdpm = json.load(open(f'{D}/kdp_match.json')); kdpi = json.load(open(f'{D}/kdp_images.json'))
shop = json.load(open(f'{D}/shop_match.json'))
src = open(f'{REPO}/src/data/productImages.ts').read()
current = {k: json.loads(v) for k, v in re.findall(r'^  "(p_[^"]+)": (\{.*\}),$', src, re.M)}

cands = {}
for pid, m in kdpm.items():
    for u in m['best'][:1]:
        im = (kdpi.get(u) or {}).get('image')
        if im:
            big = re.sub(r'wid=\d+&hei=\d+', 'wid=900&hei=900', im)
            cands.setdefault(pid, []).append({'src': 'Keurig Dr Pepper Product Facts', 'page': u, 'img': big, 'label': u.rsplit('/', 1)[1][:60]})
for pid, m in shop.items():
    for c in m['cands'][:3]:
        img = c['img'] + ('&' if '?' in c['img'] else '?') + 'width=900'
        cands.setdefault(pid, []).append({'src': c['store'], 'page': f"https://{c['store']}/products/{c['handle']}", 'img': img, 'label': c['text'][:60]})

def key(u): return hashlib.sha1(u.encode()).hexdigest()[:16]
def get(c):
    out = f"{DL}/{key(c['img'])}.img"
    if not os.path.exists(out) or os.path.getsize(out) < 800:
        subprocess.run(['curl', '-s', '-L', '--max-time', '60', '-A', 'Mozilla/5.0 (A2ZOrderPad)', '-o', out, c['img']])
    c['file'] = out
    return c
jobs = [c for v in cands.values() for c in v]
with cf.ThreadPoolExecutor(6) as ex: list(ex.map(get, jobs))

def txt(t, w, h, pt):
    out = f'{SH}/_t_{key(t + str(w))}.png'
    subprocess.run(['convert', '-size', f'{w}x{h}', '-background', 'white', '-fill', 'black', '-font', 'DejaVu-Sans', '-pointsize', str(pt), f'caption:{t}', out], check=True)
    return out
def tile(path, label, out):
    t = f'{out}.tile.png'
    r = subprocess.run(['convert', path + '[0]', '-background', 'white', '-flatten', '-trim', '+repage', '-resize', '160x150', '-gravity', 'center', '-extent', '180x150', t], capture_output=True)
    if r.returncode: subprocess.run(['convert', '-size', '180x150', 'xc:#eee', t])
    subprocess.run(['convert', t, txt(label, 180, 46, 10), '-append', out], check=True)
    return out

order = [pid for pid in products if pid in cands]
index, rows = {}, []
for i, pid in enumerate(order, 1):
    p = products[pid]
    parts = [txt(f'#{i}\n{p["name"]}', 230, 196, 14)]
    cur = current.get(pid)
    curfile = f"{REPO}/public/products/l/{cur['file']}" if cur else None
    parts.append(tile(curfile, f"NOW: {cur['status']}" if cur else 'NOW: none', f'{SH}/_c{i}.png') if curfile else tile('xc:#f4f4f4', 'NOW: none', f'{SH}/_c{i}.png'))
    index[i] = {'id': pid, 'name': p['name'], 'cands': cands[pid][:3]}
    for L, c in zip('ABC', cands[pid][:3]):
        parts.append(tile(c['file'], f"{L}: {c['label']}", f'{SH}/_{i}{L}.png'))
    row = f'{SH}/_row{i}.png'
    subprocess.run(['convert', *parts, '-background', 'white', '+append', '-bordercolor', '#999', '-border', '1', row], check=True)
    rows.append(row)
n = 0
for s in range(0, len(rows), 9):
    n += 1
    subprocess.run(['convert', *rows[s:s + 9], '-append', f'{SH}/off_{n:02d}.png'], check=True)
for f in os.listdir(SH):
    if f.startswith('_'): os.remove(os.path.join(SH, f))
json.dump(index, open(f'{D}/off_index.json', 'w'), indent=1)
print('products', len(order), 'sheets', n)
