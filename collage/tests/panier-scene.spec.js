// Ajouter au panier : la mise en scène de l'article choisi (taille, cadre, passe-partout, papier), à
// gauche des options sur ordinateur, au-dessus sur téléphone.
const { test, expect, fixture } = require('./helpers');

async function openCartAdd(page) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto('index.html?mode=impression');
  await page.waitForFunction(() => window.AtelierGribouille);
  await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png'), fixture('page-texture.png')]);
  await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
  await page.evaluate(() => document.getElementById('add-cart').click());
  await expect(page.locator('#cart-add')).toBeVisible();
}
// une empreinte des pixels de la mise en scène (attend qu'elle soit dessinée et stable)
async function sceneSig(page) {
  await page.waitForFunction(() => { const c = document.getElementById('cart-scene'); return c.width > 0 && c.height > 0; });
  await page.waitForTimeout(450);
  return page.evaluate(() => {
    const c = document.getElementById('cart-scene'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0, lit = 0;
    for (let i = 0; i < d.length; i += 16) { h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007; if (d[i + 3] > 0) lit++; }
    return { h, lit, w: c.width, h2: c.height };
  });
}

test.describe('Ajouter au panier : mise en scène', () => {
  test('sur ordinateur, à gauche des options ; elle suit la taille, le cadre, le passe-partout et le papier', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCartAdd(page);
    const sb = await page.locator('#cart-scene').boundingBox(), mb = await page.locator('.cart-add-main').boundingBox();
    expect(sb.x + sb.width).toBeLessThanOrEqual(mb.x + 1);
    const a = await sceneSig(page);
    expect(a.lit).toBeGreaterThan(1000); // (dessinée)
    const seen = [a.h];
    const changed = async (click) => { await page.locator(click).click(); const s = await sceneSig(page); expect(seen).not.toContain(s.h); seen.push(s.h); };
    await page.locator('#cart-add [data-finish="cadre"]').click();
    seen.push((await sceneSig(page)).h);
    await changed('#cart-add [data-size="70x100"]');
    await changed(`#cart-add [data-frame-kind="${(await page.locator('#cart-add [data-frame-kind].on').getAttribute('data-frame-kind')) === 'metal' ? 'bois-noir' : 'metal'}"]`);
    await changed(`#cart-add [data-mat="${(await page.locator('#cart-add [data-mat].on').getAttribute('data-mat')) === '1' ? '0' : '1'}"]`);
    await changed('#cart-add [data-finish="papier"]');
    // le fichier HD : l'œuvre à sa taille, sans cadre
    await page.locator('#cart-add input[value="hd"]').check();
    expect((await sceneSig(page)).lit).toBeGreaterThan(1000);
  });

  test('sur téléphone, au-dessus des options', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await openCartAdd(page);
    const sb = await page.locator('#cart-scene').boundingBox(), tb = await page.locator('#cart-add-title').boundingBox();
    expect(sb.y + sb.height).toBeLessThanOrEqual(tb.y + 1);
    expect(sb.width).toBeGreaterThan(300);
    expect((await sceneSig(page)).lit).toBeGreaterThan(1000);
    await ctx.close();
  });
  test('une impression d’autres proportions : l’œuvre y est mise (sans marge blanche), l’œuvre affichée ne change pas', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCartAdd(page);
    const before = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { W: c.W, H: c.H, x: c.items.map((L) => L.x), w: c.items.map((L) => L.w) }; });
    await page.locator('#cart-add [data-finish="papier"]').click();
    // une taille d'une autre forme que l'œuvre
    const size = await page.evaluate((r) => {
      const sizes = { '21x30': [21, 29.7], '30x40': [30, 40], '40x50': [40, 50], '50x70': [50, 70], '70x100': [70, 100] };
      return Object.keys(sizes).find((k) => { const [a, b] = sizes[k]; const q = r >= 1 ? b / a : a / b; return Math.abs(q - r) > 0.03; });
    }, before.W / before.H);
    await page.locator(`#cart-add [data-size="${size}"]`).click();
    await expect(page.locator('.cart-fit')).toContainText('mise aux proportions de l’impression');
    await page.locator('#cart-add-ok').click();
    await page.waitForFunction(() => document.getElementById('cart-add').hidden || !document.getElementById('cart-add-ok').disabled);
    const it = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /panier/.test(x)); return JSON.parse(localStorage.getItem(k)).slice(-1)[0]; });
    const [a, b] = { '21x30': [21, 29.7], '30x40': [30, 40], '40x50': [40, 50], '50x70': [50, 70], '70x100': [70, 100] }[size];
    const r = before.W >= before.H ? b / a : a / b;
    expect(it.W / it.H).toBeCloseTo(r, 3); // les proportions de l'impression
    expect(it.W * it.H).toBeCloseTo(before.W * before.H, 1); // à surface égale
    // l'œuvre affichée est intacte
    const after = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { W: c.W, H: c.H, x: c.items.map((L) => L.x), w: c.items.map((L) => L.w) }; });
    expect(after).toEqual(before);
  });
});
