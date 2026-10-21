// Erzeugt build/icon.ico (256/64/48/32/16 px, PNG-Einträge) aus build/icon.png – für den Starter.
// Aufruf: npx electron scripts/make-ico.cjs
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(root, 'build', 'icon.png'));
  const images = [256, 64, 48, 32, 16].map((size) => ({ size, png: source.resize({ width: size, height: size, quality: 'best' }).toPNG() }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserviert
  header.writeUInt16LE(1, 2); // Typ: Icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // Breite (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // Höhe
    e.writeUInt8(0, 2); // Palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // Farbebenen
    e.writeUInt16LE(32, 6); // Bit pro Pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });

  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
  console.log('build/icon.ico geschrieben');
  app.quit();
});
