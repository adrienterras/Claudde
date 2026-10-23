// Accessibilité au clavier : l'œuvre (choisir, déplacer, tourner, retoucher, retirer un dessin), les
// vignettes des dessins et des pièces, et les fenêtres (focus gardé dedans, rendu à la fermeture).
const { test, expect } = require('./helpers');

test.describe('Clavier', () => {
  test('l’œuvre se prend avec Tab ; Page suivante choisit un dessin (annoncé), flèches, R, Entrée, Suppr ; Retour arrière ailleurs ne supprime rien', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    expect(await page.evaluate(() => [document.getElementById('canvas').tabIndex, document.getElementById('canvas').getAttribute('role')])).toEqual([0, 'application']);
    await page.focus('#canvas');
    const sel = () => page.evaluate(() => { const L = AtelierGribouille.state.selected; return L ? { x: L.x, y: L.y, rot: L.rot, kind: L.kind } : null; });
    expect(await sel()).toBeNull();
    await page.keyboard.press('PageDown');
    const a = await sel();
    expect(a).not.toBeNull();
    await expect(page.locator('[aria-live="polite"]').last()).toContainText(/1 sur \d+/);
    // déplacer : 0,5 cm, puis 2 cm avec Maj
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const b = await sel();
    expect(b.x - a.x).toBeCloseTo(0.5, 5);
    expect(b.y - a.y).toBeCloseTo(2, 5);
    // tourner de 5°
    await page.keyboard.press('r');
    expect((await sel()).rot - b.rot).toBeCloseTo((5 * Math.PI) / 180, 5);
    // Ctrl+Z défait la rotation
    await page.keyboard.press('Control+z');
    expect((await page.evaluate(() => AtelierGribouille.state.comp.items.map((L) => L.rot)))).toContain(b.rot);
    // (Défaire désélectionne) : Page suivante reprend le premier dessin, puis Entrée : la retouche de sa
    // découpe s'ouvre ; Échap la ferme
    await page.focus('#canvas');
    await page.keyboard.press('PageDown');
    expect(await page.evaluate(() => AtelierGribouille.state.selected && AtelierGribouille.state.selected.kind)).toBe('piece');
    await page.keyboard.press('Enter');
    await expect(page.locator('#editor')).toBeVisible();
    // (Tab reste dans la fenêtre de retouche)
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement.closest('#editor'))).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toBeHidden();
    // Retour arrière, le focus ailleurs que sur l'œuvre : rien n'est retiré
    const n = await page.evaluate(() => AtelierGribouille.state.comp.items.length);
    await page.evaluate(() => { const A = AtelierGribouille; A.state.selected = A.state.comp.items[0]; });
    await page.focus('#generate');
    await page.keyboard.press('Backspace');
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items.length)).toBe(n);
    // sur l'œuvre, Suppr retire le dessin choisi
    await page.focus('#canvas');
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items.length)).toBe(n - 1);
  });

  test('vignettes : un dessin s’ouvre avec Entrée, une pièce se retire et se remet avec Espace', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    await page.evaluate(() => { const s = document.getElementById('drawings-section'); if (s.classList.contains('collapsed')) s.querySelector(':scope > h2').click(); });
    const t = page.locator('#drawings .thumb').first();
    await expect(t).toHaveAttribute('role', 'button');
    await t.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('#drawings .thumb').first()).toHaveAttribute('aria-pressed', 'true');
    const hit = () => page.locator('#pieces .thumb-hit').first();
    await expect(hit()).toHaveAttribute('aria-pressed', 'true');
    await hit().focus();
    await page.keyboard.press(' ');
    await expect(hit()).toHaveAttribute('aria-pressed', 'false');
    await hit().focus();
    await page.keyboard.press(' ');
    await expect(hit()).toHaveAttribute('aria-pressed', 'true');
  });

  test('fenêtres : le focus y entre, Tab reste dedans, Échap ferme et le focus revient au bouton d’origine', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=impression');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png'].map(require('./helpers').fixture));
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    for (const [opener, dialog] of [['.order-cta-desk', '#cart-add'], ['#scene-open', '#scene-modal']]) {
      await page.focus(opener);
      await page.keyboard.press('Enter');
      await expect(page.locator(dialog)).toBeVisible();
      await page.waitForTimeout(300);
      const inside = [];
      for (let i = 0; i < 30; i++) { await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab'); inside.push(await page.evaluate((d) => !!document.activeElement.closest(d), dialog)); }
      expect(inside.every(Boolean)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator(dialog)).toBeHidden();
      expect(await page.evaluate((o) => document.activeElement === document.querySelector(o), opener)).toBe(true);
    }
  });
  test('aide des raccourcis : la touche ? ou le lien du carnet l’ouvrent ; Échap la ferme', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png']);
    await page.focus('#canvas');
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts')).toBeVisible();
    await expect(page.locator('#shortcuts')).toContainText('Page suivante'.slice(0, 0) + 'Choisir un dessin');
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcuts')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement.id)).toBe('canvas'); // (le focus revient sur l'œuvre)
    await page.locator('#shortcuts-open').click();
    await expect(page.locator('#shortcuts')).toBeVisible();
    await page.locator('#shortcuts [data-close]').click();
    await expect(page.locator('#shortcuts')).toBeHidden();
  });

  test('structure : titres de section, fiches de Mes œuvres et vignettes sans bouton dans un bouton', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    const r = await page.evaluate(() => ({
      h2role: [...document.querySelectorAll('aside section.step > h2')].filter((h) => h.getAttribute('role')).length,
      toggles: document.querySelectorAll('aside section.step > h2 > button.step-toggle[aria-expanded]').length,
      nested: [...document.querySelectorAll('button, [role="button"]')].filter((b) => b.parentElement && b.parentElement.closest('button, [role="button"]')).length,
      groups: document.querySelectorAll('.drawings-group > h3').length,
      h4: document.querySelectorAll('.drawings-group > h4').length,
    }));
    expect(r).toMatchObject({ h2role: 0, nested: 0, h4: 0 });
    expect(r.toggles).toBeGreaterThan(3);
    expect(r.groups).toBeGreaterThan(0);
    // un titre se replie et se déplie au clavier (son bouton)
    const t = page.locator('#export-section > h2 > .step-toggle');
    const before = await t.getAttribute('aria-expanded');
    await t.focus();
    await page.keyboard.press('Enter');
    await expect(t).not.toHaveAttribute('aria-expanded', before);
  });
});
