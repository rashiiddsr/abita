// Peta statis dari tile (tanpa library): seperti desain, memakai ArcGIS World Street Map.

const TILE = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;

function project(lat: number, lon: number, z: number) {
  const n = 2 ** z * 256;
  const lr = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n };
}

/** Tile untuk kotak w×h dengan titik (lat,lon) di posisi (cx,cy) piksel. */
export function tilesFor(lat: number, lon: number, z: number, w: number, h: number, cx = w / 2, cy = h / 2) {
  const p = project(lat, lon, z);
  const ox = p.x - cx;
  const oy = p.y - cy;
  const out: { url: string; left: number; top: number }[] = [];
  for (let tx = Math.floor(ox / 256); tx * 256 < ox + w; tx++)
    for (let ty = Math.floor(oy / 256); ty * 256 < oy + h; ty++) out.push({ url: TILE(z, tx, ty), left: tx * 256 - ox, top: ty * 256 - oy });
  return out;
}

/** Selisih piksel titik b terhadap a pada zoom z. */
export function offsetPx(a: { lat: number; lng: number }, b: { lat: number; lng: number }, z: number) {
  const pa = project(a.lat, a.lng, z);
  const pb = project(b.lat, b.lng, z);
  return { dx: pb.x - pa.x, dy: pb.y - pa.y };
}

export function metersPerPixel(lat: number, z: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}
