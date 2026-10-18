// Generates every brand image from the one original artwork, public/brand/logo-original.png
// (the Bharath Interior Decor monogram). The artwork is only scaled, padded and cropped to the
// platform's icon geometry — never redrawn. Run from apps/mobile:  node scripts/make-assets.mjs && npm run assets
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';

const SRC = '../../public/brand/logo-original.png';
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** The logo scaled to `size`, placed centred on a `canvas` square of `background`. */
const onCanvas = (canvas, size, background) =>
  sharp(SRC)
    .resize(size, size)
    .toBuffer()
    .then((input) => sharp({ create: { width: canvas, height: canvas, channels: 4, background } }).composite([{ input }]).png());
const square = (size) => sharp(SRC).resize(size, size).png();

/** White silhouette (brightness becomes opacity) for the Android monochrome / notification icons. */
const silhouette = async (size, gain = 1.4) => {
  const { data, info } = await sharp(SRC).resize(size, size).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < data.length; i++) rgba[i * 4 + 3] = Math.min(255, Math.round(data[i] * gain));
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
};

// ICO container holding PNG images.
const ico = (images) => {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const p = 6 + 16 * i;
    head[p] = size >= 256 ? 0 : size;
    head[p + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, p + 4);
    head.writeUInt16LE(32, p + 6);
    head.writeUInt32LE(png.length, p + 8);
    head.writeUInt32LE(offset, p + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
};

const web = '../../src/app';
const pub = '../../public';
mkdirSync('assets', { recursive: true });
mkdirSync(`${pub}/icons`, { recursive: true });
mkdirSync(`${pub}/brand`, { recursive: true });

// --- Web: Next.js file conventions + PWA ---
await square(512).toFile(`${web}/icon.png`);
await square(180).toFile(`${web}/apple-icon.png`);
await sharp(SRC).resize(1200, 630, { fit: 'contain', background: BLACK }).png().toFile(`${web}/opengraph-image.png`);
writeFileSync(`${web}/favicon.ico`, ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await square(size).toBuffer() })))));
await square(192).toFile(`${pub}/icons/icon-192.png`);
await square(512).toFile(`${pub}/icons/icon-512.png`);
await (await onCanvas(512, 400, BLACK)).toFile(`${pub}/icons/icon-maskable-512.png`); // inside the 80% maskable safe zone
await square(512).toFile(`${pub}/brand/logo-512.png`);

// --- Android (inputs for @capacitor/assets) ---
await square(1024).toFile('assets/icon-only.png'); // legacy launcher icon
await square(1024).toFile('assets/icon-foreground.png'); // @capacitor/assets insets this layer into the adaptive safe zone itself
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BLACK } }).png().toFile('assets/icon-background.png');
await (await onCanvas(2732, 900, BLACK)).toFile('assets/splash.png');
await (await onCanvas(2732, 900, BLACK)).toFile('assets/splash-dark.png');

// Status-bar / foreground-service notification icon (white silhouette, 24dp).
for (const [dir, px] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]) {
  mkdirSync(`android/app/src/main/res/drawable-${dir}`, { recursive: true });
  await (await silhouette(px, 1.8)).toFile(`android/app/src/main/res/drawable-${dir}/ic_stat_salesgrid.png`);
}
if (existsSync('android/app/src/main/res/drawable/ic_stat_salesgrid.xml')) rmSync('android/app/src/main/res/drawable/ic_stat_salesgrid.xml');
// Android 13 themed (monochrome) adaptive layer: 108dp layer, silhouette kept inside the 66% safe zone.
const mono = await (await silhouette(288)).toBuffer();
mkdirSync('android/app/src/main/res/drawable-nodpi', { recursive: true });
await sharp({ create: { width: 432, height: 432, channels: 4, background: CLEAR } }).composite([{ input: mono }]).png()
  .toFile('android/app/src/main/res/drawable-nodpi/ic_launcher_monochrome.png');
for (const f of ['ic_launcher', 'ic_launcher_round']) {
  const p = `android/app/src/main/res/mipmap-anydpi-v26/${f}.xml`;
  const xml = readFileSync(p, 'utf8');
  if (!xml.includes('<monochrome')) {
    writeFileSync(p, xml.replace('</adaptive-icon>', '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n</adaptive-icon>'));
  }
}
console.log('brand assets ready');
