import { CZ_BOUNDS } from '../data/czechGeo';
import {
  RealCzechAdmin,
  RealCzechDataset,
  RealCzechPlaces,
  RealCzechVectors,
  RealDemGrid,
} from '../types/map';

const TILE_CACHE = new Map<string, Float32Array>();
const TILE_INFLIGHT = new Map<string, Promise<Float32Array | null>>();

function decodeTerrariumImageData(
  imgData: Uint8ClampedArray,
  pixelCount: number
): Float32Array {
  const out = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4;
    const r = imgData[p];
    const g = imgData[p + 1];
    const b = imgData[p + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

function loadPngPixels(
  url: string,
  crossOrigin?: string
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({
        width: canvas.width,
        height: canvas.height,
        data: imageData.data,
      });
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

async function loadDemPng(url: string): Promise<RealDemGrid> {
  const { width, height, data } = await loadPngPixels(url);
  return {
    cols: width,
    rows: height,
    elevations: decodeTerrariumImageData(data, width * height),
  };
}

let cachedDatasetPromise: Promise<RealCzechDataset | null> | null = null;

export function loadRealCzechDataset(): Promise<RealCzechDataset | null> {
  if (cachedDatasetPromise) return cachedDatasetPromise;
  cachedDatasetPromise = (async () => {
    try {
      const [dem, adminRes, vecRes, placesRes] = await Promise.all([
        loadDemPng('/data/cz-dem.png'),
        fetch('/data/cz-admin.json'),
        fetch('/data/cz-vector.json'),
        fetch('/data/cz-places.json'),
      ]);
      if (!adminRes.ok || !vecRes.ok || !placesRes.ok) {
        return null;
      }
      const [admin, vectors, places] = (await Promise.all([
        adminRes.json(),
        vecRes.json(),
        placesRes.json(),
      ])) as [RealCzechAdmin, RealCzechVectors, RealCzechPlaces];

      return { dem, admin, vectors, places };
    } catch {
      return null;
    }
  })();
  return cachedDatasetPromise;
}

export function sampleRealDemBilinear(
  dem: RealDemGrid,
  lon: number,
  lat: number
): number {
  const fx =
    ((lon - CZ_BOUNDS.minLon) / (CZ_BOUNDS.maxLon - CZ_BOUNDS.minLon)) *
    (dem.cols - 1);
  const fy =
    ((CZ_BOUNDS.maxLat - lat) / (CZ_BOUNDS.maxLat - CZ_BOUNDS.minLat)) *
    (dem.rows - 1);

  const cx = Math.max(0, Math.min(dem.cols - 1.0001, fx));
  const cy = Math.max(0, Math.min(dem.rows - 1.0001, fy));
  const c0 = Math.floor(cx);
  const r0 = Math.floor(cy);
  const tx = cx - c0;
  const ty = cy - r0;

  const g = dem.elevations;
  const i00 = r0 * dem.cols + c0;
  const v00 = g[i00];
  const v10 = g[i00 + 1];
  const v01 = g[i00 + dem.cols];
  const v11 = g[i00 + dem.cols + 1];

  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

// Slippy-map Terrarium streaming for deep zoom (z10..z12 => ~19m..150m SRTM/EU-DEM)
function lonToTileFrac(lon: number, z: number): number {
  return ((lon + 180) / 360) * (1 << z);
}

function latToTileFrac(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    (1 << z)
  );
}

export function pickTerrariumZoom(cameraZoom: number): number {
  if (cameraZoom >= 0.024) return 12;
  if (cameraZoom >= 0.011) return 11;
  return 10;
}

function fetchTerrariumTile(
  z: number,
  tx: number,
  ty: number
): Promise<Float32Array | null> {
  const key = `${z}/${tx}/${ty}`;
  const existing = TILE_CACHE.get(key);
  if (existing) return Promise.resolve(existing);

  const inflight = TILE_INFLIGHT.get(key);
  if (inflight) return inflight;

  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
  const p = loadPngPixels(url, 'anonymous')
    .then(({ width, height, data }) => {
      const grid = decodeTerrariumImageData(data, width * height);
      if (TILE_CACHE.size > 320) {
        const firstKey = TILE_CACHE.keys().next().value;
        if (firstKey) TILE_CACHE.delete(firstKey);
      }
      TILE_CACHE.set(key, grid);
      TILE_INFLIGHT.delete(key);
      return grid;
    })
    .catch(() => {
      TILE_INFLIGHT.delete(key);
      return null;
    });

  TILE_INFLIGHT.set(key, p);
  return p;
}

export async function ensureViewportTerrariumTiles(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  z: number
): Promise<boolean> {
  const tx0 = Math.floor(lonToTileFrac(minLon, z));
  const tx1 = Math.floor(lonToTileFrac(maxLon, z));
  const ty0 = Math.floor(latToTileFrac(maxLat, z));
  const ty1 = Math.floor(latToTileFrac(minLat, z));

  const jobs: Promise<Float32Array | null>[] = [];
  let loadedAnyNew = false;

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const key = `${z}/${tx}/${ty}`;
      if (!TILE_CACHE.has(key)) {
        jobs.push(
          fetchTerrariumTile(z, tx, ty).then((res) => {
            if (res) loadedAnyNew = true;
            return res;
          })
        );
      }
    }
  }

  if (jobs.length === 0) return false;
  // Cap parallel tiles in case of extreme bounds
  await Promise.all(jobs.slice(0, 36));
  return loadedAnyNew;
}

export function sampleElevationWithTiles(
  dem: RealDemGrid,
  lon: number,
  lat: number,
  preferredZ?: number
): number {
  if (preferredZ && preferredZ >= 10) {
    const pxG = lonToTileFrac(lon, preferredZ) * 256;
    const pyG = latToTileFrac(lat, preferredZ) * 256;
    const ix0 = Math.floor(pxG);
    const iy0 = Math.floor(pyG);
    const dx = pxG - ix0;
    const dy = pyG - iy0;

    const getPx = (gx: number, gy: number): number | null => {
      const tx = Math.floor(gx / 256);
      const ty = Math.floor(gy / 256);
      const tile = TILE_CACHE.get(`${preferredZ}/${tx}/${ty}`);
      if (!tile) return null;
      const lx = ((gx % 256) + 256) % 256;
      const ly = ((gy % 256) + 256) % 256;
      return tile[ly * 256 + lx];
    };

    const e00 = getPx(ix0, iy0);
    const e10 = getPx(ix0 + 1, iy0);
    const e01 = getPx(ix0, iy0 + 1);
    const e11 = getPx(ix0 + 1, iy0 + 1);

    if (e00 !== null && e10 !== null && e01 !== null && e11 !== null) {
      const top = e00 + (e10 - e00) * dx;
      const bot = e01 + (e11 - e01) * dx;
      return top + (bot - top) * dy;
    }
  }

  return sampleRealDemBilinear(dem, lon, lat);
}

export const WORLD_GEO_BOUNDS = {
  minLon: -180,
  maxLon: 180,
  minLat: -85,
  maxLat: 85,
};

function computeMultiPolyBbox(
  rings: [number, number][][]
): import('../types/map').GeoBbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = ring[i];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

let cachedWorldPromise: Promise<import('../types/map').RealWorldDataset | null> | null =
  null;

export function loadRealWorldDataset(): Promise<
  import('../types/map').RealWorldDataset | null
> {
  if (cachedWorldPromise) return cachedWorldPromise;
  cachedWorldPromise = (async () => {
    try {
      const [dem, dataRes] = await Promise.all([
        loadDemPng('/data/world-dem.png'),
        fetch('/data/world-data.json'),
      ]);
      if (!dataRes.ok) return null;
      const vec = await dataRes.json();
      const countries: import('../types/map').WorldCountry[] = (
        vec.countries ?? []
      ).map((c: import('../types/map').WorldCountry) => ({
        ...c,
        b: computeMultiPolyBbox(c.rings),
      }));
      const rivers: import('../types/map').WorldRiver[] = (
        vec.rivers ?? []
      ).map((r: import('../types/map').WorldRiver) => ({
        ...r,
        b: computeMultiPolyBbox(r.lines),
      }));
      const lakes: import('../types/map').WorldLake[] = (vec.lakes ?? []).map(
        (l: import('../types/map').WorldLake) => ({
          ...l,
          b: computeMultiPolyBbox(l.rings),
        })
      );
      return {
        dem,
        countries,
        rivers,
        lakes,
        cities: vec.cities ?? [],
        peaks: vec.peaks ?? [],
      };
    } catch {
      return null;
    }
  })();
  return cachedWorldPromise;
}

export function sampleWorldDemBilinear(
  dem: RealDemGrid,
  lon: number,
  lat: number
): number {
  const fx =
    ((lon - WORLD_GEO_BOUNDS.minLon) /
      (WORLD_GEO_BOUNDS.maxLon - WORLD_GEO_BOUNDS.minLon)) *
    (dem.cols - 1);
  const fy =
    ((WORLD_GEO_BOUNDS.maxLat - lat) /
      (WORLD_GEO_BOUNDS.maxLat - WORLD_GEO_BOUNDS.minLat)) *
    (dem.rows - 1);

  const cx = Math.max(0, Math.min(dem.cols - 1.0001, fx));
  const cy = Math.max(0, Math.min(dem.rows - 1.0001, fy));
  const c0 = Math.floor(cx);
  const r0 = Math.floor(cy);
  const tx = cx - c0;
  const ty = cy - r0;

  const g = dem.elevations;
  const i00 = r0 * dem.cols + c0;
  const v00 = g[i00];
  const v10 = g[i00 + 1];
  const v01 = g[i00 + dem.cols];
  const v11 = g[i00 + dem.cols + 1];

  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

// ============================================================================
// LOGICAL GEOGRAPHIC BLOCKS (15° x 15° On-Demand Viewport Streaming)
// ============================================================================

let cachedWorldPlacesIndexPromise: Promise<
  import('../types/map').WorldPlacesIndex | null
> | null = null;

export function loadWorldPlacesIndex(): Promise<
  import('../types/map').WorldPlacesIndex | null
> {
  if (cachedWorldPlacesIndexPromise) return cachedWorldPlacesIndexPromise;
  cachedWorldPlacesIndexPromise = (async () => {
    try {
      const res = await fetch('/data/world-places-index.json');
      if (!res.ok) return null;
      return (await res.json()) as import('../types/map').WorldPlacesIndex;
    } catch {
      return null;
    }
  })();
  return cachedWorldPlacesIndexPromise;
}

const WORLD_BLOCK_CACHE = new Map<
  string,
  import('../types/map').WorldDetailBlock
>();
const WORLD_BLOCK_INFLIGHT = new Map<
  string,
  Promise<import('../types/map').WorldDetailBlock | null>
>();

function fetchWorldDetailBlock(
  blockId: string
): Promise<import('../types/map').WorldDetailBlock | null> {
  const existing = WORLD_BLOCK_CACHE.get(blockId);
  if (existing) return Promise.resolve(existing);

  const inflight = WORLD_BLOCK_INFLIGHT.get(blockId);
  if (inflight) return inflight;

  const p = fetch(`/data/world-blocks/${blockId}.json`)
    .then(async (res) => {
      if (!res.ok) return null;
      const blk =
        (await res.json()) as import('../types/map').WorldDetailBlock;
      // Keep an LRU cache of up to 36 logical blocks
      if (WORLD_BLOCK_CACHE.size > 36) {
        const oldestKey = WORLD_BLOCK_CACHE.keys().next().value;
        if (oldestKey) WORLD_BLOCK_CACHE.delete(oldestKey);
      }
      WORLD_BLOCK_CACHE.set(blockId, blk);
      WORLD_BLOCK_INFLIGHT.delete(blockId);
      return blk;
    })
    .catch(() => {
      WORLD_BLOCK_INFLIGHT.delete(blockId);
      return null;
    });

  WORLD_BLOCK_INFLIGHT.set(blockId, p);
  return p;
}

export function getIntersectingWorldBlocks(
  index: import('../types/map').WorldPlacesIndex,
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  marginDeg = 1.8
): import('../types/map').WorldBlockMeta[] {
  const deg = index.blockSizeDeg || 15;
  const cols = index.cols || 24;
  const rows = index.rows || 12;

  const qMinLon = Math.max(-180, minLon - marginDeg);
  const qMaxLon = Math.min(180, maxLon + marginDeg);
  const qMinLat = Math.max(-90, minLat - marginDeg);
  const qMaxLat = Math.min(90, maxLat + marginDeg);

  const c0 = Math.max(0, Math.min(cols - 1, Math.floor((qMinLon + 180) / deg)));
  const c1 = Math.max(0, Math.min(cols - 1, Math.floor((qMaxLon + 180) / deg)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor((qMinLat + 90) / deg)));
  const r1 = Math.max(0, Math.min(rows - 1, Math.floor((qMaxLat + 90) / deg)));

  const centerLon = (minLon + maxLon) * 0.5;
  const centerLat = (minLat + maxLat) * 0.5;

  const metas: import('../types/map').WorldBlockMeta[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const id = `b_${String(c).padStart(2, '0')}_${String(r).padStart(2, '0')}`;
      const meta = index.blocks[id];
      if (meta) {
        metas.push(meta);
      }
    }
  }

  // Sort by proximity to viewport center so the primary block loads first
  metas.sort((a, b) => {
    const aLon = (a.b[0] + a.b[2]) * 0.5;
    const aLat = (a.b[1] + a.b[3]) * 0.5;
    const bLon = (b.b[0] + b.b[2]) * 0.5;
    const bLat = (b.b[1] + b.b[3]) * 0.5;
    const da = Math.hypot(aLon - centerLon, aLat - centerLat);
    const db = Math.hypot(bLon - centerLon, bLat - centerLat);
    return da - db;
  });

  return metas;
}

export function ensureWorldDetailBlocksForViewport(
  index: import('../types/map').WorldPlacesIndex | null,
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  onBlockLoaded: () => void,
  marginDeg = 1.8
): {
  loadedBlocks: import('../types/map').WorldDetailBlock[];
  activeMetas: import('../types/map').WorldBlockMeta[];
  loadingCount: number;
  totalCachedCount: number;
} {
  if (!index) {
    return {
      loadedBlocks: [],
      activeMetas: [],
      loadingCount: 0,
      totalCachedCount: WORLD_BLOCK_CACHE.size,
    };
  }

  const activeMetas = getIntersectingWorldBlocks(
    index,
    minLon,
    maxLon,
    minLat,
    maxLat,
    marginDeg
  );

  const loadedBlocks: import('../types/map').WorldDetailBlock[] = [];
  let loadingCount = 0;

  for (const meta of activeMetas) {
    const cached = WORLD_BLOCK_CACHE.get(meta.id);
    if (cached) {
      // Refresh LRU position
      WORLD_BLOCK_CACHE.delete(meta.id);
      WORLD_BLOCK_CACHE.set(meta.id, cached);
      loadedBlocks.push(cached);
    } else {
      loadingCount++;
      const alreadyInflight = WORLD_BLOCK_INFLIGHT.has(meta.id);
      if (!alreadyInflight) {
        fetchWorldDetailBlock(meta.id).then((blk) => {
          if (blk) {
            onBlockLoaded();
          }
        });
      }
    }
  }

  return {
    loadedBlocks,
    activeMetas,
    loadingCount,
    totalCachedCount: WORLD_BLOCK_CACHE.size,
  };
}

export function pickWorldTerrariumZoom(cameraZoom: number): number {
  // Scale 1 : 3,000,000 corresponds to cameraZoom ~ 0.00126
  if (cameraZoom >= 0.032) return 12;
  if (cameraZoom >= 0.015) return 11;
  if (cameraZoom >= 0.006) return 10;
  if (cameraZoom >= 0.00125) return 9;
  if (cameraZoom >= 0.0007) return 7;
  if (cameraZoom >= 0.00035) return 6;
  return 5;
}

export function sampleWorldElevationWithTiles(
  dem: RealDemGrid,
  lon: number,
  lat: number,
  preferredZ?: number,
  czDem?: RealDemGrid | null
): number {
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const clampedLon = Math.max(-180, Math.min(180, lon));
  if (preferredZ && preferredZ >= 5) {
    const n = 1 << preferredZ;
    const pxG = lonToTileFrac(clampedLon, preferredZ) * 256;
    const pyG = latToTileFrac(clampedLat, preferredZ) * 256;
    const ix0 = Math.floor(pxG);
    const iy0 = Math.floor(pyG);
    const dx = pxG - ix0;
    const dy = pyG - iy0;

    const getPx = (gx: number, gy: number): number | null => {
      const gxWrap = ((gx % (n * 256)) + n * 256) % (n * 256);
      const gyClamp = Math.max(0, Math.min(n * 256 - 1, gy));
      const tx = Math.floor(gxWrap / 256);
      const ty = Math.floor(gyClamp / 256);
      const tile = TILE_CACHE.get(`${preferredZ}/${tx}/${ty}`);
      if (!tile) return null;
      const lx = gxWrap % 256;
      const ly = gyClamp % 256;
      return tile[ly * 256 + lx];
    };

    const e00 = getPx(ix0, iy0);
    const e10 = getPx(ix0 + 1, iy0);
    const e01 = getPx(ix0, iy0 + 1);
    const e11 = getPx(ix0 + 1, iy0 + 1);

    if (e00 !== null && e10 !== null && e01 !== null && e11 !== null) {
      const top = e00 + (e10 - e00) * dx;
      const bot = e01 + (e11 - e01) * dx;
      return top + (bot - top) * dy;
    }
  }

  if (
    czDem &&
    clampedLon >= CZ_BOUNDS.minLon &&
    clampedLon <= CZ_BOUNDS.maxLon &&
    clampedLat >= CZ_BOUNDS.minLat &&
    clampedLat <= CZ_BOUNDS.maxLat
  ) {
    return sampleRealDemBilinear(czDem, clampedLon, clampedLat);
  }

  return sampleWorldDemBilinear(dem, clampedLon, clampedLat);
}


