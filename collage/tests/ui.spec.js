const { test, expect } = require('./helpers');

test.describe('Interface', () => {
  test('première visite : parcours simple, réglages repliés', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('#import-section')).toBeVisible();
    await expect(page.locator('#drop')).toBeVisible();
    // les sections secondaires sont repliées, les réglages avancés fermés
    await expect(page.locator('#drawings-section')).toHaveClass(/collapsed/);
    await expect(page.locator('#room-section')).toHaveClass(/collapsed/);
    // sur ordinateur, les réglages avancés sont dépliés d'office ; plus de « finition toile »
    expect(await page.locator('#advanced').evaluate((d) => d.open)).toBe(true);
    await expect(page.locator('#grain')).toHaveCount(0);
    // le choix de repli est mémorisé (la section Mes compositions est visible dès le départ)
    await expect(page.locator('#saved-section')).not.toHaveClass(/collapsed/);
    await page.locator('#saved-section > h2').click();
    await expect(page.locator('#saved-section')).toHaveClass(/collapsed/);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#saved-section')).toHaveClass(/collapsed/);
    await expect(page.locator('#drawings-section')).toHaveClass(/collapsed/);
  });

  test('« Commencer une nouvelle œuvre » : bien en vue en tête du panneau, confirmation avant d’effacer', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('#new-work')).toBeHidden();
    await app.import(['page-cutout.png']);
    const btn = page.locator('#new-work');
    await expect(btn).toBeVisible();
    // au-dessus de l'étape Importer, sans défiler
    const [b, imp] = await Promise.all([btn.boundingBox(), page.locator('#import-section').boundingBox()]);
    expect(b.y).toBeLessThan(imp.y);
    expect(b.y + b.height).toBeLessThan(page.viewportSize().height);
    // refus : rien ne change
    page.once('dialog', (d) => { expect(d.message()).toContain('effacée'); d.dismiss(); });
    await btn.click();
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(1);
    // accord : l'atelier repart de zéro et le bouton disparaît
    page.once('dialog', (d) => d.accept());
    await btn.click();
    await expect.poll(() => page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    await expect(btn).toBeHidden();
    await expect(page.locator('#empty')).toBeVisible();
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
    // sans service de comptes, comme les autres tests (avec, importer demanderait d'être connecté)
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
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

test.describe('Téléphone, onglets', () => {
  test('ni le choix du type d’œuvre, ni « Commencer une nouvelle œuvre » (restés dans Importer), ni « Mettre en scène »', async ({ browser }) => {
    const { fixture } = require('./helpers');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await p.goto('index.html');
    await p.waitForFunction(() => window.AtelierGribouille);
    await p.setInputFiles('#file', [fixture('page-cutout.png')]);
    await p.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await p.locator('#sheet-tabs [data-tab="more"]').click();
    await expect(p.locator('#mode-switch')).toBeHidden();
    await expect(p.locator('#new-work')).toBeHidden();
    await expect(p.locator('#saved-section')).toBeVisible();
    await expect(p.locator('#room-section')).toBeHidden();
    // ni dans les autres onglets
    for (const tab of ['compose-section', 'sizes-section', 'drawings-section', 'export-section']) {
      await p.locator(`#sheet-tabs [data-tab="${tab}"]`).click();
      await expect(p.locator('#mode-switch')).toBeHidden();
      await expect(p.locator('#new-work')).toBeHidden();
    }
    await p.locator('#sheet-tabs [data-tab="import-section"]').click();
    await expect(p.locator('#mode-switch')).toBeVisible();
    await expect(p.locator('#new-work')).toBeVisible();
    await ctx.close();
  });
});

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
    // « Retoucher le dessin » visible en entier sans faire défiler : en haut de la fiche, sur toute la largeur
    const eb = await page.locator('#detail [data-edit]').boundingBox();
    expect(eb.y + eb.height).toBeLessThan(844 - 40);
    expect(eb.width).toBeGreaterThan(250);
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
  test('Toile : une Frise rouverte ne fige pas la toile, une toile choisie reste choisie', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html?mode=toile');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // la Frise est sur sa bande ; la toile reste conseillée (pas choisie dans la liste)
    await page.evaluate(() => AtelierGribouille.selectProposal(AtelierGribouille.state.proposals.findIndex((p) => p.style.id === 'frise')));
    const band = await page.evaluate(() => document.getElementById('format').value);
    const savedFormat = () => page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => { try { const g = q.result.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => res(g.result && g.result.settings ? g.result.settings.format : null); g.onerror = () => res(null); } catch (e) { res(null); } };
      q.onerror = () => res(null);
    }));
    // le brouillon garde la bande de la Frise affichée
    await expect.poll(savedFormat, { timeout: 60000 }).toBe(band);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.style)).toBe('frise');
    expect(await page.evaluate(() => AtelierGribouille.state.formatManual)).toBe(false);
    // curseur au maximum : les autres propositions retrouvent leur toile, avec tous les dessins
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const p = AtelierGribouille.state.proposals.find((x) => x.style.id === 'tournesol').comp; return { r: Math.max(p.W, p.H) / Math.min(p.W, p.H) }; });
    expect(r.r).toBeLessThan(1.8);
    await page.evaluate(() => AtelierGribouille.selectProposal(AtelierGribouille.state.proposals.findIndex((p) => p.style.id === 'tournesol')));
    await expect(page.locator('#density-note')).toHaveText(/^2 sur 2/);
    // une toile choisie dans la liste, elle, est gardée à la réouverture
    await page.evaluate(() => { const f = document.getElementById('format'); f.value = '50x50'; f.dispatchEvent(new Event('change')); });
    await expect.poll(savedFormat, { timeout: 60000 }).toBe('50x50');
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => [AtelierGribouille.state.formatManual, document.getElementById('format').value, AtelierGribouille.state.comp.W])).toEqual([true, '50x50', 50]);
  });

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
    // les images (et la page et les masques de chaque dessin) sont écrites une seule fois, à part : le brouillon ne garde que leurs références
    const store = await page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => {
        const db = q.result;
        const g = db.transaction('compositions').objectStore('compositions').get('brouillon');
        g.onsuccess = () => {
          const k = db.transaction('brouillon-images').objectStore('brouillon-images').getAllKeys();
          k.onsuccess = () => { db.close(); res({ refs: g.result.drawings.flatMap((d) => [d.ref, d.saved.ref]), data: g.result.drawings.some((d) => d.data || d.saved.page.data), keys: k.result }); };
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
    // l'exemple s'ouvre avec ses 19 dessins sur l'œuvre
    await expect(page.locator('#density-note')).toContainText('19 sur 19');
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
    // le nombre de dessins revient au réglage habituel
    expect(await page.locator('#density').inputValue()).toBe('1.1');
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
    // atelier Impression : tirages et fichier HD ; une proposition (pas celle affichée), en tableau encadré
    await page.evaluate(() => AtelierGribouille.setMode('impression'));
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
  test('elle sélectionne une zone de couleur ; on la gomme ou on la restaure ; la sensibilité règle son étendue', async ({ page }) => {
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
    // la baguette sélectionne seulement : la découpe ne change pas encore
    expect(await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.red)).toBeGreaterThan(0);
    await expect(page.locator('#ed-selbar')).toBeVisible();
    await expect(page.locator('#ed-undo')).toBeDisabled();
    // gommer la sélection
    await page.locator('#ed-sel-erase').click();
    await expect(page.locator('#ed-selbar')).toBeHidden();
    await expect(page.locator('#ed-undo')).toBeEnabled();
    await page.locator('#ed-apply').click();
    const n1 = await opaque();
    expect(n1).toBeLessThan(n0 * 0.95);
    // désélectionner ne change rien ; défaire après gommer non plus
    await open();
    await page.locator('#editor [data-tool="wand"]').click();
    await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.red);
    await page.locator('#ed-sel-clear').click();
    await expect(page.locator('#ed-selbar')).toBeHidden();
    await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.red);
    await page.locator('#ed-sel-erase').click();
    await page.locator('#ed-undo').click();
    await page.locator('#ed-apply').click();
    expect(Math.abs((await opaque()) - n1)).toBeLessThan(n1 * 0.01);
    // à côté, sur le papier : la sélection suit la sensibilité, « Ajouter » l'agrandit, Restaurer l'ajoute à la découpe
    await open();
    await page.locator('#editor [data-tool="wand"]').click();
    await page.locator('#ed-tol').fill('5');
    const small = await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.paper);
    await page.locator('#ed-tol').fill('40');
    const large = await page.evaluate(() => Editor.selection());
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThanOrEqual(small);
    await page.locator('#ed-sel-add').click();
    await expect(page.locator('#ed-sel-add')).toHaveAttribute('aria-pressed', 'true');
    const both = await page.evaluate(({ x, y }) => Editor.wand(x, y), pts.red);
    expect(both).toBeGreaterThan(large);
    await page.locator('#ed-sel-restore').click();
    await page.locator('#ed-apply').click();
    expect(await opaque()).toBeGreaterThan(n1);
  });

  test('sur téléphone : un toucher sélectionne, puis « Gommer » applique', async ({ browser }) => {
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
    await expect(page.locator('#ed-tip')).toContainText('sélectionner');
    await expect(page.locator('#ed-undo')).toBeDisabled();
    const box = await page.locator('#ed-canvas').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#ed-selbar')).toBeVisible();
    await expect(page.locator('#ed-undo')).toBeDisabled(); // rien n'est encore changé
    await page.locator('#ed-sel-erase').tap();
    await expect(page.locator('#ed-undo')).toBeEnabled(); // la zone a été gommée (défaire possible)
    await ctx.close();
  });
});

test.describe('Réponses tardives de Claude', () => {
  test('une œuvre déplacée à la main n’est pas refaite quand Claude répond ensuite', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    // Claude simulé : la direction artistique répond tout de suite, le regard sur les découpes attend un signal
    await page.addInitScript(() => {
      let release;
      window.__late = new Promise((r) => { release = r; });
      window.__release = () => release();
      const sample = {
        limits: async () => ({ images: { maxCount: 4 } }),
        json: async (prompt) => {
          if (/directeur artistique/.test(prompt)) return { dessins: [1, 2, 3].map((n) => ({ n, sujet: 'dessin', role: 'decoupe', zone: 'milieu' })) };
          await window.__late;
          return { elements: [] };
        },
      };
      window.claude = { use: async (k) => (k === 'sample' ? sample : null) };
    });
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', ['page-cutout.png', 'page-two.png', 'page-texture.png'].map(fixture));
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 3 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden);
    await expect(page.locator('#ai-status')).toContainText('éléments découpés', { timeout: 30000 });
    // on déplace une pièce à la souris pendant que Claude regarde encore
    const pt = await page.evaluate(() => {
      const A = AtelierGribouille, v = A.view, L = A.state.comp.items[0];
      const r = document.getElementById('canvas').getBoundingClientRect();
      return { x: r.left + (L.x * v.s + v.ox) / v.dpr, y: r.top + (L.y * v.s + v.oy) / v.dpr };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 40, pt.y + 25, { steps: 6 });
    await page.mouse.up();
    const before = await page.evaluate(() => { const c = AtelierGribouille.state.comp; window.__comp = c; return c.items.map((L) => [L.x, L.y, L.rot]); });
    await page.evaluate(() => window.__release());
    await expect(page.locator('#ai-status')).toContainText('Direction artistique', { timeout: 30000 });
    const after = await page.evaluate(() => ({ same: AtelierGribouille.state.comp === window.__comp, items: AtelierGribouille.state.comp.items.map((L) => [L.x, L.y, L.rot]) }));
    expect(after.same).toBe(true);
    expect(after.items).toEqual(before);
  });
});

test.describe('Rendu pendant un glissement', () => {
  test('ne redessiner que la zone de la pièce donne exactement l’image complète', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const pixels = () => page.evaluate(async () => {
      const c = document.getElementById('canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const h = await crypto.subtle.digest('SHA-1', d);
      return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
    });
    for (const style of ['paysage', 'tournesol']) {
      await app.select(style);
      await frames();
      const pt = await page.evaluate(() => {
        const A = AtelierGribouille, v = A.view, L = A.state.comp.items[0];
        const r = document.getElementById('canvas').getBoundingClientRect();
        return { x: r.left + (L.x * v.s + v.ox) / v.dpr, y: r.top + (L.y * v.s + v.oy) / v.dpr };
      });
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      for (let j = 1; j <= 12; j++) { await page.mouse.move(pt.x + j * 9, pt.y + j * 5); await frames(); }
      await page.mouse.up();
      await frames();
      const partial = await pixels();
      await page.evaluate(() => AtelierGribouille.render());
      await frames();
      expect(await pixels()).toBe(partial);
    }
  });
});

test.describe('Découpe apprise des retouches', () => {
  test('gommer un sujet entier apprend « sujets voisins séparés », proposé aux autres dessins, mémorisé', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const k = await page.evaluate(() => { const ps = AtelierGribouille.state.drawings[0].analysis.pieces; return ps.indexOf(ps.reduce((a, b) => (a.canvas.width * a.canvas.height > b.canvas.width * b.canvas.height ? a : b))); });
    const pts = await page.evaluate((k) => {
      const d = AtelierGribouille.state.drawings[0], p = d.analysis.pieces[k], c = p.canvas;
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; if (px[i + 3] > 250 && px[i] > 180 && px[i + 1] < 90 && px[i + 2] < 90) return { x: p.src.x + x, y: p.src.y + y }; }
      return null;
    }, k);
    expect(pts).not.toBeNull();
    const piecesOf = (i) => page.evaluate((i) => AtelierGribouille.state.drawings[i].analysis.pieces.map((p) => p.id), i);
    const before1 = await piecesOf(1);
    // la retouche : la baguette sélectionne le corps rouge (un sujet entier, coloré), on le gomme
    await page.evaluate((k) => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[k]), k);
    await page.locator('#editor [data-tool="wand"]').click();
    await page.locator('#ed-tol').fill('40');
    expect(await page.evaluate(({ x, y }) => Editor.wand(x, y), pts)).toBeGreaterThan(0);
    await page.locator('#ed-sel-erase').click();
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    // apprise : les sujets voisins seront séparés (fermeture réduite), mémorisé dans ce navigateur
    await expect(page.locator('#cut-learned')).toBeVisible();
    await expect(page.locator('#drawings-section')).not.toHaveClass(/collapsed/); // la section s'est ouverte
    await expect(page.locator('#cut-learned span')).toContainText('sujets voisins séparés');
    expect(await page.evaluate(() => Extract.cutPrefs().close)).toBeLessThan(0.03);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atelier.decoupe')).close)).toBeLessThan(0.03);
    // appliquée à l'autre dessin : ses pièces sont refaites, la retouche du premier est gardée
    await expect(page.locator('#cut-learned button.link')).toHaveText(/1 autres? dessins?/);
    await page.locator('#cut-learned button.link').click();
    await expect(page.locator('#cut-learned')).toBeHidden();
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await piecesOf(1)).not.toEqual(before1);
    expect(await page.evaluate((k) => !!AtelierGribouille.state.drawings[0].analysis.pieces[k].edited, k)).toBe(true);
    // plus de rappel permanent de la découpe apprise dans l'atelier
    await expect(page.locator('#cut-prefs')).toHaveCount(0);
  });
});

test.describe('Retouches partagées (option)', () => {
  test('case cochée par défaut ; décochée, mémorisé et rien n’est envoyé ; cochée, une retouche envoie image, découpes et fiche ; décochée, rien', async ({ page }) => {
    const { fixture } = require('./helpers');
    const sent = [];
    await page.route('**/vendor/supabase.js', (r) => r.fulfill({ contentType: 'text/javascript', body: '// remplacé par le faux' }));
    // (l'hôte Supabase autorisé par la politique de sécurité de la page ; les requêtes sont interceptées, jamais envoyées)
    const host = 'https://yfrerlyndrpfgerkbkyr.supabase.co';
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.ATELIER_CONFIG = { supabaseUrl: '${host}', supabaseAnonKey: 'anon' };` }));
    await page.route(host + '/**', (r) => {
      const req = r.request();
      sent.push({ url: req.url(), method: req.method(), type: req.headers()['content-type'] || '', apikey: req.headers().apikey, body: /json/.test(req.headers()['content-type'] || '') ? req.postData() : null });
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#share-cuts')).toBeVisible();
    await expect(page.locator('#share-cuts-box')).toBeChecked();
    // décochée (refus mémorisé) avant l'import
    await page.locator('#share-cuts-box').uncheck();
    expect(await page.evaluate(() => localStorage.getItem('atelier.partage-decoupes'))).toBe('0');
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const k = await page.evaluate(() => { const ps = AtelierGribouille.state.drawings[0].analysis.pieces; return ps.indexOf(ps.reduce((a, b) => (a.canvas.width * a.canvas.height > b.canvas.width * b.canvas.height ? a : b))); });
    const edit = async () => {
      await page.evaluate((k) => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[k]), k);
      await page.locator('#ed-size').fill('140');
      const box = await page.locator('#ed-canvas').boundingBox();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.3 + 0.03 * i), box.y + box.height * 0.5);
      await page.mouse.up();
      await page.locator('#ed-apply').click();
      await expect(page.locator('#editor')).toBeHidden();
    };
    // décochée : une retouche n'envoie rien
    await edit();
    await page.waitForTimeout(800);
    expect(sent.filter((r) => /retouches/.test(r.url))).toHaveLength(0);
    // cochée (mémorisée) : image, les deux découpes, la fiche, puis la ligne en base
    await page.locator('#share-cuts-box').check();
    expect(await page.evaluate(() => localStorage.getItem('atelier.partage-decoupes'))).toBe('1');
    await edit();
    await expect.poll(() => sent.filter((r) => /rest\/v1\/retouches/.test(r.url)).length, { timeout: 15000 }).toBe(1);
    const files = sent.filter((r) => /storage\/v1\/object\/retouches\//.test(r.url));
    expect(files.map((r) => r.url.split('/').pop()).sort()).toEqual(['auto.png', 'corrige.png', 'image.jpg', 'meta.json']);
    expect(files.every((r) => r.method === 'POST' && r.apikey === 'anon')).toBe(true);
    expect(files.find((r) => /image\.jpg$/.test(r.url)).type).toBe('image/jpeg');
    expect(files.every((r) => /\/retouches\/\d{4}-\d{2}\/[0-9a-f-]+\/[a-z.]+$/.test(r.url))).toBe(true);
    const row = JSON.parse(sent.find((r) => /rest\/v1\/retouches/.test(r.url)).body);
    expect(row.path).toMatch(/^\d{4}-\d{2}\/[0-9a-f-]+$/);
    expect(row.meta.page.w).toBeGreaterThan(0);
    expect(row.meta.corrected.w).toBeGreaterThan(0);
    expect(JSON.stringify(row.meta)).not.toMatch(/page-cutout|\.png/);
    // décochée à nouveau : plus rien
    await page.locator('#share-cuts-box').uncheck();
    expect(await page.evaluate(() => localStorage.getItem('atelier.partage-decoupes'))).toBe('0');
    const n = sent.length;
    await edit();
    await page.waitForTimeout(800);
    expect(sent.length).toBe(n);
  });

  test('sans réglage Supabase, la case n’apparaît pas', async ({ app }) => {
    await expect(app.page.locator('#share-cuts')).toBeHidden();
  });
});

test.describe('Tiroir au doigt sur téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('la poignée suit le doigt, puis le tiroir se cale : agrandi, normal, barre seule', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const panelH = async () => (await page.locator('.panel').boundingBox()).height;
    const drag = async (dy, { release = true } = {}) => {
      const t = await page.locator('#sheet-tabs').boundingBox();
      const x = t.x + t.width / 2, y = t.y + 8;
      await touch('touchStart', x, y);
      for (let i = 1; i <= 10; i++) { await touch('touchMove', x, y + (dy * i) / 10); await page.waitForTimeout(30); }
      if (release) { await touch('touchEnd', 0, 0); await page.waitForTimeout(400); } // fin du glissement
    };
    const h0 = await panelH();
    expect(h0).toBeGreaterThan(300); // 42 % de 844
    // pendant le geste, le tiroir suit le doigt
    await drag(-200, { release: false });
    expect(Math.abs((await panelH()) - (h0 + 200))).toBeLessThan(12);
    await expect(page.locator('body')).toHaveClass(/sheet-drag/);
    await touch('touchEnd', 0, 0);
    await expect(page.locator('body')).not.toHaveClass(/sheet-drag/);
    // lâché à 554 px : plus près de 726 (agrandi) que de 354
    await expect(page.locator('body')).toHaveClass(/sheet-tall/);
    await page.waitForTimeout(400);
    expect(Math.abs((await panelH()) - 844 * 0.86)).toBeLessThan(12);
    // vers le bas, lentement et un peu : retour à la hauteur normale
    await drag(300);
    await expect(page.locator('body')).not.toHaveClass(/sheet-tall/);
    await expect(page.locator('body')).not.toHaveClass(/stage-full/);
    // encore vers le bas : il ne reste que la barre (plein écran)
    await drag(250);
    await expect(page.locator('body')).toHaveClass(/stage-full/);
    const tabs = await page.locator('#sheet-tabs').boundingBox();
    expect(Math.round(tabs.y + tabs.height)).toBe(844);
    // remonté depuis la barre seule : hauteur normale, plein écran quitté
    await drag(-220);
    await expect(page.locator('body')).not.toHaveClass(/stage-full/);
    await expect(page.locator('body')).not.toHaveClass(/sheet-tall/);
    // un simple toucher sur un onglet reste un toucher
    await page.locator('#sheet-tabs [data-tab="drawings-section"]').tap();
    await expect(page.locator('#drawings-section')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/sheet-drag/);
  });
});

test.describe('Plein écran sur téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('le tiroir descend jusqu’à la barre des sections ; une section touchée le fait remonter', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    await page.locator('#zoom-full').click();
    await expect(page.locator('body')).toHaveClass(/stage-full/);
    await page.waitForTimeout(450); // fin du glissement
    const tabs = await page.locator('#sheet-tabs').boundingBox();
    const panel = await page.locator('.panel').boundingBox();
    const canvas = await page.locator('#canvas').boundingBox();
    expect(Math.round(tabs.y + tabs.height)).toBe(844); // barre posée en bas de l'écran
    expect(panel.height).toBeLessThanOrEqual(tabs.height + 1); // rien d'autre du tiroir
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(tabs.y + 1); // l'œuvre au-dessus de la barre
    await expect(page.locator('#sheet-tabs [data-tab="drawings-section"]')).toBeVisible();
    await page.locator('#sheet-tabs [data-tab="drawings-section"]').click();
    await expect(page.locator('body')).not.toHaveClass(/stage-full/);
    await expect(page.locator('#drawings-section')).toBeVisible();
  });
});

test.describe('Taille d’un dessin changée sur l’œuvre', () => {
  test('A4 et A2 : la taille exacte est gardée et la puce s’allume (pas d’arrondi au demi-centimètre)', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    await page.evaluate(() => document.querySelector('#drawings .thumb').click());
    for (const [name, cm] of [['A4', 29.7], ['A2', 59.4], ['A5', 21]]) {
      await page.evaluate((name) => [...document.querySelectorAll('#detail [data-cm]')].find((b) => b.textContent.trim() === name).click(), name);
      expect(await page.evaluate(() => AtelierGribouille.state.current.sizeCm)).toBe(cm);
      await expect(page.locator('#detail [data-cm].on')).toHaveText(name);
      await expect(page.locator('#detail [data-custom]')).toBeHidden();
    }
    // une valeur saisie proche d'un format standard (ou mémorisée arrondie par une ancienne version) y revient
    await page.evaluate(() => [...document.querySelectorAll('#detail [data-cm]')].find((b) => b.dataset.cm === 'custom').click());
    await page.evaluate((v) => { const i = document.querySelector('#detail [data-custom] input'); i.value = v; i.dispatchEvent(new Event('change')); }, '29.5');
    expect(await page.evaluate(() => AtelierGribouille.state.current.sizeCm)).toBe(29.7);
    await expect(page.locator('#detail [data-cm].on')).toHaveText('A4');
    await page.evaluate(() => [...document.querySelectorAll('#detail [data-cm]')].find((b) => b.dataset.cm === 'custom').click());
    await page.evaluate((v) => { const i = document.querySelector('#detail [data-custom] input'); i.value = v; i.dispatchEvent(new Event('change')); }, '33.3');
    expect(await page.evaluate(() => AtelierGribouille.state.current.sizeCm)).toBe(33.3);
    await expect(page.locator('#detail [data-cm].on')).toHaveText('Autre…');
  });

  test('les dessins restent en place : seul le dessin réglé change de taille, autour de son centre', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    await app.select('tournesol');
    // une retouche à la main, qui doit survivre
    await page.evaluate(() => { const L = AtelierGribouille.state.comp.items[0]; L.x += 2; L.rot = 0.2; AtelierGribouille.render(); });
    const layers = () => page.evaluate(() => {
      const A = AtelierGribouille, c = A.state.comp;
      const nameOf = (L) => (L.kind === 'piece' ? L.piece.drawing.name : (A.state.drawings.find((d) => d.analysis.texture && d.analysis.texture.canvas === L.src) || {}).name || 'papier');
      return { style: c.style, all: c.bg.concat(c.items).map((L) => ({ d: nameOf(L), x: L.x, y: L.y, rot: L.rot, w: L.w })) };
    });
    const before = await layers();
    await page.evaluate(() => document.querySelector('#drawings .thumb').click());
    const d0 = await page.evaluate(() => ({ name: AtelierGribouille.state.current.name, cm: AtelierGribouille.state.current.sizeCm }));
    await page.evaluate((big) => [...document.querySelectorAll('#detail [data-cm]')].find((b) => b.textContent.trim() === (big ? 'A4' : 'A3')).click(), d0.cm > 35);
    const d1 = await page.evaluate(() => AtelierGribouille.state.current.sizeCm);
    expect(d1).not.toBe(d0.cm);
    const after = await layers();
    expect(after.style).toBe(before.style);
    expect(after.all.length).toBe(before.all.length);
    after.all.forEach((L, i) => {
      const B = before.all[i];
      expect(L.d).toBe(B.d);
      expect(L.x).toBeCloseTo(B.x, 6);
      expect(L.y).toBeCloseTo(B.y, 6);
      expect(L.rot).toBeCloseTo(B.rot, 6);
      if (L.d === d0.name) expect(L.w / B.w).toBeCloseTo(d1 / d0.cm, 3);
    });
    expect(after.all.some((L) => L.d === d0.name)).toBe(true);
    // Défaire rend les tailles d'avant sur l'œuvre
    await page.evaluate(() => AtelierGribouille.undo());
    const undone = await layers();
    undone.all.forEach((L, i) => expect(L.w).toBeCloseTo(before.all[i].w, 6));
  });
});

test.describe('Défaire une retouche', () => {
  test('la copie retouchée revient telle qu’avant, sans être déformée, et Refaire rétablit la retouche', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    await page.evaluate(() => {
      const A = AtelierGribouille, p0 = A.state.drawings[0].analysis.pieces[0];
      A.state.selected = A.state.comp.items.find((L) => L.piece === p0); A.render();
    });
    await page.locator('#toolbar [data-act="dup"]').click();
    const copyState = () => page.evaluate(() => {
      const A = AtelierGribouille, L = A.state.comp.items.find((x) => x.piece.copyOf);
      return { cw: L.piece.canvas.width, ch: L.piece.canvas.height, w: L.w, h: L.h, x: L.x, y: L.y, edited: !!L.piece.edited };
    });
    const s0 = await copyState();
    // retoucher la copie : toute la moitié gauche effacée, la découpe change de forme
    await page.locator('#toolbar [data-act="edit"]').click();
    await expect(page.locator('#editor')).toBeVisible();
    await page.locator('#ed-size').fill('140');
    const box = await page.locator('#ed-canvas').boundingBox();
    for (const fx of [0.05, 0.15, 0.25, 0.35, 0.45]) {
      await page.mouse.move(box.x + box.width * fx, box.y + 2);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * fx, box.y + box.height * i / 20 - 2);
      await page.mouse.up();
    }
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    const s1 = await copyState();
    expect(s1.edited).toBe(true);
    expect(Math.abs(s1.cw / s1.ch - s0.cw / s0.ch)).toBeGreaterThan(0.05); // la forme a changé
    const ratio = (s) => (s.w / s.h) / (s.cw / s.ch); // 1 : l'image n'est pas déformée
    expect(ratio(s1)).toBeCloseTo(1, 2);
    // Défaire : la copie d'avant, à sa place, sans déformation
    await page.locator('#toolbar [data-act="undo"]').click();
    const s2 = await copyState();
    expect(s2.cw).toBe(s0.cw);
    expect(s2.ch).toBe(s0.ch);
    expect(s2.w).toBeCloseTo(s0.w, 6);
    expect(s2.x).toBeCloseTo(s0.x, 6);
    expect(s2.edited).toBe(false);
    expect(ratio(s2)).toBeCloseTo(1, 2);
    // Refaire : la retouche revient
    await page.locator('#toolbar [data-act="redo"]').click();
    const s3 = await copyState();
    expect(s3.cw).toBe(s1.cw);
    expect(s3.w).toBeCloseTo(s1.w, 6);
    expect(ratio(s3)).toBeCloseTo(1, 2);
  });
});

test.describe('Gestes au doigt sur iPhone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('ni sélection de texte ni loupe du système ; la gomme agit, le double-toucher zoome toujours', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    // l'œuvre : un double-toucher dans le vide zoome
    const pt = await page.evaluate(() => {
      const A = AtelierGribouille, c = A.state.comp, v = A.view, r = document.getElementById('canvas').getBoundingClientRect();
      for (let fy = 0.05; fy < 1; fy += 0.05) for (let fx = 0.05; fx < 1; fx += 0.05) {
        const X = c.W * fx, Y = c.H * fy;
        if (!c.items.some((L) => Compose.hitItem(L, X, Y))) return { x: r.left + (X * v.s + v.ox) / v.dpr, y: r.top + (Y * v.s + v.oy) / v.dpr };
      }
      return null;
    });
    expect(pt).not.toBeNull();
    await page.touchscreen.tap(pt.x, pt.y);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(pt.x, pt.y);
    await expect(page.locator('#zoom-val')).toHaveText('250 %');
    // la fenêtre de retouche : aucun texte sélectionnable, pas de menu d'appui long
    await page.evaluate(() => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[0]));
    const css = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('editor')); return [s.userSelect || s.webkitUserSelect, s.webkitTouchCallout]; });
    expect(css[0]).toBe('none');
    const prevented = await page.evaluate(() => {
      const c = document.getElementById('ed-canvas'), r = c.getBoundingClientRect();
      const t = new Touch({ identifier: 1, target: c, clientX: r.left + 20, clientY: r.top + 20 });
      const ev = new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], cancelable: true, bubbles: true });
      c.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
    // un trait de gomme au doigt : la découpe change (défaire possible)
    const box = await page.locator('#ed-canvas').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', box.x + box.width * 0.3, box.y + box.height * 0.5);
    for (let i = 1; i <= 10; i++) await touch('touchMove', box.x + box.width * (0.3 + i * 0.04), box.y + box.height * 0.5);
    await touch('touchEnd');
    await expect(page.locator('#ed-undo')).toBeEnabled();
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
    await page.locator('#ed-cancel').click();
  });
});

test.describe('Fond de toile conseillé', () => {
  test('la teinte conseillée dépend des couleurs de l’œuvre : contraste, pas de confusion, calme sous les dessins très colorés', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const mk = (draw) => { const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 200, 200); draw(x); return c; };
      const piece = (c) => ({ canvas: c, wcm: 20, hcm: 20, color: [0, 0, 0], colorful: 0.5 });
      const hsl = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; const d = mx - mn; const s = !d ? 0 : l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); let h = !d ? 0 : mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: h * 60, s, l: l * 255 }; };
      const cases = {
        orange: mk((x) => { x.fillStyle = '#e8722a'; x.fillRect(20, 20, 160, 160); }),
        bleu: mk((x) => { x.fillStyle = '#2a5fd0'; x.fillRect(20, 20, 160, 160); }),
        crayon: mk((x) => { x.strokeStyle = '#9a9a9a'; x.lineWidth = 3; for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(20, 20 + i * 14); x.lineTo(180, 30 + i * 14); x.stroke(); } }),
        multi: mk((x) => { ['#e8722a', '#2a5fd0', '#c9322b', '#f6cf1e', '#1f8a5a'].forEach((col, i) => { x.fillStyle = col; x.fillRect(10 + i * 36, 10, 34, 180); }); }),
      };
      const out = {};
      for (const [k, c] of Object.entries(cases)) { const p = AtelierGribouille.pickGround({ pieces: [piece(c)], textures: [] }, 'paysage'); out[k] = Object.assign({ name: p[0], hex: p[1] }, hsl(p[1])); }
      out.nuage = hsl(AtelierGribouille.pickGround({ pieces: [piece(cases.multi)], textures: [] }, 'nuage')[1]);
      return out;
    });
    const hueDist = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); };
    // un dessin orange : jamais un fond orange, ocre ou rouge (il s'y fondrait)
    expect(r.orange.s < 0.2 || hueDist(r.orange.h, 25) > 50).toBe(true);
    // un dessin bleu : jamais un fond bleu
    expect(r.bleu.s < 0.2 || hueDist(r.bleu.h, 220) > 50).toBe(true);
    // des dessins différents n'ont pas le même fond conseillé
    expect(r.orange.hex).not.toBe(r.bleu.hex);
    // un dessin pâle au crayon : une teinte moyenne, ni blanche ni noire
    expect(r.crayon.l).toBeGreaterThan(60);
    expect(r.crayon.l).toBeLessThan(210);
    // des dessins très colorés : un fond peu saturé
    expect(r.multi.s).toBeLessThanOrEqual(0.5);
    // Nuage : un fond clair
    expect(r.nuage.l).toBeGreaterThanOrEqual(150);
  });
});

test.describe('Cartel sur ordinateur', () => {
  test('le cartel ne passe jamais sous la barre de densité ni sous la barre d’outils, quelle que soit la largeur', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    // un compteur long (« tout ») et un cartel long
    await page.evaluate(() => { const d = document.getElementById('density'); d.value = d.max; d.dispatchEvent(new Event('change')); });
    await page.evaluate(() => AtelierGribouille.setMode('impression'));
    await page.evaluate(() => { const f = document.getElementById('format'); f.value = 'cadre:29.7x21'; f.dispatchEvent(new Event('change')); });
    for (const width of [1680, 1440, 1366, 1280, 1150, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const r = await page.evaluate(() => {
        const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        const label = box(document.getElementById('label')), dens = box(document.getElementById('density-bar')), zoom = box(document.querySelector('.zoom'));
        return { dens: hit(label, dens), zoom: hit(label, zoom), text: document.getElementById('label-meta').textContent.length };
      });
      expect(r.text).toBeGreaterThan(60);
      expect(r.dens, `cartel sur la densité à ${width} px`).toBe(false);
      expect(r.zoom, `cartel sur la barre d'outils à ${width} px`).toBe(false);
    }
  });
});

test.describe('Couleur du fond à portée de main', () => {
  test('la pastille près de l’œuvre ouvre la palette ; une teinte s’applique tout de suite, les deux nuanciers restent d’accord', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    await expect(page.locator('#ground-open')).toBeVisible();
    await expect(page.locator('#ground-pop')).toBeHidden();
    // la pastille montre la couleur peinte sur l'œuvre affichée
    const dot0 = await page.evaluate(() => ({ dot: getComputedStyle(document.getElementById('ground-open')).getPropertyValue('--dot').trim().toLowerCase(), ground: String(AtelierGribouille.state.comp.ground || '#f4f2ec').toLowerCase() }));
    expect(dot0.dot).toBe(dot0.ground);
    await page.locator('#ground-open').click();
    await expect(page.locator('#ground-pop')).toBeVisible();
    // une teinte différente de l'actuelle
    const hex = await page.evaluate(() => [...document.querySelectorAll('#ground-quick button')].map((b) => b.dataset.hex).find((h) => h && h !== 'auto' && h !== AtelierGribouille.state.comp.ground));
    await page.locator(`#ground-quick button[data-hex="${hex}"]`).click();
    expect(await page.evaluate(() => AtelierGribouille.state.comp.ground)).toBe(hex);
    await expect(page.locator(`#ground-quick button[data-hex="${hex}"]`)).toHaveClass(/on/);
    await expect(page.locator(`#ground button[data-hex="${hex}"]`)).toHaveClass(/on/);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('ground-open')).getPropertyValue('--dot').trim().toLowerCase())).toBe(hex.toLowerCase());
    // la palette reste ouverte pour essayer d'autres teintes ; Échap la ferme
    await expect(page.locator('#ground-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ground-pop')).toBeHidden();
    // en Galerie (fond blanc fixe) : pas de palette
    await app.select('galerie');
    await expect(page.locator('#ground-open')).toBeDisabled();
  });

  test('toute nouvelle création part en couleur automatique ; une œuvre rouverte garde la sienne', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    const hex = await page.evaluate(() => [...document.querySelectorAll('#ground-quick button')].map((b) => b.dataset.hex).find((h) => h && h !== 'auto' && h !== AtelierGribouille.state.comp.ground));
    await page.evaluate((h) => document.querySelector(`#ground-quick button[data-hex="${h}"]`).click(), hex);
    expect(await page.evaluate(() => AtelierGribouille.state.ground)).toBe(hex);
    // le brouillon garde la couleur choisie
    const draft = () => page.evaluate(() => new Promise((res) => { const q = indexedDB.open('atelier-gribouille'); q.onsuccess = () => { const g = q.result.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }; q.onerror = () => res(null); }));
    for (let i = 0; i < 60; i++) { const r = await draft(); if (r && r.settings && r.settings.ground === hex) break; await page.waitForTimeout(500); }
    // rechargement : l'œuvre en cours se rouvre avec sa couleur
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.ground)).toBe(hex);
    // une nouvelle création : couleur automatique
    await page.goto('index.html?nouveau');
    await page.waitForFunction(() => window.AtelierGribouille);
    expect(await page.evaluate(() => AtelierGribouille.state.ground)).toBe('auto');
    await app.import(['page-texture.png']);
    expect(await page.evaluate(() => AtelierGribouille.state.ground)).toBe('auto');
    await expect(page.locator('#ground-quick button[data-hex="auto"]')).toHaveClass(/on/);
  });

  test('sur téléphone, la pastille est dans la barre de droite et la palette tient dans l’écran', async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 390, height: 844 });
    await app.import(['page-cutout.png', 'page-two.png']);
    await page.locator('#ground-open').click();
    await expect(page.locator('#ground-pop')).toBeVisible();
    const r = await page.evaluate(() => { const b = document.getElementById('ground-pop').getBoundingClientRect(); return { l: b.left, r: b.right, w: innerWidth }; });
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.r).toBeLessThanOrEqual(r.w);
    await page.mouse.click(20, 400);
    await expect(page.locator('#ground-pop')).toBeHidden();
  });
});

test.describe('Fond de toile sur une œuvre retouchée', () => {
  test('changer la couleur du fond garde les dessins où on les a mis ; Défaire rend l’ancien fond', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    await app.select('tournesol');
    // une pièce déplacée à la main
    const pt = await page.evaluate(() => { const A = AtelierGribouille, v = A.view, L = A.state.comp.items[0]; const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + (L.x * v.s + v.ox) / v.dpr, y: r.top + (L.y * v.s + v.oy) / v.dpr }; });
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + 60, pt.y + 30, { steps: 6 }); await page.mouse.up();
    const before = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { ground: c.ground, items: c.items.map((L) => [L.x, L.y, L.rot]) }; });
    // une autre couleur de fond
    await page.evaluate(() => { const b = [...document.querySelectorAll('#ground button')].find((x) => x.dataset.hex && x.dataset.hex !== 'auto' && x.dataset.hex !== AtelierGribouille.state.comp.ground); b.click(); });
    const after = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { style: c.style, ground: c.ground, items: c.items.map((L) => [L.x, L.y, L.rot]) }; });
    expect(after.style).toBe('tournesol');
    expect(after.ground).not.toBe(before.ground);
    expect(after.items).toEqual(before.items);
    await page.evaluate(() => AtelierGribouille.undo());
    expect(await page.evaluate(() => AtelierGribouille.state.comp.ground)).toBe(before.ground);
  });

  test('sur une œuvre rouverte (brouillon), changer la couleur du fond s’applique, la mise en place reste', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    await app.select('tournesol');
    const draft = () => page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => { const g = q.result.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); };
      q.onerror = () => res(null);
    }));
    for (let i = 0; i < 60; i++) { const r = await draft(); if (r && r.drawings.length === 3 && r.comp && r.comp.style === 'tournesol') break; await page.waitForTimeout(500); }
    // l'œuvre en cours est rouverte d'elle-même : composition épinglée telle quelle
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.drawings.length === 3 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { style: c.style, ground: c.ground, pinned: AtelierGribouille.state.pinned === c, items: c.items.map((L) => [L.x, L.y, L.rot]) }; });
    expect(before.pinned).toBe(true);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#ground button')].find((x) => x.dataset.hex && x.dataset.hex !== 'auto' && x.dataset.hex !== AtelierGribouille.state.comp.ground); b.click(); });
    const after = await page.evaluate(() => { const c = AtelierGribouille.state.comp; return { style: c.style, ground: c.ground, items: c.items.map((L) => [L.x, L.y, L.rot]) }; });
    expect(after.style).toBe(before.style);
    expect(after.ground).not.toBe(before.ground);
    expect(after.ground).toBe(await page.evaluate(() => AtelierGribouille.state.ground));
    expect(after.items).toEqual(before.items);
  });
});
