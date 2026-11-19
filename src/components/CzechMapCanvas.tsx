import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Compass, LocateFixed, Minus, Plus } from 'lucide-react';
import {
  CZ_BOUNDS,
  CZECH_BORDER,
  CZECH_CITIES,
  CZECH_HIGHWAYS,
  CZECH_LAKES,
  CZECH_PEAKS,
  CZECH_REGION_LINES,
  CZECH_RIVERS,
  CZECH_URBAN_AREAS,
} from '../data/czechGeo';
import {
  CompiledCzechTerrain,
  DEM_COLS,
  DEM_ROWS,
  LocalTerrainPatch,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  compileLocalViewportTerrain,
  geoToWorld,
  isInsideCzechia,
  sampleCzechElevation,
  worldToGeo,
} from '../engine/czechTerrain';
import {
  WORLD_GEO_BOUNDS,
  ensureViewportTerrariumTiles,
  ensureWorldDetailBlocksForViewport,
  pickTerrariumZoom,
  pickWorldTerrariumZoom,
} from '../engine/realCzechData';
import {
  CompiledWorldTerrain,
  GLOBAL_HEIGHT,
  GLOBAL_WIDTH,
  WORLD_DEM_COLS,
  WORLD_DEM_ROWS,
  compileWorldViewportTerrain,
  geoToGlobalWorld,
  globalWorldToGeo,
  sampleGlobalElevation,
} from '../engine/worldTerrain';
import {
  GeoPoint,
  ImportedGpxTrack,
  LayerVisibility,
  MapScope,
  MapStylePreset,
  Point2D,
  RealCzechDataset,
  RealWorldDataset,
  SelectedMapPoint,
  WorldPlacesIndex,
} from '../types/map';

// Scale 1 : 3,000,000 corresponds to camera.zoom = 3780 / 3,000,000 = 0.00126
const DETAIL_WORLD_ZOOM = 0.00125;

export interface CzechMapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  focusGeo: (lon: number, lat: number, targetZoom?: number) => void;
  fitGeoBounds: (bounds: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  }) => void;
  exportPng: () => void;
}

interface CzechMapCanvasProps {
  mapScope: MapScope;
  terrain: CompiledCzechTerrain;
  worldTerrain: CompiledWorldTerrain;
  realDataset: RealCzechDataset | null;
  worldDataset: RealWorldDataset | null;
  worldPlacesIndex: WorldPlacesIndex | null;
  stylePreset: MapStylePreset;
  layers: LayerVisibility;
  selectedPoint: SelectedMapPoint | null;
  gpxTracks: ImportedGpxTrack[];
  activeGpxId: string | null;
  gpxHoverGeo: GeoPoint | null;
  onSelectPoint: (pt: SelectedMapPoint | null) => void;
  onSelectGpxTrack: (id: string) => void;
}

interface PaletteConfig {
  bg: string;
  outsideVeil: string;
  hillshadeStrength: number;
  forestColor: [number, number, number];
  forestOpacity: number;
  contourMinor: string;
  contourIndex: string;
  contourHalo: string;
  waterFill: string;
  waterStroke: string;
  borderOuter: string;
  borderInner: string;
  regionBorder: string;
  highwayCasing: string;
  highwayCore: string;
  highwayBadgeBg: string;
  highwayBadgeText: string;
  gridStroke: string;
  gridText: string;
  textPrimary: string;
  textSecondary: string;
  textHalo: string;
  cityDot: string;
  cityRing: string;
  peakColor: string;
  isDark: boolean;
}

const PALETTES: Record<MapStylePreset, PaletteConfig> = {
  atlas: {
    bg: '#EBE8DF',
    outsideVeil: 'rgba(241, 239, 232, 0.56)',
    hillshadeStrength: 0.34,
    forestColor: [98, 142, 82],
    forestOpacity: 0.24,
    contourMinor: 'rgba(138, 88, 50, 0.21)',
    contourIndex: 'rgba(110, 66, 36, 0.45)',
    contourHalo: '#DFD2B2',
    waterFill: '#6DB1E3',
    waterStroke: '#2E6FA3',
    borderOuter: 'rgba(255, 255, 255, 0.72)',
    borderInner: '#36322D',
    regionBorder: 'rgba(72, 64, 56, 0.35)',
    highwayCasing: '#B45309',
    highwayCore: '#FBBF24',
    highwayBadgeBg: '#C82828',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(40, 52, 46, 0.14)',
    gridText: 'rgba(40, 52, 46, 0.58)',
    textPrimary: '#1A1F1C',
    textSecondary: '#47524C',
    textHalo: 'rgba(245, 242, 234, 0.88)',
    cityDot: '#1A1F1C',
    cityRing: '#FFFFFF',
    peakColor: '#2D241E',
    isDark: false,
  },
  natural: {
    bg: '#E3E5DC',
    outsideVeil: 'rgba(229, 231, 224, 0.58)',
    hillshadeStrength: 0.42,
    forestColor: [64, 102, 58],
    forestOpacity: 0.64,
    contourMinor: 'rgba(92, 80, 64, 0.17)',
    contourIndex: 'rgba(72, 60, 46, 0.38)',
    contourHalo: '#C8CEB8',
    waterFill: '#4A8BC2',
    waterStroke: '#255B8A',
    borderOuter: 'rgba(255, 255, 255, 0.68)',
    borderInner: '#2C2E2A',
    regionBorder: 'rgba(44, 46, 42, 0.34)',
    highwayCasing: '#9A3412',
    highwayCore: '#F59E0B',
    highwayBadgeBg: '#B91C1C',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(30, 40, 34, 0.14)',
    gridText: 'rgba(30, 40, 34, 0.58)',
    textPrimary: '#161C18',
    textSecondary: '#38443D',
    textHalo: 'rgba(240, 242, 236, 0.88)',
    cityDot: '#161C18',
    cityRing: '#FFFFFF',
    peakColor: '#1E1A16',
    isDark: false,
  },
  light: {
    bg: '#F4F3EE',
    outsideVeil: 'rgba(246, 245, 241, 0.65)',
    hillshadeStrength: 0.22,
    forestColor: [188, 206, 178],
    forestOpacity: 0.36,
    contourMinor: 'rgba(130, 120, 108, 0.18)',
    contourIndex: 'rgba(96, 88, 78, 0.38)',
    contourHalo: '#F4F3EE',
    waterFill: '#93C5E8',
    waterStroke: '#4D89B8',
    borderOuter: 'rgba(255, 255, 255, 0.85)',
    borderInner: '#4A4E4B',
    regionBorder: 'rgba(90, 94, 90, 0.28)',
    highwayCasing: '#D97706',
    highwayCore: '#FDE68A',
    highwayBadgeBg: '#B91C1C',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(30, 40, 36, 0.10)',
    gridText: 'rgba(60, 68, 64, 0.55)',
    textPrimary: '#1D2220',
    textSecondary: '#545E58',
    textHalo: 'rgba(250, 249, 245, 0.92)',
    cityDot: '#1D2220',
    cityRing: '#FFFFFF',
    peakColor: '#3C3630',
    isDark: false,
  },
  dark: {
    bg: '#141B20',
    outsideVeil: 'rgba(16, 22, 27, 0.68)',
    hillshadeStrength: 0.32,
    forestColor: [38, 66, 52],
    forestOpacity: 0.42,
    contourMinor: 'rgba(148, 163, 184, 0.11)',
    contourIndex: 'rgba(148, 163, 184, 0.25)',
    contourHalo: '#1D272E',
    waterFill: '#2A5B84',
    waterStroke: '#508EC2',
    borderOuter: 'rgba(15, 23, 30, 0.8)',
    borderInner: '#CBD5E1',
    regionBorder: 'rgba(148, 163, 184, 0.24)',
    highwayCasing: '#92400E',
    highwayCore: '#F59E0B',
    highwayBadgeBg: '#DC2626',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(203, 213, 225, 0.09)',
    gridText: 'rgba(148, 163, 184, 0.65)',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textHalo: 'rgba(20, 27, 32, 0.88)',
    cityDot: '#F8FAFC',
    cityRing: '#1E293B',
    peakColor: '#E2E8F0',
    isDark: true,
  },
};

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Hypsometric color ramp for physical Czech atlas
function hypsometricAtlasColor(elev: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [140, [175, 212, 148]], // Lowland alluvial green (Polabí, Dolnomoravský úval)
    [230, [202, 226, 168]], // Lower plains
    [350, [231, 235, 184]], // Rolling basins
    [520, [238, 219, 164]], // Foothills / Vysočina
    [750, [224, 186, 130]], // Uplands
    [1020, [202, 145, 96]], // Mountains
    [1320, [174, 110, 72]], // High ridges
    [1600, [148, 92, 68]], // Alpine summits (Sněžka, Praděd)
  ];
  if (elev <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [e0, c0] = stops[i];
    const [e1, c1] = stops[i + 1];
    if (elev <= e1) {
      return lerpRgb(c0, c1, (elev - e0) / (e1 - e0));
    }
  }
  return stops[stops.length - 1][1];
}

// Global world bathymetric & continental hypsometric color ramp (-8000 m .. +8849 m)
function worldAtlasColor(elev: number): [number, number, number] {
  if (elev <= 0) {
    const oceanStops: [number, [number, number, number]][] = [
      [-8000, [48, 96, 152]],
      [-4500, [74, 128, 186]],
      [-2000, [106, 162, 214]],
      [-350, [144, 194, 234]],
      [0, [182, 220, 245]],
    ];
    if (elev <= oceanStops[0][0]) return oceanStops[0][1];
    for (let i = 0; i < oceanStops.length - 1; i++) {
      const [e0, c0] = oceanStops[i];
      const [e1, c1] = oceanStops[i + 1];
      if (elev <= e1) {
        return lerpRgb(c0, c1, (elev - e0) / (e1 - e0));
      }
    }
    return oceanStops[oceanStops.length - 1][1];
  }
  const landStops: [number, [number, number, number]][] = [
    [0, [170, 210, 144]],
    [200, [202, 226, 168]],
    [550, [234, 232, 182]],
    [1100, [236, 208, 152]],
    [1900, [218, 170, 118]],
    [2900, [192, 132, 88]],
    [4200, [164, 108, 76]],
    [5800, [198, 192, 186]],
    [8849, [250, 250, 250]],
  ];
  for (let i = 0; i < landStops.length - 1; i++) {
    const [e0, c0] = landStops[i];
    const [e1, c1] = landStops[i + 1];
    if (elev <= e1) {
      return lerpRgb(c0, c1, (elev - e0) / (e1 - e0));
    }
  }
  return landStops[landStops.length - 1][1];
}

function worldNaturalColor(elev: number): [number, number, number] {
  if (elev <= 0) {
    const t = Math.max(0, Math.min(1, (elev + 7000) / 7000));
    return lerpRgb([34, 68, 108], [94, 148, 192], t);
  }
  const stops: [number, [number, number, number]][] = [
    [0, [188, 200, 162]],
    [400, [198, 204, 166]],
    [1200, [182, 186, 148]],
    [2400, [164, 162, 138]],
    [4000, [152, 148, 138]],
    [6200, [224, 226, 228]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [e0, c0] = stops[i];
    const [e1, c1] = stops[i + 1];
    if (elev <= e1) {
      return lerpRgb(c0, c1, (elev - e0) / (e1 - e0));
    }
  }
  return stops[stops.length - 1][1];
}

function naturalTerrainColor(elev: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [150, [206, 210, 174]], // Cultivated valley fields
    [320, [196, 202, 164]], // Plains & agriculture
    [550, [178, 188, 148]], // Highlands
    [880, [156, 166, 132]], // Mountain slopes
    [1250, [148, 150, 134]], // Subalpine zone
    [1580, [166, 162, 154]], // Granite summits
  ];
  if (elev <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [e0, c0] = stops[i];
    const [e1, c1] = stops[i + 1];
    if (elev <= e1) {
      return lerpRgb(c0, c1, (elev - e0) / (e1 - e0));
    }
  }
  return stops[stops.length - 1][1];
}

function rasterizeTerrainGrid(
  elevationGrid: Float32Array,
  hillshadeGrid: Float32Array,
  forestGrid: Float32Array,
  cols: number,
  rows: number,
  stylePreset: MapStylePreset,
  layers: LayerVisibility,
  isWorld = false
): HTMLCanvasElement {
  const scale = 2;
  const w = (cols - 1) * scale;
  const h = (rows - 1) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  const pal = PALETTES[stylePreset];

  for (let py = 0; py < h; py++) {
    const gy = py / scale;
    const r0 = Math.min(rows - 2, Math.floor(gy));
    const fy = gy - r0;

    for (let px = 0; px < w; px++) {
      const gx = px / scale;
      const c0 = Math.min(cols - 2, Math.floor(gx));
      const fx = gx - c0;

      const i00 = r0 * cols + c0;
      const i10 = i00 + 1;
      const i01 = i00 + cols;
      const i11 = i01 + 1;

      const bilerp = (arr: Float32Array) => {
        const top = arr[i00] + (arr[i10] - arr[i00]) * fx;
        const bot = arr[i01] + (arr[i11] - arr[i01]) * fx;
        return top + (bot - top) * fy;
      };

      const elev = bilerp(elevationGrid);
      const hs = bilerp(hillshadeGrid);
      const forest = bilerp(forestGrid);

      let rgb: [number, number, number];
      if (isWorld) {
        const isOcean = elev <= 0;
        if (stylePreset === 'dark') {
          if (isOcean) {
            const t = Math.max(0, Math.min(1, (elev + 7000) / 7000));
            rgb = layers.hypsometry
              ? lerpRgb([11, 20, 32], [22, 38, 56], t)
              : [16, 26, 38];
          } else {
            rgb = layers.hypsometry
              ? lerpRgb([32, 42, 50], [88, 102, 114], Math.min(1, elev / 4500))
              : [34, 44, 52];
          }
        } else if (stylePreset === 'light') {
          if (isOcean) {
            const t = Math.max(0, Math.min(1, (elev + 7000) / 7000));
            rgb = layers.hypsometry
              ? lerpRgb([184, 214, 238], [214, 234, 248], t)
              : [204, 226, 244];
          } else {
            rgb = layers.hypsometry
              ? lerpRgb([246, 245, 240], [218, 210, 198], Math.min(1, elev / 4200))
              : [246, 245, 240];
          }
        } else if (stylePreset === 'natural') {
          rgb = layers.hypsometry
            ? worldNaturalColor(elev)
            : isOcean
              ? [84, 136, 178]
              : [206, 210, 184];
        } else {
          rgb = layers.hypsometry
            ? worldAtlasColor(elev)
            : isOcean
              ? [154, 198, 232]
              : [238, 235, 224];
        }
      } else if (stylePreset === 'dark') {
        rgb = layers.hypsometry
          ? lerpRgb([30, 40, 48], [66, 78, 88], Math.min(1, (elev - 150) / 1300))
          : [34, 44, 52];
      } else if (stylePreset === 'light') {
        rgb = layers.hypsometry
          ? lerpRgb([246, 245, 240], [228, 222, 210], Math.min(1, (elev - 150) / 1300))
          : [246, 245, 240];
      } else if (stylePreset === 'natural') {
        rgb = layers.hypsometry ? naturalTerrainColor(elev) : [206, 210, 184];
      } else {
        rgb = layers.hypsometry
          ? hypsometricAtlasColor(elev)
          : [238, 235, 224];
      }

      if (layers.forests && forest > 0.02 && (!isWorld || elev > 0)) {
        rgb = lerpRgb(rgb, pal.forestColor, forest * pal.forestOpacity);
      }

      if (layers.hillshade) {
        const hsMult = isWorld && elev <= 0 ? 0.45 : 1.0;
        const shadeDelta =
          (hs - 0.67) * pal.hillshadeStrength * hsMult * 255;
        rgb = [
          Math.max(0, Math.min(255, rgb[0] + shadeDelta)),
          Math.max(0, Math.min(255, rgb[1] + shadeDelta)),
          Math.max(0, Math.min(255, rgb[2] + shadeDelta)),
        ];
      }

      const grain = (((px * 73856093) ^ (py * 19349663)) & 7) - 3.5;
      const outIdx = (py * w + px) * 4;
      data[outIdx] = Math.max(0, Math.min(255, rgb[0] + grain * 0.4));
      data[outIdx + 1] = Math.max(0, Math.min(255, rgb[1] + grain * 0.4));
      data[outIdx + 2] = Math.max(0, Math.min(255, rgb[2] + grain * 0.4));
      data[outIdx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function buildCzechTerrainRaster(
  terrain: CompiledCzechTerrain,
  stylePreset: MapStylePreset,
  layers: LayerVisibility
): HTMLCanvasElement {
  return rasterizeTerrainGrid(
    terrain.elevationGrid,
    terrain.hillshadeGrid,
    terrain.forestGrid,
    DEM_COLS,
    DEM_ROWS,
    stylePreset,
    layers,
    false
  );
}

function buildWorldTerrainRaster(
  worldTerrain: CompiledWorldTerrain,
  stylePreset: MapStylePreset,
  layers: LayerVisibility
): HTMLCanvasElement {
  return rasterizeTerrainGrid(
    worldTerrain.elevationGrid,
    worldTerrain.hillshadeGrid,
    worldTerrain.forestGrid,
    WORLD_DEM_COLS,
    WORLD_DEM_ROWS,
    stylePreset,
    layers,
    true
  );
}

function drawSmoothPoints(ctx: CanvasRenderingContext2D, pts: Point2D[]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) * 0.5;
    const my = (pts[i].y + pts[i + 1].y) * 0.5;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function pickScaleBar(pxPerMeter: number): { label: string; px: number } {
  const targetPx = 124;
  const rawMeters = targetPx / pxPerMeter;
  const steps = [
    200,
    500,
    1000,
    2000,
    5000,
    10000,
    20000,
    25000,
    50000,
    100000,
    200000,
    500000,
    1000000,
    2000000,
    5000000,
  ];
  let best = steps[0];
  for (const s of steps) {
    if (s <= rawMeters * 1.35) best = s;
  }
  return {
    label:
      best >= 1000
        ? `${(best / 1000).toLocaleString('cs-CZ')} km`
        : `${best} m`,
    px: best * pxPerMeter,
  };
}

function pointInGeoRing(
  lon: number,
  lat: number,
  ring: [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const ADMIN1_KRAJ: Record<string, string> = {
  '52': 'Hlavní město Praha',
  '88': 'Středočeský kraj',
  '79': 'Jihočeský kraj',
  '87': 'Plzeňský kraj',
  '81': 'Karlovarský kraj',
  '89': 'Ústecký kraj',
  '83': 'Liberecký kraj',
  '82': 'Královéhradecký kraj',
  '86': 'Pardubický kraj',
  '80': 'Kraj Vysočina',
  '78': 'Jihomoravský kraj',
  '84': 'Olomoucký kraj',
  '90': 'Zlínský kraj',
  '85': 'Moravskoslezský kraj',
};

const SUPPLEMENTAL_RIVER_IDS = new Set([
  'berounka',
  'jihlava',
  'otava',
  'luznice',
  'jizera',
  'ostravice',
  'opava',
  'becva',
  'orlice',
  'chrudimka',
  'ploucnice',
  'mze',
  'radbuza',
]);

function pointToSegmentDistWorld(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export const CzechMapCanvas = forwardRef<
  CzechMapCanvasHandle,
  CzechMapCanvasProps
>(function CzechMapCanvas(
  {
    mapScope,
    terrain,
    worldTerrain,
    realDataset,
    worldDataset,
    worldPlacesIndex,
    stylePreset,
    layers,
    selectedPoint,
    gpxTracks,
    activeGpxId,
    gpxHoverGeo,
    onSelectPoint,
    onSelectGpxTrack,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [viewportSize, setViewportSize] = useState({ width: 1050, height: 700 });

  const activeWidth = mapScope === 'world' ? GLOBAL_WIDTH : WORLD_WIDTH;
  const activeHeight = mapScope === 'world' ? GLOBAL_HEIGHT : WORLD_HEIGHT;
  const minZoom = mapScope === 'world' ? 0.000018 : 0.0007;
  const maxZoom = mapScope === 'world' ? 0.12 : 0.08;

  const projectGeo = useCallback(
    (lon: number, lat: number): Point2D =>
      mapScope === 'world' ? geoToGlobalWorld(lon, lat) : geoToWorld(lon, lat),
    [mapScope]
  );

  const unprojectWorld = useCallback(
    (wx: number, wy: number) =>
      mapScope === 'world' ? globalWorldToGeo(wx, wy) : worldToGeo(wx, wy),
    [mapScope]
  );

  const fitZoom = useMemo(() => {
    const zx = (viewportSize.width * 0.95) / activeWidth;
    const zy = (viewportSize.height * 0.92) / activeHeight;
    return Math.max(minZoom, Math.min(zx, zy));
  }, [viewportSize, activeWidth, activeHeight, minZoom]);

  const [camera, setCamera] = useState({
    cx: activeWidth * 0.5,
    cy: activeHeight * 0.49,
    zoom: mapScope === 'world' ? 0.000032 : 0.0018,
  });

  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startCx: number;
    startCy: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startCx: 0,
    startCy: 0,
  });

  // Fit on initial mount
  const initializedRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setViewportSize({ width: w, height: h });
      if (!initializedRef.current && w > 0 && h > 0) {
        initializedRef.current = true;
        const zx = (w * 0.95) / activeWidth;
        const zy = (h * 0.92) / activeHeight;
        setCamera({
          cx: activeWidth * 0.5,
          cy: activeHeight * 0.49,
          zoom: Math.min(zx, zy),
        });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeWidth, activeHeight]);

  // Reset camera when switching between Czechia and World scope
  const prevScopeRef = useRef<MapScope>(mapScope);
  useEffect(() => {
    if (prevScopeRef.current !== mapScope) {
      prevScopeRef.current = mapScope;
      const w = viewportSize.width || 1050;
      const h = viewportSize.height || 700;
      const sw = mapScope === 'world' ? GLOBAL_WIDTH : WORLD_WIDTH;
      const sh = mapScope === 'world' ? GLOBAL_HEIGHT : WORLD_HEIGHT;
      const zx = (w * 0.95) / sw;
      const zy = (h * 0.92) / sh;
      setCamera({
        cx: sw * 0.5,
        cy: sh * 0.49,
        zoom: Math.min(zx, zy),
      });
      setLocalPatch(null);
      setCursorWorld(null);
    }
  }, [mapScope, viewportSize.width, viewportSize.height]);

  const czechTerrainRaster = useMemo(
    () => buildCzechTerrainRaster(terrain, stylePreset, layers),
    [terrain, stylePreset, layers]
  );

  const worldTerrainRaster = useMemo(
    () => buildWorldTerrainRaster(worldTerrain, stylePreset, layers),
    [worldTerrain, stylePreset, layers]
  );

  const activeTerrainRaster =
    mapScope === 'world' ? worldTerrainRaster : czechTerrainRaster;

  // Local high-res viewport terrain refinement + live AWS Terrarium streaming
  const [localPatch, setLocalPatch] = useState<{
    patch: LocalTerrainPatch;
    raster: HTMLCanvasElement;
    scope: MapScope;
  } | null>(null);
  const [tileRevision, setTileRevision] = useState(0);
  const [blockRevision, setBlockRevision] = useState(0);

  useEffect(() => {
    const thresholdZoom = mapScope === 'world' ? 0.00011 : 0.0036;
    if (camera.zoom < thresholdZoom) {
      setLocalPatch(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const halfW = (viewportSize.width / camera.zoom) * 0.68;
      const halfH = (viewportSize.height / camera.zoom) * 0.68;
      const x0 = Math.max(0, camera.cx - halfW);
      const y0 = Math.max(0, camera.cy - halfH);
      const x1 = Math.min(activeWidth, camera.cx + halfW);
      const y1 = Math.min(activeHeight, camera.cy + halfH);
      if (x1 - x0 < 300 || y1 - y0 < 300) return;

      if (mapScope === 'world') {
        const targetZ = worldDataset?.dem
          ? pickWorldTerrariumZoom(camera.zoom)
          : undefined;

        const patch = compileWorldViewportTerrain(
          x0,
          y0,
          x1 - x0,
          y1 - y0,
          camera.zoom,
          layers.contours,
          worldDataset?.dem,
          targetZ,
          realDataset?.dem
        );
        const raster = rasterizeTerrainGrid(
          patch.elevationGrid,
          patch.hillshadeGrid,
          patch.forestGrid,
          patch.cols,
          patch.rows,
          stylePreset,
          layers,
          true
        );
        if (!cancelled) {
          setLocalPatch({ patch, raster, scope: 'world' });
        }

        if (worldDataset?.dem && targetZ) {
          const tl = globalWorldToGeo(x0, y0);
          const br = globalWorldToGeo(x1, y1);
          ensureViewportTerrariumTiles(
            tl.lon,
            br.lon,
            br.lat,
            tl.lat,
            targetZ
          ).then((loadedNew) => {
            if (!cancelled && loadedNew) {
              setTileRevision((v) => v + 1);
            }
          });
        }
      } else {
        const targetZ = realDataset?.dem
          ? pickTerrariumZoom(camera.zoom)
          : undefined;

        const patch = compileLocalViewportTerrain(
          x0,
          y0,
          x1 - x0,
          y1 - y0,
          camera.zoom,
          layers.contours,
          realDataset?.dem,
          targetZ
        );
        const raster = rasterizeTerrainGrid(
          patch.elevationGrid,
          patch.hillshadeGrid,
          patch.forestGrid,
          patch.cols,
          patch.rows,
          stylePreset,
          layers,
          false
        );
        if (!cancelled) {
          setLocalPatch({ patch, raster, scope: 'cz' });
        }

        if (realDataset?.dem && targetZ && camera.zoom >= 0.0045) {
          const tl = worldToGeo(x0, y0);
          const br = worldToGeo(x1, y1);
          ensureViewportTerrariumTiles(
            tl.lon,
            br.lon,
            br.lat,
            tl.lat,
            targetZ
          ).then((loadedNew) => {
            if (!cancelled && loadedNew) {
              setTileRevision((v) => v + 1);
            }
          });
        }
      }
    }, 95);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    mapScope,
    activeWidth,
    activeHeight,
    camera.cx,
    camera.cy,
    camera.zoom,
    viewportSize.width,
    viewportSize.height,
    stylePreset,
    layers,
    realDataset,
    worldDataset,
    tileRevision,
  ]);

  // Pre-projected official Czech border polygon in Czech world meters
  const borderWorld = useMemo(
    () =>
      (realDataset?.admin.border ?? CZECH_BORDER).map(([lon, lat]) =>
        geoToWorld(lon, lat)
      ),
    [realDataset]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number): Point2D => ({
      x: camera.cx + (sx - viewportSize.width / 2) / camera.zoom,
      y: camera.cy + (sy - viewportSize.height / 2) / camera.zoom,
    }),
    [camera, viewportSize]
  );

  const renderMap = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      cam: { cx: number; cy: number; zoom: number },
      forExport = false
    ) => {
      const pal = PALETTES[stylePreset];
      ctx.save();
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);

      const wxToSx = (wx: number) => width / 2 + (wx - cam.cx) * cam.zoom;
      const wyToSy = (wy: number) => height / 2 + (wy - cam.cy) * cam.zoom;

      const sheetX = wxToSx(0);
      const sheetY = wyToSy(0);
      const sheetW = activeWidth * cam.zoom;
      const sheetH = activeHeight * cam.zoom;

      // 1. Draw Base Terrain Raster + Local High-Res Refinement Patch
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(activeTerrainRaster, sheetX, sheetY, sheetW, sheetH);

      const patchThreshold = mapScope === 'world' ? 0.00011 : 0.0036;
      if (
        localPatch &&
        localPatch.scope === mapScope &&
        !forExport &&
        cam.zoom >= patchThreshold
      ) {
        const { patch, raster } = localPatch;
        ctx.drawImage(
          raster,
          wxToSx(patch.x0),
          wyToSy(patch.y0),
          patch.width * cam.zoom,
          patch.height * cam.zoom
        );
      }

      // Collision boxes for legible cartographic labels
      const placedBoxes: { x: number; y: number; w: number; h: number }[] = [];
      const tryPlaceBox = (
        x: number,
        y: number,
        w: number,
        h: number,
        force = false
      ) => {
        if (
          !force &&
          placedBoxes.some(
            (b) =>
              x < b.x + b.w &&
              x + w > b.x &&
              y < b.y + b.h &&
              y + h > b.y
          )
        ) {
          return false;
        }
        placedBoxes.push({ x, y, w, h });
        return true;
      };

      if (mapScope === 'world') {
        // =====================================================================
        // WORLD MAP RENDERING PIPELINE (LOGICKÉ BLOKY 15°×15° OD 1 : 3 000 000)
        // =====================================================================
        const isDetailScale = cam.zoom >= DETAIL_WORLD_ZOOM;
        const tlGeo = globalWorldToGeo(
          cam.cx - (width * 0.56) / cam.zoom,
          cam.cy - (height * 0.56) / cam.zoom
        );
        const brGeo = globalWorldToGeo(
          cam.cx + (width * 0.56) / cam.zoom,
          cam.cy + (height * 0.56) / cam.zoom
        );
        const viewMinLon = Math.min(tlGeo.lon, brGeo.lon);
        const viewMaxLon = Math.max(tlGeo.lon, brGeo.lon);
        const viewMinLat = Math.min(tlGeo.lat, brGeo.lat);
        const viewMaxLat = Math.max(tlGeo.lat, brGeo.lat);
        const overlapsCz =
          viewMaxLon >= CZ_BOUNDS.minLon &&
          viewMinLon <= CZ_BOUNDS.maxLon &&
          viewMaxLat >= CZ_BOUNDS.minLat &&
          viewMinLat <= CZ_BOUNDS.maxLat;
        const bboxVisible = (b: [number, number, number, number]) =>
          b[2] >= viewMinLon &&
          b[0] <= viewMaxLon &&
          b[3] >= viewMinLat &&
          b[1] <= viewMaxLat;

        // Stream & gather only the 15°×15° logical blocks covering the viewport + immediate 1.8° surroundings
        const { loadedBlocks, activeMetas } = isDetailScale
          ? ensureWorldDetailBlocksForViewport(
              worldPlacesIndex,
              viewMinLon,
              viewMaxLon,
              viewMinLat,
              viewMaxLat,
              () => setBlockRevision((v) => v + 1),
              1.8
            )
          : { loadedBlocks: [], activeMetas: [] };

        // 2W. WGS84 Global Graticule (adaptive 30° / 15° / 5° / 1° / 0.5° / 0.25° / 0.1°)
        if (layers.graticule) {
          const stepDeg =
            cam.zoom > 0.022
              ? 0.1
              : cam.zoom > 0.008
                ? 0.25
                : cam.zoom > 0.0018
                  ? 0.5
                  : cam.zoom > 0.0006
                    ? 1
                    : cam.zoom > 0.00018
                      ? 5
                      : cam.zoom > 0.000055
                        ? 15
                        : 30;
          const decimals = stepDeg < 0.2 ? 1 : stepDeg < 1 ? 2 : 0;
          ctx.strokeStyle = pal.gridStroke;
          ctx.lineWidth = 1;
          ctx.font = '500 10px "JetBrains Mono", monospace';
          ctx.fillStyle = pal.gridText;

          ctx.beginPath();
          const startLon =
            Math.ceil(Math.max(WORLD_GEO_BOUNDS.minLon, viewMinLon) / stepDeg) *
            stepDeg;
          const endLon = Math.min(WORLD_GEO_BOUNDS.maxLon, viewMaxLon);
          for (let lon = startLon; lon <= endLon; lon += stepDeg) {
            const p = geoToGlobalWorld(lon, 0);
            const sx = wxToSx(p.x);
            if (sx < -20 || sx > width + 20) continue;
            ctx.moveTo(sx, Math.max(0, sheetY));
            ctx.lineTo(sx, Math.min(height, sheetY + sheetH));
            if (sx > 35 && sx < width - 35) {
              ctx.textAlign = 'center';
              const suffix = lon > 0 ? 'E' : lon < 0 ? 'W' : '';
              ctx.fillText(
                `${Math.abs(lon).toFixed(decimals)}° ${suffix}`.trim(),
                sx,
                16
              );
            }
          }
          const latStep = stepDeg < 5 ? stepDeg : Math.max(15, stepDeg);
          const startLat =
            Math.ceil(Math.max(-75, viewMinLat) / latStep) * latStep;
          const endLat = Math.min(75, viewMaxLat);
          for (let lat = startLat; lat <= endLat; lat += latStep) {
            const p = geoToGlobalWorld(0, lat);
            const sy = wyToSy(p.y);
            if (sy < -20 || sy > height + 20) continue;
            ctx.moveTo(Math.max(0, sheetX), sy);
            ctx.lineTo(Math.min(width, sheetX + sheetW), sy);
            if (sy > 26 && sy < height - 26) {
              ctx.textAlign = 'left';
              const suffix = lat > 0 ? 'N' : lat < 0 ? 'S' : '';
              ctx.fillText(
                `${Math.abs(lat).toFixed(decimals)}° ${suffix}`.trim(),
                10,
                sy - 4
              );
            }
          }
          ctx.stroke();

          // Highlight Equator (Rovník 0°)
          const eqSy = wyToSy(geoToGlobalWorld(0, 0).y);
          if (eqSy >= 0 && eqSy <= height) {
            ctx.save();
            ctx.strokeStyle = pal.isDark
              ? 'rgba(203, 213, 225, 0.22)'
              : 'rgba(40, 52, 46, 0.25)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(Math.max(0, sheetX), eqSy);
            ctx.lineTo(Math.min(width, sheetX + sheetW), eqSy);
            ctx.stroke();
            ctx.restore();
          }
        }

        // 3W. Global Land Contour Lines + Inline Elevation Numbers at Detail Scale
        if (layers.contours) {
          const useLocalContours =
            !forExport &&
            localPatch &&
            localPatch.scope === 'world' &&
            cam.zoom >= 0.00011 &&
            localPatch.patch.contours.length > 0;
          const activeContours = useLocalContours
            ? localPatch.patch.contours
            : worldTerrain.contours;
          const showMinor = useLocalContours || cam.zoom >= 0.00008;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (showMinor) {
            ctx.strokeStyle = pal.contourMinor;
            ctx.lineWidth = isDetailScale ? 0.45 : 0.4;
            ctx.beginPath();
            for (const level of activeContours) {
              if (level.isIndex) continue;
              for (const poly of level.polylines) {
                for (let i = 0; i < poly.length; i++) {
                  const sx = wxToSx(poly[i].x);
                  const sy = wyToSy(poly[i].y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                }
              }
            }
            ctx.stroke();
          }

          ctx.strokeStyle = pal.contourIndex;
          ctx.lineWidth = isDetailScale
            ? 0.8
            : cam.zoom >= 0.0002
              ? 0.72
              : 0.58;
          ctx.beginPath();
          for (const level of activeContours) {
            if (!level.isIndex) continue;
            for (const poly of level.polylines) {
              for (let i = 0; i < poly.length; i++) {
                const sx = wxToSx(poly[i].x);
                const sy = wyToSy(poly[i].y);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              }
            }
          }
          ctx.stroke();

          // Inline contour elevation numbers at scale <= 1 : 2 000 000
          if (isDetailScale) {
            ctx.font = '500 9px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const level of activeContours) {
              if (!level.isIndex) continue;
              for (const poly of level.polylines) {
                if (poly.length < 22) continue;
                const mid = Math.floor(poly.length * 0.5);
                const sx = wxToSx(poly[mid].x);
                const sy = wyToSy(poly[mid].y);
                if (sx < 30 || sx > width - 30 || sy < 30 || sy > height - 30)
                  continue;
                const p1 = poly[mid - 1];
                const p2 = poly[mid + 1];
                let ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
                ctx.save();
                ctx.translate(sx, sy);
                ctx.rotate(ang);
                ctx.lineWidth = 3;
                ctx.strokeStyle = pal.contourHalo;
                ctx.strokeText(`${level.elevation}`, 0, 0);
                ctx.fillStyle = pal.contourIndex;
                ctx.fillText(`${level.elevation}`, 0, 0);
                ctx.restore();
              }
            }
          }
        }

        // 2bW. Logical Block Grid Overlay (15°×15° active viewport blocks)
        if (isDetailScale && layers.graticule && activeMetas.length > 0) {
          ctx.save();
          ctx.strokeStyle = pal.isDark
            ? 'rgba(56, 189, 248, 0.22)'
            : 'rgba(30, 86, 49, 0.22)';
          ctx.lineWidth = 1.1;
          ctx.setLineDash([6, 4]);
          ctx.font = '600 9.5px "JetBrains Mono", monospace';
          ctx.fillStyle = pal.isDark
            ? 'rgba(125, 211, 252, 0.72)'
            : 'rgba(30, 86, 49, 0.75)';
          for (const meta of activeMetas) {
            const pTL = geoToGlobalWorld(meta.b[0], meta.b[3]);
            const pBR = geoToGlobalWorld(meta.b[2], meta.b[1]);
            const x0 = wxToSx(pTL.x);
            const y0 = wyToSy(pTL.y);
            const x1 = wxToSx(pBR.x);
            const y1 = wyToSy(pBR.y);
            ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            const lx = Math.max(54, Math.min(width - 96, x0 + 8));
            const ly = Math.max(28, Math.min(height - 32, y0 + 14));
            if (lx >= x0 + 4 && lx <= x1 - 54 && ly >= y0 + 8 && ly <= y1 - 8) {
              ctx.textAlign = 'left';
              ctx.fillText(`BLOK ${meta.code}`, lx, ly);
            }
          }
          ctx.restore();
        }

        // 4W. Regional / Provincial / District Borders at Detail Scale (<= 1 : 3 000 000)
        if (isDetailScale && layers.districts) {
          if (loadedBlocks.length > 0) {
            ctx.save();
            ctx.strokeStyle = pal.regionBorder;
            ctx.lineWidth = cam.zoom >= 0.004 ? 1.05 : 0.85;
            ctx.setLineDash([4, 4]);
            for (const blk of loadedBlocks) {
              for (const reg of blk.admin1) {
                if (!bboxVisible(reg.b)) continue;
                for (const line of reg.l) {
                  ctx.beginPath();
                  line.forEach(([lon, lat], i) => {
                    const wPt = geoToGlobalWorld(lon, lat);
                    const sx = wxToSx(wPt.x);
                    const sy = wyToSy(wPt.y);
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                  });
                  ctx.stroke();
                }
              }
            }
            ctx.restore();
          }

          if (overlapsCz && realDataset) {
            ctx.save();
            ctx.strokeStyle = pal.isDark
              ? 'rgba(148, 163, 184, 0.22)'
              : 'rgba(72, 64, 56, 0.24)';
            ctx.lineWidth = 0.8;
            ctx.setLineDash([2, 3]);
            for (const okr of realDataset.admin.okresy) {
              for (const ring of okr.rings) {
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.stroke();
              }
            }
            ctx.restore();

            ctx.save();
            ctx.strokeStyle = pal.regionBorder;
            ctx.lineWidth = 1.05;
            ctx.setLineDash([4, 4]);
            for (const kraj of realDataset.admin.kraje) {
              for (const ring of kraj.rings) {
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.stroke();
              }
            }
            ctx.restore();
          }
        }

        // 5W. World Country Borders (10m detailed borders at <= 1 : 3 000 000; 50m overview borders hidden in detail view)
        if (layers.borders) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          if (isDetailScale) {
            // 1) Draw 10m detailed coastlines and international land borders from active logical blocks
            for (const blk of loadedBlocks) {
              if (!blk.borders) continue;
              for (const bnd of blk.borders) {
                if (!bboxVisible(bnd.b)) continue;
                const isCoast = bnd.c === 1;
                for (const line of bnd.l) {
                  if (line.length < 2) continue;
                  ctx.beginPath();
                  line.forEach(([lon, lat], i) => {
                    const wPt = geoToGlobalWorld(lon, lat);
                    const sx = wxToSx(wPt.x);
                    const sy = wyToSy(wPt.y);
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                  });
                  if (isCoast) {
                    ctx.strokeStyle = pal.waterStroke;
                    ctx.lineWidth = 1.15;
                    ctx.stroke();
                  } else {
                    ctx.strokeStyle = pal.borderOuter;
                    ctx.lineWidth = 3.6;
                    ctx.stroke();
                    ctx.strokeStyle = pal.borderInner;
                    ctx.lineWidth = 1.65;
                    ctx.stroke();
                  }
                }
              }
            }

            // 2) Draw ultra-high-resolution 5,957-point official Czech national border when overlapping Czechia
            if (overlapsCz && realDataset) {
              ctx.beginPath();
              realDataset.admin.border.forEach(([lon, lat], idx) => {
                const wPt = geoToGlobalWorld(lon, lat);
                const sx = wxToSx(wPt.x);
                const sy = wyToSy(wPt.y);
                if (idx === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
              ctx.closePath();
              ctx.strokeStyle = pal.borderOuter;
              ctx.lineWidth = 4.0;
              ctx.stroke();
              ctx.strokeStyle = pal.borderInner;
              ctx.lineWidth = 1.75;
              ctx.stroke();
            }
          } else if (worldDataset) {
            // Coarse 50m overview country borders (shown ONLY when scale > 1 : 3 000 000)
            for (const country of worldDataset.countries) {
              if (country.b && !bboxVisible(country.b)) continue;
              const isCz = country.iso === 'CZE';
              for (const ring of country.rings) {
                if (ring.length < 3) continue;
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                if (isCz) {
                  ctx.strokeStyle = '#1E5631';
                  ctx.lineWidth = cam.zoom >= 0.0002 ? 2.2 : 1.5;
                  ctx.stroke();
                } else {
                  ctx.strokeStyle = pal.isDark
                    ? 'rgba(203, 213, 225, 0.36)'
                    : 'rgba(54, 50, 45, 0.44)';
                  ctx.lineWidth = cam.zoom >= 0.0002 ? 1.15 : 0.75;
                  ctx.stroke();
                }
              }
            }
          }
          ctx.restore();
        }

        // 6W. Global Hydrology (50m overview -> 10m block detail at <= 1 : 3 000 000)
        if (layers.hydrology) {
          if (isDetailScale && loadedBlocks.length > 0) {
            for (const blk of loadedBlocks) {
              for (const lake of blk.lakes) {
                if (!bboxVisible(lake.b)) continue;
                for (const ring of lake.g) {
                  if (ring.length < 3) continue;
                  ctx.beginPath();
                  ring.forEach(([lon, lat], i) => {
                    const wPt = geoToGlobalWorld(lon, lat);
                    const sx = wxToSx(wPt.x);
                    const sy = wyToSy(wPt.y);
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                  });
                  ctx.closePath();
                  ctx.fillStyle = pal.waterFill;
                  ctx.fill();
                  ctx.strokeStyle = pal.waterStroke;
                  ctx.lineWidth = 1.0;
                  ctx.stroke();
                }
                if (lake.n && cam.zoom >= 0.0015) {
                  const cLon = (lake.b[0] + lake.b[2]) * 0.5;
                  const cLat = (lake.b[1] + lake.b[3]) * 0.5;
                  const cPt = geoToGlobalWorld(cLon, cLat);
                  const sx = wxToSx(cPt.x);
                  const sy = wyToSy(cPt.y);
                  if (
                    sx > 30 &&
                    sx < width - 30 &&
                    sy > 20 &&
                    sy < height - 20
                  ) {
                    ctx.font =
                      'italic 500 10px "Plus Jakarta Sans", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.lineWidth = 2.8;
                    ctx.strokeStyle = pal.textHalo;
                    ctx.strokeText(lake.n, sx, sy);
                    ctx.fillStyle = pal.waterStroke;
                    ctx.fillText(lake.n, sx, sy);
                  }
                }
              }
            }

            if (overlapsCz) {
              for (const lake of CZECH_LAKES) {
                ctx.beginPath();
                lake.points.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.fillStyle = pal.waterFill;
                ctx.fill();
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = 1.05;
                ctx.stroke();
              }
            }

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const labeledRivers = new Set<string>();
            for (const blk of loadedBlocks) {
              for (const river of blk.rivers) {
                if (!bboxVisible(river.b)) continue;
                const wScale = Math.max(1.0, Math.min(3.2, river.w * 2.1));
                for (const line of river.l) {
                  if (line.length < 2) continue;
                  ctx.beginPath();
                  const sPts: Point2D[] = [];
                  line.forEach(([lon, lat], i) => {
                    const wPt = geoToGlobalWorld(lon, lat);
                    const sx = wxToSx(wPt.x);
                    const sy = wyToSy(wPt.y);
                    sPts.push({ x: sx, y: sy });
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                  });
                  ctx.strokeStyle = pal.waterStroke;
                  ctx.lineWidth = Math.max(
                    1.1,
                    wScale * (0.58 + Math.min(2.8, cam.zoom * 165))
                  );
                  ctx.stroke();
                  ctx.strokeStyle = pal.waterFill;
                  ctx.lineWidth = Math.max(
                    0.6,
                    wScale * (0.3 + Math.min(1.6, cam.zoom * 95))
                  );
                  ctx.stroke();

                  if (
                    river.n &&
                    !labeledRivers.has(river.n) &&
                    sPts.length >= 4
                  ) {
                    const mid = Math.floor(sPts.length * 0.5);
                    const pA = sPts[mid];
                    const pB = sPts[Math.min(sPts.length - 1, mid + 1)];
                    if (
                      pA.x > 35 &&
                      pA.x < width - 35 &&
                      pA.y > 35 &&
                      pA.y < height - 35
                    ) {
                      labeledRivers.add(river.n);
                      let ang = Math.atan2(pB.y - pA.y, pB.x - pA.x);
                      if (ang > Math.PI / 2 || ang < -Math.PI / 2)
                        ang += Math.PI;
                      ctx.save();
                      ctx.translate((pA.x + pB.x) / 2, (pA.y + pB.y) / 2 - 6);
                      ctx.rotate(ang);
                      ctx.font =
                        'italic 600 10.5px "Plus Jakarta Sans", sans-serif';
                      ctx.textAlign = 'center';
                      ctx.lineWidth = 2.8;
                      ctx.strokeStyle = pal.textHalo;
                      ctx.strokeText(river.n, 0, 0);
                      ctx.fillStyle = pal.waterStroke;
                      ctx.fillText(river.n, 0, 0);
                      ctx.restore();
                    }
                  }
                }
              }
            }

            if (overlapsCz) {
              for (const river of CZECH_RIVERS) {
                if (!SUPPLEMENTAL_RIVER_IDS.has(river.id)) continue;
                const sPts = river.points.map(([lon, lat]) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  return { x: wxToSx(wPt.x), y: wyToSy(wPt.y) };
                });
                drawSmoothPoints(ctx, sPts);
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = Math.max(
                  1.1,
                  river.width * (0.58 + Math.min(2.6, cam.zoom * 165))
                );
                ctx.stroke();
                ctx.strokeStyle = pal.waterFill;
                ctx.lineWidth = Math.max(
                  0.6,
                  river.width * (0.3 + Math.min(1.5, cam.zoom * 95))
                );
                ctx.stroke();
              }
            }
          } else if (worldDataset) {
            for (const lake of worldDataset.lakes) {
              if (lake.b && !bboxVisible(lake.b)) continue;
              for (const ring of lake.rings) {
                if (ring.length < 3) continue;
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.fillStyle = pal.waterFill;
                ctx.fill();
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = 0.7;
                ctx.stroke();
              }
            }

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const labeledWorldRivers = new Set<string>();
            for (const river of worldDataset.rivers) {
              if (river.b && !bboxVisible(river.b)) continue;
              if (cam.zoom < 0.00005 && river.w < 0.75) continue;
              if (cam.zoom < 0.00012 && river.w < 0.45) continue;
              const wScale = Math.max(0.8, Math.min(2.6, river.w * 1.4));
              for (const line of river.lines) {
                if (line.length < 2) continue;
                ctx.beginPath();
                const sPts: Point2D[] = [];
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  sPts.push({ x: sx, y: sy });
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = Math.max(
                  0.75,
                  wScale * (0.65 + Math.min(1.8, cam.zoom * 3200))
                );
                ctx.stroke();

                if (
                  river.n &&
                  !labeledWorldRivers.has(river.n) &&
                  sPts.length >= 4 &&
                  cam.zoom >= 0.00014
                ) {
                  const mid = Math.floor(sPts.length * 0.5);
                  const pA = sPts[mid];
                  const pB = sPts[Math.min(sPts.length - 1, mid + 1)];
                  if (
                    pA.x > 40 &&
                    pA.x < width - 40 &&
                    pA.y > 40 &&
                    pA.y < height - 40
                  ) {
                    labeledWorldRivers.add(river.n);
                    let ang = Math.atan2(pB.y - pA.y, pB.x - pA.x);
                    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
                    ctx.save();
                    ctx.translate((pA.x + pB.x) / 2, (pA.y + pB.y) / 2 - 5);
                    ctx.rotate(ang);
                    ctx.font =
                      'italic 600 9.5px "Plus Jakarta Sans", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.lineWidth = 2.5;
                    ctx.strokeStyle = pal.textHalo;
                    ctx.strokeText(river.n, 0, 0);
                    ctx.fillStyle = pal.waterStroke;
                    ctx.fillText(river.n, 0, 0);
                    ctx.restore();
                  }
                }
              }
            }
          }
        }

        // 6bW. Global Built-up Urban Footprints at Detail Scale (<= 1 : 3 000 000)
        if (isDetailScale && layers.cities) {
          ctx.save();
          ctx.fillStyle = pal.isDark
            ? 'rgba(203, 213, 225, 0.09)'
            : 'rgba(218, 196, 168, 0.18)';
          ctx.strokeStyle = pal.isDark
            ? 'rgba(203, 213, 225, 0.14)'
            : 'rgba(180, 152, 122, 0.14)';
          ctx.lineWidth = 0.5;

          for (const blk of loadedBlocks) {
            for (const u of blk.urban) {
              if (!bboxVisible(u.b)) continue;
              for (const ring of u.g) {
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              }
            }
          }
          if (overlapsCz && realDataset) {
            for (const u of realDataset.vectors.urban) {
              for (const ring of u.rings) {
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }

        // 7aW. Global Railway Network at Detail Scale (<= 1 : 3 000 000)
        if (isDetailScale && layers.railways) {
          ctx.save();
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'round';
          for (const blk of loadedBlocks) {
            for (const rail of blk.railways) {
              if (!bboxVisible(rail.b)) continue;
              if (cam.zoom < 0.0022 && rail.r > 5) continue;
              for (const line of rail.l) {
                if (line.length < 2) continue;
                ctx.beginPath();
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.setLineDash([]);
                ctx.strokeStyle = pal.isDark
                  ? 'rgba(148, 163, 184, 0.55)'
                  : 'rgba(62, 58, 54, 0.58)';
                ctx.lineWidth = cam.zoom >= 0.007 ? 2.1 : 1.4;
                ctx.stroke();

                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = pal.isDark ? '#0F172A' : '#FAF9F5';
                ctx.lineWidth = cam.zoom >= 0.007 ? 1.1 : 0.7;
                ctx.stroke();
              }
            }
          }
          if (overlapsCz && realDataset && cam.zoom >= 0.0014) {
            for (const rail of realDataset.vectors.railways) {
              if (cam.zoom < 0.0024 && rail.rank > 5) continue;
              for (const line of rail.lines) {
                if (line.length < 2) continue;
                ctx.beginPath();
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.setLineDash([]);
                ctx.strokeStyle = pal.isDark
                  ? 'rgba(148, 163, 184, 0.55)'
                  : 'rgba(62, 58, 54, 0.58)';
                ctx.lineWidth = cam.zoom >= 0.007 ? 2.1 : 1.4;
                ctx.stroke();

                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = pal.isDark ? '#0F172A' : '#FAF9F5';
                ctx.lineWidth = cam.zoom >= 0.007 ? 1.1 : 0.7;
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }

        // 7bW. Global Motorways, Secondary Highways & Trunk Roads at Detail Scale (<= 1 : 3 000 000)
        if (isDetailScale && layers.highways) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          const badgeCandidates: {
            x: number;
            y: number;
            code: string;
            isMajor: boolean;
          }[] = [];

          for (const blk of loadedBlocks) {
            // Pass 1: Regular & Secondary Highways
            for (const rd of blk.roads) {
              if (rd.t === 2) continue;
              if (!bboxVisible(rd.b)) continue;
              if (cam.zoom < 0.0016 && rd.t === 0) continue;
              const isSec = rd.t === 1;
              for (const line of rd.l) {
                ctx.beginPath();
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.strokeStyle = pal.isDark
                  ? 'rgba(148, 163, 184, 0.45)'
                  : isSec
                    ? 'rgba(146, 108, 68, 0.65)'
                    : 'rgba(148, 134, 112, 0.42)';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 2.8
                    : 1.8
                  : cam.zoom >= 0.006
                    ? 1.9
                    : 1.1;
                ctx.stroke();

                ctx.strokeStyle = pal.isDark
                  ? '#475569'
                  : isSec
                    ? '#FEF08A'
                    : '#FAF5E4';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 1.4
                    : 0.9
                  : cam.zoom >= 0.006
                    ? 0.95
                    : 0.55;
                ctx.stroke();
              }
            }

            // Pass 2: Major Highways / Motorways
            for (const rd of blk.roads) {
              if (rd.t !== 2) continue;
              if (!bboxVisible(rd.b)) continue;
              for (const line of rd.l) {
                ctx.beginPath();
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.strokeStyle = pal.highwayCasing;
                ctx.lineWidth = cam.zoom >= 0.004 ? 4.0 : 2.6;
                ctx.stroke();
                ctx.strokeStyle = pal.highwayCore;
                ctx.lineWidth = cam.zoom >= 0.004 ? 1.9 : 1.25;
                ctx.stroke();

                if (
                  rd.n &&
                  rd.n.length >= 2 &&
                  rd.n.length <= 7 &&
                  line.length >= 3 &&
                  cam.zoom >= 0.0017
                ) {
                  const mid = line[Math.floor(line.length * 0.5)];
                  const wPt = geoToGlobalWorld(mid[0], mid[1]);
                  badgeCandidates.push({
                    x: wxToSx(wPt.x),
                    y: wyToSy(wPt.y),
                    code: rd.n,
                    isMajor: true,
                  });
                }
              }
            }
          }

          // Pass 3: Highway route shields
          const placedBadges: { x: number; y: number }[] = [];
          for (const b of badgeCandidates) {
            if (b.x < 35 || b.x > width - 35 || b.y < 35 || b.y > height - 35)
              continue;
            if (placedBadges.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 64))
              continue;
            placedBadges.push({ x: b.x, y: b.y });
            const bw = Math.max(24, b.code.length * 6 + 8);
            const bh = 14;
            ctx.fillStyle = pal.highwayBadgeBg;
            ctx.fillRect(b.x - bw / 2, b.y - bh / 2, bw, bh);
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 0.85;
            ctx.strokeRect(b.x - bw / 2, b.y - bh / 2, bw, bh);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '700 8px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.code, b.x, b.y + 0.5);
          }

          if (overlapsCz && cam.zoom >= 0.0018) {
            for (const hw of CZECH_HIGHWAYS) {
              if (hw.roadType === 'primary' && cam.zoom < 0.0046) continue;
              const midIdx = Math.floor(hw.points.length * 0.5);
              const [lon, lat] = hw.points[midIdx];
              const wPt = geoToGlobalWorld(lon, lat);
              const mx = wxToSx(wPt.x);
              const my = wyToSy(wPt.y);
              if (mx > 30 && mx < width - 30 && my > 30 && my < height - 30) {
                const isPrimary = hw.roadType === 'primary';
                const bw = isPrimary ? 28 : 24;
                const bh = isPrimary ? 13 : 14;
                ctx.fillStyle = isPrimary ? '#1D4ED8' : pal.highwayBadgeBg;
                ctx.fillRect(mx - bw / 2, my - bh / 2, bw, bh);
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 0.85;
                ctx.strokeRect(mx - bw / 2, my - bh / 2, bw, bh);
                ctx.fillStyle = '#FFFFFF';
                ctx.font = `700 ${isPrimary ? '8' : '8.5'}px "JetBrains Mono", monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(hw.code, mx, my + 0.5);
              }
            }
          }
          ctx.restore();
        }

        // 8W. World Cities, Towns & Settlements (Progressive multi-tier LOD & spatial decluttering)
        if (layers.cities) {
          const placedCities: { x: number; y: number }[] = [];

          const tryDrawCity = (
            lon: number,
            lat: number,
            name: string,
            pop: number,
            tier: number, // 2 = national capital, 1 = regional capital, 0 = city/town
            minDistPx: number,
            isOverview: boolean
          ) => {
            const wPt = geoToGlobalWorld(lon, lat);
            const sx = wxToSx(wPt.x);
            const sy = wyToSy(wPt.y);
            if (sx < -20 || sx > width + 20 || sy < -20 || sy > height + 20)
              return;

            // Enforce minimum screen distance between visible cities at current zoom
            for (let i = 0; i < placedCities.length; i++) {
              const dx = placedCities[i].x - sx;
              const dy = placedCities[i].y - sy;
              if (dx * dx + dy * dy < minDistPx * minDistPx) return;
            }

            const isCap = tier === 2;
            const isReg = tier === 1;
            const r = isOverview
              ? isCap
                ? cam.zoom >= 0.00012
                  ? 4.0
                  : 3.1
                : pop >= 3000000
                  ? 3.2
                  : 2.3
              : isCap
                ? 5.0
                : isReg
                  ? 3.7
                  : pop >= 100000
                    ? 3.1
                    : pop >= 25000
                      ? 2.4
                      : 1.9;

            ctx.font = isOverview
              ? isCap
                ? '700 10.5px "Plus Jakarta Sans", sans-serif'
                : '500 9.5px "Plus Jakarta Sans", sans-serif'
              : isCap
                ? '700 12.5px "Outfit", sans-serif'
                : isReg
                  ? '700 10.8px "Plus Jakarta Sans", sans-serif'
                  : pop >= 45000
                    ? '600 10.2px "Plus Jakarta Sans", sans-serif'
                    : '500 9.4px "Plus Jakarta Sans", sans-serif';

            const tw = ctx.measureText(name).width;
            const lx = sx + r + 4.5;
            const ly = sy;
            const boxH = isCap ? 15 : 13;

            // Reserve bounding box covering both the city dot and its text label
            if (
              !tryPlaceBox(
                sx - r - 3,
                ly - boxH * 0.5,
                r * 2 + 8 + tw,
                boxH,
                false
              )
            ) {
              return;
            }

            placedCities.push({ x: sx, y: sy });

            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fillStyle = isCap ? '#B91C1C' : pal.cityRing;
            ctx.fill();
            ctx.lineWidth = isCap ? 1.8 : 1.25;
            ctx.strokeStyle = pal.cityDot;
            ctx.stroke();

            if (!isOverview && isReg) {
              ctx.beginPath();
              ctx.arc(sx, sy, 1.35, 0, Math.PI * 2);
              ctx.fillStyle = pal.cityDot;
              ctx.fill();
            }

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3.0;
            ctx.strokeStyle = pal.textHalo;
            ctx.strokeText(name, lx, ly);
            ctx.fillStyle = pal.textPrimary;
            ctx.fillText(name, lx, ly);
          };

          if (isDetailScale && loadedBlocks.length > 0) {
            // Progressive zoom thresholds and spatial spacing at detail scale (<= 1 : 3 000 000)
            const minCityDistPx =
              cam.zoom < 0.0018
                ? 64
                : cam.zoom < 0.0028
                  ? 56
                  : cam.zoom < 0.0045
                    ? 50
                    : cam.zoom < 0.0075
                      ? 44
                      : cam.zoom < 0.0125
                        ? 37
                        : cam.zoom < 0.022
                          ? 30
                          : 23;

            const candidates: {
              x: number;
              y: number;
              n: string;
              p: number;
              t: number;
            }[] = [];

            for (const blk of loadedBlocks) {
              for (const city of blk.cities) {
                if (
                  city.x < viewMinLon ||
                  city.x > viewMaxLon ||
                  city.y < viewMinLat ||
                  city.y > viewMaxLat
                ) {
                  continue;
                }
                const passZoom =
                  cam.zoom < 0.0018
                    ? city.t === 2 ||
                      (city.t === 1 && city.p >= 45000) ||
                      city.p >= 90000
                    : cam.zoom < 0.0028
                      ? city.t >= 1 || city.p >= 42000
                      : cam.zoom < 0.0045
                        ? city.t >= 1 || city.p >= 20000
                        : cam.zoom < 0.0075
                          ? city.t >= 1 || city.p >= 10000
                          : cam.zoom < 0.0125
                            ? city.p >= 5000
                            : true;
                if (!passZoom) continue;
                candidates.push({
                  x: city.x,
                  y: city.y,
                  n: city.n,
                  p: city.p,
                  t: city.t,
                });
              }
            }

            if (overlapsCz && realDataset) {
              for (const city of realDataset.places.cities) {
                if (
                  city.x < viewMinLon ||
                  city.x > viewMaxLon ||
                  city.y < viewMinLat ||
                  city.y > viewMaxLat
                ) {
                  continue;
                }
                const mappedTier = city.t === 3 ? 2 : city.t === 2 ? 1 : 0;
                const passZoom =
                  cam.zoom < 0.0018
                    ? mappedTier === 2 ||
                      (mappedTier === 1 && city.p >= 40000) ||
                      city.p >= 75000
                    : cam.zoom < 0.0028
                      ? mappedTier >= 1 || city.p >= 35000
                      : cam.zoom < 0.0045
                        ? mappedTier >= 1 || city.p >= 16000
                        : cam.zoom < 0.0075
                          ? city.t >= 1 || city.p >= 7500
                          : cam.zoom < 0.0125
                            ? city.p >= 3500
                            : cam.zoom < 0.022
                              ? city.p >= 1200
                              : true;
                if (!passZoom) continue;
                candidates.push({
                  x: city.x,
                  y: city.y,
                  n: city.n,
                  p: city.p,
                  t: mappedTier,
                });
              }
            }

            // Sort unified candidates by importance: national capitals -> regional capitals -> population
            candidates.sort((a, b) => b.t - a.t || b.p - a.p);

            for (const c of candidates) {
              tryDrawCity(c.x, c.y, c.n, c.p, c.t, minCityDistPx, false);
            }
          } else if (worldDataset) {
            const minCityDistPx =
              cam.zoom < 0.000045
                ? 88
                : cam.zoom < 0.00009
                  ? 76
                  : cam.zoom < 0.00022
                    ? 66
                    : cam.zoom < 0.00055
                      ? 58
                      : 52;

            for (const city of worldDataset.cities) {
              if (
                city.x < viewMinLon ||
                city.x > viewMaxLon ||
                city.y < viewMinLat ||
                city.y > viewMaxLat
              ) {
                continue;
              }
              const visibleAtZoom =
                cam.zoom < 0.000045
                  ? (city.cap && city.p >= 1800000) || city.p >= 5500000
                  : cam.zoom < 0.00009
                    ? (city.cap && city.p >= 500000) || city.p >= 2000000
                    : cam.zoom < 0.00022
                      ? city.cap || city.p >= 750000
                      : cam.zoom < 0.00055
                        ? city.cap || city.p >= 300000
                        : true;
              if (!visibleAtZoom) continue;

              tryDrawCity(
                city.x,
                city.y,
                city.n,
                city.p,
                city.cap ? 2 : 0,
                minCityDistPx,
                true
              );
            }
          }
        }

        // 9W. World Mountain Peaks (Progressive multi-tier LOD & spatial decluttering)
        if (layers.peaks && worldDataset) {
          const placedPeaks: { x: number; y: number }[] = [];

          const minPeakDistPx = !isDetailScale
            ? cam.zoom < 0.00005
              ? 105
              : cam.zoom < 0.00014
                ? 88
                : cam.zoom < 0.00045
                  ? 74
                  : 64
            : cam.zoom < 0.0018
              ? 90
              : cam.zoom < 0.0028
                ? 76
                : cam.zoom < 0.0045
                  ? 64
                  : cam.zoom < 0.0075
                    ? 52
                    : cam.zoom < 0.013
                      ? 42
                      : cam.zoom < 0.024
                        ? 32
                        : 23;

          const drawPeakSymbol = (
            lon: number,
            lat: number,
            name: string,
            elev: number
          ) => {
            const wPt = geoToGlobalWorld(lon, lat);
            const sx = wxToSx(wPt.x);
            const sy = wyToSy(wPt.y);
            if (sx < -20 || sx > width + 20 || sy < -20 || sy > height + 20)
              return;

            // Enforce minimum screen distance between peaks so dominant summits appear first and subordinate peaks fill in gradually
            for (let i = 0; i < placedPeaks.length; i++) {
              const dx = placedPeaks[i].x - sx;
              const dy = placedPeaks[i].y - sy;
              if (dx * dx + dy * dy < minPeakDistPx * minPeakDistPx) return;
            }

            const label = `${name} ${elev}`;
            ctx.font = 'italic 600 9.4px "Plus Jakarta Sans", sans-serif';
            const tw = ctx.measureText(label).width;
            const lx = sx + 6.2;
            const ly = sy + 1;
            if (!tryPlaceBox(sx - 5, ly - 6, tw + 13, 12, false)) return;

            placedPeaks.push({ x: sx, y: sy });

            ctx.beginPath();
            ctx.moveTo(sx, sy - 4.5);
            ctx.lineTo(sx + 3.9, sy + 3.0);
            ctx.lineTo(sx - 3.9, sy + 3.0);
            ctx.closePath();
            ctx.fillStyle = pal.peakColor;
            ctx.strokeStyle = pal.textHalo;
            ctx.lineWidth = 1.4;
            ctx.stroke();
            ctx.fill();

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 2.8;
            ctx.strokeStyle = pal.textHalo;
            ctx.strokeText(label, lx, ly);
            ctx.fillStyle = pal.peakColor;
            ctx.fillText(label, lx, ly);
          };

          if (isDetailScale && loadedBlocks.length > 0) {
            const peakCandidates: {
              x: number;
              y: number;
              n: string;
              e: number;
            }[] = [];

            for (const blk of loadedBlocks) {
              for (const peak of blk.peaks) {
                if (
                  peak.x < viewMinLon ||
                  peak.x > viewMaxLon ||
                  peak.y < viewMinLat ||
                  peak.y > viewMaxLat
                ) {
                  continue;
                }
                peakCandidates.push(peak);
              }
            }

            if (overlapsCz && realDataset) {
              for (const peak of realDataset.places.peaks) {
                if (
                  peak.x < viewMinLon ||
                  peak.x > viewMaxLon ||
                  peak.y < viewMinLat ||
                  peak.y > viewMaxLat
                ) {
                  continue;
                }
                peakCandidates.push(peak);
              }
            }

            // Sort all visible peaks by elevation descending so the highest summits in every region claim their space first
            peakCandidates.sort((a, b) => b.e - a.e);

            for (const peak of peakCandidates) {
              drawPeakSymbol(peak.x, peak.y, peak.n, peak.e);
            }
          } else {
            for (const peak of worldDataset.peaks) {
              if (
                peak.x < viewMinLon ||
                peak.x > viewMaxLon ||
                peak.y < viewMinLat ||
                peak.y > viewMaxLat
              ) {
                continue;
              }
              const visibleAtZoom =
                cam.zoom < 0.00005
                  ? peak.e >= 4800 || peak.n === 'Sněžka' || peak.n === 'Fudži'
                  : cam.zoom < 0.00014
                    ? peak.e >= 3000 || peak.n === 'Sněžka'
                    : cam.zoom < 0.00045
                      ? peak.e >= 1800 || peak.n === 'Sněžka'
                      : true;
              if (!visibleAtZoom) continue;
              drawPeakSymbol(peak.x, peak.y, peak.n, peak.e);
            }
          }
        }

        // 10W. Country Name Labels
        if (layers.borders && worldDataset && cam.zoom < 0.0055) {
          const sortedCountries = [...worldDataset.countries].sort(
            (a, b) => b.p - a.p
          );
          for (const country of sortedCountries) {
            if (
              country.x < viewMinLon ||
              country.x > viewMaxLon ||
              country.y < viewMinLat ||
              country.y > viewMaxLat
            ) {
              continue;
            }
            const visibleAtZoom =
              cam.zoom < 0.000045
                ? country.p >= 25000000 || country.iso === 'CZE'
                : cam.zoom < 0.0001
                  ? country.p >= 7000000 || country.iso === 'CZE'
                  : cam.zoom < 0.00025
                    ? country.p >= 1200000 || country.iso === 'CZE'
                    : true;
            if (!visibleAtZoom) continue;

            const wPt = geoToGlobalWorld(country.x, country.y);
            const sx = wxToSx(wPt.x);
            const sy = wyToSy(wPt.y);
            if (sx < 30 || sx > width - 30 || sy < 20 || sy > height - 20)
              continue;

            const label = country.n.toUpperCase();
            ctx.font =
              country.p >= 40000000
                ? '700 10.5px "Outfit", sans-serif'
                : '600 9px "Outfit", sans-serif';
            const tw = ctx.measureText(label).width;
            if (tryPlaceBox(sx - tw / 2 - 3, sy - 7, tw + 6, 14, false)) {
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.0;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(label, sx, sy);
              ctx.fillStyle = pal.isDark
                ? 'rgba(226, 232, 240, 0.78)'
                : 'rgba(54, 64, 58, 0.76)';
              ctx.fillText(label, sx, sy);
            }
          }
        }
      } else {
        // =====================================================================
        // CZECH REPUBLIC HIGH-PRECISION RENDERING PIPELINE (ČESKÁ REPUBLIKA)
        // =====================================================================

        // 2. Soft cartographic mask outside Czech Republic border
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        borderWorld.forEach((pt, idx) => {
          const sx = wxToSx(pt.x);
          const sy = wyToSy(pt.y);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.fillStyle = pal.outsideVeil;
        ctx.fill('evenodd');
        ctx.restore();

        // 3. WGS84 Graticule (adaptive 1° / 0.5° / 0.25° / 0.1°)
        if (layers.graticule) {
          const stepDeg =
            cam.zoom > 0.022
              ? 0.1
              : cam.zoom > 0.009
                ? 0.25
                : cam.zoom > 0.004
                  ? 0.5
                  : 1.0;
          const decimals = stepDeg < 0.2 ? 1 : stepDeg < 1 ? 2 : 0;
          ctx.strokeStyle = pal.gridStroke;
          ctx.lineWidth = 1;
          ctx.font = '500 10px "JetBrains Mono", monospace';
          ctx.fillStyle = pal.gridText;

          ctx.beginPath();
          for (
            let lon = Math.ceil(CZ_BOUNDS.minLon / stepDeg) * stepDeg;
            lon <= CZ_BOUNDS.maxLon;
            lon += stepDeg
          ) {
            const p = geoToWorld(lon, CZ_BOUNDS.maxLat);
            const sx = wxToSx(p.x);
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, height);
            if (sx > 30 && sx < width - 30) {
              ctx.textAlign = 'center';
              ctx.fillText(`${lon.toFixed(decimals)}° v. d.`, sx, 16);
            }
          }
          for (
            let lat = Math.ceil(CZ_BOUNDS.minLat / stepDeg) * stepDeg;
            lat <= CZ_BOUNDS.maxLat;
            lat += stepDeg
          ) {
            const p = geoToWorld(CZ_BOUNDS.minLon, lat);
            const sy = wyToSy(p.y);
            ctx.moveTo(0, sy);
            ctx.lineTo(width, sy);
            if (sy > 26 && sy < height - 26) {
              ctx.textAlign = 'left';
              ctx.fillText(`${lat.toFixed(decimals)}° s. š.`, 10, sy - 4);
            }
          }
          ctx.stroke();
        }

        // 4. Contour Lines (adaptive: 50m/200m national, 25m/100m mid, 10m/50m local zoomed)
        if (layers.contours) {
          const useLocalContours =
            !forExport &&
            localPatch &&
            localPatch.scope === 'cz' &&
            cam.zoom >= 0.0036 &&
            localPatch.patch.contours.length > 0;
          const activeContours = useLocalContours
            ? localPatch.patch.contours
            : terrain.contours;
          const showMinor = useLocalContours || cam.zoom >= 0.0032;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (showMinor) {
            ctx.strokeStyle = pal.contourMinor;
            ctx.lineWidth = 0.45;
            ctx.beginPath();
            for (const level of activeContours) {
              if (level.isIndex) continue;
              for (const poly of level.polylines) {
                for (let i = 0; i < poly.length; i++) {
                  const sx = wxToSx(poly[i].x);
                  const sy = wyToSy(poly[i].y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                }
              }
            }
            ctx.stroke();
          }

          ctx.strokeStyle = pal.contourIndex;
          ctx.lineWidth = cam.zoom >= 0.004 ? 0.8 : 0.62;
          ctx.beginPath();
          for (const level of activeContours) {
            if (!level.isIndex) continue;
            for (const poly of level.polylines) {
              for (let i = 0; i < poly.length; i++) {
                const sx = wxToSx(poly[i].x);
                const sy = wyToSy(poly[i].y);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              }
            }
          }
          ctx.stroke();

          // Inline contour elevation numbers when zoomed in
          if (cam.zoom >= 0.0034) {
            ctx.font = '500 9px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const level of activeContours) {
              if (!level.isIndex) continue;
              for (const poly of level.polylines) {
                if (poly.length < 24) continue;
                const mid = Math.floor(poly.length * 0.5);
                const sx = wxToSx(poly[mid].x);
                const sy = wyToSy(poly[mid].y);
                if (sx < 30 || sx > width - 30 || sy < 30 || sy > height - 30)
                  continue;
                const p1 = poly[mid - 1];
                const p2 = poly[mid + 1];
                let ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
                ctx.save();
                ctx.translate(sx, sy);
                ctx.rotate(ang);
                ctx.lineWidth = 3;
                ctx.strokeStyle = pal.contourHalo;
                ctx.strokeText(`${level.elevation}`, 0, 0);
                ctx.fillStyle = pal.contourIndex;
                ctx.fillText(`${level.elevation}`, 0, 0);
                ctx.restore();
              }
            }
          }
        }

        // 5. Administrative Borders: Okresy (77), Kraje (14), and National Border
        if (layers.districts && realDataset) {
          ctx.save();
          ctx.strokeStyle = pal.isDark
            ? 'rgba(148, 163, 184, 0.22)'
            : 'rgba(72, 64, 56, 0.24)';
          ctx.lineWidth = 0.8;
          ctx.setLineDash([2, 3]);
          for (const okr of realDataset.admin.okresy) {
            for (const ring of okr.rings) {
              ctx.beginPath();
              ring.forEach(([lon, lat], i) => {
                const wPt = geoToWorld(lon, lat);
                const sx = wxToSx(wPt.x);
                const sy = wyToSy(wPt.y);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
              ctx.closePath();
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        if (layers.borders) {
          ctx.save();
          ctx.strokeStyle = pal.regionBorder;
          ctx.lineWidth = 1.05;
          ctx.setLineDash([4, 4]);
          if (realDataset) {
            for (const kraj of realDataset.admin.kraje) {
              for (const ring of kraj.rings) {
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.stroke();
              }
            }
          } else {
            for (const line of CZECH_REGION_LINES) {
              ctx.beginPath();
              line.forEach(([lon, lat], i) => {
                const wPt = geoToWorld(lon, lat);
                const sx = wxToSx(wPt.x);
                const sy = wyToSy(wPt.y);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
              ctx.stroke();
            }
          }
          ctx.restore();

          // National Border (Státní hranice ČR)
          ctx.save();
          ctx.beginPath();
          borderWorld.forEach((pt, idx) => {
            const sx = wxToSx(pt.x);
            const sy = wyToSy(pt.y);
            if (idx === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.closePath();
          ctx.lineJoin = 'round';
          ctx.strokeStyle = pal.borderOuter;
          ctx.lineWidth = 4.2;
          ctx.stroke();

          ctx.strokeStyle = pal.borderInner;
          ctx.lineWidth = 1.7;
          ctx.stroke();
          ctx.restore();
        }

        // 6. Hydrology: Reservoirs & Rivers (Real 10m NE + Czech tributaries/reservoirs)
        if (layers.hydrology) {
          if (realDataset) {
            for (const lake of realDataset.vectors.lakes) {
              for (const ring of lake.rings) {
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.fillStyle = pal.waterFill;
                ctx.fill();
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = 1.0;
                ctx.stroke();
              }
            }
          }

          for (const lake of CZECH_LAKES) {
            ctx.beginPath();
            lake.points.forEach(([lon, lat], i) => {
              const wPt = geoToWorld(lon, lat);
              const sx = wxToSx(wPt.x);
              const sy = wyToSy(wPt.y);
              if (i === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            });
            ctx.closePath();
            ctx.fillStyle = pal.waterFill;
            ctx.fill();
            ctx.strokeStyle = pal.waterStroke;
            ctx.lineWidth = 1.1;
            ctx.stroke();

            if (cam.zoom >= 0.0022) {
              const avgLon =
                lake.points.reduce((a, b) => a + b[0], 0) / lake.points.length;
              const avgLat =
                lake.points.reduce((a, b) => a + b[1], 0) / lake.points.length;
              const cPt = geoToWorld(avgLon, avgLat);
              const sx = wxToSx(cPt.x);
              const sy = wyToSy(cPt.y);
              ctx.font = 'italic 500 10px "Plus Jakarta Sans", sans-serif';
              ctx.textAlign = 'center';
              ctx.lineWidth = 2.8;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(lake.name, sx, sy - 8);
              ctx.fillStyle = pal.waterStroke;
              ctx.fillText(lake.name, sx, sy - 8);
            }
          }

          if (realDataset) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const labeledRivers = new Set<string>();
            for (const river of realDataset.vectors.rivers) {
              const wScale = Math.max(1.0, Math.min(3.2, river.w * 2.1));
              for (const line of river.lines) {
                if (line.length < 2) continue;
                ctx.beginPath();
                const sPts: Point2D[] = [];
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  sPts.push({ x: sx, y: sy });
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = Math.max(1.1, wScale * (0.58 + cam.zoom * 165));
                ctx.stroke();
                ctx.strokeStyle = pal.waterFill;
                ctx.lineWidth = Math.max(0.6, wScale * (0.3 + cam.zoom * 95));
                ctx.stroke();

                if (
                  river.name &&
                  !labeledRivers.has(river.name) &&
                  sPts.length >= 4 &&
                  (wScale >= 1.5 || cam.zoom >= 0.0028)
                ) {
                  const mid = Math.floor(sPts.length * 0.5);
                  const pA = sPts[mid];
                  const pB = sPts[Math.min(sPts.length - 1, mid + 1)];
                  if (
                    pA.x > 30 &&
                    pA.x < width - 30 &&
                    pA.y > 30 &&
                    pA.y < height - 30
                  ) {
                    labeledRivers.add(river.name);
                    let ang = Math.atan2(pB.y - pA.y, pB.x - pA.x);
                    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
                    ctx.save();
                    ctx.translate((pA.x + pB.x) / 2, (pA.y + pB.y) / 2 - 6);
                    ctx.rotate(ang);
                    ctx.font =
                      'italic 600 10.5px "Plus Jakarta Sans", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.lineWidth = 2.8;
                    ctx.strokeStyle = pal.textHalo;
                    ctx.strokeText(river.name, 0, 0);
                    ctx.fillStyle = pal.waterStroke;
                    ctx.fillText(river.name, 0, 0);
                    ctx.restore();
                  }
                }
              }
            }
          }

          // Draw supplemental Czech rivers (or all fallback rivers if dataset still loading)
          for (const river of CZECH_RIVERS) {
            if (realDataset && !SUPPLEMENTAL_RIVER_IDS.has(river.id)) continue;
            const sPts = river.points.map(([lon, lat]) => {
              const wPt = geoToWorld(lon, lat);
              return { x: wxToSx(wPt.x), y: wyToSy(wPt.y) };
            });
            drawSmoothPoints(ctx, sPts);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = pal.waterStroke;
            ctx.lineWidth = Math.max(
              1.1,
              river.width * (0.58 + cam.zoom * 165)
            );
            ctx.stroke();
            ctx.strokeStyle = pal.waterFill;
            ctx.lineWidth = Math.max(0.6, river.width * (0.3 + cam.zoom * 95));
            ctx.stroke();

            if (
              (river.width >= 1.7 || cam.zoom >= 0.0028) &&
              sPts.length >= 3
            ) {
              const mid = Math.floor(sPts.length * 0.52);
              const pA = sPts[mid];
              const pB = sPts[Math.min(sPts.length - 1, mid + 1)];
              let ang = Math.atan2(pB.y - pA.y, pB.x - pA.x);
              if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
              ctx.save();
              ctx.translate((pA.x + pB.x) / 2, (pA.y + pB.y) / 2 - 6);
              ctx.rotate(ang);
              ctx.font = 'italic 600 10.5px "Plus Jakarta Sans", sans-serif';
              ctx.textAlign = 'center';
              ctx.lineWidth = 2.8;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(river.name, 0, 0);
              ctx.fillStyle = pal.waterStroke;
              ctx.fillText(river.name, 0, 0);
              ctx.restore();
            }
          }
        }

        // 6b. Real Built-up Urban Footprints (218 urban polygons)
        if (layers.cities) {
          ctx.save();
          ctx.fillStyle = pal.isDark
            ? 'rgba(203, 213, 225, 0.09)'
            : 'rgba(218, 196, 168, 0.18)';
          ctx.strokeStyle = pal.isDark
            ? 'rgba(203, 213, 225, 0.14)'
            : 'rgba(180, 152, 122, 0.14)';
          ctx.lineWidth = 0.5;

          if (realDataset) {
            for (const u of realDataset.vectors.urban) {
              for (const ring of u.rings) {
                ctx.beginPath();
                ring.forEach(([lon, lat], i) => {
                  const wPt = geoToWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              }
            }
          } else {
            for (const area of CZECH_URBAN_AREAS) {
              ctx.beginPath();
              area.points.forEach(([lon, lat], i) => {
                const wPt = geoToWorld(lon, lat);
                const sx = wxToSx(wPt.x);
                const sy = wyToSy(wPt.y);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        // 7a. Real Czech Railway Network (1,822 segments)
        if (layers.railways && realDataset && cam.zoom >= 0.0022) {
          ctx.save();
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'round';
          for (const rail of realDataset.vectors.railways) {
            if (cam.zoom < 0.0036 && rail.rank > 5) continue;
            for (const line of rail.lines) {
              if (line.length < 2) continue;
              ctx.beginPath();
              line.forEach(([lon, lat], i) => {
                const wPt = geoToWorld(lon, lat);
                const sx = wxToSx(wPt.x);
                const sy = wyToSy(wPt.y);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
              });
              ctx.setLineDash([]);
              ctx.strokeStyle = pal.isDark
                ? 'rgba(148, 163, 184, 0.55)'
                : 'rgba(62, 58, 54, 0.58)';
              ctx.lineWidth = cam.zoom >= 0.008 ? 2.1 : 1.4;
              ctx.stroke();

              ctx.setLineDash([5, 5]);
              ctx.strokeStyle = pal.isDark ? '#0F172A' : '#FAF9F5';
              ctx.lineWidth = cam.zoom >= 0.008 ? 1.1 : 0.7;
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        // 7b. Motorways, Secondary Highways & Trunk Roads
        if (layers.highways) {
          if (realDataset) {
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // First pass: regular & secondary roads
            for (const rd of realDataset.vectors.roads) {
              if (rd.type === 'Major Highway' || rd.exp === 1) continue;
              if (cam.zoom < 0.0024 && rd.type === 'Road') continue;
              const isSec = rd.type === 'Secondary Highway';
              for (const line of rd.lines) {
                ctx.beginPath();
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.strokeStyle = pal.isDark
                  ? 'rgba(148, 163, 184, 0.45)'
                  : isSec
                    ? 'rgba(146, 108, 68, 0.65)'
                    : 'rgba(148, 134, 112, 0.42)';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 2.8
                    : 1.8
                  : cam.zoom >= 0.006
                    ? 1.9
                    : 1.1;
                ctx.stroke();

                ctx.strokeStyle = pal.isDark
                  ? '#475569'
                  : isSec
                    ? '#FEF08A'
                    : '#FAF5E4';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 1.4
                    : 0.9
                  : cam.zoom >= 0.006
                    ? 0.95
                    : 0.55;
                ctx.stroke();
              }
            }

            // Second pass: Major Highways / Expressways (Dálnice)
            for (const rd of realDataset.vectors.roads) {
              if (rd.type !== 'Major Highway' && rd.exp !== 1) continue;
              for (const line of rd.lines) {
                ctx.beginPath();
                line.forEach(([lon, lat], i) => {
                  const wPt = geoToWorld(lon, lat);
                  const sx = wxToSx(wPt.x);
                  const sy = wyToSy(wPt.y);
                  if (i === 0) ctx.moveTo(sx, sy);
                  else ctx.lineTo(sx, sy);
                });
                ctx.strokeStyle = pal.highwayCasing;
                ctx.lineWidth = cam.zoom >= 0.004 ? 4.0 : 2.6;
                ctx.stroke();
                ctx.strokeStyle = pal.highwayCore;
                ctx.lineWidth = cam.zoom >= 0.004 ? 1.9 : 1.25;
                ctx.stroke();
              }
            }
            ctx.restore();

            // Draw official route shields (D1, D5, D8, I/13, ...) along major corridors
            if (cam.zoom >= 0.0028) {
              for (const hw of CZECH_HIGHWAYS) {
                if (hw.roadType === 'primary' && cam.zoom < 0.0046) continue;
                const midIdx = Math.floor(hw.points.length * 0.5);
                const [lon, lat] = hw.points[midIdx];
                const wPt = geoToWorld(lon, lat);
                const mx = wxToSx(wPt.x);
                const my = wyToSy(wPt.y);
                if (
                  mx > 30 &&
                  mx < width - 30 &&
                  my > 30 &&
                  my < height - 30
                ) {
                  const isPrimary = hw.roadType === 'primary';
                  const bw = isPrimary ? 28 : 24;
                  const bh = isPrimary ? 13 : 14;
                  ctx.fillStyle = isPrimary ? '#1D4ED8' : pal.highwayBadgeBg;
                  ctx.fillRect(mx - bw / 2, my - bh / 2, bw, bh);
                  ctx.strokeStyle = '#FFFFFF';
                  ctx.lineWidth = 0.85;
                  ctx.strokeRect(mx - bw / 2, my - bh / 2, bw, bh);
                  ctx.fillStyle = '#FFFFFF';
                  ctx.font = `700 ${isPrimary ? '8' : '8.5'}px "JetBrains Mono", monospace`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(hw.code, mx, my + 0.5);
                }
              }
            }
          } else {
            for (const hw of CZECH_HIGHWAYS) {
              if (hw.roadType === 'primary' && cam.zoom < 0.0023) continue;
              const sPts = hw.points.map(([lon, lat]) => {
                const wPt = geoToWorld(lon, lat);
                return { x: wxToSx(wPt.x), y: wyToSy(wPt.y) };
              });
              drawSmoothPoints(ctx, sPts);
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.strokeStyle =
                hw.roadType === 'primary'
                  ? 'rgba(140, 118, 88, 0.55)'
                  : pal.highwayCasing;
              ctx.lineWidth = hw.roadType === 'primary' ? 2.0 : 3.2;
              ctx.stroke();

              drawSmoothPoints(ctx, sPts);
              ctx.strokeStyle =
                hw.roadType === 'primary' ? '#FEF3C7' : pal.highwayCore;
              ctx.lineWidth = hw.roadType === 'primary' ? 1.0 : 1.5;
              ctx.stroke();
            }
          }
        }

        // 8. Cities, Towns & Villages (2,200 real settlements with progressive zoom LOD & spatial decluttering)
        if (layers.cities) {
          const placedCzCities: { x: number; y: number }[] = [];
          const minCzCityDistPx =
            cam.zoom < 0.0022
              ? 60
              : cam.zoom < 0.0038
                ? 52
                : cam.zoom < 0.007
                  ? 44
                  : cam.zoom < 0.014
                    ? 36
                    : cam.zoom < 0.025
                      ? 28
                      : 22;

          if (realDataset) {
            for (const city of realDataset.places.cities) {
              const visibleAtZoom =
                cam.zoom < 0.002
                  ? city.t >= 2 || city.p >= 42000
                  : cam.zoom < 0.0036
                    ? city.t >= 1 || city.p >= 18000
                    : cam.zoom < 0.0065
                      ? city.t >= 1 || city.p >= 7500
                      : cam.zoom < 0.012
                        ? city.p >= 3200
                        : cam.zoom < 0.022
                          ? city.p >= 1200
                          : true;
              if (!visibleAtZoom) continue;

              const wPt = geoToWorld(city.x, city.y);
              const sx = wxToSx(wPt.x);
              const sy = wyToSy(wPt.y);
              if (
                sx < -25 ||
                sx > width + 25 ||
                sy < -25 ||
                sy > height + 25
              )
                continue;

              let tooClose = false;
              for (let i = 0; i < placedCzCities.length; i++) {
                const dx = placedCzCities[i].x - sx;
                const dy = placedCzCities[i].y - sy;
                if (dx * dx + dy * dy < minCzCityDistPx * minCzCityDistPx) {
                  tooClose = true;
                  break;
                }
              }
              if (tooClose) continue;

              const isCap = city.t === 3;
              const isReg = city.t === 2;
              const r = isCap
                ? 5.5
                : isReg
                  ? 4.0
                  : city.p >= 35000
                    ? 3.2
                    : city.p >= 8000
                      ? 2.5
                      : 1.9;

              ctx.font = isCap
                ? '700 13.5px "Outfit", sans-serif'
                : isReg
                  ? '700 11.5px "Plus Jakarta Sans", sans-serif'
                  : city.p >= 15000
                    ? '600 10.5px "Plus Jakarta Sans", sans-serif'
                    : '500 9.5px "Plus Jakarta Sans", sans-serif';
              const tw = ctx.measureText(city.n).width;
              const lx = sx + r + 5;
              const ly = sy;
              if (
                !tryPlaceBox(sx - r - 2, ly - 7, r * 2 + 8 + tw, 14, false)
              ) {
                continue;
              }

              placedCzCities.push({ x: sx, y: sy });

              ctx.beginPath();
              ctx.arc(sx, sy, r, 0, Math.PI * 2);
              ctx.fillStyle = isCap ? '#B91C1C' : pal.cityRing;
              ctx.fill();
              ctx.lineWidth = isCap ? 2 : 1.3;
              ctx.strokeStyle = pal.cityDot;
              ctx.stroke();

              if (isReg) {
                ctx.beginPath();
                ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = pal.cityDot;
                ctx.fill();
              }

              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.2;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(city.n, lx, ly);
              ctx.fillStyle = pal.textPrimary;
              ctx.fillText(city.n, lx, ly);
            }
          } else {
            const sortedCities = [...CZECH_CITIES].sort(
              (a, b) => b.population - a.population
            );

            for (const city of sortedCities) {
              const minPopForZoom =
                cam.zoom < 0.0021
                  ? 44000
                  : cam.zoom < 0.0032
                    ? 24000
                    : 0;
              if (city.population < minPopForZoom && !city.isRegionalSeat)
                continue;

              const wPt = geoToWorld(city.lon, city.lat);
              const sx = wxToSx(wPt.x);
              const sy = wyToSy(wPt.y);
              if (
                sx < -20 ||
                sx > width + 20 ||
                sy < -20 ||
                sy > height + 20
              )
                continue;

              const r = city.isCapital
                ? 5.5
                : city.isRegionalSeat
                  ? 4.0
                  : city.population >= 45000
                    ? 3.2
                    : 2.5;

              ctx.font = city.isCapital
                ? '700 13.5px "Outfit", sans-serif'
                : city.isRegionalSeat
                  ? '700 11.5px "Plus Jakarta Sans", sans-serif'
                  : '500 10.5px "Plus Jakarta Sans", sans-serif';
              const tw = ctx.measureText(city.name).width;
              const lx = sx + r + 5;
              const ly = sy;
              if (
                !tryPlaceBox(sx - r - 2, ly - 7, r * 2 + 8 + tw, 14, false)
              ) {
                continue;
              }

              ctx.beginPath();
              ctx.arc(sx, sy, r, 0, Math.PI * 2);
              ctx.fillStyle = city.isCapital ? '#B91C1C' : pal.cityRing;
              ctx.fill();
              ctx.lineWidth = city.isCapital ? 2 : 1.5;
              ctx.strokeStyle = pal.cityDot;
              ctx.stroke();

              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.4;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(city.name, lx, ly);
              ctx.fillStyle = pal.textPrimary;
              ctx.fillText(city.name, lx, ly);
            }
          }
        }

        // 9. Mountain Peaks (▲) (Progressive zoom LOD & spatial decluttering)
        if (layers.peaks) {
          const placedCzPeaks: { x: number; y: number }[] = [];
          const minCzPeakDistPx =
            cam.zoom < 0.0022
              ? 82
              : cam.zoom < 0.004
                ? 68
                : cam.zoom < 0.0075
                  ? 54
                  : cam.zoom < 0.014
                    ? 42
                    : 28;

          if (realDataset) {
            for (const peak of realDataset.places.peaks) {
              const visibleAtZoom =
                cam.zoom < 0.0022
                  ? peak.e >= 1050 || peak.n === 'Říp'
                  : cam.zoom < 0.0045
                    ? peak.e >= 800 || peak.n === 'Říp'
                    : cam.zoom < 0.01
                      ? peak.e >= 580
                      : true;
              if (!visibleAtZoom) continue;

              const wPt = geoToWorld(peak.x, peak.y);
              const sx = wxToSx(wPt.x);
              const sy = wyToSy(wPt.y);
              if (
                sx < -20 ||
                sx > width + 20 ||
                sy < -20 ||
                sy > height + 20
              )
                continue;

              let tooClose = false;
              for (let i = 0; i < placedCzPeaks.length; i++) {
                const dx = placedCzPeaks[i].x - sx;
                const dy = placedCzPeaks[i].y - sy;
                if (dx * dx + dy * dy < minCzPeakDistPx * minCzPeakDistPx) {
                  tooClose = true;
                  break;
                }
              }
              if (tooClose) continue;

              const label = `${peak.n} ${peak.e}`;
              ctx.font = 'italic 600 9.5px "Plus Jakarta Sans", sans-serif';
              const tw = ctx.measureText(label).width;
              const lx = sx + 6.5;
              const ly = sy + 1;
              if (!tryPlaceBox(sx - 5, ly - 6, tw + 13, 12, false)) continue;

              placedCzPeaks.push({ x: sx, y: sy });

              ctx.beginPath();
              ctx.moveTo(sx, sy - 4.6);
              ctx.lineTo(sx + 4.0, sy + 3.1);
              ctx.lineTo(sx - 4.0, sy + 3.1);
              ctx.closePath();
              ctx.fillStyle = pal.peakColor;
              ctx.strokeStyle = pal.textHalo;
              ctx.lineWidth = 1.45;
              ctx.stroke();
              ctx.fill();

              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 2.8;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(label, lx, ly);
              ctx.fillStyle = pal.peakColor;
              ctx.fillText(label, lx, ly);
            }
          } else {
            const sortedPeaks = [...CZECH_PEAKS].sort(
              (a, b) => b.elevation - a.elevation
            );
            for (const peak of sortedPeaks) {
              if (
                cam.zoom < 0.0022 &&
                peak.elevation < 1000 &&
                peak.id !== 'rip'
              ) {
                continue;
              }
              const wPt = geoToWorld(peak.lon, peak.lat);
              const sx = wxToSx(wPt.x);
              const sy = wyToSy(wPt.y);
              if (
                sx < -20 ||
                sx > width + 20 ||
                sy < -20 ||
                sy > height + 20
              )
                continue;

              ctx.beginPath();
              ctx.moveTo(sx, sy - 5);
              ctx.lineTo(sx + 4.5, sy + 3.5);
              ctx.lineTo(sx - 4.5, sy + 3.5);
              ctx.closePath();
              ctx.fillStyle = pal.peakColor;
              ctx.strokeStyle = pal.textHalo;
              ctx.lineWidth = 1.6;
              ctx.stroke();
              ctx.fill();

              const label = `${peak.name} ${peak.elevation}`;
              ctx.font = 'italic 600 10px "Plus Jakarta Sans", sans-serif';
              const tw = ctx.measureText(label).width;
              const lx = sx + 7;
              const ly = sy + 1;
              if (
                tryPlaceBox(lx - 2, ly - 6, tw + 4, 12, peak.elevation >= 1350)
              ) {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.lineWidth = 3;
                ctx.strokeStyle = pal.textHalo;
                ctx.strokeText(label, lx, ly);
                ctx.fillStyle = pal.peakColor;
                ctx.fillText(label, lx, ly);
              }
            }
          }
        }
      }

      // 10. Imported GPX Tracks & Waypoints (Works seamlessly in both CZ and World scopes!)
      const visibleTracks = gpxTracks.filter(
        (t) => t.visible && t.points.length >= 2
      );
      const sortedTracks = [...visibleTracks].sort((a, b) => {
        if (a.id === activeGpxId) return 1;
        if (b.id === activeGpxId) return -1;
        return 0;
      });

      for (const track of sortedTracks) {
        const isActive = track.id === activeGpxId;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Build path
        ctx.beginPath();
        track.points.forEach((pt, idx) => {
          const wPt = projectGeo(pt.lon, pt.lat);
          const sx = wxToSx(wPt.x);
          const sy = wyToSy(wPt.y);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });

        // Subtle outer glow for active track
        if (isActive) {
          ctx.strokeStyle = 'rgba(28, 36, 32, 0.22)';
          ctx.lineWidth = 9.5;
          ctx.stroke();
        }

        // Crisp white/dark halo casing
        ctx.strokeStyle = pal.isDark ? '#0F172A' : '#FFFFFF';
        ctx.lineWidth = isActive ? 6.2 : 4.8;
        ctx.stroke();

        // Vivid track line
        ctx.strokeStyle = track.color;
        ctx.lineWidth = isActive ? 3.5 : 2.4;
        ctx.stroke();

        // Start (green) & Finish (crimson/track color) markers
        const first = projectGeo(track.points[0].lon, track.points[0].lat);
        const last = projectGeo(
          track.points[track.points.length - 1].lon,
          track.points[track.points.length - 1].lat
        );

        const drawEndpoint = (wPt: Point2D, fill: string, label: string) => {
          const sx = wxToSx(wPt.x);
          const sy = wyToSy(wPt.y);
          ctx.beginPath();
          ctx.arc(sx, sy, isActive ? 5.5 : 4.2, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();
          if (isActive && cam.zoom >= (mapScope === 'world' ? 0.0005 : 0.0025)) {
            ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.strokeStyle = pal.textHalo;
            ctx.strokeText(label, sx + 8, sy);
            ctx.fillStyle = pal.textPrimary;
            ctx.fillText(label, sx + 8, sy);
          }
        };

        drawEndpoint(first, '#16A34A', 'Start');
        drawEndpoint(last, track.color, 'Cíl');

        // Optional GPX <wpt> markers
        for (const wpt of track.waypoints) {
          const wPt = projectGeo(wpt.lon, wpt.lat);
          const sx = wxToSx(wPt.x);
          const sy = wyToSy(wPt.y);
          ctx.beginPath();
          ctx.arc(sx, sy, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = track.color;
          ctx.stroke();

          if (cam.zoom >= (mapScope === 'world' ? 0.0008 : 0.003)) {
            ctx.font = '500 10px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 2.8;
            ctx.strokeStyle = pal.textHalo;
            ctx.strokeText(wpt.name, sx + 7, sy);
            ctx.fillStyle = pal.textPrimary;
            ctx.fillText(wpt.name, sx + 7, sy);
          }
        }

        ctx.restore();
      }

      // 11. GPX Elevation Profile Hover Marker
      if (gpxHoverGeo && !forExport) {
        const wPt = projectGeo(gpxHoverGeo.lon, gpxHoverGeo.lat);
        const sx = wxToSx(wPt.x);
        const sy = wyToSy(wPt.y);
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(28, 36, 32, 0.20)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#1E5631';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
      }

      // 12. Selected Inspection Marker
      if (selectedPoint && !forExport) {
        const wPt = projectGeo(selectedPoint.lon, selectedPoint.lat);
        const sx = wxToSx(wPt.x);
        const sy = wyToSy(wPt.y);

        ctx.beginPath();
        ctx.arc(sx, sy, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(185, 28, 28, 0.18)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#B91C1C';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
      }

      ctx.restore();
      ctx.restore();
    },
    [
      mapScope,
      activeWidth,
      activeHeight,
      projectGeo,
      stylePreset,
      activeTerrainRaster,
      localPatch,
      realDataset,
      worldDataset,
      worldPlacesIndex,
      blockRevision,
      borderWorld,
      layers,
      terrain.contours,
      worldTerrain.contours,
      selectedPoint,
      gpxTracks,
      activeGpxId,
      gpxHoverGeo,
    ]
  );

  // Redraw canvas on state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = viewportSize.width;
    const h = viewportSize.height;
    if (w === 0 || h === 0) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    renderMap(ctx, w, h, camera);
    ctx.restore();
  }, [viewportSize, camera, renderMap]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () =>
        setCamera((c) => ({ ...c, zoom: Math.min(maxZoom, c.zoom * 1.35) })),
      zoomOut: () =>
        setCamera((c) => ({ ...c, zoom: Math.max(minZoom, c.zoom / 1.35) })),
      resetView: () =>
        setCamera({
          cx: activeWidth * 0.5,
          cy: activeHeight * 0.49,
          zoom: fitZoom,
        }),
      focusGeo: (lon: number, lat: number, targetZoom?: number) => {
        const wPt = projectGeo(lon, lat);
        const defaultZoom = mapScope === 'world' ? 0.00025 : 0.0065;
        setCamera((c) => ({
          cx: wPt.x,
          cy: wPt.y,
          zoom: targetZoom ?? Math.max(c.zoom, defaultZoom),
        }));
      },
      fitGeoBounds: (bounds) => {
        const topLeft = projectGeo(bounds.minLon, bounds.maxLat);
        const botRight = projectGeo(bounds.maxLon, bounds.minLat);
        const bw = Math.max(4000, botRight.x - topLeft.x);
        const bh = Math.max(3000, botRight.y - topLeft.y);
        const zx = (viewportSize.width * 0.72) / bw;
        const zy = (viewportSize.height * 0.66) / bh;
        const nextZoom = Math.max(
          minZoom,
          Math.min(maxZoom, Math.min(zx, zy))
        );
        setCamera({
          cx: (topLeft.x + botRight.x) * 0.5,
          cy: (topLeft.y + botRight.y) * 0.5,
          zoom: nextZoom,
        });
      },
      exportPng: () => {
        const outW = 2400;
        const outH = 1560;
        const off = document.createElement('canvas');
        off.width = outW;
        off.height = outH;
        const ctx = off.getContext('2d')!;
        const mapZoom = (outW * 0.94) / activeWidth;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, outW, 1440);
        ctx.clip();
        renderMap(
          ctx,
          outW,
          1440,
          {
            cx: activeWidth * 0.5,
            cy: activeHeight * 0.49,
            zoom: mapZoom,
          },
          true
        );
        ctx.restore();

        // Footer cartouche
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 1440, outW, 120);
        ctx.strokeStyle = '#D6D3C9';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 1440);
        ctx.lineTo(outW, 1440);
        ctx.stroke();

        ctx.fillStyle = '#1A1F1C';
        ctx.font = '700 32px "Outfit", sans-serif';
        ctx.fillText(
          mapScope === 'world'
            ? 'Fyzická a batymetrická mapa světa — Kartografický atlas'
            : 'Česká republika — Topografický mapový podklad',
          48,
          1492
        );

        ctx.fillStyle = '#545E58';
        ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(
          mapScope === 'world'
            ? 'Globální reliéf a batymetrie oceánů · 240 států · Vodní síť · Světové metropole a velehorstva · WGS84'
            : 'Reliéfní hypsometrie · Stínovaný terén · Vodní síť · Silniční tahy · Vrstevnice 10–200 m · WGS84',
          48,
          1528
        );

        const sb = pickScaleBar(mapZoom);
        const sbX = outW - sb.px - 60;
        ctx.fillStyle = '#1A1F1C';
        ctx.fillRect(sbX, 1510, sb.px, 7);
        ctx.font = '500 18px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(sb.label, outW - 60, 1496);

        const url = off.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download =
          mapScope === 'world'
            ? `mapa-sveta-${stylePreset}.png`
            : `mapovy-podklad-cr-${stylePreset}.png`;
        a.click();
      },
    }),
    [
      mapScope,
      activeWidth,
      activeHeight,
      minZoom,
      maxZoom,
      projectGeo,
      fitZoom,
      renderMap,
      stylePreset,
      viewportSize,
    ]
  );

  const activeTileZ =
    mapScope === 'world'
      ? worldDataset?.dem
        ? pickWorldTerrariumZoom(camera.zoom)
        : undefined
      : realDataset?.dem && camera.zoom >= 0.0045
        ? pickTerrariumZoom(camera.zoom)
        : undefined;

  const findNearestFeature = useCallback(
    (wx: number, wy: number): SelectedMapPoint | null => {
      const hitRadius = 15 / camera.zoom;
      let bestDist = hitRadius;
      let bestPoint: SelectedMapPoint | null = null;

      if (mapScope === 'world') {
        if (!worldDataset) return null;
        const isDetailScale = camera.zoom >= DETAIL_WORLD_ZOOM;
        const clickGeo = globalWorldToGeo(wx, wy);

        if (isDetailScale && worldPlacesIndex) {
          for (const city of worldPlacesIndex.cities) {
            if (
              Math.abs(city.x - clickGeo.lon) > 2.5 ||
              Math.abs(city.y - clickGeo.lat) > 2.5
            ) {
              continue;
            }
            const pt = geoToGlobalWorld(city.x, city.y);
            const d = Math.hypot(wx - pt.x, wy - pt.y);
            if (d < bestDist) {
              bestDist = d;
              bestPoint = {
                title: city.n,
                subtitle: `${
                  city.t === 2
                    ? 'Hlavní město'
                    : city.t === 1
                      ? 'Regionální metropole'
                      : 'Město'
                } · ${city.a ? `${city.a}, ` : ''}${city.c}${
                  city.p > 0
                    ? ` · ${city.p.toLocaleString('cs-CZ')} obyv.`
                    : ''
                }`,
                lon: city.x,
                lat: city.y,
                elevation: Math.max(
                  0,
                  Math.round(
                    sampleGlobalElevation(
                      worldTerrain,
                      pt.x,
                      pt.y,
                      worldDataset.dem,
                      activeTileZ,
                      realDataset?.dem
                    )
                  )
                ),
                kind: 'city',
              };
            }
          }

          for (const peak of worldPlacesIndex.peaks) {
            if (
              Math.abs(peak.x - clickGeo.lon) > 2.5 ||
              Math.abs(peak.y - clickGeo.lat) > 2.5
            ) {
              continue;
            }
            const pt = geoToGlobalWorld(peak.x, peak.y);
            const d = Math.hypot(wx - pt.x, wy - pt.y);
            if (d < bestDist) {
              bestDist = d;
              bestPoint = {
                title: peak.n,
                subtitle: `Světový vrchol${peak.r ? ` (${peak.r})` : ''} · ${peak.e.toLocaleString('cs-CZ')} m n. m.`,
                lon: peak.x,
                lat: peak.y,
                elevation: peak.e,
                kind: 'peak',
              };
            }
          }
        }

        for (const city of worldDataset.cities) {
          const pt = geoToGlobalWorld(city.x, city.y);
          const d = Math.hypot(wx - pt.x, wy - pt.y);
          if (d < bestDist) {
            bestDist = d;
            bestPoint = {
              title: city.n,
              subtitle: `${city.cap ? 'Hlavní město' : 'Světová metropole'} · ${city.c}${
                city.p > 0
                  ? ` · ${(city.p / 1_000_000).toFixed(1)} mil. obyv.`
                  : ''
              }`,
              lon: city.x,
              lat: city.y,
              elevation: Math.max(
                0,
                Math.round(
                  sampleGlobalElevation(
                    worldTerrain,
                    pt.x,
                    pt.y,
                    worldDataset.dem,
                    activeTileZ,
                    realDataset?.dem
                  )
                )
              ),
              kind: 'city',
            };
          }
        }

        for (const peak of worldDataset.peaks) {
          const pt = geoToGlobalWorld(peak.x, peak.y);
          const d = Math.hypot(wx - pt.x, wy - pt.y);
          if (d < bestDist) {
            bestDist = d;
            bestPoint = {
              title: peak.n,
              subtitle: `Světový vrchol${peak.r ? ` (${peak.r})` : ''} · ${peak.e.toLocaleString('cs-CZ')} m n. m.`,
              lon: peak.x,
              lat: peak.y,
              elevation: peak.e,
              kind: 'peak',
            };
          }
        }

        if (isDetailScale && realDataset) {
          for (const city of realDataset.places.cities) {
            const pt = geoToGlobalWorld(city.x, city.y);
            const d = Math.hypot(wx - pt.x, wy - pt.y);
            if (d < bestDist) {
              bestDist = d;
              const kraj = ADMIN1_KRAJ[city.a] || 'Česká republika';
              bestPoint = {
                title: city.n,
                subtitle:
                  city.p > 0
                    ? `${kraj} · ${city.p.toLocaleString('cs-CZ')} obyv.`
                    : kraj,
                lon: city.x,
                lat: city.y,
                elevation:
                  city.e > 0
                    ? city.e
                    : Math.round(
                        sampleGlobalElevation(
                          worldTerrain,
                          pt.x,
                          pt.y,
                          worldDataset.dem,
                          activeTileZ,
                          realDataset.dem
                        )
                      ),
                kind: 'city',
              };
            }
          }
          for (const peak of realDataset.places.peaks) {
            const pt = geoToGlobalWorld(peak.x, peak.y);
            const d = Math.hypot(wx - pt.x, wy - pt.y);
            if (d < bestDist) {
              bestDist = d;
              bestPoint = {
                title: peak.n,
                subtitle: `Vrchol ČR · ${peak.e} m n. m.`,
                lon: peak.x,
                lat: peak.y,
                elevation: peak.e,
                kind: 'peak',
              };
            }
          }
        }
        return bestPoint;
      }

      if (realDataset) {
        for (const city of realDataset.places.cities) {
          const pt = geoToWorld(city.x, city.y);
          const d = Math.hypot(wx - pt.x, wy - pt.y);
          if (d < bestDist) {
            bestDist = d;
            const kraj = ADMIN1_KRAJ[city.a] || 'Česká republika';
            bestPoint = {
              title: city.n,
              subtitle:
                city.p > 0
                  ? `${kraj} · ${city.p.toLocaleString('cs-CZ')} obyv.`
                  : kraj,
              lon: city.x,
              lat: city.y,
              elevation:
                city.e > 0
                  ? city.e
                  : Math.round(
                      sampleCzechElevation(
                        terrain,
                        pt.x,
                        pt.y,
                        realDataset.dem,
                        activeTileZ
                      )
                    ),
              kind: 'city',
            };
          }
        }

        for (const peak of realDataset.places.peaks) {
          const pt = geoToWorld(peak.x, peak.y);
          const d = Math.hypot(wx - pt.x, wy - pt.y);
          if (d < bestDist) {
            bestDist = d;
            bestPoint = {
              title: peak.n,
              subtitle: `Vrchol · ${peak.e} m n. m.`,
              lon: peak.x,
              lat: peak.y,
              elevation: peak.e,
              kind: 'peak',
            };
          }
        }
      } else {
        for (const city of CZECH_CITIES) {
          const pt = geoToWorld(city.lon, city.lat);
          const d = Math.hypot(wx - pt.x, wy - pt.y);
          if (d < bestDist) {
            bestDist = d;
            bestPoint = {
              title: city.name,
              subtitle: `${city.region} kraj · ${city.population.toLocaleString('cs-CZ')} obyv.`,
              lon: city.lon,
              lat: city.lat,
              elevation: Math.round(sampleCzechElevation(terrain, pt.x, pt.y)),
              kind: 'city',
            };
          }
        }

        for (const peak of CZECH_PEAKS) {
          const pt = geoToWorld(peak.lon, peak.lat);
          const d = Math.hypot(wx - pt.x, wy - pt.y);
          if (d < bestDist) {
            bestDist = d;
            bestPoint = {
              title: peak.name,
              subtitle: `Vrchol · ${peak.range}`,
              lon: peak.lon,
              lat: peak.lat,
              elevation: peak.elevation,
              kind: 'peak',
            };
          }
        }
      }

      return bestPoint;
    },
    [
      mapScope,
      camera.zoom,
      terrain,
      worldTerrain,
      realDataset,
      worldDataset,
      worldPlacesIndex,
      activeTileZ,
    ]
  );

  const findNearestGpxTrack = useCallback(
    (wx: number, wy: number): string | null => {
      const hitDist = 11 / camera.zoom;
      let bestId: string | null = null;
      let bestD = hitDist;
      for (const track of gpxTracks) {
        if (!track.visible || track.points.length < 2) continue;
        const step = Math.max(1, Math.floor(track.points.length / 600));
        for (let i = 0; i < track.points.length - step; i += step) {
          const a = projectGeo(track.points[i].lon, track.points[i].lat);
          const nextIdx = Math.min(track.points.length - 1, i + step);
          const b = projectGeo(
            track.points[nextIdx].lon,
            track.points[nextIdx].lat
          );
          const d = pointToSegmentDistWorld(wx, wy, a.x, a.y, b.x, b.y);
          if (d < bestD) {
            bestD = d;
            bestId = track.id;
          }
        }
      }
      return bestId;
    },
    [camera.zoom, gpxTracks, projectGeo]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startCx: camera.cx,
      startCy: camera.cy,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wPt = screenToWorld(sx, sy);

    if (
      wPt.x >= 0 &&
      wPt.x <= activeWidth &&
      wPt.y >= 0 &&
      wPt.y <= activeHeight
    ) {
      setCursorWorld(wPt);
    } else {
      setCursorWorld(null);
    }

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        dragRef.current.moved = true;
      }
      if (dragRef.current.moved) {
        setCamera((c) => ({
          ...c,
          cx: dragRef.current.startCx - dx / c.zoom,
          cy: dragRef.current.startCy - dy / c.zoom,
        }));
      }
    } else {
      const hit = findNearestFeature(wPt.x, wPt.y);
      const hitGpx = !hit ? findNearestGpxTrack(wPt.x, wPt.y) : null;
      setHoveredEntity(hit?.title ?? hitGpx);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;

    if (!wasMoved) {
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wPt = screenToWorld(sx, sy);

      const hit = findNearestFeature(wPt.x, wPt.y);
      if (hit) {
        onSelectPoint(hit);
        return;
      }

      const hitGpx = findNearestGpxTrack(wPt.x, wPt.y);
      if (hitGpx) {
        onSelectGpxTrack(hitGpx);
        onSelectPoint(null);
        return;
      }

      if (
        wPt.x >= 0 &&
        wPt.x <= activeWidth &&
        wPt.y >= 0 &&
        wPt.y <= activeHeight
      ) {
        const geo = unprojectWorld(wPt.x, wPt.y);
        if (mapScope === 'world') {
          const elev = Math.round(
            sampleGlobalElevation(
              worldTerrain,
              wPt.x,
              wPt.y,
              worldDataset?.dem,
              activeTileZ,
              realDataset?.dem
            )
          );
          const hitCountry = worldDataset?.countries.find(
            (c) =>
              (!c.b ||
                (geo.lon >= c.b[0] &&
                  geo.lon <= c.b[2] &&
                  geo.lat >= c.b[1] &&
                  geo.lat <= c.b[3])) &&
              c.rings.some((ring) => pointInGeoRing(geo.lon, geo.lat, ring))
          );
          if (hitCountry) {
            onSelectPoint({
              title: hitCountry.n,
              subtitle: `Stát (${hitCountry.iso})${
                hitCountry.p > 0
                  ? ` · ${(hitCountry.p / 1_000_000).toFixed(1)} mil. obyv.`
                  : ''
              }`,
              lon: geo.lon,
              lat: geo.lat,
              elevation: elev,
              kind: 'country',
            });
          } else {
            onSelectPoint({
              title: elev < 0 ? 'Světový oceán (batymetrie)' : 'Terénní bod na Zemi',
              subtitle:
                elev < 0
                  ? `Hloubka oceánu ${Math.abs(elev).toLocaleString('cs-CZ')} m`
                  : 'Globální digitální model terénu SRTM / ETOPO',
              lon: geo.lon,
              lat: geo.lat,
              elevation: elev,
              kind: 'terrain',
            });
          }
        } else {
          const elev = Math.round(
            sampleCzechElevation(
              terrain,
              wPt.x,
              wPt.y,
              realDataset?.dem,
              activeTileZ
            )
          );
          const inside = isInsideCzechia(
            geo.lon,
            geo.lat,
            realDataset?.admin.border
          );
          onSelectPoint({
            title: inside ? 'Terénní bod v ČR' : 'Okolní území mimo ČR',
            subtitle: realDataset?.dem
              ? 'Digitální model terénu SRTM / EU-DEM'
              : 'Digitální model terénu',
            lon: geo.lon,
            lat: geo.lat,
            elevation: elev,
            kind: 'terrain',
          });
        }
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;

    setCamera((c) => {
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, c.zoom * factor));
      const wx = c.cx + (sx - viewportSize.width / 2) / c.zoom;
      const wy = c.cy + (sy - viewportSize.height / 2) / c.zoom;
      return {
        zoom: nextZoom,
        cx: wx - (sx - viewportSize.width / 2) / nextZoom,
        cy: wy - (sy - viewportSize.height / 2) / nextZoom,
      };
    });
  };

  const scaleBar = useMemo(() => pickScaleBar(camera.zoom), [camera.zoom]);

  const cursorInfo = useMemo(() => {
    if (!cursorWorld) return null;
    const geo = unprojectWorld(cursorWorld.x, cursorWorld.y);
    const elev =
      mapScope === 'world'
        ? Math.round(
            sampleGlobalElevation(
              worldTerrain,
              cursorWorld.x,
              cursorWorld.y,
              worldDataset?.dem,
              activeTileZ,
              realDataset?.dem
            )
          )
        : Math.round(
            sampleCzechElevation(
              terrain,
              cursorWorld.x,
              cursorWorld.y,
              realDataset?.dem,
              activeTileZ
            )
          );
    return {
      elev,
      lat: geo.lat,
      lon: geo.lon,
    };
  }, [
    mapScope,
    cursorWorld,
    unprojectWorld,
    terrain,
    worldTerrain,
    realDataset,
    worldDataset,
    activeTileZ,
    tileRevision,
  ]);

  // Approximate cartographic scale ratio (assuming 96 DPI ~ 3780 px/m)
  const scaleRatio = Math.round(3780 / camera.zoom);

  const activeBlockBadge = useMemo(() => {
    if (mapScope !== 'world') return null;
    if (camera.zoom < DETAIL_WORLD_ZOOM) {
      return '· Detailní bloky od 1 : 3 000 000';
    }
    const tl = globalWorldToGeo(
      camera.cx - (viewportSize.width * 0.56) / camera.zoom,
      camera.cy - (viewportSize.height * 0.56) / camera.zoom
    );
    const br = globalWorldToGeo(
      camera.cx + (viewportSize.width * 0.56) / camera.zoom,
      camera.cy + (viewportSize.height * 0.56) / camera.zoom
    );
    const { loadedBlocks, activeMetas, loadingCount } =
      ensureWorldDetailBlocksForViewport(
        worldPlacesIndex,
        Math.min(tl.lon, br.lon),
        Math.max(tl.lon, br.lon),
        Math.min(tl.lat, br.lat),
        Math.max(tl.lat, br.lat),
        () => setBlockRevision((v) => v + 1),
        1.8
      );
    const primaryCode = activeMetas[0]?.code ?? 'OCEÁN';
    if (loadingCount > 0) {
      return `· Načítání bloku ${primaryCode} (${loadedBlocks.length}/${activeMetas.length})`;
    }
    return `· Blok ${primaryCode}${
      activeMetas.length > 1 ? ` +${activeMetas.length - 1} okolí` : ''
    } (10m detail)`;
  }, [
    mapScope,
    camera.cx,
    camera.cy,
    camera.zoom,
    viewportSize.width,
    viewportSize.height,
    worldPlacesIndex,
    blockRevision,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-[#E6E3D9]"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          dragRef.current.active = false;
          setCursorWorld(null);
          setHoveredEntity(null);
        }}
        onWheel={handleWheel}
        style={{
          cursor: hoveredEntity
            ? 'pointer'
            : dragRef.current.active
              ? 'grabbing'
              : 'grab',
        }}
        className="block w-full h-full touch-none"
      />

      {/* Top-right Navigation Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-1.5 z-10">
        <div className="flex flex-col bg-white/95 backdrop-blur-sm border border-[#1C2420]/12 rounded-lg shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() =>
              setCamera((c) => ({
                ...c,
                zoom: Math.min(maxZoom, c.zoom * 1.35),
              }))
            }
            title="Přiblížit"
            aria-label="Přiblížit mapu"
            className="w-10 h-10 flex items-center justify-center text-[#1C2420] hover:bg-[#F2F0E8] transition-colors border-b border-[#1C2420]/10"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCamera((c) => ({
                ...c,
                zoom: Math.max(minZoom, c.zoom / 1.35),
              }))
            }
            title="Oddálit"
            aria-label="Oddálit mapu"
            className="w-10 h-10 flex items-center justify-center text-[#1C2420] hover:bg-[#F2F0E8] transition-colors border-b border-[#1C2420]/10"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCamera({
                cx: activeWidth * 0.5,
                cy: activeHeight * 0.49,
                zoom: fitZoom,
              })
            }
            title={
              mapScope === 'world' ? 'Zobrazit celý svět' : 'Zobrazit celou ČR'
            }
            aria-label={
              mapScope === 'world' ? 'Zobrazit celý svět' : 'Zobrazit celou ČR'
            }
            className="w-10 h-10 flex items-center justify-center text-[#1C2420] hover:bg-[#F2F0E8] transition-colors"
          >
            <LocateFixed className="w-4 h-4" />
          </button>
        </div>

        <div
          title="Sever"
          className="w-10 h-10 bg-white/95 backdrop-blur-sm border border-[#1C2420]/12 rounded-lg shadow-sm flex flex-col items-center justify-center text-[#1C2420]"
        >
          <Compass className="w-4 h-4 text-[#B91C1C]" />
          <span className="text-[9px] font-bold leading-none mt-0.5">S</span>
        </div>
      </div>

      {/* Bottom-left Scale Bar & Live Coordinates / Elevation */}
      <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
        <div className="bg-white/94 backdrop-blur-sm border border-[#1C2420]/14 rounded-md px-3 py-1.5 shadow-sm flex flex-wrap items-center gap-3">
          <div className="flex flex-col">
            <div className="flex justify-between text-[10px] font-mono-tabular text-[#4A5A50] leading-none mb-1">
              <span>0</span>
              <span>{scaleBar.label}</span>
            </div>
            <div
              style={{ width: `${Math.round(scaleBar.px)}px` }}
              className="h-1.5 flex border border-[#1C2420]"
            >
              <div className="w-1/2 h-full bg-[#1C2420]" />
              <div className="w-1/2 h-full bg-white" />
            </div>
          </div>

          <div className="border-l border-[#1C2420]/12 pl-3 text-[11px] font-mono-tabular text-[#4A5A50] whitespace-nowrap">
            <span>1 : {scaleRatio.toLocaleString('cs-CZ')}</span>
            {activeBlockBadge && (
              <span className="ml-2 text-[#1E5631] font-semibold">
                {activeBlockBadge}
              </span>
            )}
          </div>

          {cursorInfo && (
            <div className="border-l border-[#1C2420]/12 pl-3 text-[11px] font-mono-tabular text-[#1C2420] whitespace-nowrap">
              <span className="font-semibold">
                {cursorInfo.elev.toLocaleString('cs-CZ')} m n. m.
              </span>
              <span className="text-[#5B6760] mx-1.5" aria-hidden="true">
                ·
              </span>
              <span className="text-[#4A5A50]">
                {Math.abs(cursorInfo.lat).toFixed(4)}°{' '}
                {cursorInfo.lat >= 0 ? 'N' : 'S'},{' '}
                {Math.abs(cursorInfo.lon).toFixed(4)}°{' '}
                {cursorInfo.lon >= 0 ? 'E' : 'W'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
