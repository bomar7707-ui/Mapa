import { Point2D } from '../types/map';

export interface LoadedSatelliteTile {
  key: string;
  z: number;
  tx: number;
  ty: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  img: HTMLImageElement;
  clipBounds?: [number, number, number, number];
}

// EOX Sentinel-2 Cloudless 2024 (CC BY 4.0 · ESA Copernicus Sentinel-2 data)
const SENTINEL2_WMTS_BASE =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g';

const MAX_SAT_CACHE = 180;
const MAX_CONCURRENT_SAT = 10;
const MAX_VISIBLE_SAT_BUDGET = 48;

const SAT_CACHE = new Map<string, LoadedSatelliteTile>();
const SAT_INFLIGHT = new Set<string>();
const SAT_FAILED = new Map<string, number>();

interface SatFetchJob {
  key: string;
  z: number;
  tx: number;
  ty: number;
  onLoaded: () => void;
}

const SAT_QUEUE: SatFetchJob[] = [];
const SAT_QUEUED = new Set<string>();
let activeSatFetches = 0;
let lastRequestedSatZ: number | null = null;

function lonToSatX(lon: number, z: number): number {
  const n = 1 << z;
  const clamped = Math.max(-179.9999, Math.min(179.9999, lon));
  return Math.max(0, Math.min(n - 1, Math.floor(((clamped + 180) / 360) * n)));
}

function latToSatY(lat: number, z: number): number {
  const n = 1 << z;
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
  return Math.max(0, Math.min(n - 1, y));
}

function satYToLat(yNorm: number): number {
  const merc = Math.PI * (1 - 2 * yNorm);
  return (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
}

function satTileBounds(
  z: number,
  tx: number,
  ty: number
): [number, number, number, number] {
  const n = 1 << z;
  const minLon = (tx / n) * 360 - 180;
  const maxLon = ((tx + 1) / n) * 360 - 180;
  const maxLat = satYToLat(ty / n);
  const minLat = satYToLat((ty + 1) / n);
  return [minLon, minLat, maxLon, maxLat];
}

function flushStaleSatQueue(targetZ: number) {
  for (let i = SAT_QUEUE.length - 1; i >= 0; i--) {
    if (SAT_QUEUE[i].z !== targetZ) {
      SAT_QUEUED.delete(SAT_QUEUE[i].key);
      SAT_QUEUE.splice(i, 1);
    }
  }
}

function pumpSatQueue() {
  while (activeSatFetches < MAX_CONCURRENT_SAT && SAT_QUEUE.length > 0) {
    const job = SAT_QUEUE.shift()!;
    SAT_QUEUED.delete(job.key);
    if (SAT_CACHE.has(job.key) || SAT_INFLIGHT.has(job.key)) continue;

    activeSatFetches++;
    SAT_INFLIGHT.add(job.key);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    const finish = () => {
      SAT_INFLIGHT.delete(job.key);
      activeSatFetches = Math.max(0, activeSatFetches - 1);
      pumpSatQueue();
    };

    img.onload = () => {
      if (SAT_CACHE.size >= MAX_SAT_CACHE) {
        const oldest = SAT_CACHE.keys().next().value;
        if (oldest) SAT_CACHE.delete(oldest);
      }
      SAT_CACHE.set(job.key, {
        key: job.key,
        z: job.z,
        tx: job.tx,
        ty: job.ty,
        bounds: satTileBounds(job.z, job.tx, job.ty),
        img,
      });
      finish();
      job.onLoaded();
    };

    img.onerror = () => {
      SAT_FAILED.set(job.key, Date.now() + 12000);
      finish();
    };

    // Note: EOX WMTS GoogleMapsCompatible ('g') path is /{z}/{y}/{x}.jpg
    img.src = `${SENTINEL2_WMTS_BASE}/${job.z}/${job.ty}/${job.tx}.jpg`;
  }
}

function enqueueSatJob(job: SatFetchJob) {
  if (SAT_CACHE.has(job.key) || SAT_INFLIGHT.has(job.key) || SAT_QUEUED.has(job.key)) {
    return;
  }
  const retryAfter = SAT_FAILED.get(job.key);
  if (retryAfter && Date.now() < retryAfter) return;

  if (SAT_QUEUE.length >= 96) {
    const dropped = SAT_QUEUE.shift();
    if (dropped) SAT_QUEUED.delete(dropped.key);
  }
  SAT_QUEUED.add(job.key);
  SAT_QUEUE.push(job);
  pumpSatQueue();
}

export function pickSatelliteZoom(
  minLon: number,
  maxLon: number,
  viewportWidthPx: number
): number {
  const lonSpan = Math.max(0.0005, maxLon - minLon);
  const desiredTilesX = Math.max(1, viewportWidthPx / 256);
  const rawZ = Math.round(Math.log2((360 * desiredTilesX) / lonSpan));
  return Math.max(1, Math.min(14, rawZ));
}

export function ensureSatelliteTilesForViewport(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  viewportWidthPx: number,
  onLoaded: () => void
): { tiles: LoadedSatelliteTile[]; targetZ: number } {
  const cMinLon = Math.max(-179.99, Math.min(179.99, minLon));
  const cMaxLon = Math.max(-179.99, Math.min(179.99, maxLon));
  const cMinLat = Math.max(-85.0, Math.min(85.0, minLat));
  const cMaxLat = Math.max(-85.0, Math.min(85.0, maxLat));

  let effectiveZ = pickSatelliteZoom(cMinLon, cMaxLon, viewportWidthPx);
  while (effectiveZ > 1) {
    const nx = lonToSatX(cMaxLon, effectiveZ) - lonToSatX(cMinLon, effectiveZ) + 1;
    const ny = latToSatY(cMinLat, effectiveZ) - latToSatY(cMaxLat, effectiveZ) + 1;
    if (nx * ny <= MAX_VISIBLE_SAT_BUDGET) break;
    effectiveZ--;
  }

  if (lastRequestedSatZ !== null && lastRequestedSatZ !== effectiveZ) {
    flushStaleSatQueue(effectiveZ);
  }
  lastRequestedSatZ = effectiveZ;

  const tx0 = lonToSatX(cMinLon, effectiveZ);
  const tx1 = lonToSatX(cMaxLon, effectiveZ);
  const ty0 = latToSatY(cMaxLat, effectiveZ);
  const ty1 = latToSatY(cMinLat, effectiveZ);

  const tiles: LoadedSatelliteTile[] = [];
  const addedKeys = new Set<string>();

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const key = `${effectiveZ}/${tx}/${ty}`;
      const cached = SAT_CACHE.get(key);
      if (cached) {
        SAT_CACHE.delete(key);
        SAT_CACHE.set(key, cached);
        tiles.push(cached);
        addedKeys.add(key);
      } else {
        enqueueSatJob({ key, z: effectiveZ, tx, ty, onLoaded });
        const cellBounds = satTileBounds(effectiveZ, tx, ty);
        let foundFallback = false;

        // Smooth ancestor fallback clipped strictly to this missing cell
        for (let dz = 1; dz <= 3 && effectiveZ - dz >= 1; dz++) {
          const pz = effectiveZ - dz;
          const ptx = tx >> dz;
          const pty = ty >> dz;
          const pKey = `${pz}/${ptx}/${pty}`;
          const parent = SAT_CACHE.get(pKey);
          if (parent) {
            tiles.push({ ...parent, clipBounds: cellBounds });
            foundFallback = true;
            break;
          }
        }

        // Immediate child fallback when zooming out
        if (!foundFallback && effectiveZ < 14) {
          const cz = effectiveZ + 1;
          for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
              const cKey = `${cz}/${tx * 2 + dx}/${ty * 2 + dy}`;
              const child = SAT_CACHE.get(cKey);
              if (child && !addedKeys.has(cKey)) {
                tiles.push(child);
                addedKeys.add(cKey);
              }
            }
          }
        }
      }
    }
  }

  tiles.sort((a, b) => a.z - b.z || a.ty - b.ty || a.tx - b.tx);
  return { tiles, targetZ: effectiveZ };
}

export function renderSatelliteTilesToCanvas(
  ctx: CanvasRenderingContext2D,
  tiles: LoadedSatelliteTile[],
  viewW: number,
  viewH: number,
  projectGeo: (lon: number, lat: number) => Point2D,
  wxToSx: (wx: number) => number,
  wyToSy: (wy: number) => number
) {
  if (tiles.length === 0) return;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const img = tile.img;
    if (!img.complete || img.naturalWidth === 0) continue;

    const [minLon, minLat, maxLon, maxLat] = tile.bounds;
    const tl = projectGeo(minLon, maxLat);
    const br = projectGeo(maxLon, minLat);
    const dx = wxToSx(tl.x);
    const dy = wyToSy(tl.y);
    const dw = wxToSx(br.x) - dx;
    const dh = wyToSy(br.y) - dy;

    if (
      dw <= 0 ||
      dh <= 0 ||
      dx + dw < -2 ||
      dx > viewW + 2 ||
      dy + dh < -2 ||
      dy > viewH + 2
    ) {
      continue;
    }

    const hasClip = Boolean(tile.clipBounds);
    if (hasClip && tile.clipBounds) {
      const [cMinLon, cMinLat, cMaxLon, cMaxLat] = tile.clipBounds;
      const ctl = projectGeo(cMinLon, cMaxLat);
      const cbr = projectGeo(cMaxLon, cMinLat);
      const cx0 = wxToSx(ctl.x);
      const cy0 = wyToSy(ctl.y);
      const cw = wxToSx(cbr.x) - cx0;
      const ch = wyToSy(cbr.y) - cy0;
      if (cw <= 0 || ch <= 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx0, cy0, cw + 0.7, ch + 0.7);
      ctx.clip();
    }

    // For low-zoom tiles (z <= 4), slice vertically into horizontal latitude strips
    // so Mercator imagery aligns with sub-pixel precision to our non-linear global projection
    const strips = tile.z <= 2 ? 12 : tile.z <= 4 ? 6 : 1;
    if (strips === 1) {
      ctx.drawImage(img, dx, dy, dw + 0.7, dh + 0.7);
    } else {
      const n = 1 << tile.z;
      const srcH = img.naturalHeight / strips;
      for (let s = 0; s < strips; s++) {
        const yNormTop = (tile.ty + s / strips) / n;
        const yNormBot = (tile.ty + (s + 1) / strips) / n;
        const latTop = satYToLat(yNormTop);
        const latBot = satYToLat(yNormBot);
        const syTop = wyToSy(projectGeo(minLon, latTop).y);
        const syBot = wyToSy(projectGeo(minLon, latBot).y);
        const sh = syBot - syTop;
        if (sh <= 0 || syBot < -2 || syTop > viewH + 2) continue;
        ctx.drawImage(
          img,
          0,
          s * srcH,
          img.naturalWidth,
          srcH,
          dx,
          syTop,
          dw + 0.7,
          sh + 0.7
        );
      }
    }

    if (hasClip) {
      ctx.restore();
    }
  }

  ctx.restore();
}
