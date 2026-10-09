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
  const r = indexedDB.open('atelier-gribouille');
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
    // au plus 200 cm, pour la feuille comme pour la toile calculée
    await page.locator('#detail [data-custom] input').fill('350');
    await page.locator('#detail [data-custom] input').dispatchEvent('change');
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].sizeCm)).toBe(200);
    await page.evaluate(() => { const A = AtelierGribouille; A.state.drawings.forEach((d) => { d.sizeCm = 200; d.sizeMode = 'manual'; }); A.regenerate(); });
    await page.waitForTimeout(300);
    const cv = await page.evaluate(() => AtelierGribouille.state.canvasSize);
    expect(Math.max(cv.w, cv.h)).toBeLessThanOrEqual(200);
    await page.locator('#detail [data-cm="42"]').click();
    await page.locator('#detail [data-cm="custom"]').click();
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
  test('l’œuvre en cours est gardée d’elle-même et rouverte toute seule après un rechargement', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#draft-offer')).toBeHidden();
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await waitDraft(page);
    const style0 = await page.evaluate(() => AtelierGribouille.state.comp.style);
    await page.reload();
    // sans rien demander : l'œuvre revient, avec un message pendant la réouverture
    await expect(page.locator('#empty-resume')).toBeVisible();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBe(style0);
    await expect(page.locator('#draft-offer')).toBeHidden();
    await expect(page.locator('#empty-resume')).toBeHidden();
    await expect(page.locator('#compose-section')).toBeVisible();
    // le brouillon n'est pas listé parmi les compositions sauvegardées
    await expect(page.locator('#saved-list .saved')).toHaveCount(0);
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
    // les images sont écrites une seule fois, à part : le brouillon ne garde que leurs références
    const store = await page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => {
        const db = q.result;
        const g = db.transaction('compositions').objectStore('compositions').get('brouillon');
        g.onsuccess = () => {
          const k = db.transaction('brouillon-images').objectStore('brouillon-images').getAllKeys();
          k.onsuccess = () => { db.close(); res({ refs: g.result.drawings.map((d) => d.ref), data: g.result.drawings.some((d) => d.data), keys: k.result }); };
        };
      };
    }));
    expect(store.data).toBe(false);
    expect(store.keys.sort()).toEqual(store.refs.slice().sort());
    // une réouverture qui n'a pas abouti (page fermée faute de mémoire) est proposée, pas relancée d'office
    // (un plantage ne passe pas par une sortie normale : la marque est encore là au démarrage suivant)
    await page.addInitScript(() => localStorage.setItem('atelier-gribouille:reouverture', String(Date.now())));
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#draft-offer')).toContainText('n’a pas abouti');
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    await page.locator('#draft-resume').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await expect(page.locator('#draft-offer')).toBeHidden();
    // repartir de zéro efface le brouillon
    await page.locator('#restart').click();
    for (let i = 0; i < 40 && await hasDraft(page); i++) await page.waitForTimeout(250); // l'effacement est asynchrone
    expect(await hasDraft(page)).toBe(false);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.waitForTimeout(500);
    await expect(page.locator('#draft-offer')).toBeHidden();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
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

test.describe('Luminosité, contraste et saturation', () => {
  test('réglés dans la fenêtre de retouche : aperçu, appliqués à la validation, oubliés à l’annulation, mémorisés', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    // même formule que les filtres CSS brightness() puis contrast()
    const px = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const x = c.getContext('2d'); x.fillStyle = 'rgb(100,100,100)'; x.fillRect(0, 0, 1, 1);
      return Array.from(Compose.toned(c, { b: 20, c: 10 }).getContext('2d').getImageData(0, 0, 1, 1).data);
    });
    expect(px[0]).toBe(119);
    expect(px[3]).toBe(255);
    // saturation : même formule que saturate() en CSS
    const sat = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const x = c.getContext('2d'); x.fillStyle = 'rgb(200,100,50)'; x.fillRect(0, 0, 1, 1);
      return Array.from(Compose.toned(c, { b: 0, c: 0, s: 50 }).getContext('2d').getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
    const ref = [200, 100, 50], k = 1.5, m = [[0.213 + 0.787 * k, 0.715 - 0.715 * k, 0.072 - 0.072 * k], [0.213 - 0.213 * k, 0.715 + 0.285 * k, 0.072 - 0.072 * k], [0.213 - 0.213 * k, 0.715 - 0.715 * k, 0.072 + 0.928 * k]];
    m.forEach((row, i) => expect(Math.abs(sat[i] - Math.min(255, Math.max(0, row[0] * ref[0] + row[1] * ref[1] + row[2] * ref[2])))).toBeLessThanOrEqual(1));

    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.locator('#drawings-section > h2').click();
    await page.locator('#drawings .thumb').first().click();
    // une découpe : pas de curseurs dans la fiche, ils sont dans la fenêtre de retouche
    await expect(page.locator('#detail [data-tone="b"]')).toHaveCount(0);
    const fit = await page.evaluate(() => {
      const box = document.getElementById('detail').getBoundingClientRect();
      const r = (q) => document.querySelector('#detail ' + q).getBoundingClientRect();
      return ['[data-edit]', '.chips', '.seg'].every((q) => r(q).right <= box.right - 4 && r(q).left >= box.left + 4);
    });
    expect(fit).toBe(true);
    const mean = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.getElementById('canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      res(s / (d.length / 4) / 3);
    }))));
    const edMean = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.getElementById('ed-canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      res(s / (d.length / 4) / 3);
    }))));
    const slide = (k, v) => page.locator(`#ed-tone [data-ed-tone="${k}"]`).evaluate((r, v) => { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    const comp = await page.evaluateHandle(() => AtelierGribouille.state.comp);
    const m0 = await mean();

    // annuler : rien ne change
    await page.locator('#detail [data-edit]').click();
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#ed-tone')).toBeHidden();
    await page.locator('#ed-tone-toggle').click();
    await expect(page.locator('#ed-tone')).toBeVisible();
    const e0 = await edMean();
    await slide('b', -40);
    expect(await edMean()).toBeLessThan(e0 - 1); // aperçu direct dans la fenêtre
    await page.locator('#ed-cancel').click();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].tone)).toBeUndefined();

    // valider : l'œuvre suit, sans recomposer ni toucher la découpe
    await page.locator('#detail [data-edit]').click();
    await page.locator('#ed-tone-toggle').click();
    await expect(page.locator('#ed-tone [data-ed-tone="b"]')).toHaveValue('0');
    await slide('b', -40);
    await slide('c', 30);
    await expect(page.locator('#ed-tone [data-ed-tone="b"] + output')).toHaveText('−40');
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].tone)).toEqual({ b: -40, c: 30, s: 0 });
    expect(await page.evaluate(() => !!AtelierGribouille.state.drawings[0].analysis.pieces[0].edited)).toBe(false);
    expect(await page.evaluate((c) => c === AtelierGribouille.state.comp, comp)).toBe(true);
    expect(await mean()).toBeLessThan(m0 - 1);
    expect(await page.locator('#drawings .thumb').first().locator('img').evaluate((i) => i.style.filter)).toContain('brightness(0.6)');
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('atelier-gribouille:tons:')))).toBe(true);

    // en rouvrant, les curseurs reprennent le réglage ; automatique puis Rétablir
    await page.locator('#detail [data-edit]').click();
    await page.locator('#ed-tone-toggle').click();
    await expect(page.locator('#ed-tone [data-ed-tone="b"]')).toHaveValue('-40');
    await page.locator('#ed-tone-auto').click();
    await expect(page.locator('#ed-tone-msg')).toBeVisible();
    await slide('s', 10);
    await page.locator('#ed-tone-reset').click();
    await expect(page.locator('#ed-tone [data-ed-tone="c"]')).toHaveValue('0');
    await page.locator('#ed-apply').click();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].tone)).toBeUndefined();
    expect(Math.abs((await mean()) - m0)).toBeLessThan(0.5);
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('atelier-gribouille:tons:')))).toBe(false);

    // une page de fond n'a pas de fenêtre de retouche : ses curseurs restent dans la fiche
    await page.locator('#detail [data-role="texture"]').click();
    await expect(page.locator('#detail [data-edit]')).toHaveCount(0);
    await page.locator('#detail [data-tone="s"]').evaluate((r) => { r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].tone)).toEqual({ b: 0, c: 0, s: 20 });
    await page.locator('#detail [data-tone-auto]').click();
    await expect(page.locator('#detail [data-tone-msg]')).toBeVisible();
  });
});

test.describe('Réglage automatique de l’image', () => {
  test('éclaircit et ravive un scan terne, laisse tranquille un dessin déjà net, une page peinte et le crayon gris', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.Compose && Compose.autoTone);
    const r = await page.evaluate(() => {
      const mk = (paper, ink, col) => {
        const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
        x.fillStyle = `rgb(${paper})`; x.fillRect(0, 0, 400, 300); x.fillStyle = `rgb(${ink})`; x.fillRect(50, 50, 120, 8); x.fillRect(50, 100, 8, 120);
        if (col) { x.fillStyle = `rgb(${col})`; x.fillRect(200, 80, 140, 140); }
        return c;
      };
      const terne = mk('200,198,190', '110,110,110', '170,120,110');
      const t = Compose.autoTone([terne]);
      // le papier du scan terne devient blanc
      const px = Compose.toned(terne, t).getContext('2d').getImageData(10, 10, 1, 1).data;
      return {
        terne: t, paper: px[0],
        bon: Compose.autoTone([mk('250,250,250', '15,15,15', '230,30,30')]),
        peint: Compose.autoTone([mk('40,60,140', '20,20,60', '200,180,40')]),
        crayon: Compose.autoTone([mk('235,235,235', '150,150,150')]),
      };
    });
    expect(r.terne.b).toBeGreaterThan(0);
    expect(r.terne.c).toBeGreaterThan(0);
    expect(r.terne.s).toBeGreaterThan(0);
    expect(r.paper).toBeGreaterThan(240);
    expect(r.bon).toEqual({ b: 0, c: 0, s: 0 });
    expect(r.peint.b).toBe(0);
    expect(r.crayon.s).toBe(0);
    for (const t of [r.terne, r.crayon]) for (const k of ['b', 'c']) expect(Math.abs(t[k])).toBeLessThanOrEqual(35);
  });
});

test.describe('Liste des dessins et photos de l’iPhone', () => {
  test('choisir un dessin dans la liste le sélectionne aussi sur l’œuvre ; une photo HEIC est importée et sauvegardée en JPEG', async ({ page }) => {
    const fs = require('fs');
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    // le sélecteur accepte les HEIC tels quels (l'iPhone ne les convertit plus avant de rendre la main)
    expect(await page.locator('#file').getAttribute('accept')).toContain('image/heic');
    // (Chromium ne lit pas le HEIC : un PNG déclaré HEIC suffit à vérifier le chemin suivi)
    await page.setInputFiles('#file', [
      { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: fs.readFileSync(fixture('page-cutout.png')) },
      { name: 'page-two.png', mimeType: 'image/png', buffer: fs.readFileSync(fixture('page-two.png')) },
    ]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && AtelierGribouille.state.drawings.length === 2 && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // un dessin choisi dans la liste est sélectionné sur l'œuvre (cadre, poignée, barre d'outils)
    await page.locator('#drawings-section > h2').click();
    for (const i of [1, 0]) {
      await page.locator('#drawings .thumb').nth(i).click();
      await expect(page.locator('#detail')).toBeVisible();
      expect(await page.evaluate((i) => { const s = AtelierGribouille.state; return !!s.selected && s.selected.piece && s.selected.piece.drawing === s.drawings[i]; }, i)).toBe(true);
      await expect(page.locator('#toolbar [data-act="flip"]')).toBeEnabled();
    }
    // dessin suivant avec ‹ › : la sélection suit
    await page.locator('#detail [data-nav="1"]').click();
    expect(await page.evaluate(() => { const s = AtelierGribouille.state; return s.selected && s.selected.piece.drawing === s.drawings[1]; })).toBe(true);
    // refermer la fiche (re-clic sur la vignette) retire la sélection
    await page.locator('#drawings .thumb').nth(1).click();
    expect(await page.evaluate(() => AtelierGribouille.state.selected)).toBeNull();
    // le brouillon garde la photo HEIC en JPEG, lisible sur n'importe quel navigateur
    let type = null;
    for (let i = 0; i < 60 && !type; i++) {
      type = await page.evaluate(() => new Promise((res) => {
        const q = indexedDB.open('atelier-gribouille');
        q.onsuccess = () => {
          // le brouillon garde la référence de l'image, écrite une fois dans le magasin des images
          const db = q.result, g = db.transaction('compositions').objectStore('compositions').get('brouillon');
          g.onsuccess = () => {
            const ref = g.result && g.result.drawings[0].ref;
            if (!ref || !db.objectStoreNames.contains('brouillon-images')) { res(null); return; }
            const f = db.transaction('brouillon-images').objectStore('brouillon-images').get(ref);
            f.onsuccess = () => res(f.result ? f.result.type : null); f.onerror = () => res(null);
          };
          g.onerror = () => res(null);
        };
        q.onerror = () => res(null);
      }));
      if (!type) await page.waitForTimeout(500);
    }
    expect(type).toBe('image/jpeg');
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});

test.describe('Panier', () => {
  test('ajouter des propositions, régler, retirer, retrouver après rechargement, revoir et commander', async ({ page }) => {
    test.setTimeout(240000);
    const { fixture } = require('./helpers');
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('.cart-btn-desk')).toBeHidden(); // panier vide : pas de bouton
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const euros = (t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
    // une proposition (pas celle affichée), en tableau encadré
    const style1 = await page.evaluate(() => AtelierGribouille.state.proposals[1].style.id);
    await page.locator('.proposal-cart').nth(1).click();
    await expect(page.locator('#cart-add')).toBeVisible();
    await page.locator('#cart-add [data-finish="cadre"]').click();
    await page.locator('#cart-add [data-size="50x70"]').click();
    expect(euros(await page.locator('.cart-add-total').textContent())).toBe(129);
    await page.locator('#cart-add [data-qty="1"]').click();
    expect(euros(await page.locator('.cart-add-total').textContent())).toBe(258);
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart')).toBeVisible();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await page.locator('#cart [data-close]').first().click();
    // la composition en cours, depuis l'étape Exporter, en fichier HD (quantité fixe)
    await page.locator('#add-cart').click();
    await page.locator('#cart-add input[value="hd"]').check();
    await page.locator('#cart-add-ok').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(2);
    // chaque article a sa quantité, fichier HD compris
    await expect(page.locator('#cart .cart-item').nth(1).locator('.cart-qty output')).toHaveText('1');
    await expect(page.locator('#cart .cart-item').nth(1).locator('[data-qty="-1"]')).toBeDisabled();
    await page.locator('#cart .cart-item').nth(1).locator('[data-qty="1"]').click();
    expect(euros(await page.locator('#cart .cart-total b').textContent())).toBeCloseTo(258 + 29.8, 2);
    await page.locator('#cart .cart-item').nth(1).locator('[data-qty="-1"]').click();
    expect(euros(await page.locator('#cart .cart-total b').textContent())).toBeCloseTo(258 + 14.9, 2);
    await expect(page.locator('.cart-btn-desk .cart-count')).toHaveText('3');
    // quantité −, puis retirer le fichier HD
    await page.locator('#cart .cart-item').first().locator('[data-qty="-1"]').click();
    expect(euros(await page.locator('#cart .cart-total b').textContent())).toBeCloseTo(129 + 14.9, 2);
    await page.locator('#cart .cart-item').nth(1).locator('[data-remove]').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    expect(euros(await page.locator('#cart .cart-total b').textContent())).toBe(129);
    await page.locator('#cart [data-close]').first().click();
    // une nouvelle œuvre efface le brouillon, pas ce qui est au panier ; le panier survit au rechargement
    await page.locator('#restart').click();
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('.cart-btn-desk .cart-count')).toHaveText('1');
    await page.locator('.cart-btn-desk').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await expect(page.locator('#cart .cart-item small')).toContainText('70 × 50');
    // revoir : la composition revient dans l'atelier, telle qu'ajoutée
    await page.locator('#cart [data-review]').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBe(style1);
    // commander (sans comptes ici) : récapitulatif prêt, panier vidé, commande gardée
    await page.locator('.cart-btn-desk').click();
    await page.locator('#cart-order').click();
    await expect(page.locator('#cart .cart-status')).toContainText('prête');
    const orders = await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-gribouille:commandes') || '[]'));
    expect(orders).toHaveLength(1);
    expect(orders[0].total).toBe(129);
    expect(orders[0].ref).toMatch(/^AG-\d{6}-[A-Z0-9]{4}$/);
    await expect(page.locator('.cart-btn-desk')).toBeHidden();
    expect(errors).toEqual([]);
    await page.evaluate(() => new Promise((r) => { localStorage.clear(); const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});

test.describe('Panier relu du navigateur', () => {
  test('un prix modifié à la main est recalculé, un article invalide écarté, sans casser le panier', async ({ page }) => {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.addInitScript(() => localStorage.setItem('atelier-gribouille:panier', JSON.stringify([
      { id: 'a1', recId: 'panier-a1', refs: [], title: '<img src=x onerror=alert(1)>', styleName: 'Frise', thumb: 'javascript:alert(1)', W: 36, H: 25, product: 'print', finish: 'cadre', size: '50x70', qty: '3abc', unit: 1 },
      { id: 'a2', recId: 'panier-a2', title: 'cassé', W: 36, H: 25, product: 'print', finish: 'or', size: '1x1', qty: 2, unit: 1 },
      'n’importe quoi',
    ])));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { errors.push('dialog ' + d.message()); d.dismiss(); });
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('.cart-btn-desk .cart-count')).toHaveText('1');
    await page.locator('.cart-btn-desk').click();
    await expect(page.locator('#cart .cart-item')).toHaveCount(1);
    await expect(page.locator('#cart .cart-item b').first()).toHaveText('<img src=x onerror=alert(1)>'); // affiché comme du texte
    expect(Number((await page.locator('#cart .cart-total b').textContent()).replace(/[^\d,]/g, '').replace(',', '.'))).toBe(129);
    expect(await page.locator('#cart .cart-item img').getAttribute('src')).toBe('');
    expect(errors).toEqual([]);
  });
});

test.describe('Baguette magique', () => {
  test('dans la découpe une zone de couleur est retirée, à côté elle est ajoutée ; la sensibilité règle son étendue', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const big = () => page.evaluate(() => { const ps = AtelierGribouille.state.drawings[0].analysis.pieces; return ps.indexOf(ps.reduce((a, b) => (a.canvas.width * a.canvas.height > b.canvas.width * b.canvas.height ? a : b))); });
    const k = await big();
    const opaque = () => page.evaluate((k) => {
      const c = AtelierGribouille.state.drawings[0].analysis.pieces[k].canvas;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n;
    }, k);
    const open = () => page.evaluate((k) => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[k]), k);
    // un point de la pièce, en pixels de page : le rouge du corps, et un point de papier hors découpe
    const pts = await page.evaluate((k) => {
      const d = AtelierGribouille.state.drawings[0], p = d.analysis.pieces[k], c = p.canvas;
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let red = null;
      for (let y = 0; y < c.height && !red; y += 2) for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; if (px[i + 3] > 250 && px[i] > 180 && px[i + 1] < 90 && px[i + 2] < 90) { red = { x: p.src.x + x, y: p.src.y + y }; break; } }
      return { red, paper: { x: 8, y: 8 } };
    }, k);
    expect(pts.red).not.toBeNull();
    const n0 = await opaque();
    await open();
    await page.locator('#editor [data-tool="wand"]').click();
    await expect(page.locator('#ed-tol')).toBeVisible();
    await expect(page.locator('#ed-size')).toBeHidden();
    await page.locator('#ed-tol').fill('20');
    // dans la découpe : retirée
    expect(await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.red)).toBeLessThan(0);
    await page.locator('#ed-apply').click();
    const n1 = await opaque();
    expect(n1).toBeLessThan(n0 * 0.95);
    // annuler dans la fenêtre : rien ne change à la validation
    await open();
    await page.locator('#editor [data-tool="wand"]').click();
    await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.red);
    await page.locator('#ed-undo').click();
    await page.locator('#ed-apply').click();
    expect(Math.abs((await opaque()) - n1)).toBeLessThan(n1 * 0.01);
    // à côté, sur le papier : ajoutée (et d'autant plus large que la sensibilité est forte)
    await open();
    await page.locator('#editor [data-tool="wand"]').click();
    await page.locator('#ed-tol').fill('5');
    const small = await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.paper);
    await page.locator('#ed-undo').click();
    await page.locator('#ed-tol').fill('40');
    const large = await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.paper);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThanOrEqual(small);
    await page.locator('#ed-cancel').click();
  });

  test('sur téléphone : un toucher sur le dessin applique la baguette', async ({ browser }) => {
    const { fixture } = require('./helpers');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.evaluate(() => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[0]));
    await page.locator('#editor [data-tool="wand"]').click();
    await expect(page.locator('#ed-tip')).toContainText('retirée');
    await expect(page.locator('#ed-undo')).toBeDisabled();
    const box = await page.locator('#ed-canvas').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#ed-undo')).toBeEnabled(); // la baguette a agi (défaire possible)
    await ctx.close();
  });
});
