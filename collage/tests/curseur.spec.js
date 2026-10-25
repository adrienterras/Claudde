// Curseur « Nombre de dessins » : les découpes qu'il retire de l'œuvre passent dans « Non utilisé »
// (avec leur « + »), sans changer de rôle ; le curseur remonté les repose.
const { test, expect, fixture } = require('./helpers');

test.describe('Curseur « Nombre de dessins »', () => {
  test('les dessins retirés par le curseur sont listés sous « Non utilisé » ; « + » en repose un ; le curseur au maximum les repose tous', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png'), fixture('photo-wood.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    const placedIdx = () => page.evaluate(() => { const S = AtelierGribouille.state; return S.drawings.map((d, i) => S.comp.items.some((L) => L.piece.drawing === d) ? i : -1).filter((i) => i >= 0); });
    const groupOf = (k) => page.evaluate((k) => { const el = document.querySelector(`#drawings .thumb[data-i="${k}"]`); return el && el.closest('.drawings-group').classList[1]; }, k);
    // au maximum : tous posés, rien sous « Non utilisé »
    const all = await placedIdx();
    expect(all.length).toBe(4);
    await expect(page.locator('#drawings .drawings-group.off')).toHaveCount(0);
    await expect(page.locator('#drawings .thumb-add')).toHaveCount(0);
    // le curseur au minimum : moins de dessins sur l'œuvre, les autres sous « Non utilisé », chacun avec son « + »
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.min; d.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => document.getElementById('progress').hidden);
    await page.waitForTimeout(300);
    const kept = await placedIdx();
    expect(kept.length).toBeLessThan(4);
    const out = all.filter((i) => !kept.includes(i));
    await expect(page.locator('#drawings .drawings-group.off h3')).toContainText(`Non utilisé (${out.length})`);
    for (const k of out) { expect(await groupOf(k)).toBe('off'); await expect(page.locator(`#drawings .thumb[data-i="${k}"] + .thumb-add`)).toHaveCount(1); }
    for (const k of kept) expect(await groupOf(k)).toBe('cutout');
    // leur rôle n'a pas changé (ce n'est pas un retrait)
    expect(await page.evaluate((out) => out.map((k) => AtelierGribouille.state.drawings[k].role), out)).toEqual(out.map(() => 'auto'));
    // « + » sur l'un : il revient sur l'œuvre, au premier plan ; les autres restent sous « Non utilisé »
    const k = out[0];
    await page.locator(`#drawings .thumb[data-i="${k}"] + .thumb-add`).click();
    expect(await groupOf(k)).toBe('cutout');
    expect((await placedIdx()).includes(k)).toBe(true);
    for (const j of out.slice(1)) expect(await groupOf(j)).toBe('off');
    // le curseur remonté au maximum : tous posés, plus de « Non utilisé »
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => document.getElementById('progress').hidden);
    await page.waitForTimeout(300);
    expect((await placedIdx()).length).toBe(4);
    await expect(page.locator('#drawings .drawings-group.off')).toHaveCount(0);
  });
});
