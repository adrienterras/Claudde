const { test, expect, openStep } = require('./helpers');

test.describe('Réouverture sur un appareil plus petit', () => {
  test('une page sauvegardée plus grande que ce que l’appareil porte est réduite, pièces et repères avec elle', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    const r = await page.evaluate(async () => {
      const A = AtelierGribouille, d = A.state.drawings[0];
      const saved = await A.savedOf(d, false);
      const long0 = Math.max(saved.page.w || 0, saved.page.h || 0) || Math.max(d.analysis.page.width, d.analysis.page.height);
      const a = await A.restoreAnalysis(saved, 400);
      const k = 400 / long0;
      const p0 = saved.pieces[0], q0 = a.pieces[0];
      return {
        long0, long: Math.max(a.page.width, a.page.height), n: a.pieces.length, n0: saved.pieces.length,
        w0: p0.w, w: q0.canvas.width, srcx0: p0.src.x, srcx: q0.src.x, k,
        hit: q0.hit.w > 0 && q0.hit.data.some((v) => v === 1),
        opaque: (() => { const c = q0.canvas, dd = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < dd.length; i += 4) if (dd[i] > 127) n++; return n / (c.width * c.height); })(),
        budgetPhone: A.sourceMax(28),
      };
    });
    expect(r.long0).toBeGreaterThan(420);
    expect(r.long).toBe(400);
    expect(r.n).toBe(r.n0);
    expect(r.w).toBe(Math.max(1, Math.round(r.w0 * r.k)));
    expect(r.srcx).toBeCloseTo(r.srcx0 * r.k, 3);
    expect(r.hit).toBe(true);
    expect(r.opaque).toBeGreaterThan(0.05); // la pièce réduite garde son dessin sous le masque
    // sans réduction demandée : la page garde sa taille
    const same = await page.evaluate(async () => { const A = AtelierGribouille, d = A.state.drawings[0]; const a = await A.restoreAnalysis(await A.savedOf(d, false)); return Math.max(a.page.width, a.page.height); });
    expect(same).toBe(r.long0);
  });
});

test.describe('Mes œuvres', () => {
  test('rangée par « nouvelle œuvre », rouverte après rechargement : la mise en place est identique ; dupliquer, supprimer', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png', 'photo-wood.png']);
    await app.select('tournesol');
    const before = await page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      c.items[0].x += 3.5; c.items[0].rot = 0.3; // une retouche manuelle doit être conservée
      return { style: c.style, n: c.items.length, bg: c.bg.length, first: [c.items[0].x, c.items[0].y, c.items[0].rot], W: c.W, H: c.H };
    });
    // l'œuvre s'enregistre d'elle-même (rien à sauvegarder) : en tête de Mes œuvres, « en cours »
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1, { timeout: 30000 });
    // « nouvelle œuvre » la range dans Mes œuvres (la retouche manuelle comprise)
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(0);
    await expect(page.locator('.saved .saved-meta')).toContainText('4 dessins');
    await expect(page.locator('.saved .saved-meta')).toContainText('Collage des originaux'); // le type d'œuvre

    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    // la carte « travail en cours » s'affiche au centre de la scène pendant la réouverture
    await page.evaluate(() => {
      window.__busy = [];
      const note = () => { const b = document.getElementById('busy'); if (!b.hidden) window.__busy.push(document.getElementById('busy-title').textContent + ' | ' + document.getElementById('busy-step').textContent); };
      new MutationObserver(note).observe(document.getElementById('busy'), { attributes: true, subtree: true, childList: true, characterData: true });
    });
    await openStep(page, 'saved-section');
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    await expect(page.locator('#busy')).toBeHidden();
    const seen = await page.evaluate(() => window.__busy);
    expect(seen.some((t) => /^Réouverture de « .+ »/.test(t) && /Lecture du dessin/.test(t))).toBe(true);
    const after = await page.evaluate(() => {
      const c = AtelierGribouille.state.comp;
      return { style: c.style, n: c.items.length, bg: c.bg.length, first: [c.items[0].x, c.items[0].y, c.items[0].rot], W: c.W, H: c.H, drawings: AtelierGribouille.state.drawings.length };
    });
    expect(after.style).toBe(before.style);
    expect(after.n).toBe(before.n);
    expect(after.bg).toBe(before.bg);
    expect(after.W).toBeCloseTo(before.W, 3);
    expect(after.first[0]).toBeCloseTo(before.first[0], 3);
    expect(after.first[1]).toBeCloseTo(before.first[1], 3);
    expect(after.first[2]).toBeCloseTo(before.first[2], 3);
    expect(after.drawings).toBe(4);
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1);
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);

    // « Dupliquer » : une copie rejoint Mes œuvres, on reste sur l'œuvre
    await openStep(page, 'export-section');
    await page.locator('#save-comp').click();
    await expect(page.locator('#save-status')).toContainText('ajoutée à Mes œuvres');
    await expect(page.locator('#saved-list .saved')).toHaveCount(2);
    await expect(page.locator('#saved-list .saved:not(.current) .saved-name')).toContainText('(copie)');
    await expect(page.locator('#saved-list .saved.current')).toHaveCount(1);

    // suppression en deux temps : l'œuvre affichée supprimée laisse la place à une nouvelle, la copie reste
    const del = page.locator('#saved-list .saved.current .saved-del');
    await del.click();
    await expect(del).toContainText('Supprimer ?');
    await del.click();
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await expect(page.locator('#empty')).toBeVisible();
    // la copie se rouvre telle quelle
    await expect(page.locator('#saved-status')).toBeHidden(); // (le message de la réouverture d'avant est parti)
    await page.locator('#saved-list .saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    await page.waitForFunction(() => AtelierGribouille.state.comp && AtelierGribouille.state.drawings.length === 4 && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.comp.items[0].x)).toBeCloseTo(before.first[0], 3);
    await page.locator('#saved-list .saved .saved-del').click();
    await page.locator('#saved-list .saved .saved-del').click();
    await expect(page.locator('#saved-list .saved')).toHaveCount(0);
    // plus rien dans le magasin des images (ni œuvre, ni panier)
    const keys = await page.evaluate(() => new Promise((res) => { const q = indexedDB.open('atelier-gribouille'); q.onsuccess = () => { const k = q.result.transaction('brouillon-images').objectStore('brouillon-images').getAllKeys(); k.onsuccess = () => res(k.result.length); }; }));
    expect(keys).toBe(0);
  });

  test('sans dessin, « Dupliquer » explique quoi faire', async ({ app }) => {
    const { page } = app;
    await expect(page.locator('#export-section')).toBeHidden();
    await page.evaluate(() => document.getElementById('save-comp').click());
    await expect(page.locator('#save-status')).toContainText('Importez des dessins');
  });
});

test.describe('Retouches de découpe sauvegardées', () => {
  test('une découpe retouchée est rejouée à l’identique à la réouverture', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    const coverage = () => page.evaluate(() => {
      const p = AtelierGribouille.state.drawings[0].analysis.pieces[0];
      const d = p.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.canvas.width, p.canvas.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++;
      return { opaque: n, w: p.canvas.width, h: p.canvas.height, edited: !!p.edited };
    });
    const before = await coverage();
    expect(before.edited).toBe(false);
    // on ouvre l'éditeur sur la première pièce et on gomme une large bande au milieu
    await page.evaluate(() => AtelierGribouille.editPiece(AtelierGribouille.state.drawings[0].analysis.pieces[0]));
    await expect(page.locator('#editor')).toBeVisible();
    await page.locator('#ed-size').fill('140');
    const box = await page.locator('#ed-canvas').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.6 * i / 20), y);
    await page.mouse.up();
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    const edited = await coverage();
    expect(edited.edited).toBe(true);
    expect(edited.opaque).toBeLessThan(before.opaque * 0.9);

    await openStep(page, 'export-section');
    // l'œuvre s'enregistre d'elle-même : « nouvelle œuvre » la range dans Mes œuvres
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await openStep(page, 'saved-section');
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    const after = await coverage();
    expect(after.edited).toBe(true);
    expect(after.w).toBe(edited.w);
    expect(after.h).toBe(edited.h);
    expect(Math.abs(after.opaque - edited.opaque) / edited.opaque).toBeLessThan(0.005);
    // la pièce retouchée garde sa retouche à l'export haute définition
    const hd = await page.evaluate(async () => {
      const A = AtelierGribouille; const comp = A.state.comp;
      await A.hydrateHD(comp, 300 / 2.54);
      const L = comp.items.find((x) => x.piece === A.state.drawings[0].analysis.pieces[0]);
      const r = L && L.piece.hd ? { w: L.piece.hd.width, h: L.piece.hd.height } : null;
      A.releaseHD();
      return r;
    });
    if (hd) expect(hd.w / hd.h).toBeCloseTo(after.w / after.h, 1);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});

test.describe('Dessin dupliqué', () => {
  test('la copie a sa propre découpe : la retoucher ne change pas l’originale, et c’est gardé à la réouverture', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png']);
    const opaque = (c) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; };
    const state = () => page.evaluate((src) => {
      const opaque = new Function(`return (${src})`)();
      const A = AtelierGribouille, p0 = A.state.drawings[0].analysis.pieces[0];
      const items = A.state.comp.items.filter((L) => (L.piece.copyOf || L.piece) === p0);
      return items.map((L) => ({ copy: !!L.piece.copyOf, opaque: opaque(L.piece.canvas) }));
    }, opaque.toString());
    // sélectionner la pièce sur l'œuvre, la dupliquer (copies des œuvres déjà faites : plus de bouton)
    await page.evaluate(() => {
      const A = AtelierGribouille, p0 = A.state.drawings[0].analysis.pieces[0];
      A.state.selected = A.state.comp.items.find((L) => L.piece === p0); A.render();
    });
    await page.evaluate(() => AtelierGribouille.act('dup'));
    const s0 = await state();
    expect(s0.map((x) => x.copy)).toEqual([false, true]);
    expect(s0[1].opaque).toBe(s0[0].opaque);
    // retoucher la copie (sélectionnée après la duplication)
    await page.locator('#toolbar [data-act="edit"]').click();
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#editor')).toContainText('copie');
    await page.locator('#ed-size').fill('140');
    const box = await page.locator('#ed-canvas').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.6 * i / 20), y);
    await page.mouse.up();
    await page.locator('#ed-apply').click();
    await expect(page.locator('#editor')).toBeHidden();
    const s1 = await state();
    expect(s1[0].opaque).toBe(s0[0].opaque); // l'originale n'a pas bougé
    expect(s1[1].opaque).toBeLessThan(s0[0].opaque * 0.9);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[0].analysis.pieces[0].edited)).toBeFalsy();

    await openStep(page, 'export-section');
    // l'œuvre s'enregistre d'elle-même : « nouvelle œuvre » la range dans Mes œuvres
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    await openStep(page, 'saved-section');
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    const s2 = await state();
    expect(s2.map((x) => x.copy)).toEqual([false, true]);
    expect(Math.abs(s2[0].opaque - s0[0].opaque) / s0[0].opaque).toBeLessThan(0.02);
    expect(Math.abs(s2[1].opaque - s1[1].opaque) / s1[1].opaque).toBeLessThan(0.03);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});

test.describe('Découpes autonomes', () => {
  test('les pièces rouvertes sont celles de la sauvegarde, même si la découpe automatique a changé', async ({ app }) => {
    const { page } = app;
    await app.import(['page-cutout.png', 'page-two.png', 'page-texture.png']);
    const digest = () => page.evaluate(() => {
      const A = AtelierGribouille;
      // taille, découpe (pixels opaques) et couleur moyenne de la pièce : la découpe doit être la même
      // au pixel près, la couleur à la compression JPEG de la page près
      const sum = (c) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0, r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) { n++; r += d[i]; g += d[i + 1]; b += d[i + 2]; } return { size: `${c.width}x${c.height}`, opaque: n, rgb: [r / n, g / n, b / n] }; };
      return { items: A.state.comp.items.map((L) => Object.assign({ at: `${A.state.drawings.indexOf(L.piece.drawing)}/${L.piece.drawing.analysis.pieces.indexOf(L.piece)}` }, sum(L.piece.canvas))), pieces: A.state.drawings.flatMap((d) => (d.analysis.pieces || []).map((p) => sum(p.canvas))), bg: A.state.comp.bg.length };
    });
    const same = (a, b) => { expect(b.length).toBe(a.length); a.forEach((x, i) => { expect(b[i].at).toBe(x.at); expect(b[i].size).toBe(x.size); expect(b[i].opaque).toBe(x.opaque); x.rgb.forEach((v, k) => expect(Math.abs(b[i].rgb[k] - v)).toBeLessThan(3)); }); };
    const before = await digest();
    expect(before.items.length).toBeGreaterThan(1);
    await openStep(page, 'export-section');
    // l'œuvre s'enregistre d'elle-même : « nouvelle œuvre » la range dans Mes œuvres
    await page.locator('#new-work').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 0);
    await expect(page.locator('#saved-list .saved')).toHaveCount(1);
    await page.reload();
    await page.waitForFunction(() => window.AtelierGribouille && document.querySelectorAll('.saved').length === 1);
    // la découpe automatique est devenue toute autre (une seule pièce par dessin) : sans effet sur la réouverture
    await page.evaluate(() => {
      window.__analyses = 0;
      const orig = Extract.analyze;
      Extract.analyze = (...a) => { window.__analyses++; const r = orig(...a); if (r.pieces) r.pieces = r.pieces.slice(0, 1); return r; };
    });
    await openStep(page, 'saved-section');
    await page.locator('.saved').first().click();
    await expect(page.locator('#saved-status')).toContainText('rouverte', { timeout: 120000 });
    const after = await digest();
    expect(await page.evaluate(() => window.__analyses)).toBe(0);
    same(before.items, after.items);
    same(before.pieces, after.pieces);
    expect(after.bg).toBe(before.bg);
    // et l'œuvre enregistrée contient bien la page et les masques de chaque dessin (rouverte : c'est le brouillon)
    const rec = await page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => {
        const db = q.result, g = db.transaction('compositions').objectStore('compositions').get('brouillon');
        // (la page et les planches sont rangées à part, sous la clé de la découpe)
        g.onsuccess = () => {
          const r = g.result, f = db.transaction('brouillon-images').objectStore('brouillon-images');
          Promise.all(r.drawings.map((d) => new Promise((ok) => { const x = f.get(d.saved.ref); x.onsuccess = () => ok(x.result); }))).then((packs) => res({
            v: r.v, drawings: r.drawings.map((d, i) => ({ page: !!(packs[i] && packs[i].page.byteLength > 1000), atlases: d.saved.atlases.length, pieces: d.saved.pieces.length })),
          }));
        };
      };
    }));
    expect(rec.v).toBe(2);
    expect(rec.drawings.every((d) => d.page)).toBe(true);
    expect(rec.drawings[0].pieces).toBeGreaterThan(0);
    expect(rec.drawings[0].atlases).toBe(1);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});

test.describe('Réouverture fidèle des retouches', () => {
  test('atelier/?nouveau (« Créer mon œuvre ») : l’atelier s’ouvre vide, l’œuvre en cours est seulement proposée', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const draft = () => page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => { const g = q.result.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); };
      q.onerror = () => res(null);
    }));
    for (let i = 0; i < 60; i++) { const r = await draft(); if (r && r.drawings.length === 2) break; await page.waitForTimeout(500); }
    // arrivée depuis l'accueil : rien n'est importé, l'œuvre en cours est proposée
    await page.goto('index.html?nouveau');
    await page.waitForFunction(() => window.AtelierGribouille);
    await expect(page.locator('#draft-offer')).toBeVisible();
    await expect(page.locator('#draft-offer span')).toContainText('2 dessins');
    await expect(page.locator('#draft-resume')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(0);
    // Reprendre : l'œuvre revient
    await page.locator('#draft-resume').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // sans le paramètre, l'œuvre en cours est rouverte d'elle-même
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.drawings.length === 2, null, { timeout: 120000 });
  });

  test('atelier/?exemple (« Voir un exemple ») : les dessins d’exemple seuls, l’œuvre en cours seulement proposée', async ({ page }) => {
    const { fixture } = require('./helpers');
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('page-two.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    const draft = () => page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => { const g = q.result.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); };
      q.onerror = () => res(null);
    }));
    for (let i = 0; i < 60; i++) { const r = await draft(); if (r && r.drawings.length === 2) break; await page.waitForTimeout(500); }
    await page.goto('index.html?exemple');
    await page.waitForFunction(() => window.AtelierGribouille && AtelierGribouille.state.proposals && document.getElementById('progress').hidden && AtelierGribouille.state.drawings.length > 2, null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    // seulement les dessins d'exemple, et l'œuvre en cours proposée (pas rouverte par-dessus)
    const names = await page.evaluate(() => AtelierGribouille.state.drawings.map((d) => d.name));
    expect(names.every((n) => /^Exemple/.test(n))).toBe(true);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.every((d) => d.sample))).toBe(true);
    await expect(page.locator('#draft-offer')).toBeVisible();
    await expect(page.locator('#draft-resume')).toBeVisible();
    await expect(page.locator('#sample-note')).toBeVisible();
    // l'exemple n'écrase pas l'œuvre en cours ; « Reprendre » la ramène à la place de l'exemple
    await page.waitForTimeout(3500);
    expect((await draft()).drawings.length).toBe(2);
    await page.locator('#draft-resume').click();
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length === 2 && AtelierGribouille.state.comp && document.getElementById('progress').hidden, null, { timeout: 120000 });
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.some((d) => d.sample))).toBe(false);
    await expect(page.locator('#sample-note')).toBeHidden();
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });

  test('dessins importés en plusieurs fois : la retouche revient au même endroit, sinon elle n’est pas plaquée de travers', async ({ page }) => {
    test.setTimeout(240000);
    const { fixture } = require('./helpers');
    // peu de mémoire : la résolution de travail dépend du nombre de dessins importés d'un coup
    await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { get: () => 0.2 }));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    const ready = (n) => page.waitForFunction((n) => window.AtelierGribouille && AtelierGribouille.state.drawings.length === n && AtelierGribouille.state.comp && document.getElementById('progress').hidden, n, { timeout: 120000 });
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await ready(1);
    const piece = () => page.evaluate(() => {
      const d = AtelierGribouille.state.drawings[0], p = d.analysis.pieces.reduce((a, b) => (a.canvas.width * a.canvas.height > b.canvas.width * b.canvas.height ? a : b));
      const px = p.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, p.canvas.width, p.canvas.height).data;
      let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 127) n++;
      return { long: d.srcLong, edited: !!p.edited, opaque: n / (d.srcLong * d.srcLong), x: p.src.x / d.analysis.page.width, y: p.src.y / d.analysis.page.width };
    });
    const auto = await piece();
    // gommer une bande au milieu de la pièce principale
    await page.evaluate(() => { const d = AtelierGribouille.state.drawings[0]; AtelierGribouille.editPiece(d.analysis.pieces.reduce((a, b) => (a.canvas.width * a.canvas.height > b.canvas.width * b.canvas.height ? a : b))); });
    await page.locator('#ed-size').fill('140');
    const box = await page.locator('#ed-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) await page.mouse.move(box.x + box.width * (0.3 + 0.025 * i), box.y + box.height * 0.5);
    await page.mouse.up();
    await page.locator('#ed-apply').click();
    const edited = await piece();
    expect(edited.edited).toBe(true);
    expect(edited.opaque).toBeLessThan(auto.opaque * 0.95);
    // deuxième import : les nouveaux dessins sont lus à une résolution plus basse
    await page.setInputFiles('#file', [fixture('page-two.png'), fixture('scan-300dpi.jpg')]);
    await ready(3);
    expect(await page.evaluate(() => AtelierGribouille.state.drawings[1].srcLong)).toBeLessThan(edited.long);
    // le même fichier, réimporté, n'est pas ajouté une deuxième fois
    await page.setInputFiles('#file', [fixture('page-cutout.png')]);
    await expect(page.locator('#notice')).toContainText('déjà dans l’atelier');
    expect(await page.evaluate(() => AtelierGribouille.state.drawings.length)).toBe(3);
    const draft = () => page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => { const g = q.result.transaction('compositions').objectStore('compositions').get('brouillon'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); };
      q.onerror = () => res(null);
    }));
    for (let i = 0; i < 60; i++) { const r = await draft(); if (r && r.drawings.length === 3 && r.drawings[0].saved && r.drawings[0].saved.pieces.some((p) => p.edited)) break; await page.waitForTimeout(500); }
    // rechargement : tout est relu d'un coup, chaque dessin à sa résolution d'origine
    await page.reload();
    await ready(3);
    await page.waitForTimeout(500);
    const back = await piece();
    expect(back.long).toBe(edited.long);
    expect(back.edited).toBe(true);
    expect(Math.abs(back.opaque - edited.opaque) / edited.opaque).toBeLessThan(0.02);
    expect(Math.abs(back.x - edited.x)).toBeLessThan(0.005);
    expect(Math.abs(back.y - edited.y)).toBeLessThan(0.005);
    // « Découpe automatique » ramène la découpe de l'atelier
    await page.evaluate(() => { const d = AtelierGribouille.state.drawings[0]; AtelierGribouille.editPiece(d.analysis.pieces.reduce((a, b) => (a.canvas.width * a.canvas.height > b.canvas.width * b.canvas.height ? a : b))); });
    await page.locator('#ed-reset').click();
    await page.locator('#ed-apply').click();
    const reset = await piece();
    expect(Math.abs(reset.opaque - auto.opaque) / auto.opaque).toBeLessThan(0.03);
    // une sauvegarde d'avant les découpes autonomes (sans page ni masques) est relue avec la découpe
    // automatique de l'époque (module chargé à la demande)
    for (let i = 0; i < 60; i++) { const r = await draft(); if (r && r.drawings[0].saved && !r.drawings[0].saved.pieces.some((p) => p.edited)) break; await page.waitForTimeout(500); }
    await page.waitForTimeout(3000);
    await page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open('atelier-gribouille');
      q.onsuccess = () => {
        const st = q.result.transaction('compositions', 'readwrite').objectStore('compositions');
        const g = st.get('brouillon');
        g.onsuccess = () => { const r = g.result; delete r.v; r.drawings.forEach((sd) => { delete sd.saved; }); st.put(r).onsuccess = () => res(); };
      };
    }));
    expect(await page.evaluate(() => !!window.ExtractLegacy)).toBe(false);
    await page.reload();
    await ready(3);
    expect(await page.evaluate(() => !!window.ExtractLegacy && AtelierGribouille.state.drawings.every((d) => d.extract === window.ExtractLegacy))).toBe(true);
    const relu = await piece();
    expect(relu.edited).toBe(false);
    expect(Math.abs(relu.opaque - auto.opaque) / auto.opaque).toBeLessThan(0.1);
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('atelier-gribouille'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  });
});
