// Collage : l'œuvre attend que la taille des dessins soit vérifiée (au milieu de l'atelier, la liste
// des tailles) ; l'attente est gardée à la réouverture ; vérifiées, les propositions sont refaites.
const { test, expect, fixture } = require('./helpers');

const hasDraft = (page, n) => page.evaluate((n) => new Promise((res) => {
  const r = indexedDB.open('atelier-gribouille');
  r.onsuccess = () => { const db = r.result; try { const g = db.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => { db.close(); res(g.result && g.result.drawings ? g.result.drawings : null); }; g.onerror = () => { db.close(); res(null); }; } catch (e) { db.close(); res(null); } };
  r.onerror = () => res(null);
}), n);

test.describe('Collage : tailles à vérifier', () => {
  test('l’œuvre attend la vérification des tailles, même après un rechargement ; vérifiées, elle s’affiche', async ({ page }) => {
    test.setTimeout(240000);
    // (les tests automatiques passent d'ordinaire l'attente : ici on la veut)
    await page.addInitScript(() => { window.__sizeGate = true; });
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 3 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // l'œuvre attend : au milieu, la liste des tailles (une ligne par feuille)
    const gate = page.locator('#size-gate');
    await expect(gate).toBeVisible();
    const rows = gate.locator('.sizes-row');
    await expect(rows).toHaveCount(2);
    // la première feuille vérifiée (sa taille estimée était juste : on la touche quand même)
    await rows.nth(0).locator('[data-cm="29.7"]').click();
    await expect(rows).toHaveCount(1);
    await expect(gate).toBeVisible();
    // rechargée : l'œuvre attend encore, la feuille vérifiée n'y est plus
    for (let i = 0; i < 60; i++) { const ds = await hasDraft(page); if (ds && ds.length === 3 && ds.filter((d) => d.sizeMode === 'manual').length === 1) break; await page.waitForTimeout(500); }
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.comp && document.getElementById('progress').hidden && AtelierGribouille.state.drawings.length === 3, null, { timeout: 120000 });
    await expect(gate).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.sizes-name')).toContainText('Dessins 2, 3');
    // les actions sur l'œuvre attendent aussi
    const before = await page.evaluate(() => AtelierGribouille.state.comp.items.length);
    await page.evaluate(() => { const S = AtelierGribouille.state; S.selected = S.comp.items[0]; AtelierGribouille.act('del'); });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items.length)).toBe(before);
    // la dernière feuille vérifiée (en A3) : l'œuvre s'affiche, refaite à ces tailles
    await rows.first().locator('[data-cm="42"]').click();
    await expect(gate).toBeHidden();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.map((d) => d.sizeCm))).toEqual(expect.arrayContaining([29.7]));
    await expect(page.locator('#sizes-section #sizes-check')).toHaveCount(1); // (la liste revenue dans Tailles)
    // rechargée : plus d'attente
    for (let i = 0; i < 60; i++) { const ds = await hasDraft(page); if (ds && ds.every((d) => d.sizeMode === 'manual' || (d.sheet && d.sheet.sizeMode === 'manual'))) break; await page.waitForTimeout(500); }
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.comp && document.getElementById('progress').hidden && AtelierGribouille.state.drawings.length === 3, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    await expect(gate).toBeHidden();
  });

  test('tableau imprimé : pas d’attente (les dessins y sont mis à la taille du cadre)', async ({ page }) => {
    await page.addInitScript(() => { window.__sizeGate = true; });
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#size-gate')).toBeHidden();
  });
});
