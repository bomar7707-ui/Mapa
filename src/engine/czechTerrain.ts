import {
  CZ_BOUNDS,
  CZECH_BORDER,
  CZECH_LAKES,
  CZECH_PEAKS,
  CZECH_RELIEF_MASSIFS,
  CZECH_RIVERS,
} from '../data/czechGeo';
import { ContourLevel, Point2D, RealDemGrid } from '../types/map';
import { extractContours } from './contours';
import { fbm2D, ridgedNoise2D } from './noise';
import {
  sampleElevationWithTiles,
  sampleRealDemBilinear,
} from './realCzechData';

export const WORLD_WIDTH = 531690;
export const WORLD_HEIGHT = 322540;

export const DEM_COLS = 420;
export const DEM_ROWS = 255;
export const CELL_SIZE_X = WORLD_WIDTH / (DEM_COLS - 1);
export const CELL_SIZE_Y = WORLD_HEIGHT / (DEM_ROWS - 1);

export interface CompiledCzechTerrain {
  elevationGrid: Float32Array;
  hillshadeGrid: Float32Array;
  forestGrid: Float32Array;
  contours: ContourLevel[];
  minElevation: number;
  maxElevation: number;
  isRealDem: boolean;
}

export interface LocalTerrainPatch {
  x0: number;
  y0: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  elevationGrid: Float32Array;
  hillshadeGrid: Float32Array;
  forestGrid: Float32Array;
  contours: ContourLevel[];
  contourMinorInterval: number;
  contourMajorInterval: number;
}

export function geoToWorld(lon: number, lat: number): Point2D {
  const x =
    ((lon - CZ_BOUNDS.minLon) / (CZ_BOUNDS.maxLon - CZ_BOUNDS.minLon)) *
    WORLD_WIDTH;
  const y =
    ((CZ_BOUNDS.maxLat - lat) / (CZ_BOUNDS.maxLat - CZ_BOUNDS.minLat)) *
    WORLD_HEIGHT;
  return { x, y };
}

export function worldToGeo(x: number, y: number): { lon: number; lat: number } {
  const lon =
    CZ_BOUNDS.minLon +
    (x / WORLD_WIDTH) * (CZ_BOUNDS.maxLon - CZ_BOUNDS.minLon);
  const lat =
    CZ_BOUNDS.maxLat -
    (y / WORLD_HEIGHT) * (CZ_BOUNDS.maxLat - CZ_BOUNDS.minLat);
  return { lon, lat };
}

export function pointInGeoPolygon(
  lon: number,
  lat: number,
  poly: [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToGeoPolyline(
  lon: number,
  lat: number,
  pts: [number, number][]
): number {
  let minSq = Infinity;
  const cosLat = 0.645;
  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = pts[i][0] * cosLat;
    const y1 = pts[i][1];
    const x2 = pts[i + 1][0] * cosLat;
    const y2 = pts[i + 1][1];
    const px = lon * cosLat;
    const py = lat;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const dSq = (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2;
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

export function evaluateCzechElevation(lon: number, lat: number): number {
  let h = 335;

  h += fbm2D(lon * 1.4, lat * 2.1, 409, 4) * 82;
  h += (ridgedNoise2D(lon * 2.6, lat * 3.8, 733, 3) - 0.45) * 62;
  h += fbm2D(lon * 8.5, lat * 13.0, 991, 2) * 26;
  h += fbm2D(lon * 28.0, lat * 42.0, 1451, 2) * 11;

  for (const m of CZECH_RELIEF_MASSIFS) {
    let dx = lon - m.lon;
    let dy = lat - m.lat;
    if (m.rotationDeg) {
      const rad = (-m.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      dx = rx;
      dy = ry;
    }
    const u = dx / m.radiusLon;
    const v = dy / m.radiusLat;
    const dSq = u * u + v * v;
    if (dSq < 6.0) {
      h += m.amplitude * Math.exp(-dSq);
    }
  }

  for (const river of CZECH_RIVERS) {
    const distDeg = distToGeoPolyline(lon, lat, river.points);
    const valleyRadius = 0.036 + river.width * 0.016;
    if (distDeg < valleyRadius * 2.2) {
      const f = Math.exp(-(distDeg * distDeg) / (2 * valleyRadius * valleyRadius));
      h -= (36 + river.width * 18) * f;
    }
  }

  for (const pk of CZECH_PEAKS) {
    const dx = (lon - pk.lon) * 0.645;
    const dy = lat - pk.lat;
    const dSq = dx * dx + dy * dy;
    if (dSq < 0.004) {
      const w = Math.exp(-dSq / 0.0007);
      h = h * (1 - w * 0.68) + pk.elevation * (w * 0.68);
    }
  }

  for (const lake of CZECH_LAKES) {
    if (pointInGeoPolygon(lon, lat, lake.points)) {
      return lake.elevation;
    }
  }

  return Math.max(115, Math.min(1610, h));
}

function evaluateForestCover(
  lon: number,
  lat: number,
  elev: number,
  slopeProxy = 0
): number {
  for (const lake of CZECH_LAKES) {
    if (pointInGeoPolygon(lon, lat, lake.points)) return 0;
  }
  const elevFactor = Math.max(0, Math.min(1, (elev - 220) / 500));
  const slopeFactor = Math.min(0.32, slopeProxy * 2.2);
  const patch = fbm2D(lon * 5.2, lat * 7.8, 1523, 3) + 0.1;
  const fine = fbm2D(lon * 18, lat * 26, 2089, 2) * 0.24;
  let density =
    patch * 0.68 + elevFactor * 0.52 + slopeFactor + fine - 0.16;

  if (elev > 1260) {
    density *= Math.max(0, 1 - (elev - 1260) / 240);
  }

  return density > 0.1 ? Math.min(1, (density - 0.1) * 1.4) : 0;
}

function computeHillshade(
  elevationGrid: Float32Array,
  cols: number,
  rows: number,
  cellSizeX: number,
  cellSizeY: number,
  zFactor: number
): Float32Array {
  const hillshadeGrid = new Float32Array(cols * rows);
  const zenithRad = (42 * Math.PI) / 180;
  const cosZ = Math.cos(zenithRad);
  const sinZ = Math.sin(zenithRad);
  const invSqrt2 = Math.SQRT1_2;

  for (let r = 0; r < rows; r++) {
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(rows - 1, r + 1);
    for (let c = 0; c < cols; c++) {
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(cols - 1, c + 1);

      const dzdx =
        (elevationGrid[r * cols + cNext] - elevationGrid[r * cols + cPrev]) /
        ((cNext - cPrev) * cellSizeX);
      const dzdy =
        (elevationGrid[rNext * cols + c] - elevationGrid[rPrev * cols + c]) /
        ((rNext - rPrev) * cellSizeY);

      const sx = zFactor * dzdx;
      const sy = zFactor * dzdy;
      const norm = Math.sqrt(1 + sx * sx + sy * sy);

      // Top-left (North-West 315°) illumination so mountains appear convex and valleys concave
      const nwDot = (sx * invSqrt2 + sy * invSqrt2) * sinZ + cosZ;
      hillshadeGrid[r * cols + c] = Math.max(0, Math.min(1, nwDot / norm));
    }
  }
  return hillshadeGrid;
}

export function compileCzechTerrain(
  realDem?: RealDemGrid | null
): CompiledCzechTerrain {
  const count = DEM_COLS * DEM_ROWS;
  const elevationGrid = new Float32Array(count);
  const forestGrid = new Float32Array(count);

  // Lightweight instant placeholder before real cz-dem.png finishes loading (~100ms)
  // Avoids a 2-second synchronous main-thread stall on initial app mount.
  if (!realDem) {
    elevationGrid.fill(380);
    const hillshadeGrid = new Float32Array(count);
    hillshadeGrid.fill(0.67);
    return {
      elevationGrid,
      hillshadeGrid,
      forestGrid,
      contours: [],
      minElevation: 115,
      maxElevation: 1603,
      isRealDem: false,
    };
  }

  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let r = 0; r < DEM_ROWS; r++) {
    const y = r * CELL_SIZE_Y;
    const lat =
      CZ_BOUNDS.maxLat -
      (y / WORLD_HEIGHT) * (CZ_BOUNDS.maxLat - CZ_BOUNDS.minLat);

    for (let c = 0; c < DEM_COLS; c++) {
      const x = c * CELL_SIZE_X;
      const lon =
        CZ_BOUNDS.minLon +
        (x / WORLD_WIDTH) * (CZ_BOUNDS.maxLon - CZ_BOUNDS.minLon);

      const idx = r * DEM_COLS + c;
      const e = sampleRealDemBilinear(realDem, lon, lat);
      elevationGrid[idx] = e;
      if (e < minElevation) minElevation = e;
      if (e > maxElevation) maxElevation = e;
    }
  }

  const hillshadeGrid = computeHillshade(
    elevationGrid,
    DEM_COLS,
    DEM_ROWS,
    CELL_SIZE_X,
    CELL_SIZE_Y,
    8.5
  );

  const contours = extractContours(
    elevationGrid,
    DEM_COLS,
    DEM_ROWS,
    CELL_SIZE_X,
    CELL_SIZE_Y,
    50,
    200
  );

  return {
    elevationGrid,
    hillshadeGrid,
    forestGrid,
    contours,
    minElevation,
    maxElevation,
    isRealDem: true,
  };
}

/**
 * Compiles a high-resolution terrain patch for zoomed-in viewports
 * using live AWS Terrarium tiles (z10..z12) when realDem is loaded.
 */
export function compileLocalViewportTerrain(
  x0: number,
  y0: number,
  width: number,
  height: number,
  zoom: number,
  withContours: boolean,
  realDem?: RealDemGrid | null,
  preferredTileZ?: number
): LocalTerrainPatch {
  const cols = 220;
  const rows = 142;
  const count = cols * rows;
  const elevationGrid = new Float32Array(count);
  const forestGrid = new Float32Array(count);

  const dx = width / (cols - 1);
  const dy = height / (rows - 1);

  for (let r = 0; r < rows; r++) {
    const wy = y0 + r * dy;
    const lat =
      CZ_BOUNDS.maxLat -
      (wy / WORLD_HEIGHT) * (CZ_BOUNDS.maxLat - CZ_BOUNDS.minLat);

    for (let c = 0; c < cols; c++) {
      const wx = x0 + c * dx;
      const lon =
        CZ_BOUNDS.minLon +
        (wx / WORLD_WIDTH) * (CZ_BOUNDS.maxLon - CZ_BOUNDS.minLon);

      const idx = r * cols + c;
      elevationGrid[idx] = realDem
        ? sampleElevationWithTiles(realDem, lon, lat, preferredTileZ)
        : evaluateCzechElevation(lon, lat);
    }
  }

  // Skip synthetic forestGrid pass for Czech local patches (real forests come from OSM bitmaps)
  if (!realDem) {
    for (let r = 0; r < rows; r++) {
      const wy = y0 + r * dy;
      const lat =
        CZ_BOUNDS.maxLat -
        (wy / WORLD_HEIGHT) * (CZ_BOUNDS.maxLat - CZ_BOUNDS.minLat);
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(rows - 1, r + 1);
      for (let c = 0; c < cols; c++) {
        const wx = x0 + c * dx;
        const lon =
          CZ_BOUNDS.minLon +
          (wx / WORLD_WIDTH) * (CZ_BOUNDS.maxLon - CZ_BOUNDS.minLon);
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(cols - 1, c + 1);
        const idx = r * cols + c;
        const dzx =
          (elevationGrid[r * cols + cNext] - elevationGrid[r * cols + cPrev]) /
          ((cNext - cPrev) * dx);
        const dzy =
          (elevationGrid[rNext * cols + c] - elevationGrid[rPrev * cols + c]) /
          ((rNext - rPrev) * dy);
        forestGrid[idx] = evaluateForestCover(
          lon,
          lat,
          elevationGrid[idx],
          Math.hypot(dzx, dzy)
        );
      }
    }
  }

  // Adaptive vertical exaggeration tuned for real DEM at close zoom
  const zFactor = realDem
    ? zoom >= 0.02
      ? 3.2
      : zoom >= 0.008
        ? 4.6
        : 6.4
    : zoom >= 0.008
      ? 6.5
      : 10.0;

  const hillshadeGrid = computeHillshade(
    elevationGrid,
    cols,
    rows,
    dx,
    dy,
    zFactor
  );

  const minorInterval =
    zoom >= 0.06 ? 10 : zoom >= 0.028 ? 20 : zoom >= 0.012 ? 25 : 50;
  const majorInterval =
    zoom >= 0.06 ? 50 : zoom >= 0.028 ? 100 : zoom >= 0.012 ? 100 : 200;

  let contours: ContourLevel[] = [];
  if (withContours) {
    const rawContours = extractContours(
      elevationGrid,
      cols,
      rows,
      dx,
      dy,
      minorInterval,
      majorInterval
    );
    contours = rawContours.map((lvl) => ({
      ...lvl,
      polylines: lvl.polylines.map((poly) =>
        poly.map((p) => ({ x: p.x + x0, y: p.y + y0 }))
      ),
    }));
  }

  return {
    x0,
    y0,
    width,
    height,
    cols,
    rows,
    elevationGrid,
    hillshadeGrid,
    forestGrid,
    contours,
    contourMinorInterval: minorInterval,
    contourMajorInterval: majorInterval,
  };
}

export function sampleCzechElevation(
  terrain: CompiledCzechTerrain,
  x: number,
  y: number,
  realDem?: RealDemGrid | null,
  preferredTileZ?: number
): number {
  if (realDem && x >= 0 && x <= WORLD_WIDTH && y >= 0 && y <= WORLD_HEIGHT) {
    const { lon, lat } = worldToGeo(x, y);
    return sampleElevationWithTiles(realDem, lon, lat, preferredTileZ);
  }
  if (!terrain.isRealDem && x >= 0 && x <= WORLD_WIDTH && y >= 0 && y <= WORLD_HEIGHT) {
    const { lon, lat } = worldToGeo(x, y);
    return evaluateCzechElevation(lon, lat);
  }
  const cx = Math.max(0, Math.min(WORLD_WIDTH, x)) / CELL_SIZE_X;
  const cy = Math.max(0, Math.min(WORLD_HEIGHT, y)) / CELL_SIZE_Y;
  const c0 = Math.min(DEM_COLS - 2, Math.floor(cx));
  const r0 = Math.min(DEM_ROWS - 2, Math.floor(cy));
  const fx = cx - c0;
  const fy = cy - r0;

  const g = terrain.elevationGrid;
  const v00 = g[r0 * DEM_COLS + c0];
  const v10 = g[r0 * DEM_COLS + c0 + 1];
  const v01 = g[(r0 + 1) * DEM_COLS + c0];
  const v11 = g[(r0 + 1) * DEM_COLS + c0 + 1];

  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

export function isInsideCzechia(
  lon: number,
  lat: number,
  borderPolygon?: [number, number][] | null
): boolean {
  return pointInGeoPolygon(lon, lat, borderPolygon ?? CZECH_BORDER);
}
