// Politique de sécurité du contenu (balise <meta>) : présente sur chaque page publiée, appliquée par le
// navigateur, et compatible avec tous les parcours (import PDF, export PDF, guide, livre).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect, fixture } = require('./helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGES = ['collage/index.html', 'collage/confidentialite.html', 'livre/index.html', 'landing/index.html', 'landing/tarifs.html', 'landing/idees-dessins-enfants.html'];
const cspOf = (html) => { const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/); return m && m[1]; };
const directive = (csp, name) => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) || []).slice(1);

// relève les violations dans la page (avant tout script de la page)
const watch = (page) => page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});

test.describe('Politique de sécurité du contenu', () => {
  test('chaque page publiée la déclare, sans script inline non autorisé', () => {
    for (const p of PAGES) {
      const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
      const csp = cspOf(html);
      expect(csp, p).toBeTruthy();
      expect(directive(csp, 'object-src'), p).toEqual(["'none'"]);
      expect(directive(csp, 'base-uri'), p).toEqual(["'self'"]);
      const scripts = directive(csp, 'script-src');
      expect(scripts.filter((s) => /unsafe/.test(s)), p).toEqual([]);
      // chaque script inline (hors données JSON-LD) doit avoir son empreinte dans la politique
      for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/src=|application\/ld\+json/.test(attrs)) continue;
        const h = `'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`;
        expect(scripts, `${p} : empreinte du script inline`).toContain(h);
      }
      // aucun gestionnaire d'événement écrit dans le HTML (onclick="…") : il serait bloqué
      expect(html.match(/<[a-z][^>]*\son[a-z]+=/gi), p).toBeNull();
    }
  });

  test('appliquée dans l’atelier : un script étranger est bloqué, les parcours n’en déclenchent aucune', async ({ page }) => {
    await watch(page);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) errors.push(m.text()); });
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille);
    // import d'un PDF (pdf.js et son worker) et d'une image
    await page.setInputFiles('#file', [fixture('two-pages.pdf'), fixture('page-cutout.png')]);
    await page.waitForFunction(() => AtelierGribouille.state.drawings.length >= 3 && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, null, { timeout: 120000 });
    // export PDF (jsPDF) puis guide de création
    await page.locator('#fmt').selectOption('application/pdf');
    await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    await page.locator('#export-section details.guide-box summary').click();
    await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#guide').click()]);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
    expect(errors).toEqual([]);
    // témoin : un script inline injecté ne s'exécute pas
    const ran = await page.evaluate(() => new Promise((res) => {
      window.__ran = false;
      const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.body.appendChild(s);
      setTimeout(() => res(window.__ran), 100);
    }));
    expect(ran).toBe(false);
    expect((await page.evaluate(() => window.__csp)).some((v) => /script-src/.test(v))).toBe(true);
  });

  test('appliquée dans le livre : import et export PDF sans violation', async ({ page }) => {
    await watch(page);
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
    await page.goto('livre/');
    await page.waitForFunction(() => window.LivreGribouille);
    await page.setInputFiles('#file', [fixture('page-cutout.png'), fixture('two-pages.pdf')]);
    await page.waitForFunction(() => LivreGribouille.state.drawings.length >= 3 && document.getElementById('progress').hidden, null, { timeout: 120000 });
    await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.locator('#export').click()]);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
  });
});
