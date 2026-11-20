import { ContourLevel, Point2D, RealDemGrid } from '../types/map';
import { extractContours } from './contours';
import { LocalTerrainPatch } from './czechTerrain';
import { fbm2D } from './noise';
import {
  WORLD_GEO_BOUNDS,
  sampleWorldDemBilinear,
  sampleWorldElevationWithTiles,
} from './realCzechData';

// 1 degree lon = 100,000 metric units; non-linear latitude projection preserves true 1:1 conformal aspect ratio in mid-latitudes (e.g. Czechia at ~50°N)
export const GLOBAL_WIDTH = 36_000_000;
export const GLOBAL_HEIGHT = 21_500_000;

export const WORLD_DEM_COLS = 640;
export const WORLD_DEM_ROWS = 380;
export const WORLD_CELL_X = GLOBAL_WIDTH / (WORLD_DEM_COLS - 1);
export const WORLD_CELL_Y = GLOBAL_HEIGHT / (WORLD_DEM_ROWS - 1);

// Calibrated latitude projection factor k = 0.805 so dy/dx at lat=49.8°N equals 1/cos(49.8°) ≈ 1.5499 (matching Czechia's exact metric aspect ratio)
const LAT_PROJ_K = 0.805;
const LAT_PROJ_MAX = Math.atanh(
  LAT_PROJ_K * Math.sin((WORLD_GEO_BOUNDS.maxLat * Math.PI) / 180)
);

function projectLatNorm(lat: number): number {
  const clamped = Math.max(
    WORLD_GEO_BOUNDS.minLat,
    Math.min(WORLD_GEO_BOUNDS.maxLat, lat)
  );
  const s = Math.sin((clamped * Math.PI) / 180);
  const yProj = Math.atanh(LAT_PROJ_K * s);
  return (LAT_PROJ_MAX - yProj) / (2 * LAT_PROJ_MAX);
}

function unprojectLatNorm(normY: number): number {
  const clampedNorm = Math.max(0, Math.min(1, normY));
  const yProj = LAT_PROJ_MAX * (1 - 2 * clampedNorm);
  const sinLat = Math.max(-1, Math.min(1, Math.tanh(yProj) / LAT_PROJ_K));
  return (Math.asin(sinLat) * 180) / Math.PI;
}

export interface CompiledWorldTerrain {
  elevationGrid: Float32Array;
  hillshadeGrid: Float32Array;
  forestGrid: Float32Array;
  contours: ContourLevel[];
  minElevation: number;
  maxElevation: number;
}

export function geoToGlobalWorld(lon: number, lat: number): Point2D {
  const x =
    ((lon - WORLD_GEO_BOUNDS.minLon) /
      (WORLD_GEO_BOUNDS.maxLon - WORLD_GEO_BOUNDS.minLon)) *
    GLOBAL_WIDTH;
  const y = projectLatNorm(lat) * GLOBAL_HEIGHT;
  return { x, y };
}

export function globalWorldToGeo(
  x: number,
  y: number
): { lon: number; lat: number } {
  const lon =
    WORLD_GEO_BOUNDS.minLon +
    (x / GLOBAL_WIDTH) * (WORLD_GEO_BOUNDS.maxLon - WORLD_GEO_BOUNDS.minLon);
  const lat = unprojectLatNorm(y / GLOBAL_HEIGHT);
  return { lon, lat };
}

function evaluateWorldForestBiome(
  lon: number,
  lat: number,
  elev: number
): number {
  if (elev <= 2 || elev > 3600) return 0;
  const absLat = Math.abs(lat);
  if (absLat > 69) return 0;

  // Tropical rainforest belt (~0..14 deg) + temperate/boreal belt (~42..64 deg)
  const tropical = Math.exp(-((absLat - 4) ** 2) / 140);
  const boreal = Math.exp(-((absLat - 53) ** 2) / 130);

  // Suppress major arid belts (Sahara/Arabia/Central Asia/Outback)
  let aridPenalty = 0;
  if (lat > 14 && lat < 34 && lon > -18 && lon < 62) {
    aridPenalty = 0.85; // Sahara + Arabian desert
  } else if (lat > 34 && lat < 47 && lon > 52 && lon < 108) {
    aridPenalty = 0.65; // Central Asia / Gobi
  } else if (lat < -18 && lat > -32 && lon > 114 && lon < 144) {
    aridPenalty = 0.72; // Australian Outback
  } else if (lat > 24 && lat < 38 && lon > -120 && lon < -102) {
    aridPenalty = 0.55; // SW North America
  }

  const noise = fbm2D(lon * 0.18, lat * 0.22, 3191, 3) * 0.35;
  let density =
    Math.max(tropical * 0.92, boreal * 0.78) + noise - aridPenalty + 0.12;
  if (elev > 2200) {
    density *= Math.max(0, 1 - (elev - 2200) / 1400);
  }
  return Math.max(0, Math.min(1, density));
}

function computeGlobalHillshade(
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

  // Primary light from Top-Left (North-West, 315° compass azimuth).
  // Since +c is East (right) and +r is South (down), a NW-facing slope (top-left of a mountain)
  // has dzdx > 0 and dzdy > 0. To illuminate top-left slopes brightly and shade bottom-right slopes,
  // the upward surface normal (-zFactor*dzdx, -zFactor*dzdy, 1) is dotted with the NW light vector.
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

      // Dot product with NW light source (coming from top-left screen direction)
      const nwDot = (sx * invSqrt2 + sy * invSqrt2) * sinZ + cosZ;
      hillshadeGrid[r * cols + c] = Math.max(0, Math.min(1, nwDot / norm));
    }
  }
  return hillshadeGrid;
}

export function compileWorldTerrain(
  worldDem?: RealDemGrid | null
): CompiledWorldTerrain {
  const count = WORLD_DEM_COLS * WORLD_DEM_ROWS;
  const elevationGrid = new Float32Array(count);
  const forestGrid = new Float32Array(count);

  if (!worldDem) {
    elevationGrid.fill(-1200);
    const hillshadeGrid = new Float32Array(count);
    hillshadeGrid.fill(0.67);
    return {
      elevationGrid,
      hillshadeGrid,
      forestGrid,
      contours: [],
      minElevation: -9337,
      maxElevation: 8849,
    };
  }

  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let r = 0; r < WORLD_DEM_ROWS; r++) {
    const y = r * WORLD_CELL_Y;
    const lat = unprojectLatNorm(y / GLOBAL_HEIGHT);

    for (let c = 0; c < WORLD_DEM_COLS; c++) {
      const x = c * WORLD_CELL_X;
      const lon =
        WORLD_GEO_BOUNDS.minLon +
        (x / GLOBAL_WIDTH) *
          (WORLD_GEO_BOUNDS.maxLon - WORLD_GEO_BOUNDS.minLon);

      const idx = r * WORLD_DEM_COLS + c;
      const e = sampleWorldDemBilinear(worldDem, lon, lat);

      elevationGrid[idx] = e;
      forestGrid[idx] = evaluateWorldForestBiome(lon, lat, e);
      if (e < minElevation) minElevation = e;
      if (e > maxElevation) maxElevation = e;
    }
  }

  const hillshadeGrid = computeGlobalHillshade(
    elevationGrid,
    WORLD_DEM_COLS,
    WORLD_DEM_ROWS,
    WORLD_CELL_X,
    WORLD_CELL_Y,
    48.0
  );

  // Extract land contours (500 m minor / 2000 m index at global scale)
  const landOnly = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    landOnly[i] = Math.max(0, elevationGrid[i]);
  }

  const contours = extractContours(
    landOnly,
    WORLD_DEM_COLS,
    WORLD_DEM_ROWS,
    WORLD_CELL_X,
    WORLD_CELL_Y,
    500,
    2000
  );

  return {
    elevationGrid,
    hillshadeGrid,
    forestGrid,
    contours,
    minElevation,
    maxElevation,
  };
}

export function sampleGlobalElevation(
  worldTerrain: CompiledWorldTerrain,
  wx: number,
  wy: number,
  worldDem?: RealDemGrid | null,
  preferredTileZ?: number,
  czDem?: RealDemGrid | null
): number {
  const { lon, lat } = globalWorldToGeo(wx, wy);
  if (worldDem) {
    return sampleWorldElevationWithTiles(
      worldDem,
      lon,
      lat,
      preferredTileZ,
      czDem
    );
  }
  const gx = Math.max(
    0,
    Math.min(WORLD_DEM_COLS - 1.0001, (wx / GLOBAL_WIDTH) * (WORLD_DEM_COLS - 1))
  );
  const gy = Math.max(
    0,
    Math.min(WORLD_DEM_ROWS - 1.0001, (wy / GLOBAL_HEIGHT) * (WORLD_DEM_ROWS - 1))
  );
  const c0 = Math.floor(gx);
  const r0 = Math.floor(gy);
  const fx = gx - c0;
  const fy = gy - r0;
  const i00 = r0 * WORLD_DEM_COLS + c0;
  const top =
    worldTerrain.elevationGrid[i00] * (1 - fx) +
    worldTerrain.elevationGrid[i00 + 1] * fx;
  const bot =
    worldTerrain.elevationGrid[i00 + WORLD_DEM_COLS] * (1 - fx) +
    worldTerrain.elevationGrid[i00 + WORLD_DEM_COLS + 1] * fx;
  return top * (1 - fy) + bot * fy;
}

export function compileWorldViewportTerrain(
  x0: number,
  y0: number,
  width: number,
  height: number,
  zoom: number,
  withContours: boolean,
  worldDem?: RealDemGrid | null,
  preferredTileZ?: number,
  czDem?: RealDemGrid | null
): LocalTerrainPatch {
  const cols = 210;
  const rows = 136;
  const count = cols * rows;
  const elevationGrid = new Float32Array(count);
  const forestGrid = new Float32Array(count);

  const dx = width / (cols - 1);
  const dy = height / (rows - 1);

  for (let r = 0; r < rows; r++) {
    const wy = y0 + r * dy;
    const lat = unprojectLatNorm(wy / GLOBAL_HEIGHT);

    for (let c = 0; c < cols; c++) {
      const wx = x0 + c * dx;
      const lon =
        WORLD_GEO_BOUNDS.minLon +
        (wx / GLOBAL_WIDTH) *
          (WORLD_GEO_BOUNDS.maxLon - WORLD_GEO_BOUNDS.minLon);

      const idx = r * cols + c;
      const e = worldDem
        ? sampleWorldElevationWithTiles(
            worldDem,
            lon,
            lat,
            preferredTileZ,
            czDem
          )
        : fbm2D(lon * 0.05, lat * 0.05, 101, 4) * 1800;
      elevationGrid[idx] = e;
      forestGrid[idx] = evaluateWorldForestBiome(lon, lat, e);
    }
  }

  const zFactor =
    zoom >= 0.015
      ? 5.0
      : zoom >= 0.005
        ? 8.5
        : zoom >= 0.00125
          ? 14.0
          : zoom >= 0.0006
            ? 22.0
            : 32.0;
  const hillshadeGrid = computeGlobalHillshade(
    elevationGrid,
    cols,
    rows,
    dx,
    dy,
    zFactor
  );

  const minorInterval =
    zoom >= 0.045
      ? 10
      : zoom >= 0.02
        ? 20
        : zoom >= 0.01
          ? 50
          : zoom >= 0.004
            ? 100
            : zoom >= 0.00125
              ? 200
              : 400;
  const majorInterval =
    zoom >= 0.045
      ? 50
      : zoom >= 0.02
        ? 100
        : zoom >= 0.01
          ? 200
          : zoom >= 0.004
            ? 400
            : zoom >= 0.00125
              ? 800
              : 1600;

  let contours: ContourLevel[] = [];
  if (withContours) {
    const landOnly = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      landOnly[i] = Math.max(0, elevationGrid[i]);
    }
    const rawContours = extractContours(
      landOnly,
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
