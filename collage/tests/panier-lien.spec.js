// Venu du menu du compte du site (« Mon panier ») : l'atelier ouvre le panier à l'arrivée, puis l'adresse l'oublie.
const { test, expect } = require('@playwright/test');

test('atelier/?panier : le panier s’ouvre à l’arrivée ; actualiser ne le rouvre pas', async ({ page }) => {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.ATELIER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto('index.html?panier');
  await page.waitForFunction(() => window.AtelierGribouille);
  await expect(page.locator('#cart')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  await page.waitForFunction(() => window.AtelierGribouille);
  await page.waitForTimeout(500);
  await expect(page.locator('#cart')).toBeHidden();
});
