const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8091/');
  await page.waitForSelector('#searchTerm:not([disabled])', { timeout: 120000 });
  await page.click('.lang-btn[data-lang="lv"]');
  await page.waitForTimeout(500);
  const btn = await page.locator('.combo-btn-1').first();
  await btn.scrollIntoViewIfNeeded();
  const buf = await btn.screenshot({ padding: 8 });
  const p1 = 'C:/Users/gurud/OneDrive/Dators/Claude code testi/CA-Web/docs/user-guide/lv/images/combo-by-2026.png';
  const p2 = 'C:/Users/gurud/OneDrive/Dators/Claude code testi/CA-Web/deploy/guide/lv/images/combo-by-2026.png';
  fs.writeFileSync(p1, buf);
  fs.writeFileSync(p2, buf);
  console.log('wrote', buf.length, 'bytes to both locations');
  await browser.close();
})();
