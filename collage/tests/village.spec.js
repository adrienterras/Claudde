// Village : plus proposé (remplacé par le Pop art) ; une œuvre déjà faite dans ce style se rouvre. Reste
// vérifiée ici la détection des grandes zones de couleur qui fait son patchwork.
const { test, expect } = require('./helpers');

test.describe('Village', () => {
  test('zones de couleur : un aplat de coloriage est trouvé sans traverser un contour ; ordre du bas (terre) vers le haut (ciel)', async ({ app }) => {
    const r = await app.page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 400;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400);
      // un coloriage bleu au crayon (des traits, du papier entre eux), coupé par un trait noir à x = 300
      x.strokeStyle = '#3d7fd6'; x.lineWidth = 3;
      for (let i = -400; i < 600; i += 7) { x.beginPath(); x.moveTo(40 + i, 360); x.lineTo(40 + i + 320, 40); x.stroke(); }
      x.fillStyle = '#fff'; x.fillRect(0, 0, 40, 400); x.fillRect(560, 0, 40, 400); x.fillRect(0, 0, 600, 40); x.fillRect(0, 360, 600, 40);
      x.fillStyle = '#111'; x.fillRect(298, 40, 5, 320);
      const found = Compose.colorPatches(c, 80);
      const S = (rgb) => Compose.skyness(rgb);
      return {
        n: found.length,
        crossing: found.filter((p) => p.x < 296 && p.x + p.w > 305).length,
        blue: found.every((p) => p.ink[2] > p.ink[0] + 60),
        order: [S([240, 200, 30]) > S([150, 200, 240]), S([150, 200, 240]) > S([35, 80, 170]), S([150, 200, 240]) > S([140, 85, 40]), S([240, 200, 30]) > S([40, 110, 50]), S([240, 200, 30]) > S([200, 40, 30]), S([20, 20, 20]) < S([140, 85, 40])],
      };
    });
    expect(r.n).toBeGreaterThanOrEqual(2); // de part et d'autre du trait
    expect(r.crossing).toBe(0);
    expect(r.blue).toBe(true);
    expect(r.order).toEqual([true, true, true, true, true, true]);
  });
});
