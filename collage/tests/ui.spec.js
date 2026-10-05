const { test, expect } = require('./helpers');

test.describe('Interface', () => {
  test('première visite : parcours simple, réglages repliés', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('#import-section')).toBeVisible();
    await expect(page.locator('#drop')).toBeVisible();
    // les sections secondaires sont repliées, les réglages avancés fermés
    await expect(page.locator('#drawings-section')).toHaveClass(/collapsed/);
    await expect(page.locator('#room-section')).toHaveClass(/collapsed/);
    expect(await page.locator('#advanced').evaluate((d) => d.open)).toBe(false);
    expect(await page.locator('#export-options').evaluate((d) => d.open)).toBe(false);
    // le choix de repli est mémorisé (la section Mes compositions est visible dès le départ)
    await expect(page.locator('#saved-section')).not.toHaveClass(/collapsed/);
    await page.locator('#saved-section > h2').click();
    await expect(page.locator('#saved-section')).toHaveClass(/collapsed/);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#saved-section')).toHaveClass(/collapsed/);
    await expect(page.locator('#drawings-section')).toHaveClass(/collapsed/);
  });

  test('capteur d’erreur global : une erreur imprévue s’affiche avec son détail', async ({ app }) => {
    const { page, errors } = app;
    await expect(page.locator('#fatal')).toBeHidden();
    await page.evaluate(() => setTimeout(() => { throw new Error('panne de test'); }, 0));
    await expect(page.locator('#fatal')).toBeVisible();
    await expect(page.locator('#fatal .fatal-text')).toContainText('panne de test');
    expect(await page.evaluate(() => window.AtelierErrors.detail)).toContain('panne de test');
    // une promesse rejetée sans rattrapage est signalée aussi
    await page.locator('#fatal-close').click();
    await expect(page.locator('#fatal')).toBeHidden();
    await page.evaluate(() => { Promise.reject(new Error('promesse de test')); });
    await expect(page.locator('#fatal')).toBeVisible();
    await expect(page.locator('#fatal .fatal-text')).toContainText('promesse de test');
    // ces erreurs étaient voulues : on les retire de la liste surveillée
    errors.splice(0, errors.length);
  });

  test('téléphone : la colonne de zoom est verticale à droite et la page ne déborde pas', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const zoom = await page.locator('.zoom').evaluate((el) => getComputedStyle(el).flexDirection);
    expect(zoom).toBe('column');
    await ctx.close();
  });
});

test.describe('Dessins d’exemple', () => {
  test('sans dossier samples, rien n’est proposé', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('**/samples/manifest.json', (r) => r.fulfill({ status: 404, body: 'introuvable' }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.waitForTimeout(500);
    await expect(page.locator('#sample-offer')).toBeHidden();
    await expect(page.locator('#empty-sample')).toBeHidden();
    await ctx.close();
  });

  test('le jeu d’exemple fourni avec l’app s’analyse correctement', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('#sample-offer')).toBeVisible();
    await page.locator('#load-sample').click();
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 180000 });
    const ds = await app.drawings();
    expect(ds.length).toBe(19);
    const painted = ds.filter((d) => /peint/.test(d.name));
    expect(painted.every((d) => d.kind === 'texture'), JSON.stringify(painted)).toBe(true);
    const subjects = ds.filter((d) => !/peint/.test(d.name));
    expect(subjects.every((d) => d.kind === 'cutout' && d.pieces >= 1), JSON.stringify(subjects)).toBe(true);
    expect(ds.every((d) => d.photo === null)).toBe(true);
  });

  test('avec un manifeste, un bouton propose l’exemple et le charge au clic', async ({ browser }) => {
    const fs = require('fs');
    const { fixture } = require('./helpers');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/samples/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ base: 'samples/', pages: [{ file: 'page-cutout.png', name: 'Exemple 1' }, { file: 'page-texture.png', name: 'Exemple 2', sizeCm: 42 }] }) }));
    await page.route('**/samples/*.png', (r) => { const f = r.request().url().split('/').pop(); r.fulfill({ contentType: 'image/png', body: fs.readFileSync(fixture(f)) }); });
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#sample-offer')).toBeVisible();
    await expect(page.locator('#empty-sample')).toBeVisible();
    // rien n'est chargé d'office
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    await page.locator('#empty-sample').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.proposals);
    const ds = await page.evaluate(() => AtelierGribouille.state.drawings.map((d) => [d.name, d.sizeCm]));
    expect(ds).toEqual([['Exemple 1', 29.7], ['Exemple 2', 42]]);
    await expect(page.locator('#sample-note')).toBeVisible();
    await expect(page.locator('#sample-offer')).toBeHidden();
    // « repartir de zéro » remet la proposition
    await page.locator('#clear').click();
    await expect(page.locator('#sample-offer')).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
