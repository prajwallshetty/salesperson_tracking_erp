// Builds the source images for `npm run assets` (@capacitor/assets) from the SalesGrid mark used
// by the web app (public/icons/icon.svg), so the launcher icon and splash match the PWA icon.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const NAVY = '#081224';
const mark = (size) => {
  const s = size / 224; // the mark is a 224×224 grid of four tiles
  const tile = (x, y, fill, opacity = 0.92) =>
    `<rect x="${x * s}" y="${y * s}" width="${104 * s}" height="${104 * s}" rx="${14 * s}" fill="${fill}" opacity="${opacity}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${tile(0, 0, '#fff')}${tile(120, 0, '#fff')}${tile(0, 120, '#fff')}${tile(120, 120, '#B4E39C', 1)}</svg>`;
};
const centered = async (canvas, markSize, background) =>
  sharp({ create: { width: canvas, height: canvas, channels: 4, background } })
    .composite([{ input: Buffer.from(mark(markSize)), gravity: 'center' }])
    .png();

mkdirSync('assets', { recursive: true });
// Adaptive icon: foreground mark inside the 66% safe zone, solid navy background layer.
await (await centered(1024, 440, { r: 0, g: 0, b: 0, alpha: 0 })).toFile('assets/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: NAVY } }).png().toFile('assets/icon-background.png');
// Legacy (pre-Android 8) icon: full-bleed navy square with the mark.
await (await centered(1024, 520, NAVY)).toFile('assets/icon-only.png');
// Splash: navy with the mark; same for dark mode.
await (await centered(2732, 560, NAVY)).toFile('assets/splash.png');
await (await centered(2732, 560, NAVY)).toFile('assets/splash-dark.png');
console.log('assets/ ready');
