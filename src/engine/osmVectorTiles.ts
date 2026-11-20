import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { LayerVisibility, MapStylePreset } from '../types/map';

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

export interface OsmWaterLabel {
  lon: number;
  lat: number;
  name: string;
  isLake: boolean;
}

export interface OsmRiverLabel {
  lon: number;
  lat: number;
  angle: number;
  name: string;
  isRiver: boolean;
}

export interface OsmRoadShield {
  lon: number;
  lat: number;
  cls: string;
  ref: string;
}

export interface OsmStreetLabel {
  lon: number;
  lat: number;
  angle: number;
  name: string;
  isMajor: boolean;
}

export interface OsmPlacePoint {
  lon: number;
  lat: number;
  name: string;
  cls: string;
  rank: number;
}

export interface OsmPeakPoint {
  lon: number;
  lat: number;
  name: string;
  ele: number;
  rank: number;
}

export interface OsmTileLabels {
  waterLabels: OsmWaterLabel[];
  riverLabels: OsmRiverLabel[];
  roadShields: OsmRoadShield[];
  streetLabels: OsmStreetLabel[];
  places: OsmPlacePoint[];
  peaks: OsmPeakPoint[];
}

export interface OsmTileRenderOptions {
  stylePreset: MapStylePreset;
  forests: boolean;
  hydrology: boolean;
  highways: boolean;
  railways: boolean;
  cities: boolean;
  drawCountryBorders: boolean;
  drawRegionalBorders: boolean;
  waterFill: string;
  waterStroke: string;
  borderOuter: string;
  borderInner: string;
  regionBorder: string;
  isDark: boolean;
}

export interface RenderedOsmTile {
  key: string;
  tileKey: string;
  z: number;
  tx: number;
  ty: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  baseImageData: ImageData | null; // CPU-backed ImageData (0 GPU VRAM!): forests, wetlands, glaciers, parks, urban, buildings (under contours)
  overlayImageData: ImageData | null; // CPU-backed ImageData (0 GPU VRAM!): water, waterways, aeroways, railways, roads, borders (over contours)
  labels: OsmTileLabels;
  clipBounds?: [number, number, number, number];
}

const TILE_PX = 512;
const MAX_RAW_PBF_CACHE = 160;
const MAX_RENDERED_TILES = 120;
const MAX_LABELS_CACHE = 160;
const MAX_CONCURRENT_FETCHES = 8;
const MAX_VISIBLE_TILES_BUDGET = 32;

const RAW_PBF_CACHE = new Map<string, ArrayBuffer>();
const LABELS_CACHE = new Map<string, OsmTileLabels>();
const RENDERED_CACHE = new Map<string, RenderedOsmTile>();
const FETCH_INFLIGHT = new Map<string, Promise<ArrayBuffer | null>>();
const FAILED_TILES = new Map<string, number>();

let activeFetchCount = 0;
let activeRenderSig: string | null = null;
let lastRequestedZ: number | null = null;
let resolvedTileTemplate: string | null = null;
let templatePromise: Promise<string> | null = null;

// Staggered off-frame rasterization queue (1 tile per tick so UI never stalls or OOMs)
interface RasterJob {
  renderKey: string;
  tileKey: string;
  z: number;
  tx: number;
  ty: number;
  opts: OsmTileRenderOptions;
  onReady: () => void;
}
const RASTER_QUEUE: RasterJob[] = [];
const RASTER_QUEUED_KEYS = new Set<string>();
let rasterScheduled = false;

interface FetchJob {
  renderKey: string;
  tileKey: string;
  z: number;
  tx: number;
  ty: number;
  opts: OsmTileRenderOptions;
  onReady: () => void;
}
const FETCH_QUEUE: FetchJob[] = [];
const FETCH_QUEUED_KEYS = new Set<string>();

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

export function pickOsmVectorZoom(
  viewLonSpanDeg: number,
  minZ = 7,
  maxZ = 14
): number {
  if (!Number.isFinite(viewLonSpanDeg) || viewLonSpanDeg <= 0) return minZ;
  const span = Math.max(0.015, viewLonSpanDeg);
  const rawZ = Math.floor(Math.log2((2.7 * 360) / span));
  return Math.max(minZ, Math.min(maxZ, rawZ));
}

export function buildOsmRenderOptions(
  stylePreset: MapStylePreset,
  layers: LayerVisibility,
  pal: {
    isDark: boolean;
    waterFill: string;
    waterStroke: string;
    borderOuter: string;
    borderInner: string;
    regionBorder: string;
  },
  drawCountryBorders: boolean,
  drawRegionalBorders: boolean
): OsmTileRenderOptions {
  return {
    stylePreset,
    forests: layers.forests,
    hydrology: layers.hydrology,
    highways: layers.highways,
    railways: layers.railways,
    cities: layers.cities,
    drawCountryBorders,
    drawRegionalBorders,
    waterFill: pal.waterFill,
    waterStroke: pal.waterStroke,
    borderOuter: pal.borderOuter,
    borderInner: pal.borderInner,
    regionBorder: pal.regionBorder,
    isDark: pal.isDark,
  };
}

function getRenderSignature(opts: OsmTileRenderOptions): string {
  return `v6|${opts.stylePreset}|${opts.forests ? 1 : 0}${opts.hydrology ? 1 : 0}${opts.highways ? 1 : 0}${opts.railways ? 1 : 0}${opts.cities ? 1 : 0}${opts.drawCountryBorders ? 1 : 0}${opts.drawRegionalBorders ? 1 : 0}`;
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

interface RoadPaintStyle {
  minZ: number;
  casing: string;
  core: string;
  casingW: number;
  coreW: number;
  dash?: number[];
}

function getRoadPaintStyles(
  z: number,
  isDark: boolean
): Record<OsmRoadClass, RoadPaintStyle> {
  // Calibrated for 512x512 super-sampled tiles so roads render as extra-fine, crisp Mapy.com lines
  const zScale =
    z >= 14
      ? 1.32
      : z >= 13
        ? 1.15
        : z >= 12
          ? 1.0
          : z >= 11
            ? 0.9
            : z >= 9
              ? 0.82
              : 0.75;

  if (isDark) {
    return {
      ferry: {
        minZ: 8,
        casing: '#4A749C',
        core: '',
        casingW: 0.72,
        coreW: 0,
        dash: [5, 5],
      },
      path: {
        minZ: 13,
        casing: '#526071',
        core: '',
        casingW: 0.52 * zScale,
        coreW: 0,
        dash: [3, 3],
      },
      track: {
        minZ: 12,
        casing: '#58677A',
        core: '',
        casingW: 0.62 * zScale,
        coreW: 0,
        dash: [5, 3],
      },
      service: {
        minZ: 13,
        casing: '#3A4656',
        core: '#283240',
        casingW: 0.96 * zScale,
        coreW: 0.52 * zScale,
      },
      minor: {
        minZ: 11,
        casing: '#445264',
        core: '#334050',
        casingW: 1.2 * zScale,
        coreW: 0.68 * zScale,
      },
      tertiary: {
        minZ: 10,
        casing: '#526275',
        core: '#465568',
        casingW: 1.42 * zScale,
        coreW: 0.82 * zScale,
      },
      secondary: {
        minZ: 8,
        casing: z <= 9 ? '#A47632' : '#785422',
        core: z <= 9 ? '' : '#B88438',
        casingW: z <= 9 ? 0.84 * zScale : 1.62 * zScale,
        coreW: z <= 9 ? 0 : 0.96 * zScale,
      },
      primary: {
        minZ: 7,
        casing: '#84581E',
        core: '#CC8E32',
        casingW: 1.88 * zScale,
        coreW: 1.12 * zScale,
      },
      trunk: {
        minZ: 7,
        casing: '#225A2B',
        core: '#42944B',
        casingW: 2.24 * zScale,
        coreW: 1.34 * zScale,
      },
      motorway: {
        minZ: 7,
        casing: '#1E5E28',
        core: '#48A252',
        casingW: 2.58 * zScale,
        coreW: 1.54 * zScale,
      },
    };
  }

  // Mapy.com light/atlas/natural road hierarchy: 100% opaque colors, delicate widths
  return {
    ferry: {
      minZ: 8,
      casing: '#5A9AD2',
      core: '',
      casingW: 0.75,
      coreW: 0,
      dash: [5, 5],
    },
    path: {
      minZ: 13,
      casing: '#9A9286',
      core: '',
      casingW: 0.55 * zScale,
      coreW: 0,
      dash: [3, 3],
    },
    track: {
      minZ: 12,
      casing: '#948B7E',
      core: '',
      casingW: 0.64 * zScale,
      coreW: 0,
      dash: [5, 3],
    },
    service: {
      minZ: 13,
      casing: '#C6BEB0',
      core: '#FCFBF8',
      casingW: 1.0 * zScale,
      coreW: 0.56 * zScale,
    },
    minor: {
      minZ: 11,
      casing: '#BEB5A4',
      core: '#FEFDFA',
      casingW: 1.24 * zScale,
      coreW: 0.74 * zScale,
    },
    tertiary: {
      minZ: 10,
      casing: z <= 11 ? '#DEB95C' : '#C6A04A',
      core: z <= 11 ? '' : '#FCE38C',
      casingW: z <= 11 ? 0.82 * zScale : 1.46 * zScale,
      coreW: z <= 11 ? 0 : 0.88 * zScale,
    },
    secondary: {
      minZ: 8,
      casing: z <= 9 ? '#EAB03C' : '#CA8E28',
      core: z <= 9 ? '' : '#F9C454',
      casingW: z <= 9 ? 0.86 * zScale : 1.66 * zScale,
      coreW: z <= 9 ? 0 : 1.0 * zScale,
    },
    primary: {
      minZ: 7,
      casing: '#C87C1A',
      core: '#F6A62C',
      casingW: 1.92 * zScale,
      coreW: 1.16 * zScale,
    },
    trunk: {
      minZ: 7,
      casing: '#328038',
      core: '#66C56A',
      casingW: 2.3 * zScale,
      coreW: 1.38 * zScale,
    },
    motorway: {
      minZ: 7,
      casing: '#2B7830',
      core: '#5AC05E',
      casingW: 2.65 * zScale,
      coreW: 1.6 * zScale,
    },
  };
}

const ROAD_TIER_GROUPS: OsmRoadClass[][] = [
  ['ferry', 'path', 'track'],
  ['service', 'minor', 'tertiary'],
  ['secondary', 'primary'],
  ['trunk', 'motorway'],
];

function signedRingArea(ring: { x: number; y: number }[]): number {
  let area = 0;
  const len = ring.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    area += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  }
  return area;
}

function traceRingToTileCtx(
  ctx: CanvasRenderingContext2D,
  ring: { x: number; y: number }[],
  n: number,
  ty: number,
  maxLat: number,
  invLatSpan: number,
  invExt: number,
  xScale: number,
  close: boolean
): boolean {
  const len = ring.length;
  if (len < 2) return false;
  let first = true;
  let prevU = -99999;
  let prevV = -99999;

  for (let i = 0; i < len; i++) {
    const pt = ring[i];
    const u = Math.max(-128, Math.min(TILE_PX + 128, pt.x * xScale));
    const gy = ty + pt.y * invExt;
    const merc = Math.PI * (1 - (2 * gy) / n);
    const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
    const v = Math.max(
      -128,
      Math.min(TILE_PX + 128, (maxLat - lat) * invLatSpan * TILE_PX)
    );
    if (first) {
      ctx.moveTo(u, v);
      first = false;
      prevU = u;
      prevV = v;
    } else {
      // Never skip corners or visible edges; only coalesce sub-quarter-pixel duplicates
      if (
        i < len - 1 &&
        Math.abs(u - prevU) < 0.2 &&
        Math.abs(v - prevV) < 0.2
      ) {
        continue;
      }
      ctx.lineTo(u, v);
      prevU = u;
      prevV = v;
    }
  }
  if (close) ctx.closePath();
  return !first;
}

function isTinyRing(
  ring: { x: number; y: number }[],
  xScale: number,
  minPx: number
): boolean {
  const len = ring.length;
  if (len < 3) return true;
  let minX = ring[0].x;
  let maxX = minX;
  let minY = ring[0].y;
  let maxY = minY;
  for (let i = 1; i < len; i++) {
    const px = ring[i].x;
    const py = ring[i].y;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return (maxX - minX) * xScale < minPx && (maxY - minY) * xScale < minPx;
}

/**
 * Safely fills/strokes an MVT polygon or MultiPolygon feature by classifying
 * exterior rings and interior holes using @mapbox/vector-tile's exact winding rule,
 * drawing each polygon individually so large MultiPolygons never overload Skia.
 */
function paintPolygonFeatureSafe(
  ctx: CanvasRenderingContext2D,
  feature: VectorTileFeature,
  n: number,
  ty: number,
  maxLat: number,
  invLatSpan: number,
  extent: number,
  minPx: number,
  doFill: boolean,
  doStroke: boolean
): boolean {
  const geom = feature.loadGeometry();
  if (geom.length === 0) return false;
  const invExt = 1 / extent;
  const xScale = TILE_PX * invExt;
  let painted = false;

  // Group rings into [outer, ...holes] polygons using the first non-zero ring's winding sign
  const polygons: { x: number; y: number }[][][] = [];
  let currentPoly: { x: number; y: number }[][] | null = null;
  let outerIsNeg: boolean | undefined;

  for (let i = 0; i < geom.length; i++) {
    const ring = geom[i];
    const area = signedRingArea(ring);
    if (area === 0) continue;
    const isNeg = area < 0;
    if (outerIsNeg === undefined) {
      outerIsNeg = isNeg;
    }
    if (isNeg === outerIsNeg) {
      if (currentPoly) polygons.push(currentPoly);
      currentPoly = [ring];
    } else if (currentPoly) {
      currentPoly.push(ring);
    }
  }
  if (currentPoly) polygons.push(currentPoly);

  for (let p = 0; p < polygons.length; p++) {
    const poly = polygons[p];
    const outer = poly[0];
    if (isTinyRing(outer, xScale, minPx)) continue;

    ctx.beginPath();
    if (
      !traceRingToTileCtx(
        ctx,
        outer,
        n,
        ty,
        maxLat,
        invLatSpan,
        invExt,
        xScale,
        true
      )
    ) {
      continue;
    }
    for (let h = 1; h < poly.length; h++) {
      if (!isTinyRing(poly[h], xScale, minPx)) {
        traceRingToTileCtx(
          ctx,
          poly[h],
          n,
          ty,
          maxLat,
          invLatSpan,
          invExt,
          xScale,
          true
        );
      }
    }
    if (doFill) ctx.fill('evenodd');
    if (doStroke) ctx.stroke();
    painted = true;
  }
  return painted;
}

/**
 * Traces an MVT line feature onto a tile-local equirectangular canvas (0..TILE_PX)
 * with strict coordinate clamping.
 */
function traceFeatureToTileCtx(
  ctx: CanvasRenderingContext2D,
  feature: VectorTileFeature,
  n: number,
  ty: number,
  maxLat: number,
  invLatSpan: number,
  extent: number,
  close: boolean
): boolean {
  const geom = feature.loadGeometry();
  const invExt = 1 / extent;
  const xScale = TILE_PX * invExt;
  let drew = false;

  for (let r = 0; r < geom.length; r++) {
    const ring = geom[r];
    if (ring.length < 2) continue;
    if (close && isTinyRing(ring, xScale, 0.8)) continue;
    if (
      traceRingToTileCtx(ctx, ring, n, ty, maxLat, invLatSpan, invExt, xScale, close)
    ) {
      drew = true;
    }
  }
  return drew;
}

function tilePtToGeo(
  px: number,
  py: number,
  n: number,
  tx: number,
  ty: number,
  extent: number
): { lon: number; lat: number } {
  const gx = tx + px / extent;
  const gy = ty + py / extent;
  const lon = (gx / n) * 360 - 180;
  const merc = Math.PI * (1 - (2 * gy) / n);
  const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
  return { lon, lat };
}

function extractCompactLabels(
  vt: VectorTile,
  z: number,
  tx: number,
  ty: number
): OsmTileLabels {
  const n = 1 << z;
  const labels: OsmTileLabels = {
    waterLabels: [],
    riverLabels: [],
    roadShields: [],
    streetLabels: [],
    places: [],
    peaks: [],
  };

  // Water body names (lakes, reservoirs, ponds)
  const waterNameLayer = vt.layers.water_name;
  if (waterNameLayer) {
    const ext = waterNameLayer.extent || 4096;
    const cap = Math.min(waterNameLayer.length, 40);
    for (let i = 0; i < cap; i++) {
      const f = waterNameLayer.feature(i);
      const cls = String(f.properties.class || '');
      if (cls === 'ocean' || cls === 'sea') continue;
      const name = getPreferredName(f.properties);
      if (!name) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      const pt = tilePtToGeo(geom[0][0].x, geom[0][0].y, n, tx, ty, ext);
      labels.waterLabels.push({
        lon: pt.lon,
        lat: pt.lat,
        name,
        isLake: cls === 'lake' || cls === 'pond' || cls === 'reservoir',
      });
    }
  }

  // River / stream names
  const waterwayLayer = vt.layers.waterway;
  if (waterwayLayer) {
    const ext = waterwayLayer.extent || 4096;
    const seen = new Set<string>();
    for (let i = 0; i < waterwayLayer.length && labels.riverLabels.length < 24; i++) {
      const f = waterwayLayer.feature(i);
      if (f.type !== 2) continue;
      const cls = String(f.properties.class || 'stream');
      if (cls === 'stream' && z < 12) continue;
      const name = getPreferredName(f.properties);
      if (!name || seen.has(name)) continue;
      const geom = f.loadGeometry();
      const line = geom[0];
      if (!line || line.length < 3) continue;
      const mid = Math.floor(line.length * 0.5);
      const pA = line[Math.max(0, mid - 1)];
      const pM = line[mid];
      const pB = line[Math.min(line.length - 1, mid + 1)];
      const geo = tilePtToGeo(pM.x, pM.y, n, tx, ty, ext);
      let angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      seen.add(name);
      labels.riverLabels.push({
        lon: geo.lon,
        lat: geo.lat,
        angle,
        name,
        isRiver: cls === 'river',
      });
    }
  }

  // Highway shields & close-zoom street names
  const transNameLayer = vt.layers.transportation_name;
  if (transNameLayer) {
    const ext = transNameLayer.extent || 4096;
    const seenRefs = new Set<string>();
    const seenStreets = new Set<string>();
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
      const geom = f.loadGeometry();
      const line = geom[0];
      if (!line || line.length < 2) continue;
      const mid = Math.floor(line.length * 0.5);
      const pM = line[mid];
      const geo = tilePtToGeo(pM.x, pM.y, n, tx, ty, ext);

      if (
        refRaw &&
        labels.roadShields.length < 24 &&
        (cls === 'motorway' ||
          cls === 'trunk' ||
          (cls === 'primary' && z >= 10) ||
          (cls === 'secondary' && z >= 11))
      ) {
        const primaryRef = refRaw.split(';')[0].trim();
        if (
          primaryRef.length >= 1 &&
          primaryRef.length <= 7 &&
          !seenRefs.has(primaryRef)
        ) {
          seenRefs.add(primaryRef);
          labels.roadShields.push({
            lon: geo.lon,
            lat: geo.lat,
            cls,
            ref: primaryRef,
          });
        }
      }

      if (
        z >= 12 &&
        name &&
        line.length >= 3 &&
        labels.streetLabels.length < 36 &&
        !seenStreets.has(name) &&
        (cls === 'primary' ||
          cls === 'secondary' ||
          cls === 'tertiary' ||
          (cls === 'minor' && z >= 13))
      ) {
        const pA = line[Math.max(0, mid - 1)];
        const pB = line[Math.min(line.length - 1, mid + 1)];
        let angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        seenStreets.add(name);
        labels.streetLabels.push({
          lon: geo.lon,
          lat: geo.lat,
          angle,
          name,
          isMajor: cls === 'primary' || cls === 'secondary',
        });
      }
    }
  }

  // Cities, towns, villages, hamlets & suburbs sorted by importance for clean scale hierarchy
  const placeLayer = vt.layers.place;
  if (placeLayer && z >= 7) {
    const ext = placeLayer.extent || 4096;
    const rawPlaces: OsmPlacePoint[] = [];
    for (let i = 0; i < placeLayer.length; i++) {
      const f = placeLayer.feature(i);
      if (f.type !== 1) continue;
      const cls = String(f.properties.class || '');
      if (
        cls !== 'city' &&
        cls !== 'town' &&
        cls !== 'village' &&
        cls !== 'hamlet' &&
        cls !== 'suburb' &&
        cls !== 'quarter'
      ) {
        continue;
      }
      if (z <= 9 && cls !== 'city' && cls !== 'town') continue;
      if (
        z <= 10 &&
        (cls === 'village' ||
          cls === 'hamlet' ||
          cls === 'suburb' ||
          cls === 'quarter')
      ) {
        continue;
      }
      if (
        z <= 12 &&
        (cls === 'hamlet' || cls === 'quarter' || cls === 'suburb')
      ) {
        continue;
      }
      const rank = Number(f.properties.rank ?? 10);
      if (z === 7 && cls === 'town' && rank > 6) continue;
      if (z === 8 && cls === 'town' && rank > 7) continue;
      if (z === 9 && cls === 'town' && rank > 8) continue;
      if (z === 11 && cls === 'village' && rank > 10) continue;
      const name = getPreferredName(f.properties);
      if (!name) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      const geo = tilePtToGeo(geom[0][0].x, geom[0][0].y, n, tx, ty, ext);
      rawPlaces.push({
        lon: geo.lon,
        lat: geo.lat,
        name,
        cls,
        rank,
      });
    }
    const clsPriority = (c: string) =>
      c === 'city'
        ? 0
        : c === 'town'
          ? 1
          : c === 'village'
            ? 2
            : c === 'suburb'
              ? 3
              : 4;
    rawPlaces.sort(
      (a, b) => clsPriority(a.cls) - clsPriority(b.cls) || a.rank - b.rank
    );
    labels.places = rawPlaces.slice(0, 40);
  }

  // Close-zoom mountain peaks (z >= 11), sorted highest elevation first so dominant summits always win
  const peakLayer = vt.layers.mountain_peak;
  if (peakLayer && z >= 11) {
    const ext = peakLayer.extent || 4096;
    const rawPeaks: OsmPeakPoint[] = [];
    for (let i = 0; i < peakLayer.length; i++) {
      const f = peakLayer.feature(i);
      if (f.type !== 1) continue;
      const name = getPreferredName(f.properties);
      const ele = Math.round(Number(f.properties.ele || 0));
      if (!name || !Number.isFinite(ele) || ele < 240) continue;
      if (z === 11 && ele < 720) continue;
      if (z === 12 && ele < 520) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      const geo = tilePtToGeo(geom[0][0].x, geom[0][0].y, n, tx, ty, ext);
      rawPeaks.push({
        lon: geo.lon,
        lat: geo.lat,
        name,
        ele,
        rank: Number(f.properties.rank ?? 10),
      });
    }
    rawPeaks.sort((a, b) => b.ele - a.ele || a.rank - b.rank);
    labels.peaks = rawPeaks.slice(0, 18);
  }

  return labels;
}

// Single shared 512x512 CPU work canvas for tile rasterization (zero persistent GPU surfaces!)
let sharedWorkCanvas: HTMLCanvasElement | null = null;
let sharedWorkCtx: CanvasRenderingContext2D | null = null;

function getSharedWorkCtx(): CanvasRenderingContext2D | null {
  if (!sharedWorkCanvas) {
    sharedWorkCanvas = document.createElement('canvas');
    sharedWorkCanvas.width = TILE_PX;
    sharedWorkCanvas.height = TILE_PX;
    sharedWorkCtx = sharedWorkCanvas.getContext('2d', {
      willReadFrequently: true,
    });
  }
  if (
    sharedWorkCanvas.width !== TILE_PX ||
    sharedWorkCanvas.height !== TILE_PX
  ) {
    sharedWorkCanvas.width = TILE_PX;
    sharedWorkCanvas.height = TILE_PX;
  }
  return sharedWorkCtx;
}

function rasterizeOsmTile(
  buf: ArrayBuffer,
  z: number,
  tx: number,
  ty: number,
  opts: OsmTileRenderOptions
): RenderedOsmTile {
  const tileKey = `${z}/${tx}/${ty}`;
  const renderKey = `${tileKey}|${getRenderSignature(opts)}`;
  const bounds = osmTileBounds(z, tx, ty);
  const [, minLat, , maxLat] = bounds;
  const invLatSpan = 1 / Math.max(1e-7, maxLat - minLat);
  const n = 1 << z;

  const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));

  let labels = LABELS_CACHE.get(tileKey);
  if (!labels) {
    labels = extractCompactLabels(vt, z, tx, ty);
    if (LABELS_CACHE.size >= MAX_LABELS_CACHE) {
      const oldest = LABELS_CACHE.keys().next().value;
      if (oldest) LABELS_CACHE.delete(oldest);
    }
    LABELS_CACHE.set(tileKey, labels);
  }

  const ctx = getSharedWorkCtx();

  // ---------------------------------------------------------------------------
  // LAYER A (baseImageData): Forests, wetlands, glaciers, parks, urban, buildings
  // Composited with 'multiply' in light/atlas/natural themes so 100% of 3D hillshade shines through forests!
  // ---------------------------------------------------------------------------
  let baseImageData: ImageData | null = null;
  if (ctx && (opts.forests || opts.cities)) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    {
      let paintedAnything = false;

      if (opts.forests) {
        const forestFill =
          opts.stylePreset === 'dark'
            ? 'rgba(46, 86, 62, 0.38)'
            : opts.stylePreset === 'natural'
              ? 'rgba(186, 222, 152, 0.88)'
              : opts.stylePreset === 'light'
                ? 'rgba(208, 234, 182, 0.82)'
                : 'rgba(196, 227, 164, 0.88)';
        const wetlandFill = opts.isDark
          ? 'rgba(56, 118, 128, 0.28)'
          : 'rgba(154, 214, 208, 0.65)';
        const glacierFill = opts.isDark
          ? 'rgba(203, 213, 225, 0.24)'
          : 'rgba(244, 250, 255, 0.75)';

        const landcover = vt.layers.landcover;
        if (landcover) {
          const ext = landcover.extent || 4096;
          const minPolyPx = z <= 8 ? 0.65 : 0.45;
          for (let i = 0; i < landcover.length; i++) {
            const f = landcover.feature(i);
            if (f.type !== 3) continue;
            const cls = String(f.properties.class || '');
            let fill: string | null = null;
            if (cls === 'wood' || cls === 'forest') fill = forestFill;
            else if (cls === 'wetland') fill = wetlandFill;
            else if (cls === 'ice' || cls === 'glacier') fill = glacierFill;
            if (!fill) continue;
            ctx.fillStyle = fill;
            if (
              paintPolygonFeatureSafe(
                ctx,
                f,
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                minPolyPx,
                true,
                false
              )
            ) {
              paintedAnything = true;
            }
          }
        }

        // Also render wood/forest polygons that appear in vt.layers.landuse
        const landuseForForest = vt.layers.landuse;
        if (landuseForForest) {
          const ext = landuseForForest.extent || 4096;
          const minPolyPx = z <= 8 ? 0.65 : 0.45;
          ctx.fillStyle = forestFill;
          for (let i = 0; i < landuseForForest.length; i++) {
            const f = landuseForForest.feature(i);
            if (f.type !== 3) continue;
            const cls = String(f.properties.class || '');
            if (cls !== 'wood' && cls !== 'forest') continue;
            if (
              paintPolygonFeatureSafe(
                ctx,
                f,
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                minPolyPx,
                true,
                false
              )
            ) {
              paintedAnything = true;
            }
          }
        }

        // Protected parks & NP/CHKO boundaries (z >= 10)
        const parkLayer = vt.layers.park;
        if (parkLayer && z >= 10) {
          const ext = parkLayer.extent || 4096;
          ctx.strokeStyle = opts.isDark
            ? 'rgba(104, 182, 132, 0.28)'
            : 'rgba(82, 146, 88, 0.45)';
          ctx.lineWidth = z >= 11 ? 1.2 : 0.9;
          ctx.setLineDash([6, 4]);
          for (let i = 0; i < parkLayer.length; i++) {
            const f = parkLayer.feature(i);
            if (f.type !== 3) continue;
            const cls = String(f.properties.class || '').toLowerCase();
            const isProt =
              cls.includes('national_park') ||
              cls.includes('národní') ||
              cls.includes('protected') ||
              cls.includes('nature_reserve') ||
              cls.includes('conservation') ||
              cls.includes('biosph');
            if (!isProt) continue;
            if (
              paintPolygonFeatureSafe(
                ctx,
                f,
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                1.2,
                false,
                true
              )
            ) {
              paintedAnything = true;
            }
          }
          ctx.setLineDash([]);
        }
      }

      if (opts.cities) {
        const urbanFill = opts.isDark
          ? 'rgba(203, 213, 225, 0.09)'
          : opts.stylePreset === 'light'
            ? 'rgba(236, 232, 224, 0.72)'
            : 'rgba(232, 226, 215, 0.78)';
        const urbanStroke = opts.isDark
          ? 'rgba(203, 213, 225, 0.14)'
          : 'rgba(204, 196, 184, 0.52)';

        const landuse = vt.layers.landuse;
        if (landuse) {
          const ext = landuse.extent || 4096;
          const minUrbanPx = z <= 9 ? 1.0 : 0.65;
          ctx.fillStyle = urbanFill;
          ctx.strokeStyle = urbanStroke;
          ctx.lineWidth = 0.55;
          for (let i = 0; i < landuse.length; i++) {
            const f = landuse.feature(i);
            if (f.type !== 3) continue;
            const cls = String(f.properties.class || '');
            if (!URBAN_LANDUSE_CLASSES.has(cls)) continue;
            if (
              paintPolygonFeatureSafe(
                ctx,
                f,
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                minUrbanPx,
                true,
                z >= 11
              )
            ) {
              paintedAnything = true;
            }
          }
        }

        // Individual buildings at z >= 13 (batched in small chunks of 32)
        const buildingLayer = vt.layers.building;
        if (buildingLayer && z >= 13) {
          const ext = buildingLayer.extent || 4096;
          const cap = Math.min(buildingLayer.length, 480);
          ctx.fillStyle = opts.isDark
            ? 'rgba(148, 163, 184, 0.22)'
            : 'rgba(218, 208, 198, 0.72)';
          ctx.strokeStyle = opts.isDark
            ? 'rgba(203, 213, 225, 0.18)'
            : 'rgba(186, 174, 164, 0.58)';
          ctx.lineWidth = 0.55;
          for (let i = 0; i < cap; i += 32) {
            const end = Math.min(cap, i + 32);
            ctx.beginPath();
            let batchHas = false;
            for (let j = i; j < end; j++) {
              const f = buildingLayer.feature(j);
              if (f.type !== 3) continue;
              if (
                traceFeatureToTileCtx(ctx, f, n, ty, maxLat, invLatSpan, ext, true)
              ) {
                batchHas = true;
              }
            }
            if (batchHas) {
              ctx.fill('evenodd');
              ctx.stroke();
              paintedAnything = true;
            }
          }
        }
      }

      if (paintedAnything) {
        baseImageData = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // LAYER B (overlayImageData): Ocean/Sea, Water, waterways, aeroways, railways, roads, borders
  // ---------------------------------------------------------------------------
  let overlayImageData: ImageData | null = null;
  const waterLayer = vt.layers.water;
  if (
    ctx &&
    (Boolean(waterLayer) ||
      opts.hydrology ||
      opts.highways ||
      opts.railways ||
      opts.drawCountryBorders ||
      opts.drawRegionalBorders)
  ) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    {
      let paintedAnything = false;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1a. Ocean & Sea polygons (always rendered from OSM coastlines so low-lying land below sea level is never flooded by DEM)
      if (waterLayer) {
        const ext = waterLayer.extent || 4096;
        const oceanFill =
          opts.stylePreset === 'dark'
            ? '#162A3E'
            : opts.stylePreset === 'light'
              ? '#B4D5F0'
              : opts.stylePreset === 'natural'
                ? '#90BCE0'
                : '#96C0E4';
        ctx.fillStyle = oceanFill;
        for (let i = 0; i < waterLayer.length; i++) {
          const f = waterLayer.feature(i);
          if (f.type !== 3) continue;
          const cls = String(f.properties.class || '');
          if (cls !== 'ocean' && cls !== 'sea') continue;
          if (
            paintPolygonFeatureSafe(
              ctx,
              f,
              n,
              ty,
              maxLat,
              invLatSpan,
              ext,
              0.35,
              true,
              false
            )
          ) {
            paintedAnything = true;
          }
        }
      }

      // 1b. Hydrology: Inland water polygons (lakes, lagoons, rivers, ponds) & clean single-stroke waterways
      if (opts.hydrology) {
        if (waterLayer) {
          const ext = waterLayer.extent || 4096;
          const minWaterPx = z <= 8 ? 0.65 : 0.45;
          ctx.fillStyle = opts.waterFill;
          ctx.strokeStyle = opts.waterStroke;
          ctx.lineWidth = z >= 11 ? 0.65 : 0.45;
          for (let i = 0; i < waterLayer.length; i++) {
            const f = waterLayer.feature(i);
            if (f.type !== 3) continue;
            const cls = String(f.properties.class || '');
            if (cls === 'ocean' || cls === 'sea' || cls === 'swimming_pool') {
              continue;
            }
            if (
              paintPolygonFeatureSafe(
                ctx,
                f,
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                minWaterPx,
                true,
                true
              )
            ) {
              paintedAnything = true;
            }
          }
        }

        const waterwayLayer = vt.layers.waterway;
        if (waterwayLayer) {
          const ext = waterwayLayer.extent || 4096;
          const streamW = z >= 13 ? 0.66 : z >= 12 ? 0.52 : 0.42;
          const canalW = z >= 12 ? 0.88 : z >= 10 ? 0.68 : 0.54;
          const riverW =
            z >= 13 ? 1.56 : z >= 11 ? 1.22 : z >= 9 ? 0.94 : 0.76;

          for (const pass of ['stream', 'canal', 'river'] as const) {
            if (pass === 'stream' && z < 11) continue;
            const indices: number[] = [];
            for (let i = 0; i < waterwayLayer.length; i++) {
              const f = waterwayLayer.feature(i);
              if (f.type !== 2) continue;
              const clsRaw = String(f.properties.class || 'stream');
              const cls =
                clsRaw === 'river'
                  ? 'river'
                  : clsRaw === 'canal'
                    ? 'canal'
                    : 'stream';
              if (cls === pass) indices.push(i);
            }
            for (let start = 0; start < indices.length; start += 120) {
              const end = Math.min(indices.length, start + 120);
              ctx.beginPath();
              let hasPass = false;
              for (let k = start; k < end; k++) {
                if (
                  traceFeatureToTileCtx(
                    ctx,
                    waterwayLayer.feature(indices[k]),
                    n,
                    ty,
                    maxLat,
                    invLatSpan,
                    ext,
                    false
                  )
                ) {
                  hasPass = true;
                }
              }
              if (!hasPass) continue;
              paintedAnything = true;
              ctx.strokeStyle = opts.waterStroke;
              ctx.lineWidth =
                pass === 'stream'
                  ? streamW
                  : pass === 'canal'
                    ? canalW
                    : riverW;
              ctx.stroke();
            }
          }
        }
      }

      // 2. Aeroways (z >= 10)
      if (opts.highways && z >= 10) {
        const aeroLayer = vt.layers.aeroway;
        if (aeroLayer) {
          const ext = aeroLayer.extent || 4096;
          for (let i = 0; i < aeroLayer.length; i++) {
            const f = aeroLayer.feature(i);
            const cls = String(f.properties.class || '');
            if (cls !== 'runway' && cls !== 'taxiway' && cls !== 'apron') {
              continue;
            }
            ctx.beginPath();
            if (
              traceFeatureToTileCtx(
                ctx,
                f,
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                f.type === 3
              )
            ) {
              if (f.type === 3) {
                ctx.fillStyle = opts.isDark
                  ? 'rgba(148, 163, 184, 0.25)'
                  : 'rgba(148, 144, 138, 0.35)';
                ctx.fill();
              } else {
                ctx.strokeStyle = opts.isDark ? '#64748B' : '#94908A';
                ctx.lineWidth =
                  cls === 'runway' ? (z >= 12 ? 4.4 : 2.6) : 1.3;
                ctx.stroke();
              }
              paintedAnything = true;
            }
          }
        }
      }

      // 3.Administrative Borders (drawn beneath major roads so highway shields & green motorways stay crisp)
      if (opts.drawCountryBorders || opts.drawRegionalBorders) {
        const boundaryLayer = vt.layers.boundary;
        if (boundaryLayer) {
          const ext = boundaryLayer.extent || 4096;
          const b2: number[] = [];
          const b4: number[] = [];
          const b6: number[] = [];
          for (let i = 0; i < boundaryLayer.length; i++) {
            const f = boundaryLayer.feature(i);
            if (f.type !== 2 || f.properties.maritime === 1) continue;
            const lvl = Number(f.properties.admin_level || 0);
            if (lvl === 2 && opts.drawCountryBorders) b2.push(i);
            else if (lvl === 4 && opts.drawRegionalBorders) b4.push(i);
            else if (lvl === 6 && opts.drawRegionalBorders && z >= 9) b6.push(i);
          }

          if (b6.length > 0) {
            ctx.beginPath();
            for (const idx of b6) {
              traceFeatureToTileCtx(
                ctx,
                boundaryLayer.feature(idx),
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                false
              );
            }
            ctx.strokeStyle = opts.isDark
              ? 'rgba(148, 163, 184, 0.20)'
              : 'rgba(72, 76, 72, 0.24)';
            ctx.lineWidth = 0.85;
            ctx.setLineDash([3, 4]);
            ctx.stroke();
            paintedAnything = true;
          }

          if (b4.length > 0) {
            ctx.beginPath();
            for (const idx of b4) {
              traceFeatureToTileCtx(
                ctx,
                boundaryLayer.feature(idx),
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                false
              );
            }
            ctx.strokeStyle = opts.regionBorder;
            ctx.lineWidth = 1.0;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            paintedAnything = true;
          }

          if (b2.length > 0) {
            ctx.setLineDash([]);
            ctx.beginPath();
            for (const idx of b2) {
              traceFeatureToTileCtx(
                ctx,
                boundaryLayer.feature(idx),
                n,
                ty,
                maxLat,
                invLatSpan,
                ext,
                false
              );
            }
            ctx.strokeStyle = opts.borderOuter;
            ctx.lineWidth = 2.8;
            ctx.stroke();
            ctx.strokeStyle = opts.borderInner;
            ctx.lineWidth = 1.28;
            ctx.stroke();
            paintedAnything = true;
          }
          ctx.setLineDash([]);
        }
      }

      // 4. Railways & Roads from transportation layer
      const transLayer = vt.layers.transportation;
      if (transLayer && (opts.railways || opts.highways)) {
        const ext = transLayer.extent || 4096;

        const railSurfaceIdx: number[] = [];
        const railTunnelIdx: number[] = [];
        const roadBuckets: Record<OsmRoadClass, number[]> = {
          ferry: [],
          path: [],
          track: [],
          service: [],
          minor: [],
          tertiary: [],
          secondary: [],
          primary: [],
          trunk: [],
          motorway: [],
        };
        const roadTunnelBuckets: Partial<Record<OsmRoadClass, number[]>> = {};

        for (let i = 0; i < transLayer.length; i++) {
          const f = transLayer.feature(i);
          if (f.type !== 2) continue;
          const cls = String(f.properties.class || '');
          const isTunnel = String(f.properties.brunnel || '') === 'tunnel';

          if (cls === 'rail' || cls === 'transit') {
            if (!opts.railways) continue;
            if (cls === 'transit' && z < 12) continue;
            if (isTunnel) railTunnelIdx.push(i);
            else railSurfaceIdx.push(i);
            continue;
          }

          if (!opts.highways) continue;
          if (f.properties.indoor === 1) continue;
          if (!(cls in roadBuckets)) continue;
          const roadCls = cls as OsmRoadClass;
          if (isTunnel) {
            if (!roadTunnelBuckets[roadCls]) roadTunnelBuckets[roadCls] = [];
            roadTunnelBuckets[roadCls]!.push(i);
          } else {
            roadBuckets[roadCls].push(i);
          }
        }

        // 4a. Railways
        if (opts.railways && (railSurfaceIdx.length > 0 || railTunnelIdx.length > 0)) {
          const railBaseW = z >= 12 ? 1.7 : z >= 10 ? 1.35 : 1.05;
          const railDashW = railBaseW * 0.55;
          ctx.lineCap = 'butt';

          if (railSurfaceIdx.length > 0) {
            for (let start = 0; start < railSurfaceIdx.length; start += 120) {
              const end = Math.min(railSurfaceIdx.length, start + 120);
              ctx.beginPath();
              for (let k = start; k < end; k++) {
                traceFeatureToTileCtx(
                  ctx,
                  transLayer.feature(railSurfaceIdx[k]),
                  n,
                  ty,
                  maxLat,
                  invLatSpan,
                  ext,
                  false
                );
              }
              ctx.setLineDash([]);
              ctx.strokeStyle = opts.isDark
                ? 'rgba(148, 163, 184, 0.42)'
                : 'rgba(112, 116, 114, 0.54)';
              ctx.lineWidth = railBaseW;
              ctx.stroke();

              ctx.setLineDash([6, 6]);
              ctx.strokeStyle = opts.isDark
                ? 'rgba(15, 23, 42, 0.82)'
                : 'rgba(252, 251, 248, 0.86)';
              ctx.lineWidth = railDashW;
              ctx.stroke();
            }
            paintedAnything = true;
          }

          if (railTunnelIdx.length > 0) {
            for (let start = 0; start < railTunnelIdx.length; start += 120) {
              const end = Math.min(railTunnelIdx.length, start + 120);
              ctx.beginPath();
              for (let k = start; k < end; k++) {
                traceFeatureToTileCtx(
                  ctx,
                  transLayer.feature(railTunnelIdx[k]),
                  n,
                  ty,
                  maxLat,
                  invLatSpan,
                  ext,
                  false
                );
              }
              ctx.setLineDash([4, 4]);
              ctx.strokeStyle = opts.isDark
                ? 'rgba(148, 163, 184, 0.28)'
                : 'rgba(92, 96, 94, 0.34)';
              ctx.lineWidth = Math.max(0.9, railBaseW * 0.72);
              ctx.stroke();
            }
            paintedAnything = true;
          }
          ctx.setLineDash([]);
          ctx.lineCap = 'round';
        }

        // 4b. Two-Pass Opaque Road Hierarchy (Pass A: all casings in tier -> Pass B: all cores in tier)
        // Guarantees zero alpha-accumulation knots at vertices and zero casing lines cutting across junctions
        if (opts.highways) {
          const styles = getRoadPaintStyles(z, opts.isDark);

          for (const tierGroup of ROAD_TIER_GROUPS) {
            // Pass 0: Tunnels in this tier
            for (const roadCls of tierGroup) {
              const st = styles[roadCls];
              if (z < st.minZ) continue;
              const tunnelList = roadTunnelBuckets[roadCls];
              if (
                tunnelList &&
                tunnelList.length > 0 &&
                roadCls !== 'ferry' &&
                roadCls !== 'path' &&
                roadCls !== 'track'
              ) {
                ctx.beginPath();
                for (let k = 0; k < tunnelList.length; k++) {
                  traceFeatureToTileCtx(
                    ctx,
                    transLayer.feature(tunnelList[k]),
                    n,
                    ty,
                    maxLat,
                    invLatSpan,
                    ext,
                    false
                  );
                }
                ctx.save();
                ctx.globalAlpha = 0.45;
                ctx.setLineDash([5, 4]);
                ctx.strokeStyle = st.casing;
                ctx.lineWidth = st.casingW * 0.85;
                ctx.stroke();
                ctx.restore();
                paintedAnything = true;
              }
            }

            // Pass 1: All surface casings across all road classes in this tier
            for (const roadCls of tierGroup) {
              const st = styles[roadCls];
              if (z < st.minZ) continue;
              const surfaceList = roadBuckets[roadCls];
              if (surfaceList.length === 0) continue;

              if (st.dash) ctx.setLineDash(st.dash);
              else ctx.setLineDash([]);
              ctx.strokeStyle = st.casing;
              ctx.lineWidth = st.casingW;

              for (let start = 0; start < surfaceList.length; start += 250) {
                const end = Math.min(surfaceList.length, start + 250);
                ctx.beginPath();
                for (let k = start; k < end; k++) {
                  traceFeatureToTileCtx(
                    ctx,
                    transLayer.feature(surfaceList[k]),
                    n,
                    ty,
                    maxLat,
                    invLatSpan,
                    ext,
                    false
                  );
                }
                ctx.stroke();
              }
              paintedAnything = true;
            }

            // Pass 2: All surface cores across all road classes in this tier
            ctx.setLineDash([]);
            for (const roadCls of tierGroup) {
              const st = styles[roadCls];
              if (z < st.minZ || !st.core || st.coreW <= 0) continue;
              const surfaceList = roadBuckets[roadCls];
              if (surfaceList.length === 0) continue;

              ctx.strokeStyle = st.core;
              ctx.lineWidth = st.coreW;

              for (let start = 0; start < surfaceList.length; start += 250) {
                const end = Math.min(surfaceList.length, start + 250);
                ctx.beginPath();
                for (let k = start; k < end; k++) {
                  traceFeatureToTileCtx(
                    ctx,
                    transLayer.feature(surfaceList[k]),
                    n,
                    ty,
                    maxLat,
                    invLatSpan,
                    ext,
                    false
                  );
                }
                ctx.stroke();
              }
            }
          }
          ctx.setLineDash([]);
        }
      }

      if (paintedAnything) {
        overlayImageData = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
      }
    }
  }

  return {
    key: renderKey,
    tileKey,
    z,
    tx,
    ty,
    bounds,
    baseImageData,
    overlayImageData,
    labels,
  };
}

function storeRenderedTile(tile: RenderedOsmTile) {
  if (RENDERED_CACHE.size >= MAX_RENDERED_TILES) {
    const oldestKey = RENDERED_CACHE.keys().next().value;
    if (oldestKey) {
      const old = RENDERED_CACHE.get(oldestKey);
      if (old) {
        old.baseImageData = null;
        old.overlayImageData = null;
      }
      RENDERED_CACHE.delete(oldestKey);
    }
  }
  RENDERED_CACHE.set(tile.key, tile);
}

function pumpRasterQueue() {
  rasterScheduled = false;
  let notifyReady: (() => void) | null = null;
  let processed = 0;

  while (RASTER_QUEUE.length > 0 && processed < 6) {
    const job = RASTER_QUEUE.shift()!;
    RASTER_QUEUED_KEYS.delete(job.renderKey);

    if (!RENDERED_CACHE.has(job.renderKey)) {
      const buf = RAW_PBF_CACHE.get(job.tileKey);
      if (buf) {
        try {
          const rendered = rasterizeOsmTile(
            buf,
            job.z,
            job.tx,
            job.ty,
            job.opts
          );
          storeRenderedTile(rendered);
          notifyReady = job.onReady;
          processed++;
        } catch {
          // Ignore corrupt tile safely
        }
      }
    }
  }

  if (notifyReady) {
    notifyReady();
  }

  if (RASTER_QUEUE.length > 0 && !rasterScheduled) {
    rasterScheduled = true;
    window.setTimeout(pumpRasterQueue, 12);
  }
}

function purgeRenderedCache() {
  for (const tile of RENDERED_CACHE.values()) {
    tile.baseImageData = null;
    tile.overlayImageData = null;
  }
  RENDERED_CACHE.clear();
  LABELS_CACHE.clear();
  RASTER_QUEUE.length = 0;
  RASTER_QUEUED_KEYS.clear();
  FETCH_QUEUE.length = 0;
  FETCH_QUEUED_KEYS.clear();
}

function flushStaleZoomQueues(keepZ: number) {
  for (let i = RASTER_QUEUE.length - 1; i >= 0; i--) {
    if (RASTER_QUEUE[i].z !== keepZ) {
      RASTER_QUEUED_KEYS.delete(RASTER_QUEUE[i].renderKey);
      RASTER_QUEUE.splice(i, 1);
    }
  }
  for (let i = FETCH_QUEUE.length - 1; i >= 0; i--) {
    if (FETCH_QUEUE[i].z !== keepZ) {
      FETCH_QUEUED_KEYS.delete(FETCH_QUEUE[i].tileKey);
      FETCH_QUEUE.splice(i, 1);
    }
  }
}

function enqueueRasterJob(job: RasterJob) {
  if (RENDERED_CACHE.has(job.renderKey) || RASTER_QUEUED_KEYS.has(job.renderKey)) {
    return;
  }
  if (RASTER_QUEUE.length >= 96) {
    const dropped = RASTER_QUEUE.shift();
    if (dropped) RASTER_QUEUED_KEYS.delete(dropped.renderKey);
  }
  RASTER_QUEUED_KEYS.add(job.renderKey);
  RASTER_QUEUE.push(job);
  if (!rasterScheduled) {
    rasterScheduled = true;
    window.setTimeout(pumpRasterQueue, 6);
  }
}

function pumpFetchQueue() {
  while (activeFetchCount < MAX_CONCURRENT_FETCHES && FETCH_QUEUE.length > 0) {
    const job = FETCH_QUEUE.shift()!;
    FETCH_QUEUED_KEYS.delete(job.tileKey);
    if (RENDERED_CACHE.has(job.renderKey)) continue;
    if (RAW_PBF_CACHE.has(job.tileKey)) {
      enqueueRasterJob(job);
      continue;
    }
    const retryAfter = FAILED_TILES.get(job.tileKey);
    if (retryAfter && Date.now() < retryAfter) continue;

    fetchRawPbfTile(job.z, job.tx, job.ty).then((buf) => {
      if (buf) {
        enqueueRasterJob(job);
      }
      pumpFetchQueue();
    });
  }
}

function enqueueFetchJob(job: FetchJob) {
  if (RENDERED_CACHE.has(job.renderKey)) {
    return;
  }
  // If raw PBF is already in flight, attach rasterization callback to the existing promise so it never gets lost
  const inflight = FETCH_INFLIGHT.get(job.tileKey);
  if (inflight) {
    inflight.then((buf) => {
      if (buf) {
        enqueueRasterJob(job);
      }
    });
    return;
  }
  if (FETCH_QUEUED_KEYS.has(job.tileKey)) {
    return;
  }
  const retryAfter = FAILED_TILES.get(job.tileKey);
  if (retryAfter && Date.now() < retryAfter) return;

  if (FETCH_QUEUE.length >= 96) {
    const dropped = FETCH_QUEUE.shift();
    if (dropped) FETCH_QUEUED_KEYS.delete(dropped.tileKey);
  }
  FETCH_QUEUED_KEYS.add(job.tileKey);
  FETCH_QUEUE.push(job);
  pumpFetchQueue();
}

function fetchRawPbfTile(
  z: number,
  tx: number,
  ty: number
): Promise<ArrayBuffer | null> {
  const tileKey = `${z}/${tx}/${ty}`;
  const existing = RAW_PBF_CACHE.get(tileKey);
  if (existing) return Promise.resolve(existing);

  const retryAfter = FAILED_TILES.get(tileKey);
  if (retryAfter && Date.now() < retryAfter) {
    return Promise.resolve(null);
  }

  const inflight = FETCH_INFLIGHT.get(tileKey);
  if (inflight) return inflight;

  activeFetchCount++;
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
        FAILED_TILES.set(tileKey, Date.now() + 15000);
        FETCH_INFLIGHT.delete(tileKey);
        activeFetchCount = Math.max(0, activeFetchCount - 1);
        return null;
      }
      const buf = await res.arrayBuffer();
      if (RAW_PBF_CACHE.size >= MAX_RAW_PBF_CACHE) {
        const oldest = RAW_PBF_CACHE.keys().next().value;
        if (oldest) RAW_PBF_CACHE.delete(oldest);
      }
      RAW_PBF_CACHE.set(tileKey, buf);
      FETCH_INFLIGHT.delete(tileKey);
      activeFetchCount = Math.max(0, activeFetchCount - 1);
      return buf;
    })
    .catch(() => {
      FAILED_TILES.set(tileKey, Date.now() + 15000);
      FETCH_INFLIGHT.delete(tileKey);
      activeFetchCount = Math.max(0, activeFetchCount - 1);
      return null;
    });

  FETCH_INFLIGHT.set(tileKey, p);
  return p;
}

/**
 * Ensures pre-rasterized OpenStreetMap tile bitmaps covering 100% of the viewport.
 * Automatically steps down effectiveZ on ultra-wide viewports so visible tiles never
 * exceed MAX_VISIBLE_TILES_BUDGET (20 < MAX_RENDERED_TILES=36), eliminating both
 * half-loaded screens and LRU cache eviction thrashing.
 */
export function ensureOsmVectorTilesForViewport(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  targetZ: number,
  opts: OsmTileRenderOptions,
  onTileLoaded: () => void
): {
  tiles: RenderedOsmTile[];
  exactCoverage: boolean;
  loadingCount: number;
  targetZ: number;
} {
  let effectiveZ = Math.max(6, Math.min(14, targetZ));
  while (effectiveZ > 6) {
    const nx =
      lonToOsmTileX(maxLon, effectiveZ) - lonToOsmTileX(minLon, effectiveZ) + 1;
    const ny =
      latToOsmTileY(minLat, effectiveZ) - latToOsmTileY(maxLat, effectiveZ) + 1;
    if (nx * ny <= MAX_VISIBLE_TILES_BUDGET) break;
    effectiveZ--;
  }

  const tx0 = lonToOsmTileX(minLon, effectiveZ);
  const tx1 = lonToOsmTileX(maxLon, effectiveZ);
  const ty0 = latToOsmTileY(maxLat, effectiveZ);
  const ty1 = latToOsmTileY(minLat, effectiveZ);
  const sig = getRenderSignature(opts);
  if (activeRenderSig !== null && activeRenderSig !== sig) {
    // Release stale-style GPU canvases immediately when style/layer flags change
    purgeRenderedCache();
  }
  activeRenderSig = sig;
  if (lastRequestedZ !== null && lastRequestedZ !== effectiveZ) {
    flushStaleZoomQueues(effectiveZ);
  }
  lastRequestedZ = effectiveZ;

  const tiles: RenderedOsmTile[] = [];
  const addedKeys = new Set<string>();
  let loadingCount = 0;

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const tileKey = `${effectiveZ}/${tx}/${ty}`;
      const renderKey = `${tileKey}|${sig}`;
      const cached = RENDERED_CACHE.get(renderKey);

      if (cached) {
        // Refresh LRU position
        RENDERED_CACHE.delete(renderKey);
        RENDERED_CACHE.set(renderKey, cached);
        tiles.push(cached);
        addedKeys.add(renderKey);
      } else {
        loadingCount++;
        const job: FetchJob = {
          renderKey,
          tileKey,
          z: effectiveZ,
          tx,
          ty,
          opts,
          onReady: onTileLoaded,
        };
        if (RAW_PBF_CACHE.has(tileKey)) {
          enqueueRasterJob(job);
        } else {
          enqueueFetchJob(job);
        }

        // Smooth ancestor fallback (z-1, z-2) clipped strictly to the missing cell's bounds so it never overlaps sibling tiles
        const cellBounds = osmTileBounds(effectiveZ, tx, ty);
        let foundFallback = false;
        for (let dz = 1; dz <= 2 && effectiveZ - dz >= 6; dz++) {
          const pz = effectiveZ - dz;
          const ptx = tx >> dz;
          const pty = ty >> dz;
          const pRenderKey = `${pz}/${ptx}/${pty}|${sig}`;
          const parentTile = RENDERED_CACHE.get(pRenderKey);
          if (parentTile) {
            tiles.push({
              ...parentTile,
              clipBounds: cellBounds,
            });
            foundFallback = true;
            break;
          }
        }
        // Or immediate child fallback (z+1) when zooming out (children lie inside cellBounds naturally)
        if (!foundFallback && effectiveZ < 14) {
          const cz = effectiveZ + 1;
          for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
              const cRenderKey = `${cz}/${tx * 2 + dx}/${ty * 2 + dy}|${sig}`;
              const childTile = RENDERED_CACHE.get(cRenderKey);
              if (childTile && !addedKeys.has(cRenderKey)) {
                tiles.push(childTile);
                addedKeys.add(cRenderKey);
              }
            }
          }
        }
      }
    }
  }

  // Ensure fallback parent tiles (lower z) always composite beneath target tiles, and tile order is strictly deterministic
  tiles.sort((a, b) => a.z - b.z || a.ty - b.ty || a.tx - b.tx);

  return {
    tiles,
    exactCoverage: loadingCount === 0 && tiles.length > 0,
    loadingCount,
    targetZ: effectiveZ,
  };
}
