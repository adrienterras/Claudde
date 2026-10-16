const { test } = require('@playwright/test');
const SP = '/tmp/claude-0/-home-user-Claudde/fd5a9eba-ddcd-5192-9cb7-f1a52e5dc32f/scratchpad';
for (const mode of ['toile', 'impression']) test('t ' + mode, async ({ page }) => {
  test.setTimeout(600000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = {};" }));
  await page.goto('index.html?mode=' + mode);
  await page.waitForFunction(() => window.AtelierGribouille);
  const files = Array.from({ length: 20 }, (_, i) => `${SP}/ex3/pages/q${String(i + 1).padStart(2, '0')}.jpg`);
  await page.setInputFiles('#file', files);
  await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden && AtelierGribouille.state.drawings.length >= 20, null, { timeout: 500000 });
  for (const orient of ['land', 'port']) {
    await page.locator(`#canvas-orient [data-orient="${orient}"]`).evaluate((b) => b.click());
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => AtelierGribouille.state.proposals.map((p, i) => { AtelierGribouille.selectProposal(i); return null; }));
    for (let i = 0; i < 7; i++) {
      await page.evaluate((i) => AtelierGribouille.selectProposal(i), i);
      await page.waitForTimeout(300);
      console.log(mode, orient, JSON.stringify(await page.evaluate(() => [AtelierGribouille.state.comp.style, document.getElementById('density-note').textContent, document.getElementById('format').value, AtelierGribouille.state.comp.W, AtelierGribouille.state.comp.H, AtelierGribouille.state.drawings.map((d) => d.role === 'auto' ? d.auto : d.role).join('')])));
    }
  }
});
