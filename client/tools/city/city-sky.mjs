// Sky textures in the release skydome layout: four 512×128 strips, each a
// 90° azimuth quarter with the zenith at the strip top and the horizon at
// the bottom. Day uses the village dome; dusk and night are generated.
import { RgbaCanvas } from "./png.mjs";
import { random } from "./geometry.mjs";

const SIZE = 512, STRIP = 128;

function gradientSky({ zenith, mid, horizon, stars = 0, moon, glow, seed = 7 }) {
  const canvas = new RgbaCanvas(SIZE, SIZE, [0, 0, 0, 255]);
  const rng = random(seed);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let strip = 0; strip < 4; strip++) {
    for (let y = 0; y < STRIP; y++) {
      const t = y / (STRIP - 1);
      const color = t < 0.55 ? mix(zenith, mid, t / 0.55) : mix(mid, horizon, (t - 0.55) / 0.45);
      for (let x = 0; x < SIZE; x++) {
        let [r, g, b] = color;
        if (glow && strip === glow.strip) {
          // A warm glow near the horizon around the sun/moon azimuth.
          const d = Math.hypot((x - glow.x) / 160, (y - glow.y) / 60);
          const a = Math.max(0, 1 - d) ** 2 * glow.strength;
          r += (glow.color[0] - r) * a; g += (glow.color[1] - g) * a; b += (glow.color[2] - b) * a;
        }
        canvas.set(x, strip * STRIP + y, [Math.round(r), Math.round(g), Math.round(b), 255]);
      }
    }
    // Stars in the upper two thirds of each strip.
    for (let i = 0; i < stars; i++) {
      const x = Math.floor(rng() * SIZE), y = Math.floor(rng() * STRIP * 0.7);
      const brightness = 150 + Math.floor(rng() * 105);
      canvas.set(x, strip * STRIP + y, [brightness, brightness, Math.min(255, brightness + 20), 255]);
      if (rng() < 0.25) { canvas.set(x + 1, strip * STRIP + y, [brightness, brightness, brightness, 200]); canvas.set(x, strip * STRIP + y + 1, [brightness, brightness, brightness, 200]); }
    }
  }
  if (moon) {
    canvas.fillCircle(moon.x, moon.strip * STRIP + moon.y, moon.radius, [240, 240, 225, 255]);
    canvas.fillCircle(moon.x + moon.radius * 0.45, moon.strip * STRIP + moon.y - moon.radius * 0.25, moon.radius * 0.85, [...mix([240, 240, 225], [18, 22, 48], 0.9).map(Math.round), 255]);
  }
  return canvas.png();
}

export const SKY_TEXTURES = {
  kartcity_sky_night: () => gradientSky({
    zenith: [8, 11, 30], mid: [16, 22, 56], horizon: [44, 48, 86], stars: 140,
    moon: { strip: 1, x: 300, y: 40, radius: 14 },
  }),
  kartcity_sky_dusk: () => gradientSky({
    zenith: [48, 44, 110], mid: [150, 90, 120], horizon: [252, 160, 90], stars: 25,
    glow: { strip: 2, x: 256, y: 120, strength: 0.9, color: [255, 200, 120] },
  }),
};
