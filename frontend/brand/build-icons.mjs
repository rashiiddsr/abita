// Membuat semua ikon ABiTA dari SVG sumber di folder ini.
//   npm run icons   (dari folder frontend; sharp ada di devDependencies)
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sharp = createRequire(join(root, "package.json"))("sharp");

const mark = readFileSync(join(here, "abita-mark.svg"));
// Maskable (PWA/Android adaptif): latar penuh, simbol di zona aman 60%
const maskable = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12A3B0"/><stop offset="1" stop-color="#005A64"/></linearGradient></defs>
  <rect width="64" height="64" fill="url(#g)"/>
  <g transform="translate(32 32) scale(.62) translate(-32 -32)">
    <path d="M18.5 47 L32 16.5 L45.5 47" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="32" cy="37.5" r="4.4" fill="#FF5C61"/>
  </g>
</svg>`);

const png = (svg, size) => sharp(svg, { density: Math.max(72, (size / 64) * 72 * 2) }).resize(size, size).png().toBuffer();
async function out(path, svg, size) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, await png(svg, size));
  console.log("  ", path.replace(root, "").replaceAll("\\", "/"), `${size}px`);
}

/** favicon.ico berisi PNG (didukung semua browser modern). */
async function ico(path, sizes) {
  const imgs = await Promise.all(sizes.map((s) => png(mark, s)));
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(imgs.length, 4);
  let offset = head.length;
  imgs.forEach((b, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e);
    head.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(b.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += b.length;
  });
  writeFileSync(path, Buffer.concat([head, ...imgs]));
  console.log("  ", path.replace(root, "").replaceAll("\\", "/"), sizes.join("/") + "px");
}

console.log("Dasbor (admin/public)");
copyFileSync(join(here, "abita-mark.svg"), join(root, "admin/public/icon.svg"));
await out(join(root, "admin/public/apple-icon.png"), mark, 180);
await ico(join(root, "admin/public/favicon.ico"), [16, 32, 48]);
await out(join(root, "admin/public/icons/Icon-192.png"), mark, 192);
await out(join(root, "admin/public/icons/Icon-512.png"), mark, 512);
await out(join(root, "admin/public/icons/Icon-maskable-192.png"), maskable, 192);
await out(join(root, "admin/public/icons/Icon-maskable-512.png"), maskable, 512);

console.log("Aplikasi karyawan (staff/public)");
copyFileSync(join(here, "abita-mark.svg"), join(root, "staff/public/abita-mark.svg"));
await out(join(root, "staff/public/icons/Icon-192.png"), mark, 192);
await out(join(root, "staff/public/icons/Icon-512.png"), mark, 512);
await out(join(root, "staff/public/icons/Icon-maskable-192.png"), maskable, 192);
await out(join(root, "staff/public/icons/Icon-maskable-512.png"), maskable, 512);

console.log("Ekspor (brand/png)");
for (const s of [1024, 512]) await out(join(here, `png/abita-mark-${s}.png`), mark, s);
await out(join(here, "png/abita-maskable-1024.png"), maskable, 1024);
for (const name of ["abita-logo", "abita-logo-white"]) {
  const svg = readFileSync(join(here, `${name}.svg`));
  writeFileSync(join(here, `png/${name}.png`), await sharp(svg, { density: 576 }).resize({ width: 944 }).png().toBuffer());
  console.log("  ", `/brand/png/${name}.png`, "944px");
}
