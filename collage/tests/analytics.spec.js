// Mesure d'audience sans script tiers : la page envoie elle-même la visite et les événements à
// l'adresse de collecte d'Umami, sans paramètres d'adresse ni contenu.
const { test, expect } = require('./helpers');

test('Umami : aucune balise script tierce ; la visite et un événement partent vers l’adresse de collecte, sans « ?… »', async ({ page }) => {
  const sent = [];
  // un vrai nom de site (rien n'est envoyé depuis localhost) servi par le serveur de test
  await page.route('http://atelier.test/**', async (r) => {
    const resp = await r.fetch({ url: r.request().url().replace('http://atelier.test', 'http://localhost:8781') });
    await r.fulfill({ response: resp });
  });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', analytics: { provider: 'umami', websiteId: 'site-test' } };" }));
  await page.route('https://gateway.umami.is/**', async (r) => { sent.push({ url: r.request().url(), body: r.request().postDataJSON() }); await r.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' } }); });
  // (Playwright se signale comme navigateur piloté : rien ne partirait)
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  await page.goto('http://atelier.test/index.html?code=secret-123&lang=fr');
  await page.waitForFunction(() => window.AtelierGribouille);
  await expect.poll(() => sent.length).toBeGreaterThanOrEqual(1);
  const visit = sent[0];
  expect(visit.url).toBe('https://gateway.umami.is/api/send');
  expect(visit.body.type).toBe('event');
  expect(visit.body.payload).toMatchObject({ website: 'site-test', hostname: 'atelier.test', url: '/index.html' });
  expect(visit.body.payload.name).toBeUndefined();
  expect(JSON.stringify(sent)).not.toContain('secret-123');
  // aucune balise <script> venue d'ailleurs que le site
  expect(await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((u) => u && !u.startsWith(location.origin)))).toEqual([]);
  // un événement : son nom et ses compteurs
  await page.evaluate(() => window.Atelier.track('Export', { type: 'jpg' }));
  await expect.poll(() => sent.length).toBeGreaterThanOrEqual(2);
  expect(sent[sent.length - 1].body.payload).toMatchObject({ name: 'Export', data: { type: 'jpg' }, url: '/index.html' });
});

test('sans réglage, ou depuis localhost : rien n’est envoyé', async ({ page }) => {
  const sent = [];
  await page.route('https://gateway.umami.is/**', (r) => { sent.push(r.request().url()); return r.abort(); });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', analytics: { provider: 'umami', websiteId: 'site-test' } };" }));
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  await page.goto('index.html');
  await page.waitForFunction(() => window.AtelierGribouille);
  await page.evaluate(() => window.Atelier.track('Export', { type: 'jpg' }));
  await page.waitForTimeout(800);
  expect(sent).toEqual([]);
});
