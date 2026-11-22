// For each matched kdpproductfacts.com page, record the main product picture (Scene7, 480px request).
const fs = require('fs');
const { chromium } = require('playwright');
const dir = __dirname + '/';
const match = JSON.parse(fs.readFileSync(dir + 'kdp_match.json', 'utf8'));
const outFile = dir + 'kdp_images.json';
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
(async () => {
  const b = await chromium.launch();
  const urls = [...new Set(Object.values(match).flatMap((m) => m.best.slice(0, 1)))].filter((u) => !out[u]);
  let i = 0;
  async function worker() {
    const p = await b.newPage();
    while (i < urls.length) {
      const u = urls[i++];
      const seen = [];
      const onReq = (r) => { const x = r.url(); if (x.includes('scene7.com/is/image/') && /wid=480/.test(x) && !/logo/i.test(x)) seen.push(x); };
      p.on('request', onReq);
      try {
        await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
        for (let t = 0; t < 30 && !seen.length; t++) await p.waitForTimeout(500);
        await p.waitForTimeout(800);
        out[u] = { image: seen[0] || null, title: await p.title() };
      } catch (e) {
        out[u] = { image: null, error: String(e).slice(0, 120) };
      }
      p.off('request', onReq);
      fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
      console.log(Object.keys(out).length, u.split('/').pop(), out[u].image ? 'ok' : 'NO IMAGE');
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  await b.close();
})();
