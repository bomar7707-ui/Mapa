import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export type OsmRoadClass =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'minor'
  | 'service'
  | 'track'
  | 'path'
  | 'ferry';

export interface OsmWaterPoly {
  rings: Float32Array[]; // alternating [lon0, lat0, lon1, lat1, ...]
  isRiver: boolean;
  isPond: boolean;
}

export interface OsmWaterway {
  cls: 'river' | 'canal' | 'stream';
  lines: Float32Array[];
  name?: string;
  intermittent: boolean;
}

export interface OsmWaterLabel {
  lon: number;
  lat: number;
  name: string;
  isLake: boolean;
}

export interface OsmRoadFeature {
  cls: OsmRoadClass;
  brunnel: 0 | 1 | 2; // 0 = normal, 1 = bridge, 2 = tunnel
  lines: Float32Array[];
}

export interface OsmRailwayFeature {
  brunnel: 0 | 1 | 2;
  isTransit: boolean;
  lines: Float32Array[];
}

export interface OsmRoadLabel {
  cls: string;
  ref?: string;
  name?: string;
  lines: Float32Array[];
}

export interface OsmParkFeature {
  rings: Float32Array[];
  name?: string;
  isNational: boolean;
}

export interface OsmAerowayFeature {
  isRunway: boolean;
  lines: Float32Array[];
  rings: Float32Array[];
}

export interface OsmBorderFeature {
  level: number; // 2 = country, 4 = region/kraj/state, 6 = district/okres/county
  lines: Float32Array[];
}

export interface OsmPlacePoint {
  lon: number;
  lat: number;
  name: string;
  cls: string; // city, town, village, hamlet, suburb, neighbourhood
  rank: number;
}

export interface OsmPeakPoint {
  lon: number;
  lat: number;
  name: string;
  ele: number;
  rank: number;
}

export interface DecodedOsmTile {
  key: string;
  z: number;
  tx: number;
  ty: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  forests: Float32Array[];
  wetlands: Float32Array[];
  glaciers: Float32Array[];
  urban: Float32Array[];
  buildings: Float32Array[];
  parks: OsmParkFeature[];
  waterPolys: OsmWaterPoly[];
  waterways: OsmWaterway[];
  waterLabels: OsmWaterLabel[];
  roads: OsmRoadFeature[];
  railways: OsmRailwayFeature[];
  aeroways: OsmAerowayFeature[];
  roadLabels: OsmRoadLabel[];
  borders: OsmBorderFeature[];
  places: OsmPlacePoint[];
  peaks: OsmPeakPoint[];
}

const TILE_CACHE = new Map<string, DecodedOsmTile>();
const TILE_INFLIGHT = new Map<string, Promise<DecodedOsmTile | null>>();
const FAILED_TILES = new Map<string, number>(); // key -> retryAfter timestamp
const MAX_CACHED_TILES = 240;

let resolvedTileTemplate: string | null = null;
let templatePromise: Promise<string> | null = null;

// Fallback OpenFreeMap planet URL (refreshed dynamically from TileJSON on first load)
const FALLBACK_TILE_TEMPLATE =
  'https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf';

function resolveOpenFreeMapTemplate(): Promise<string> {
  if (resolvedTileTemplate) return Promise.resolve(resolvedTileTemplate);
  if (templatePromise) return templatePromise;

  templatePromise = fetch('https://tiles.openfreemap.org/planet')
    .then((res) => (res.ok ? res.json() : null))
    .then((tj) => {
      if (tj && Array.isArray(tj.tiles) && typeof tj.tiles[0] === 'string') {
        resolvedTileTemplate = tj.tiles[0];
        return resolvedTileTemplate;
      }
      resolvedTileTemplate = FALLBACK_TILE_TEMPLATE;
      return resolvedTileTemplate;
    })
    .catch(() => {
      resolvedTileTemplate = FALLBACK_TILE_TEMPLATE;
      return resolvedTileTemplate;
    });

  return templatePromise;
}

export function lonToOsmTileX(lon: number, z: number): number {
  const n = 1 << z;
  const clamped = Math.max(-179.9999, Math.min(179.9999, lon));
  return Math.max(0, Math.min(n - 1, Math.floor(((clamped + 180) / 360) * n)));
}

export function latToOsmTileY(lat: number, z: number): number {
  const n = 1 << z;
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  const rad = (clamped * Math.PI) / 180;
  const frac = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  return Math.max(0, Math.min(n - 1, Math.floor(frac * n)));
}

export function osmTileBounds(
  z: number,
  tx: number,
  ty: number
): [number, number, number, number] {
  const n = 1 << z;
  const minLon = (tx / n) * 360 - 180;
  const maxLon = ((tx + 1) / n) * 360 - 180;
  const latFromY = (yVal: number) => {
    const merc = Math.PI * (1 - (2 * yVal) / n);
    return (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
  };
  const maxLat = latFromY(ty);
  const minLat = latFromY(ty + 1);
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Picks an optimal OpenMapTiles zoom level (z7..z14) based on the visible
 * longitude span so the viewport typically loads only 6-20 crisp tiles.
 */
export function pickOsmVectorZoom(
  viewLonSpanDeg: number,
  minZ = 7,
  maxZ = 14
): number {
  const span = Math.max(0.015, viewLonSpanDeg);
  const rawZ = Math.round(Math.log2((3.8 * 360) / span));
  return Math.max(minZ, Math.min(maxZ, rawZ));
}

function getPreferredName(props: Record<string, unknown>): string | undefined {
  const raw =
    props['name:cs'] ||
    props['name:latin'] ||
    props['name'] ||
    props['name:en'] ||
    props['name_en'];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function decodeFeatureCoords(
  feature: VectorTileFeature,
  z: number,
  tx: number,
  ty: number,
  extent: number
): Float32Array[] {
  const geom = feature.loadGeometry();
  const n = 1 << z;
  const invExtent = 1 / extent;
  const out: Float32Array[] = [];

  for (let r = 0; r < geom.length; r++) {
    const ring = geom[r];
    if (ring.length < 2) continue;
    const arr = new Float32Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      const gx = tx + ring[i].x * invExtent;
      const gy = ty + ring[i].y * invExtent;
      const lon = (gx / n) * 360 - 180;
      const merc = Math.PI * (1 - (2 * gy) / n);
      const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
      arr[i * 2] = lon;
      arr[i * 2 + 1] = lat;
    }
    out.push(arr);
  }
  return out;
}

function decodePointCoord(
  feature: VectorTileFeature,
  z: number,
  tx: number,
  ty: number,
  extent: number
): { lon: number; lat: number } | null {
  const geom = feature.loadGeometry();
  if (!geom.length || !geom[0].length) return null;
  const pt = geom[0][0];
  const n = 1 << z;
  const gx = tx + pt.x / extent;
  const gy = ty + pt.y / extent;
  const lon = (gx / n) * 360 - 180;
  const merc = Math.PI * (1 - (2 * gy) / n);
  const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
  return { lon, lat };
}

const URBAN_LANDUSE_CLASSES = new Set([
  'residential',
  'industrial',
  'commercial',
  'retail',
  'quarter',
  'suburb',
  'neighbourhood',
  'hospital',
  'school',
  'university',
  'college',
  'cemetery',
  'railway',
  'quarry',
  'military',
  'stadium',
]);

const ROAD_CLASS_MAP: Record<string, OsmRoadClass> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  minor: 'minor',
  service: 'service',
  track: 'track',
  path: 'path',
  ferry: 'ferry',
};

function decodeOsmPbfTile(
  buf: ArrayBuffer,
  z: number,
  tx: number,
  ty: number
): DecodedOsmTile {
  const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
  const tile: DecodedOsmTile = {
    key: `${z}/${tx}/${ty}`,
    z,
    tx,
    ty,
    bounds: osmTileBounds(z, tx, ty),
    forests: [],
    wetlands: [],
    glaciers: [],
    urban: [],
    buildings: [],
    parks: [],
    waterPolys: [],
    waterways: [],
    waterLabels: [],
    roads: [],
    railways: [],
    aeroways: [],
    roadLabels: [],
    borders: [],
    places: [],
    peaks: [],
  };

  // 1. Landcover (forests, wetlands, glaciers)
  const landcover = vt.layers.landcover;
  if (landcover) {
    const ext = landcover.extent || 4096;
    for (let i = 0; i < landcover.length; i++) {
      const f = landcover.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class || '');
      if (cls === 'wood') {
        const rings = decodeFeatureCoords(f, z, tx, ty, ext);
        for (let r = 0; r < rings.length; r++) tile.forests.push(rings[r]);
      } else if (cls === 'wetland') {
        const rings = decodeFeatureCoords(f, z, tx, ty, ext);
        for (let r = 0; r < rings.length; r++) tile.wetlands.push(rings[r]);
      } else if (cls === 'ice' || cls === 'glacier') {
        const rings = decodeFeatureCoords(f, z, tx, ty, ext);
        for (let r = 0; r < rings.length; r++) tile.glaciers.push(rings[r]);
      }
    }
  }

  // 2. Landuse (real built-up urban footprints)
  const landuse = vt.layers.landuse;
  if (landuse) {
    const ext = landuse.extent || 4096;
    for (let i = 0; i < landuse.length; i++) {
      const f = landuse.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class || '');
      if (URBAN_LANDUSE_CLASSES.has(cls)) {
        const rings = decodeFeatureCoords(f, z, tx, ty, ext);
        for (let r = 0; r < rings.length; r++) tile.urban.push(rings[r]);
      }
    }
  }

  // 3. National parks & protected areas
  const parkLayer = vt.layers.park;
  if (parkLayer && z >= 8) {
    const ext = parkLayer.extent || 4096;
    for (let i = 0; i < parkLayer.length; i++) {
      const f = parkLayer.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class || '').toLowerCase();
      const isNational =
        cls.includes('national_park') ||
        cls.includes('národní') ||
        cls.includes('protected') ||
        cls.includes('nature_reserve') ||
        cls.includes('conservation') ||
        cls.includes('biosph');
      if (!isNational) continue;
      const rings = decodeFeatureCoords(f, z, tx, ty, ext);
      if (rings.length > 0) {
        tile.parks.push({
          rings,
          name: getPreferredName(f.properties),
          isNational: cls.includes('national') || cls.includes('národní'),
        });
      }
    }
  }

  // 4. Buildings (only at z >= 13)
  const buildingLayer = vt.layers.building;
  if (buildingLayer && z >= 13) {
    const ext = buildingLayer.extent || 4096;
    const cap = Math.min(buildingLayer.length, 3200);
    for (let i = 0; i < cap; i++) {
      const f = buildingLayer.feature(i);
      if (f.type !== 3) continue;
      const rings = decodeFeatureCoords(f, z, tx, ty, ext);
      for (let r = 0; r < rings.length; r++) tile.buildings.push(rings[r]);
    }
  }

  // 5. Water polygons (lakes, reservoirs, ponds, wide rivers; exclude ocean so world bathymetry stays intact)
  const waterLayer = vt.layers.water;
  if (waterLayer) {
    const ext = waterLayer.extent || 4096;
    for (let i = 0; i < waterLayer.length; i++) {
      const f = waterLayer.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class || '');
      if (cls === 'ocean' || cls === 'sea' || cls === 'swimming_pool') continue;
      const rings = decodeFeatureCoords(f, z, tx, ty, ext);
      if (rings.length > 0) {
        tile.waterPolys.push({
          rings,
          isRiver: cls === 'river' || cls === 'canal',
          isPond: cls === 'pond',
        });
      }
    }
  }

  // 6. Waterways (rivers, canals, streams, brooks)
  const waterwayLayer = vt.layers.waterway;
  if (waterwayLayer) {
    const ext = waterwayLayer.extent || 4096;
    for (let i = 0; i < waterwayLayer.length; i++) {
      const f = waterwayLayer.feature(i);
      if (f.type !== 2) continue;
      const clsRaw = String(f.properties.class || 'stream');
      const cls: 'river' | 'canal' | 'stream' =
        clsRaw === 'river'
          ? 'river'
          : clsRaw === 'canal'
            ? 'canal'
            : 'stream';
      const lines = decodeFeatureCoords(f, z, tx, ty, ext);
      if (lines.length > 0) {
        tile.waterways.push({
          cls,
          lines,
          name: getPreferredName(f.properties),
          intermittent: f.properties.intermittent === 1,
        });
      }
    }
  }

  // 7. Water body names (lakes, reservoirs, ponds)
  const waterNameLayer = vt.layers.water_name;
  if (waterNameLayer) {
    const ext = waterNameLayer.extent || 4096;
    for (let i = 0; i < waterNameLayer.length; i++) {
      const f = waterNameLayer.feature(i);
      const cls = String(f.properties.class || '');
      if (cls === 'ocean' || cls === 'sea') continue;
      const name = getPreferredName(f.properties);
      if (!name) continue;
      const pt = decodePointCoord(f, z, tx, ty, ext);
      if (pt) {
        tile.waterLabels.push({
          lon: pt.lon,
          lat: pt.lat,
          name,
          isLake: cls === 'lake' || cls === 'pond' || cls === 'reservoir',
        });
      }
    }
  }

  // 8. Transportation (roads & railways)
  const transLayer = vt.layers.transportation;
  if (transLayer) {
    const ext = transLayer.extent || 4096;
    for (let i = 0; i < transLayer.length; i++) {
      const f = transLayer.feature(i);
      if (f.type !== 2) continue;
      const clsRaw = String(f.properties.class || '');
      const brunnelRaw = String(f.properties.brunnel || '');
      const brunnel: 0 | 1 | 2 =
        brunnelRaw === 'bridge' ? 1 : brunnelRaw === 'tunnel' ? 2 : 0;

      if (clsRaw === 'rail' || clsRaw === 'transit') {
        const lines = decodeFeatureCoords(f, z, tx, ty, ext);
        if (lines.length > 0) {
          tile.railways.push({
            brunnel,
            isTransit: clsRaw === 'transit',
            lines,
          });
        }
        continue;
      }

      const roadCls = ROAD_CLASS_MAP[clsRaw];
      if (!roadCls) continue;
      // Skip indoor paths
      if (f.properties.indoor === 1) continue;
      const lines = decodeFeatureCoords(f, z, tx, ty, ext);
      if (lines.length > 0) {
        tile.roads.push({
          cls: roadCls,
          brunnel,
          lines,
        });
      }
    }
  }

  // 9. Aeroways (runways & taxiways at z >= 10)
  const aeroLayer = vt.layers.aeroway;
  if (aeroLayer && z >= 10) {
    const ext = aeroLayer.extent || 4096;
    for (let i = 0; i < aeroLayer.length; i++) {
      const f = aeroLayer.feature(i);
      const cls = String(f.properties.class || '');
      if (cls !== 'runway' && cls !== 'taxiway' && cls !== 'apron') continue;
      const coords = decodeFeatureCoords(f, z, tx, ty, ext);
      if (coords.length > 0) {
        tile.aeroways.push({
          isRunway: cls === 'runway',
          lines: f.type === 2 ? coords : [],
          rings: f.type === 3 ? coords : [],
        });
      }
    }
  }

  // 10. Transportation labels (highway shields & street names)
  const transNameLayer = vt.layers.transportation_name;
  if (transNameLayer) {
    const ext = transNameLayer.extent || 4096;
    for (let i = 0; i < transNameLayer.length; i++) {
      const f = transNameLayer.feature(i);
      if (f.type !== 2) continue;
      const cls = String(f.properties.class || '');
      const refRaw =
        typeof f.properties.ref === 'string'
          ? f.properties.ref.trim()
          : undefined;
      const name = getPreferredName(f.properties);
      if (!refRaw && !name) continue;
      const lines = decodeFeatureCoords(f, z, tx, ty, ext);
      if (lines.length > 0) {
        tile.roadLabels.push({
          cls,
          ref: refRaw && refRaw.length <= 10 ? refRaw : undefined,
          name,
          lines,
        });
      }
    }
  }

  // 11. Precision administrative borders (admin_level 2, 4, 6; non-maritime)
  const boundaryLayer = vt.layers.boundary;
  if (boundaryLayer) {
    const ext = boundaryLayer.extent || 4096;
    for (let i = 0; i < boundaryLayer.length; i++) {
      const f = boundaryLayer.feature(i);
      if (f.type !== 2) continue;
      if (f.properties.maritime === 1) continue;
      const level = Number(f.properties.admin_level || 0);
      if (level !== 2 && level !== 4 && level !== 6) continue;
      const lines = decodeFeatureCoords(f, z, tx, ty, ext);
      if (lines.length > 0) {
        tile.borders.push({ level, lines });
      }
    }
  }

  // 12. Close-zoom villages, hamlets, suburbs (z >= 10)
  const placeLayer = vt.layers.place;
  if (placeLayer && z >= 10) {
    const ext = placeLayer.extent || 4096;
    for (let i = 0; i < placeLayer.length; i++) {
      const f = placeLayer.feature(i);
      if (f.type !== 1) continue;
      const cls = String(f.properties.class || '');
      if (
        cls !== 'town' &&
        cls !== 'village' &&
        cls !== 'hamlet' &&
        cls !== 'suburb' &&
        cls !== 'quarter'
      ) {
        continue;
      }
      const name = getPreferredName(f.properties);
      if (!name) continue;
      const pt = decodePointCoord(f, z, tx, ty, ext);
      if (pt) {
        tile.places.push({
          lon: pt.lon,
          lat: pt.lat,
          name,
          cls,
          rank: Number(f.properties.rank ?? 10),
        });
      }
    }
  }

  // 13. Close-zoom mountain peaks (z >= 10)
  const peakLayer = vt.layers.mountain_peak;
  if (peakLayer && z >= 10) {
    const ext = peakLayer.extent || 4096;
    for (let i = 0; i < peakLayer.length; i++) {
      const f = peakLayer.feature(i);
      if (f.type !== 1) continue;
      const name = getPreferredName(f.properties);
      const ele = Math.round(Number(f.properties.ele || 0));
      if (!name || !Number.isFinite(ele) || ele < 180) continue;
      const pt = decodePointCoord(f, z, tx, ty, ext);
      if (pt) {
        tile.peaks.push({
          lon: pt.lon,
          lat: pt.lat,
          name,
          ele,
          rank: Number(f.properties.rank ?? 10),
        });
      }
    }
  }

  return tile;
}

function fetchOsmVectorTile(
  z: number,
  tx: number,
  ty: number
): Promise<DecodedOsmTile | null> {
  const key = `${z}/${tx}/${ty}`;
  const existing = TILE_CACHE.get(key);
  if (existing) return Promise.resolve(existing);

  const retryAfter = FAILED_TILES.get(key);
  if (retryAfter && Date.now() < retryAfter) {
    return Promise.resolve(null);
  }

  const inflight = TILE_INFLIGHT.get(key);
  if (inflight) return inflight;

  const p = resolveOpenFreeMapTemplate()
    .then((tpl) => {
      const url = tpl
        .replace('{z}', String(z))
        .replace('{x}', String(tx))
        .replace('{y}', String(ty));
      return fetch(url);
    })
    .then(async (res) => {
      if (!res.ok) {
        FAILED_TILES.set(key, Date.now() + 15000);
        TILE_INFLIGHT.delete(key);
        return null;
      }
      const buf = await res.arrayBuffer();
      const decoded = decodeOsmPbfTile(buf, z, tx, ty);
      if (TILE_CACHE.size >= MAX_CACHED_TILES) {
        const oldestKey = TILE_CACHE.keys().next().value;
        if (oldestKey) TILE_CACHE.delete(oldestKey);
      }
      TILE_CACHE.set(key, decoded);
      TILE_INFLIGHT.delete(key);
      return decoded;
    })
    .catch(() => {
      FAILED_TILES.set(key, Date.now() + 15000);
      TILE_INFLIGHT.delete(key);
      return null;
    });

  TILE_INFLIGHT.set(key, p);
  return p;
}

/**
 * Ensures OpenStreetMap OpenMapTiles vector tiles covering the viewport are loaded.
 * Returns cached tiles immediately (falling back to cached parent/ancestor tiles
 * for any tile still streaming so panning/zooming never flickers).
 */
export function ensureOsmVectorTilesForViewport(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  targetZ: number,
  onTileLoaded: () => void
): {
  tiles: DecodedOsmTile[];
  exactCoverage: boolean;
  loadingCount: number;
  targetZ: number;
} {
  const tx0 = lonToOsmTileX(minLon, targetZ);
  const tx1 = lonToOsmTileX(maxLon, targetZ);
  const ty0 = latToOsmTileY(maxLat, targetZ);
  const ty1 = latToOsmTileY(minLat, targetZ);

  const tiles: DecodedOsmTile[] = [];
  const addedKeys = new Set<string>();
  let loadingCount = 0;
  let totalWanted = 0;
  const maxTiles = 30;

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (totalWanted >= maxTiles) break;
      totalWanted++;
      const key = `${targetZ}/${tx}/${ty}`;
      const cached = TILE_CACHE.get(key);
      if (cached) {
        // Refresh LRU position
        TILE_CACHE.delete(key);
        TILE_CACHE.set(key, cached);
        tiles.push(cached);
        addedKeys.add(key);
      } else {
        loadingCount++;
        if (!TILE_INFLIGHT.has(key)) {
          fetchOsmVectorTile(targetZ, tx, ty).then((decoded) => {
            if (decoded) onTileLoaded();
          });
        }
        // Check ancestor tiles (z-1, z-2) so the viewport never flashes empty during zoom/pan
        let foundFallback = false;
        for (let dz = 1; dz <= 2 && targetZ - dz >= 6; dz++) {
          const pz = targetZ - dz;
          const ptx = tx >> dz;
          const pty = ty >> dz;
          const pKey = `${pz}/${ptx}/${pty}`;
          const parentTile = TILE_CACHE.get(pKey);
          if (parentTile) {
            if (!addedKeys.has(pKey)) {
              tiles.push(parentTile);
              addedKeys.add(pKey);
            }
            foundFallback = true;
            break;
          }
        }
        // Or check immediate children (z+1) when zooming out
        if (!foundFallback && targetZ < 14) {
          const cz = targetZ + 1;
          for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
              const cKey = `${cz}/${tx * 2 + dx}/${ty * 2 + dy}`;
              const childTile = TILE_CACHE.get(cKey);
              if (childTile && !addedKeys.has(cKey)) {
                tiles.push(childTile);
                addedKeys.add(cKey);
              }
            }
          }
        }
      }
    }
  }

  return {
    tiles,
    exactCoverage: loadingCount === 0 && tiles.length > 0,
    loadingCount,
    targetZ,
  };
}
