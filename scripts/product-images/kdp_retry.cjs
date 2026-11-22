// Re-open pages whose main picture is unavailable; keep the first product picture that actually loads (HTTP 200).
const fs = require('fs');
const { chromium } = require('playwright');
const dir = __dirname + '/';
const urls = JSON.parse(fs.readFileSync(dir + 'kdp_retry.json', 'utf8'));
const out = JSON.parse(fs.readFileSync(dir + 'kdp_images.json', 'utf8'));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const u of urls) {
    const ok = [];
    const onRes = (r) => { const x = r.url(); if (x.includes('scene7.com/is/image/') && /wid=480/.test(x) && !/logo/i.test(x) && r.status() === 200) ok.push(x); };
    p.on('response', onRes);
    await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    for (let t = 0; t < 30 && !ok.length; t++) await p.waitForTimeout(500);
    await p.waitForTimeout(1500);
    p.off('response', onRes);
    out[u] = { ...(out[u] || {}), image: ok[0] || null, alternates: ok.slice(0, 4) };
    console.log(u.split('/').pop(), ok.length ? ok[0].split('/').pop().slice(0, 90) : 'NONE');
  }
  fs.writeFileSync(dir + 'kdp_images.json', JSON.stringify(out, null, 1));
  await b.close();
})();
