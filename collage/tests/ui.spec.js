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
    // la fiche d'un dessin s'ouvre dans un tiroir agrandi et se ferme par sa croix
    await page.locator('#drawings .thumb').first().click();
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/sheet-detail/);
    await page.locator('#detail .detail-close').click();
    await expect(page.locator('#detail')).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/sheet-detail/);
    await page.waitForTimeout(300);
    // l'œuvre reste visible au-dessus du tiroir
    const canvasBottom = await page.locator('#canvas').evaluate((el) => el.getBoundingClientRect().bottom);
    const panelTop = await page.locator('.panel').evaluate((el) => el.getBoundingClientRect().top);
    expect(canvasBottom).toBeLessThanOrEqual(panelTop + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await ctx.close();
  });
});

// attend que le brouillon soit bien écrit dans IndexedDB (il part 2,5 s après le dernier changement)
const hasDraft = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('atelier-gribouille', 1);
  r.onsuccess = () => { const db = r.result; try { const g = db.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => { db.close(); res(!!(g.result && g.result.drawings && g.result.drawings.length)); }; g.onerror = () => { db.close(); res(false); }; } catch (e) { db.close(); res(false); } };
  r.onerror = () => res(false);
}));
const waitDraft = async (page) => {
  for (let i = 0; i < 120; i++) { if (await hasDraft(page)) return; await page.waitForTimeout(500); }
  throw new Error('brouillon jamais écrit');
};

test.describe('Téléphone, tiroir agrandi', () => {
  test('régler la taille dans la fiche d’un dessin ne plante pas, et l’œuvre revient à la fermeture', async ({ browser }) => {
    const { fixture } = require('./helpers');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.locator('#sheet-tabs [data-tab="drawings-section"]').click();
    await page.locator('#drawings .thumb').first().click();
    await expect(page.locator('body')).toHaveClass(/sheet-detail/);
    // tiroir agrandi à fond (glissement vers le haut) : la zone de l'œuvre n'a presque plus de place
    await page.evaluate(() => document.body.classList.add('sheet-tall'));
    await page.locator('#detail [data-cm="42"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#fatal')).toBeHidden();
    await page.locator('#detail .detail-close').click();
    await page.waitForTimeout(400);
    const painted = await page.evaluate(() => { const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n; });
    expect(painted).toBeGreaterThan(100);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('Fiche d’un dessin sur téléphone', () => {
  test('à mi-hauteur avec l’œuvre visible, dessin suivant, taille et orientation en boutons, retouche', async ({ browser }) => {
    const { fixture } = require('./helpers');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png'), fixture('page-texture.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.locator('#sheet-tabs [data-tab="drawings-section"]').click();
    await page.locator('#drawings .thumb').first().click();
    await expect(page.locator('#detail')).toBeVisible();
    await page.waitForTimeout(300);
    // l'œuvre reste visible au-dessus de la fiche
    const canvasH = await page.locator('#canvas').evaluate((el) => el.getBoundingClientRect().height);
    expect(canvasH).toBeGreaterThan(150);
    await expect(page.locator('.density-bar')).toBeVisible();
    // taille en boutons
    await page.locator('#detail [data-cm="42"]').click();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].sizeCm)).toBe(42);
    await expect(page.locator('#detail [data-cm="42"]')).toHaveClass(/on/);
    await page.locator('#detail [data-cm="custom"]').click();
    await expect(page.locator('#detail [data-custom]')).toBeVisible();
    // orientation : un quart de tour à droite, puis retour à l'automatique
    await page.locator('#detail [data-rot="90"]').click();
    const o = await page.evaluate(() => AtelierGribouille.state.drawings[0].orient);
    expect(o).not.toBe('auto');
    await page.locator('#detail [data-rot="auto"]').click();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].orient)).toBe('auto');
    // la croix ne recouvre pas la flèche ›
    const boxes = await page.evaluate(() => ['.detail-close', '[data-nav="1"]'].map((q) => document.querySelector('#detail ' + q).getBoundingClientRect().toJSON()));
    const [x, nx] = boxes;
    expect(x.left >= nx.right || nx.left >= x.right || x.top >= nx.bottom || nx.top >= x.bottom).toBe(true);
    // dessin suivant sans fermer la fiche
    await expect(page.locator('#detail [data-nav="-1"]')).toBeDisabled();
    await page.locator('#detail [data-nav="1"]').click();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.indexOf(AtelierGribouille.state.current))).toBe(1);
    await expect(page.locator('#detail')).toContainText('2');
    // retoucher la découpe depuis la fiche (dessin découpé)
    await page.locator('#detail [data-nav="-1"]').click();
    await page.locator('#detail [data-edit]').click();
    await expect(page.locator('#editor')).toBeVisible();
    await page.locator('#ed-cancel').click();
    // changer d'onglet referme le tiroir à mi-hauteur
    await page.locator('#sheet-tabs [data-tab="compose-section"]').click();
    await expect(page.locator('body')).not.toHaveClass(/sheet-detail/);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('Éditeur de découpe sur téléphone', () => {
  test('Annuler et Valider en haut, outils en bas, loupe pendant le geste au doigt', async ({ browser }) => {
    const { fixture } = require('./helpers');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => AtelierGribouille.editPiece(AtelierGribouille.state.comp.items[0].piece));
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#ed-tip')).toBeVisible();
    await expect(page.locator('#ed-apply')).toHaveText(/Valider/);
    const y = (id) => page.locator(id).evaluate((el) => el.getBoundingClientRect().top);
    expect(await y('#ed-apply')).toBeLessThan(80);
    expect(await y('#ed-cancel')).toBeLessThan(80);
    expect(await y('#editor .ed-tools')).toBeGreaterThan(600);
    const h = await page.locator('#ed-canvas').evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThan(844 * 0.6);
    // un trait au doigt : la loupe apparaît pendant le geste, disparaît après, et le geste se défait
    const r = await page.locator('#ed-canvas').boundingBox();
    await page.evaluate(([x, y]) => {
      const c = document.getElementById('ed-canvas');
      const ev = (t, X, Y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 9, pointerType: 'touch', clientX: X, clientY: Y, bubbles: true, isPrimary: true }));
      ev('pointerdown', x, y); for (let i = 1; i <= 6; i++) ev('pointermove', x + i * 5, y + i * 3);
    }, [r.x + r.width / 2, r.y + r.height / 2]);
    expect(await page.evaluate(() => Editor.loupe())).toBe(true);
    await page.evaluate(([x, y]) => document.getElementById('ed-canvas').dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, bubbles: true })), [r.x + r.width / 2 + 30, r.y + r.height / 2 + 18]);
    expect(await page.evaluate(() => Editor.loupe())).toBe(false);
    await expect(page.locator('#ed-undo')).toBeEnabled();
    await page.locator('#ed-cancel').click();
    await expect(page.locator('#editor')).toBeHidden();
    expect(errors).toEqual([]);
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
    await waitDraft(page);
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
    // retour d'une connexion externe (Google) : l'œuvre reprend d'elle-même, sur l'étape Exporter
    await waitDraft(page);
    await page.evaluate(() => sessionStorage.setItem('atelier-gribouille:after-auth', 'télécharger votre œuvre'));
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#draft-offer')).toBeHidden();
    await expect(page.locator('#save-status')).toContainText('télécharger votre œuvre');
    expect(await page.evaluate(() => sessionStorage.getItem('atelier-gribouille:after-auth'))).toBeNull();
    // une composition rouverte est épinglée : en choisir une autre puis modifier un dessin n'y ramène pas
    const pinnedStyle = await page.evaluate(() => AtelierGribouille.state.comp.style);
    const other = await page.evaluate((st) => AtelierGribouille.state.proposals.findIndex((p) => p.style.id !== st), pinnedStyle);
    await page.evaluate((i) => AtelierGribouille.selectProposal(i), other);
    const otherStyle = await page.evaluate(() => AtelierGribouille.state.comp.style);
    expect(otherStyle).not.toBe(pinnedStyle);
    await page.evaluate(() => { const sec = document.getElementById('drawings-section'); if (sec.classList.contains('collapsed')) sec.querySelector('h2').click(); });
    await page.locator('#drawings .thumb').first().click();
    await page.locator('#detail [data-role="texture"]').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBe(otherStyle);
    // repartir de zéro efface le brouillon
    await page.locator('#restart').click();
    for (let i = 0; i < 40 && await hasDraft(page); i++) await page.waitForTimeout(250); // l'effacement est asynchrone
    expect(await hasDraft(page)).toBe(false);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.waitForTimeout(500);
    await expect(page.locator('#draft-offer')).toBeHidden();
  });
});

test.describe('Historique', () => {
  test('Défaire et Refaire reviennent sur un retrait, un retournement et un changement de proposition', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const undo = page.locator('#toolbar [data-act="undo"]'), redo = page.locator('#toolbar [data-act="redo"]');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    const n0 = await page.evaluate(() => AtelierGribouille.state.comp.items.length);
    // retirer une pièce
    await page.evaluate(() => { const s = AtelierGribouille.state; s.selected = s.comp.items[0]; AtelierGribouille.render(); });
    await page.locator('#toolbar [data-act="del"]').click();
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items.length)).toBe(n0 - 1);
    await expect(undo).toBeEnabled();
    await undo.click();
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items.length)).toBe(n0);
    await expect(redo).toBeEnabled();
    await redo.click();
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items.length)).toBe(n0 - 1);
    await undo.click();
    // retourner, puis Ctrl+Z au clavier
    await page.evaluate(() => { const s = AtelierGribouille.state; s.selected = s.comp.items[0]; AtelierGribouille.render(); });
    const f0 = await page.evaluate(() => !!AtelierGribouille.state.comp.items[0].flip);
    await page.locator('#toolbar [data-act="flip"]').click();
    expect(await page.evaluate(() => !!AtelierGribouille.state.comp.items[0].flip)).toBe(!f0);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => !!AtelierGribouille.state.comp.items[0].flip)).toBe(f0);
    // changer de proposition se défait aussi
    const s0 = await page.evaluate(() => AtelierGribouille.state.comp.style);
    await page.evaluate(() => AtelierGribouille.selectProposal((AtelierGribouille.state.active + 1) % AtelierGribouille.state.proposals.length));
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).not.toBe(s0);
    await undo.click();
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBe(s0);
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
