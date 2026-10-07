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

  test('téléphone : le carnet est un tiroir à onglets, ouvert sur Propositions après l’import', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    // sans dessin : onglet Importer, les autres étapes grisées, numérotation continue (01, 02)
    await expect(page.locator('.panel')).toHaveAttribute('data-tab', 'import-section');
    await expect(page.locator('#sheet-tabs [data-tab="compose-section"]')).toBeDisabled();
    expect(await page.evaluate(() => [...document.querySelectorAll('aside section.step')].filter((s) => !s.hidden).map((s) => s.querySelector('.num').textContent))).toEqual(['01', '02']);
    await expect(page.locator('#toolbar')).toBeHidden();
    const { fixture } = require('./helpers');
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('.panel')).toHaveAttribute('data-tab', 'compose-section');
    await expect(page.locator('#compose-section')).toBeVisible();
    await expect(page.locator('#import-section')).toBeHidden();
    await expect(page.locator('#toolbar')).toBeVisible();
    // l'onglet Dessins ouvre la section même si elle était repliée par défaut
    await page.locator('#sheet-tabs [data-tab="drawings-section"]').click();
    await expect(page.locator('#drawings .thumb').first()).toBeVisible();
    // l'œuvre reste visible au-dessus du tiroir
    const canvasBottom = await page.locator('#canvas').evaluate((el) => el.getBoundingClientRect().bottom);
    const panelTop = await page.locator('.panel').evaluate((el) => el.getBoundingClientRect().top);
    expect(canvasBottom).toBeLessThanOrEqual(panelTop + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  });
});

test.describe('Brouillon', () => {
  test('l’œuvre en cours est gardée d’elle-même et proposée après un rechargement', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#draft-offer')).toBeHidden();
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.waitForTimeout(3500); // le brouillon s'enregistre 2,5 s après le dernier changement
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#draft-offer')).toBeVisible();
    await expect(page.locator('#draft-offer')).toContainText('2 dessins');
    await expect(page.locator('#empty-resume')).toBeVisible();
    // le brouillon n'est pas listé parmi les compositions sauvegardées
    await expect(page.locator('#saved-list .saved')).toHaveCount(0);
    await page.locator('#draft-resume').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#draft-offer')).toBeHidden();
    await expect(page.locator('#compose-section')).toBeVisible();
    // repartir de zéro efface le brouillon
    await page.locator('#restart').click();
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.waitForTimeout(500);
    await expect(page.locator('#draft-offer')).toBeHidden();
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

  test('importer ses propres dessins retire les dessins d’exemple', async ({ app }) => {
    const { page } = app;
    const { fixture } = require('./helpers');
    await page.locator('#load-sample').click();
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 180000 });
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(19);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const names = await page.evaluate(() => AtelierGribouille.state.drawings.map((d) => d.name));
    expect(names).toEqual(['page-cutout.png', 'page-two.png']);
    await expect(page.locator('#notice')).toContainText('exemple ont été retirés');
    await expect(page.locator('#sample-note')).toBeHidden();
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
    // une seule taille connue ne suffit pas à étalonner les autres : Exemple 1 garde l'estimation A4
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
