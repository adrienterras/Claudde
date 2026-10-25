// Tableau imprimé sur papier (poster seul) : avec ou sans marge blanche de 3 cm autour de l'œuvre,
// dans la mise en scène comme à la commande ; le même choix des deux côtés, mémorisé.
const { test, expect, fixture } = require('./helpers');

async function start(page) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto('index.html?mode=impression');
  await page.waitForFunction(() => window.AtelierGribouille);
  await page.setInputFiles('#file', [fixture('page-cutout.png')]);
  await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
}
// une empreinte des pixels d'un canevas (attend qu'il soit dessiné et stable)
async function sig(page, id) {
  await page.waitForFunction((id) => { const c = document.getElementById(id); return c.width > 0 && c.height > 0; }, id);
  await page.waitForTimeout(450);
  return page.evaluate((id) => {
    const c = document.getElementById(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007;
    return h;
  }, id);
}

test.describe('Poster : marge blanche', () => {
  test('mise en scène : Papier montre le poster seul, avec ou sans marge de 3 cm ; la commande reprend le choix', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await start(page);
    const { W, H } = await page.evaluate(() => AtelierGribouille.state.comp);
    const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('fr');
    await page.locator('#scene-open').click();
    await expect(page.locator('#scene-modal')).toBeVisible();
    // encadré par défaut : la finition se choisit en premier, après la pièce ; la marge n'apparaît qu'en papier
    await expect(page.locator('#scene-finish [data-finish="cadre"]')).toHaveClass(/on/);
    await expect(page.locator('#scene-margin-field')).toBeHidden();
    await expect(page.locator('#scene-frame-pick')).toBeVisible();
    const framedSig = await sig(page, 'scene-canvas');
    // papier : plus de cadre ni de passe-partout ; le poster a la taille d'impression du format
    await page.locator('#scene-finish [data-finish="papier"]').click();
    await expect(page.locator('#scene-frame-pick')).toBeHidden();
    await expect(page.locator('#scene-mat-field')).toBeHidden();
    await expect(page.locator('#scene-margin-field')).toBeVisible();
    await expect(page.locator('#scene-margin [data-margin="0"]')).toHaveClass(/on/);
    await expect(page.locator('#scene-size-info')).toHaveText(`Affiche de ${fmt(W)} × ${fmt(H)} cm, sans cadre.`);
    await expect(page.locator('#scene-info')).toHaveText(new RegExp(`^Affiche de ${fmt(W)} × ${fmt(H)} cm, sans cadre, au-dessus`));
    const paperSig = await sig(page, 'scene-canvas');
    expect(paperSig).not.toBe(framedSig);
    // avec marge : l'œuvre réduite d'un même facteur dans le poster, 3 cm de blanc autour
    await page.locator('#scene-margin [data-margin="1"]').click();
    const a = Math.min((W - 6) / W, (H - 6) / H);
    await expect(page.locator('#scene-info')).toHaveText(new RegExp(`^Affiche de ${fmt(W)} × ${fmt(H)} cm avec une marge blanche de 3 cm : l’œuvre imprimée en ${fmt(W * a)} × ${fmt(H * a)} cm, au-dessus`));
    expect(await sig(page, 'scene-canvas')).not.toBe(paperSig);
    expect(await page.evaluate(() => [localStorage.getItem('atelier.finition'), localStorage.getItem('atelier.marge')])).toEqual(['papier', '1']);
    // la commande reprend papier + marge, et le texte le dit
    await page.locator('#scene-order').click();
    await expect(page.locator('#cart-add')).toBeVisible();
    await expect(page.locator('#cart-add [data-finish="papier"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add .cart-margin-field')).toBeVisible();
    await expect(page.locator('#cart-add [data-margin="1"]')).toHaveClass(/on/);
    await expect(page.locator('#cart-add .cart-dims')).toContainText('avec une marge blanche de 3 cm');
    await expect(page.locator('#cart-add .cart-dims')).toContainText('l’œuvre imprimée en');
    // encadré : la marge disparaît, le passe-partout revient
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await expect(page.locator('#cart-add .cart-margin-field')).toBeHidden();
    await expect(page.locator('#cart-add .cart-mat-field')).toBeVisible();
    await page.locator('#cart-add [data-finish="papier"]').click();
    // « sans marge » : le texte redevient « sans cadre », et la mise en scène change
    const withSig = await sig(page, 'cart-scene');
    await page.locator('#cart-add [data-margin="0"]').click();
    await expect(page.locator('#cart-add .cart-dims')).not.toContainText('marge');
    expect(await sig(page, 'cart-scene')).not.toBe(withSig);
    await page.locator('#cart-add [data-margin="1"]').click();
    // l'article garde la marge ; le panier la dit
    await page.locator('#cart-add-ok').click();
    await page.waitForFunction(() => document.getElementById('cart-add').hidden || !document.getElementById('cart-add-ok').disabled);
    const it = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /panier/.test(x)); return JSON.parse(localStorage.getItem(k)).slice(-1)[0]; });
    expect(it.finish).toBe('papier');
    expect(it.margin).toBe(true);
    expect(it.frame).toBeUndefined();
    await page.evaluate(() => document.getElementById('cart-add-view').click());
    await expect(page.locator('#cart')).toContainText('avec une marge blanche de 3 cm');
  });

  test('un article encadré n’a pas de marge ; le choix « sans » est mémorisé', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await start(page);
    await page.evaluate(() => { localStorage.setItem('atelier.finition', 'papier'); localStorage.setItem('atelier.marge', '1'); });
    await page.evaluate(() => document.getElementById('add-cart').click());
    await expect(page.locator('#cart-add')).toBeVisible();
    await expect(page.locator('#cart-add [data-margin="1"]')).toHaveClass(/on/);
    await page.locator('#cart-add [data-margin="0"]').click();
    expect(await page.evaluate(() => localStorage.getItem('atelier.marge'))).toBe('0');
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await page.locator('#cart-add-ok').click();
    await page.waitForFunction(() => document.getElementById('cart-add').hidden || !document.getElementById('cart-add-ok').disabled);
    const it = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /panier/.test(x)); return JSON.parse(localStorage.getItem(k)).slice(-1)[0]; });
    expect(it.finish).toBe('cadre');
    expect(it.margin).toBeUndefined();
    // la mise en scène rouverte : encadré, comme choisi à la commande
    await page.evaluate(() => document.querySelectorAll('.account-modal:not([hidden]) [data-close]').forEach((b) => b.click()));
    await page.evaluate(() => document.getElementById('scene-open').click());
    await expect(page.locator('#scene-modal')).toBeVisible();
    await expect(page.locator('#scene-finish [data-finish="cadre"]')).toHaveClass(/on/);
  });
});
