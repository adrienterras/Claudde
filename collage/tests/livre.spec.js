// Le livre de dessins (dossier livre/, publié sous /livre/) : import, mise en page, réglages,
// brouillon, export PDF et traduction anglaise.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { fixture } = require('./helpers');

async function open(page, query) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource/.test(m.text())) errors.push(`console : ${m.text()}`); });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto(`livre/${query || ''}`);
  await page.waitForFunction(() => window.LivreGribouille);
  return errors;
}
const waitDrawings = (page, n) => page.waitForFunction((n) => LivreGribouille.state.drawings.length >= n && document.getElementById('progress').hidden, n, { timeout: 120000 });
const pagesCount = (page) => page.evaluate(() => LivreGribouille.bookPages().length);

test.describe('Livre de dessins', () => {
  test('les scans deviennent un livre : couverture, pages, 4e de couverture, nombre de pages pair', async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('#book-section')).toBeHidden();
    // deux images et un PDF de deux pages : quatre dessins
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png'), fixture('two-pages.pdf')]);
    await waitDrawings(page, 4);
    expect(await page.evaluate(() => LivreGribouille.state.drawings.length)).toBe(4);
    await expect(page.locator('#empty')).toBeHidden();
    await expect(page.locator('#book-section')).toBeVisible();
    await expect(page.locator('#list .item')).toHaveCount(4);
    // un dessin par page : couverture + 4 pages + page blanche + 4e = 7 → 8 (toujours pair)
    const kinds = await page.evaluate(() => LivreGribouille.bookPages().map((p) => p.kind));
    expect(kinds[0]).toBe('cover');
    expect(kinds[kinds.length - 1]).toBe('back');
    expect(kinds.length % 2).toBe(0);
    expect(kinds.filter((k) => k === 'drawings')).toHaveLength(4);
    // deux puis quatre dessins par page
    await page.locator('#layout [data-n="2"]').click();
    expect(await page.evaluate(() => LivreGribouille.bookPages().filter((p) => p.kind === 'drawings').length)).toBe(2);
    await page.locator('#layout [data-n="4"]').click();
    expect(await page.evaluate(() => LivreGribouille.bookPages().filter((p) => p.kind === 'drawings').length)).toBe(1);
    expect((await pagesCount(page)) % 2).toBe(0);
    // l'aperçu montre une double page par paire, la couverture et la 4e seules
    const spreads = await page.locator('#spreads .spread').count();
    expect(spreads).toBe((await pagesCount(page)) / 2 + 1);
    // chaque image reste dans sa page
    const inside = await page.evaluate(() => {
      const st = LivreGribouille.state;
      const F = { a4p: [21, 29.7], a4l: [29.7, 21], sq21: [21, 21], sq30: [30, 30] }[st.settings.format];
      return LivreGribouille.bookPages().every((p, i, all) => LivreGribouille.layoutPage(p, i, all.length).every((e) => e.t !== 'image' || (e.x >= 0 && e.y >= 0 && e.x + e.w <= F[0] + 1e-6 && e.y + e.h <= F[1] + 1e-6)));
    });
    expect(inside).toBe(true);
    expect(errors).toEqual([]);
  });

  test('titre, légendes, ordre, couverture et rotation', async ({ page }) => {
    const errors = await open(page);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png'), fixture('page-texture.png')]);
    await waitDrawings(page, 3);
    await page.fill('#title', 'Les dessins de Camille');
    await page.fill('#subtitle', '2024 – 2026');
    const first = page.locator('#list .item').first();
    await first.locator('[data-f="caption"]').fill('Le grand soleil');
    await first.locator('[data-f="date"]').fill('5 ans');
    await page.waitForTimeout(300);
    // l'aperçu reprend titre et légendes
    const texts = await page.locator('#spreads svg text').allTextContents();
    expect(texts).toContain('Les dessins de Camille');
    expect(texts).toContain('2024 – 2026');
    expect(texts).toContain('Le grand soleil');
    expect(texts).toContain('5 ans');
    // sans légendes, plus de texte sous les dessins
    await page.locator('label:has(#captions)').click();
    await page.waitForTimeout(200);
    expect(await page.locator('#spreads svg text').allTextContents()).not.toContain('Le grand soleil');
    await page.locator('label:has(#captions)').click();
    // descendre le premier dessin
    const ids0 = await page.evaluate(() => LivreGribouille.state.drawings.map((d) => d.id));
    await page.locator('#list .item').first().locator('[data-a="down"]').click();
    expect(await page.evaluate(() => LivreGribouille.state.drawings.map((d) => d.id))).toEqual([ids0[1], ids0[0], ids0[2]]);
    // l'étoile choisit le dessin de couverture
    await page.locator('#list .item').nth(2).locator('[data-a="cover"]').click();
    const cover = await page.evaluate(() => { const p = LivreGribouille.bookPages()[0]; return LivreGribouille.layoutPage(p, 0, 1).find((e) => e.t === 'image').d.id; });
    expect(cover).toBe(ids0[2]);
    await expect(page.locator('#list .item').nth(2).locator('.cover')).toBeVisible();
    // un quart de tour échange largeur et hauteur
    const [w, h] = await page.evaluate(() => [LivreGribouille.state.drawings[0].w, LivreGribouille.state.drawings[0].h]);
    await page.locator('#list .item').first().locator('[data-a="rotate"]').click();
    await page.waitForFunction(([w, h]) => LivreGribouille.state.drawings[0].w === h && LivreGribouille.state.drawings[0].h === w, [w, h]);
    // retirer un dessin
    await page.locator('#list .item').last().locator('[data-a="del"]').click();
    await expect(page.locator('#list .item')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('le PDF a une page par page du livre, au format choisi, fond perdu compris', async ({ page }) => {
    const errors = await open(page);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png'), fixture('scan-300dpi.jpg')]);
    await waitDrawings(page, 3);
    await page.selectOption('#format', 'sq21');
    await page.locator('label:has(#bleed)').click();
    await expect(page.locator('#export-info')).toContainText('21,6 × 21,6');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#export').click()]);
    const file = await dl.path();
    const pdf = fs.readFileSync(file).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    const pages = (pdf.match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBe(await pagesCount(page));
    // 21,6 cm = 612,28 points
    const box = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(Math.abs(Number(box[1]) - 612.28)).toBeLessThan(0.5);
    expect(Math.abs(Number(box[2]) - 612.28)).toBeLessThan(0.5);
    await expect(page.locator('#export-status')).toContainText('.pdf');
    expect(errors).toEqual([]);
  });

  test('le livre en cours est retrouvé après un rechargement, puis effacé par « nouveau livre »', async ({ page }) => {
    await open(page);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await waitDrawings(page, 2);
    await page.fill('#title', 'Mon livre');
    await page.locator('#list .item').first().locator('[data-f="caption"]').fill('Premier');
    await page.evaluate(() => LivreGribouille.saveMeta());
    await page.reload();
    await page.waitForFunction(() => window.LivreGribouille);
    await expect(page.locator('#draft-offer')).toBeVisible();
    await expect(page.locator('#draft-offer')).toContainText('2');
    await expect(page.locator('#empty-resume')).toBeVisible();
    await page.locator('#empty-resume').click();
    await waitDrawings(page, 2);
    await expect(page.locator('#title')).toHaveValue('Mon livre');
    await expect(page.locator('#list .item').first().locator('[data-f="caption"]')).toHaveValue('Premier');
    page.once('dialog', (d) => d.accept());
    await page.locator('#restart').click();
    await expect(page.locator('#empty')).toBeVisible();
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => window.LivreGribouille);
    await page.waitForTimeout(500);
    await expect(page.locator('#draft-offer')).toBeHidden();
  });

  test('recadrer et gommer un dessin, puis revenir au dessin d’origine, même après un rechargement', async ({ page }) => {
    const errors = await open(page);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await waitDrawings(page, 2);
    const [w0, h0] = await page.evaluate(() => [LivreGribouille.state.drawings[0].w, LivreGribouille.state.drawings[0].h]);
    await page.locator('#list .item').first().locator('[data-a="edit"]').click();
    await page.waitForFunction(() => LivreEditor.isOpen());
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#ed-orig')).toBeHidden(); // pas encore retouché : pas d'original à part
    // la poignée en haut à gauche, tirée vers l'intérieur, recadre
    const r = await page.locator('#ed-canvas').boundingBox();
    const k = Math.min((r.width - 48) / w0, (r.height - 48) / h0);
    const ox = r.x + (r.width - w0 * k) / 2, oy = r.y + (r.height - h0 * k) / 2;
    await page.mouse.move(ox + 1, oy + 1);
    await page.mouse.down();
    await page.mouse.move(ox + w0 * k * 0.2, oy + h0 * k * 0.2, { steps: 5 });
    await page.mouse.up();
    // Défaire annule ce recadrage, on le refait
    await page.locator('#ed-undo').click();
    expect(await page.evaluate(() => LivreEditor.session().crop.x)).toBe(0);
    await page.mouse.move(ox + 1, oy + 1);
    await page.mouse.down();
    await page.mouse.move(ox + w0 * k * 0.2, oy + h0 * k * 0.2, { steps: 5 });
    await page.mouse.up();
    // un coup de gomme au centre
    await page.locator('#editor [data-tool="erase"]').click();
    await page.mouse.move(ox + w0 * k * 0.5, oy + h0 * k * 0.5);
    await page.mouse.down();
    await page.mouse.move(ox + w0 * k * 0.6, oy + h0 * k * 0.55, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => LivreEditor.session().strokes.length)).toBe(1);
    await page.locator('#ed-apply').click();
    await page.waitForFunction(() => !LivreEditor.isOpen());
    await page.waitForFunction((w0) => LivreGribouille.state.drawings[0].w < w0 * 0.85, w0);
    const [w1, h1, hasOrig] = await page.evaluate(() => { const d = LivreGribouille.state.drawings[0]; return [d.w, d.h, !!d.orig]; });
    expect(Math.abs(w1 / w0 - 0.8)).toBeLessThan(0.03);
    expect(Math.abs(h1 / h0 - 0.8)).toBeLessThan(0.03);
    expect(hasOrig).toBe(true);
    // la retouche et le scan d'origine survivent au rechargement
    await page.evaluate(() => LivreGribouille.saveMeta());
    await page.reload();
    await page.waitForFunction(() => window.LivreGribouille);
    await page.locator('#empty-resume').click();
    await waitDrawings(page, 2);
    expect(await page.evaluate(() => LivreGribouille.state.drawings[0].w)).toBe(w1);
    // « Dessin d'origine » rend le scan entier ; Annuler ne change rien
    await page.locator('#list .item').first().locator('.thumb').click();
    await page.waitForFunction(() => LivreEditor.isOpen());
    await page.locator('#ed-cancel').click();
    expect(await page.evaluate(() => LivreGribouille.state.drawings[0].w)).toBe(w1);
    await page.locator('#list .item').first().locator('[data-a="edit"]').click();
    await page.waitForFunction(() => LivreEditor.isOpen());
    await expect(page.locator('#ed-orig')).toBeVisible();
    await page.locator('#ed-orig').click();
    await page.waitForFunction((w0) => LivreEditor.session().w === w0, w0);
    await page.locator('#ed-apply').click();
    await page.waitForFunction((w0) => !LivreEditor.isOpen() && LivreGribouille.state.drawings[0].w === w0, w0);
    expect(errors).toEqual([]);
  });

  test('toucher un dessin dans l’aperçu l’ouvre pour la retouche', async ({ page }) => {
    await open(page);
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await waitDrawings(page, 1);
    await page.locator('#spreads image[data-id]').nth(1).click();
    await page.waitForFunction(() => LivreEditor.isOpen());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !LivreEditor.isOpen());
  });

  test('les dessins d’exemple de l’atelier composent un livre légendé', async ({ page }) => {
    const errors = await open(page, '?exemple');
    await waitDrawings(page, 10);
    const ds = await page.evaluate(() => LivreGribouille.state.drawings.map((d) => d.caption));
    expect(ds.every((c) => c.length > 0)).toBe(true);
    await expect(page.locator('#title')).not.toHaveValue('');
    expect(errors).toEqual([]);
  });

  test('en anglais, tous les textes sont traduits', async ({ page }) => {
    const errors = await open(page, '?lang=en&exemple');
    await waitDrawings(page, 10);
    await page.locator('#layout [data-n="2"]').click();
    await expect(page.locator('#export')).toContainText('Download the book');
    await expect(page.locator('#import-section h2')).toContainText('Import the drawings');
    expect(await page.evaluate(() => I18n.missing())).toEqual([]);
    // aucun texte français resté dans la page (hors noms propres)
    const left = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim();
        if (!t || n.parentElement.closest('script,style')) continue;
        if (/\b(les|des|une|dessins?|livre|avec|vos|votre|et)\b/i.test(t) && !/Atelier Gribouille/.test(t)) out.push(t);
      }
      return out;
    });
    expect(left).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('téléphone : une seule colonne, sans débordement horizontal', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await open(page, '?exemple');
    await waitDrawings(page, 10);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('#export')).toBeVisible();
    await ctx.close();
  });
});
