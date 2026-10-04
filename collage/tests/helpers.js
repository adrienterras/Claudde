// Aides communes aux tests : ouverture de l'app, import des images de synthèse, surveillance des erreurs.
const path = require('path');
const { test: base, expect } = require('@playwright/test');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (name) => path.join(FIXTURES, name);

// Le test échoue si la page lève une erreur non rattrapée (le capteur global l'afficherait à l'utilisateur).
const test = base.extend({
  app: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR|InvalidPDFException/.test(m.text())) errors.push(`console : ${m.text()}`); });
    await page.goto('index.html');
    await page.waitForFunction(() => window.AtelierGribouille && window.Extract && window.Compose);
    const app = {
      page,
      errors,
      // importe des images ou PDF du dossier fixtures et attend la fin de l'analyse
      async import(names, expected) {
        await page.setInputFiles('#file', names.map(fixture));
        const n = expected || names.length;
        await page.waitForFunction((n) => AtelierGribouille.state.drawings.length >= n && AtelierGribouille.state.proposals && document.getElementById('progress').hidden, n, { timeout: 120000 });
        await page.waitForTimeout(300);
      },
      drawings() {
        return page.evaluate(() => AtelierGribouille.state.drawings.map((d) => ({
          name: d.name, kind: d.analysis.kind, photo: d.photo ? d.photo.kind : null, role: d.role === 'auto' ? d.auto : d.role,
          pieces: (d.analysis.pieces || []).length, enabled: (d.analysis.pieces || []).filter((p) => p.enabled).length, sizeCm: d.sizeCm,
        })));
      },
      proposals() {
        return page.evaluate(() => AtelierGribouille.state.proposals.map((p) => ({ style: p.style.id, items: p.comp.items.length, bg: p.comp.bg.length, W: p.comp.W, H: p.comp.H })));
      },
      select(styleId) {
        return page.evaluate((id) => { const i = AtelierGribouille.state.proposals.findIndex((p) => p.style.id === id); AtelierGribouille.selectProposal(i); return i; }, styleId);
      },
    };
    await use(app);
    expect(errors, 'erreurs de page').toEqual([]);
  },
});

module.exports = { test, expect, fixture, FIXTURES };
