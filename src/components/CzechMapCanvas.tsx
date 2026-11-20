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
  getIntersectingWorldBlocks,
  pickTerrariumZoom,
  pickWorldTerrariumZoom,
} from '../engine/realCzechData';
import {
  buildOsmRenderOptions,
  ensureOsmVectorTilesForViewport,
} from '../engine/osmVectorTiles';
import {
  OsmRenderContext,
  renderOsmBaseBitmaps,
  renderOsmOverlayBitmaps,
  renderOsmTransportLabels,
  renderOsmWaterLabels,
} from '../engine/osmCanvasRenderer';
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

interface FixedZoomLevel {
  level: number;
  zoom: number;
  label: string;
  osmZ: number | null; // null = global overview (no OSM tiles needed)
}

const WORLD_FIXED_LEVELS_BASE: Omit<FixedZoomLevel, 'level'>[] = [
  { zoom: 0.000028, label: 'Celý svět', osmZ: null },
  { zoom: 0.000055, label: 'Kontinenty', osmZ: null },
  { zoom: 0.00011, label: 'Velké oblasti', osmZ: null },
  { zoom: 0.00024, label: 'Státy', osmZ: null },
  { zoom: 0.00055, label: 'Části kontinentů', osmZ: null },
  { zoom: 0.00145, label: 'Regiony · Detail', osmZ: 7 },
  { zoom: 0.0029, label: 'Kraje a pohoří', osmZ: 8 },
  { zoom: 0.0058, label: 'Okresy', osmZ: 9 },
  { zoom: 0.0116, label: 'Silniční síť', osmZ: 10 },
  { zoom: 0.0235, label: 'Města a obce', osmZ: 11 },
  { zoom: 0.047, label: 'Turistický detail', osmZ: 12 },
  { zoom: 0.094, label: 'Ulice a toky', osmZ: 13 },
  { zoom: 0.188, label: 'Budovy a ulice', osmZ: 14 },
];

const CZ_FIXED_LEVELS_BASE: Omit<FixedZoomLevel, 'level'>[] = [
  { zoom: 0.0022, label: 'Celá ČR', osmZ: 8 },
  { zoom: 0.0046, label: 'Čechy / Morava', osmZ: 8 },
  { zoom: 0.0092, label: 'Kraje', osmZ: 9 },
  { zoom: 0.0185, label: 'Okresy a pohoří', osmZ: 10 },
  { zoom: 0.037, label: 'Města a silnice', osmZ: 11 },
  { zoom: 0.074, label: 'Obce a toky', osmZ: 12 },
  { zoom: 0.148, label: 'Turistický detail', osmZ: 13 },
  { zoom: 0.296, label: 'Ulice a budovy', osmZ: 14 },
];

function buildFixedZoomLevels(
  scope: MapScope,
  fitZoom: number
): FixedZoomLevel[] {
  const base =
    scope === 'world' ? WORLD_FIXED_LEVELS_BASE : CZ_FIXED_LEVELS_BASE;
  return base.map((item, idx) => ({
    level: idx + 1,
    zoom: idx === 0 ? Math.max(fitZoom, scope === 'world' ? 0.000018 : 0.0008) : item.zoom,
    label: item.label,
    osmZ: item.osmZ,
  }));
}

function findNearestZoomIndex(
  levels: FixedZoomLevel[],
  targetZoom: number
): number {
  let bestIdx = 0;
  let bestDiff = Infinity;
  const logTarget = Math.log(Math.max(1e-7, targetZoom));
  for (let i = 0; i < levels.length; i++) {
    const diff = Math.abs(Math.log(levels[i].zoom) - logTarget);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

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
  onEnterDetailScale?: (overlapsCz: boolean) => void;
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
    bg: '#F3F2E9',
    outsideVeil: 'rgba(243, 242, 233, 0.56)',
    hillshadeStrength: 0.27,
    forestColor: [188, 220, 158],
    forestOpacity: 0.64,
    contourMinor: 'rgba(164, 146, 122, 0.24)',
    contourIndex: 'rgba(138, 116, 90, 0.44)',
    contourHalo: '#F3F2E9',
    waterFill: '#8EC0E8',
    waterStroke: '#66A2D4',
    borderOuter: 'rgba(116, 120, 114, 0.34)',
    borderInner: 'rgba(34, 38, 34, 0.92)',
    regionBorder: 'rgba(84, 88, 84, 0.38)',
    highwayCasing: 'rgba(42, 118, 48, 0.92)',
    highwayCore: '#58BC5E',
    highwayBadgeBg: '#3A9642',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(60, 72, 68, 0.11)',
    gridText: 'rgba(60, 72, 68, 0.56)',
    textPrimary: '#1F2421',
    textSecondary: '#4A544E',
    textHalo: 'rgba(255, 255, 255, 0.95)',
    cityDot: '#7A5A3C',
    cityRing: '#F5A65B',
    peakColor: '#3A332C',
    isDark: false,
  },
  natural: {
    bg: '#F0EFE5',
    outsideVeil: 'rgba(240, 239, 229, 0.56)',
    hillshadeStrength: 0.34,
    forestColor: [176, 212, 146],
    forestOpacity: 0.68,
    contourMinor: 'rgba(154, 134, 108, 0.24)',
    contourIndex: 'rgba(128, 104, 78, 0.45)',
    contourHalo: '#F0EFE5',
    waterFill: '#86B8E2',
    waterStroke: '#5E9ACC',
    borderOuter: 'rgba(110, 114, 108, 0.34)',
    borderInner: 'rgba(30, 34, 30, 0.92)',
    regionBorder: 'rgba(80, 84, 80, 0.38)',
    highwayCasing: 'rgba(40, 114, 46, 0.92)',
    highwayCore: '#54B65A',
    highwayBadgeBg: '#389240',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(48, 60, 54, 0.12)',
    gridText: 'rgba(48, 60, 54, 0.58)',
    textPrimary: '#1D221F',
    textSecondary: '#455049',
    textHalo: 'rgba(255, 255, 255, 0.94)',
    cityDot: '#755638',
    cityRing: '#F2A052',
    peakColor: '#322B24',
    isDark: false,
  },
  light: {
    bg: '#F8F7F2',
    outsideVeil: 'rgba(248, 247, 242, 0.64)',
    hillshadeStrength: 0.21,
    forestColor: [200, 226, 174],
    forestOpacity: 0.54,
    contourMinor: 'rgba(168, 152, 132, 0.18)',
    contourIndex: 'rgba(142, 124, 102, 0.36)',
    contourHalo: '#F8F7F2',
    waterFill: '#A4CEF0',
    waterStroke: '#78B0DE',
    borderOuter: 'rgba(124, 128, 122, 0.30)',
    borderInner: 'rgba(42, 46, 42, 0.88)',
    regionBorder: 'rgba(92, 96, 92, 0.34)',
    highwayCasing: 'rgba(48, 124, 54, 0.88)',
    highwayCore: '#64C26A',
    highwayBadgeBg: '#3E9B47',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(40, 52, 48, 0.09)',
    gridText: 'rgba(72, 82, 78, 0.54)',
    textPrimary: '#222725',
    textSecondary: '#58625D',
    textHalo: 'rgba(255, 255, 255, 0.96)',
    cityDot: '#7D5E40',
    cityRing: '#F6AC66',
    peakColor: '#423B35',
    isDark: false,
  },
  dark: {
    bg: '#161D24',
    outsideVeil: 'rgba(18, 24, 30, 0.68)',
    hillshadeStrength: 0.36,
    forestColor: [46, 86, 58],
    forestOpacity: 0.46,
    contourMinor: 'rgba(148, 163, 184, 0.12)',
    contourIndex: 'rgba(148, 163, 184, 0.26)',
    contourHalo: '#1D272E',
    waterFill: '#244A68',
    waterStroke: '#487CA6',
    borderOuter: 'rgba(0, 0, 0, 0.28)',
    borderInner: 'rgba(148, 163, 184, 0.55)',
    regionBorder: 'rgba(148, 163, 184, 0.24)',
    highwayCasing: 'rgba(34, 98, 44, 0.88)',
    highwayCore: '#469E50',
    highwayBadgeBg: '#34823C',
    highwayBadgeText: '#FFFFFF',
    gridStroke: 'rgba(203, 213, 225, 0.09)',
    gridText: 'rgba(148, 163, 184, 0.65)',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textHalo: 'rgba(20, 27, 34, 0.90)',
    cityDot: '#9A6B3E',
    cityRing: '#E09248',
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

// Smooth cubic Hermite interpolation across elevation stops so transitions between elevation bands are silky-smooth without flat plateaus or harsh band edges
function evaluateSmoothColorStops(
  elev: number,
  stops: readonly [number, [number, number, number]][]
): [number, number, number] {
  if (elev <= stops[0][0]) return stops[0][1];
  const lastIdx = stops.length - 1;
  if (elev >= stops[lastIdx][0]) return stops[lastIdx][1];
  for (let i = 0; i < lastIdx; i++) {
    const [e0, c0] = stops[i];
    const [e1, c1] = stops[i + 1];
    if (elev <= e1) {
      const u = Math.max(0, Math.min(1, (elev - e0) / (e1 - e0)));
      // Blend 65% smoothstep + 35% linear for natural gradations without plateau banding
      const s = u * u * (3 - 2 * u);
      const t = u * 0.35 + s * 0.65;
      return lerpRgb(c0, c1, t);
    }
  }
  return stops[lastIdx][1];
}

// Bright, high-luminance Mapy.com base terrain ramp for Czechia (115 m .. 1603 m)
// Keeps open non-forested land bright warm-ivory/cream so pastel green forests, golden roads, green motorways, and azure rivers pop clearly
const CZ_ATLAS_STOPS: readonly [number, [number, number, number]][] = [
  [115, [240, 243, 231]], // Lowest Elbe / Morava river gates (bright valley ivory-sage)
  [175, [242, 243, 232]], // River floodplains & basins (Polabí, Dyjskosvratecký úval)
  [235, [244, 243, 233]], // Lowland plains
  [305, [244, 242, 231]], // Lower agricultural tablelands
  [385, [243, 240, 228]], // Rolling hills (Středočeská pahorkatina)
  [475, [241, 238, 225]], // Lower highlands
  [575, [239, 235, 221]], // Českomoravská vrchovina (Vysočina)
  [690, [237, 233, 217]], // Upper highlands & sub-mountain foothills
  [820, [234, 230, 214]], // Lower mountain slopes (Šumava, Krušné hory)
  [970, [231, 226, 210]], // Mid-mountain ridges
  [1140, [228, 223, 207]], // High mountain massifs (Jeseníky, Beskydy)
  [1340, [226, 222, 207]], // Subalpine ridges (Krkonoše, Hrubý Jeseník)
  [1603, [234, 231, 218]], // Sunlit alpine summits (Sněžka 1603 m, Praděd 1491 m)
];

function hypsometricAtlasColor(elev: number): [number, number, number] {
  return evaluateSmoothColorStops(elev, CZ_ATLAS_STOPS);
}

const CZ_NATURAL_STOPS: readonly [number, [number, number, number]][] = [
  [115, [234, 240, 223]], // Lush alluvial valleys
  [185, [237, 241, 226]], // Lowland basins
  [260, [240, 241, 228]], // Fertile plains
  [350, [241, 239, 226]], // Rolling countryside
  [460, [239, 236, 222]], // Lower highlands
  [580, [236, 232, 217]], // Uplands
  [720, [233, 228, 212]], // Foothills
  [880, [229, 224, 207]], // Mountain slopes
  [1060, [226, 220, 203]], // Upper montane zone
  [1260, [224, 219, 203]], // Subalpine zone
  [1603, [232, 228, 215]], // Alpine granite crests
];

function naturalTerrainColor(elev: number): [number, number, number] {
  return evaluateSmoothColorStops(elev, CZ_NATURAL_STOPS);
}

const CZ_LIGHT_STOPS: readonly [number, [number, number, number]][] = [
  [115, [245, 247, 239]],
  [220, [247, 248, 241]],
  [360, [249, 248, 242]],
  [520, [247, 245, 237]],
  [720, [244, 241, 232]],
  [960, [240, 237, 227]],
  [1240, [237, 233, 223]],
  [1603, [242, 239, 230]],
];

const CZ_DARK_STOPS: readonly [number, [number, number, number]][] = [
  [115, [22, 33, 38]],
  [230, [27, 38, 44]],
  [370, [33, 44, 51]],
  [530, [40, 50, 57]],
  [720, [49, 58, 65]],
  [950, [59, 67, 73]],
  [1220, [71, 78, 84]],
  [1603, [88, 95, 102]],
];

// Global Mapy.com-inspired bathymetric & continental terrain ramp (-8000 m .. +8849 m)
const WORLD_OCEAN_ATLAS_STOPS: readonly [number, [number, number, number]][] = [
  [-8000, [104, 168, 224]],
  [-5500, [118, 180, 232]],
  [-3500, [134, 193, 239]],
  [-1800, [150, 206, 245]],
  [-600, [166, 217, 249]],
  [-120, [178, 225, 252]],
  [0, [188, 230, 254]],
];

const WORLD_LAND_ATLAS_STOPS: readonly [number, [number, number, number]][] = [
  [0, [238, 242, 228]],
  [120, [241, 243, 231]],
  [280, [244, 243, 232]],
  [500, [243, 240, 228]],
  [800, [240, 236, 222]],
  [1200, [236, 231, 216]],
  [1750, [232, 226, 210]],
  [2400, [228, 221, 204]],
  [3200, [224, 217, 200]],
  [4200, [227, 221, 207]],
  [5400, [236, 233, 225]],
  [7000, [246, 246, 243]],
  [8849, [253, 254, 255]],
];

function worldAtlasColor(elev: number): [number, number, number] {
  if (elev <= 0) {
    return evaluateSmoothColorStops(elev, WORLD_OCEAN_ATLAS_STOPS);
  }
  return evaluateSmoothColorStops(elev, WORLD_LAND_ATLAS_STOPS);
}

const WORLD_OCEAN_NATURAL_STOPS: readonly [number, [number, number, number]][] = [
  [-8000, [94, 156, 212]],
  [-4500, [116, 176, 226]],
  [-1800, [140, 196, 238]],
  [-300, [160, 210, 246]],
  [0, [174, 219, 249]],
];

const WORLD_LAND_NATURAL_STOPS: readonly [number, [number, number, number]][] = [
  [0, [232, 239, 221]],
  [180, [237, 241, 226]],
  [450, [240, 239, 226]],
  [850, [237, 233, 218]],
  [1400, [232, 226, 210]],
  [2200, [226, 219, 202]],
  [3200, [221, 213, 196]],
  [4500, [226, 220, 208]],
  [6200, [242, 243, 244]],
  [8849, [252, 253, 255]],
];

function worldNaturalColor(elev: number): [number, number, number] {
  if (elev <= 0) {
    return evaluateSmoothColorStops(elev, WORLD_OCEAN_NATURAL_STOPS);
  }
  return evaluateSmoothColorStops(elev, WORLD_LAND_NATURAL_STOPS);
}

function buildWorldLandMask(
  countries: RealWorldDataset['countries'] | undefined,
  cols: number,
  rows: number,
  x0: number,
  y0: number,
  patchWidth: number,
  patchHeight: number
): Uint8ClampedArray | null {
  if (!countries || countries.length === 0) return null;
  const scale = 2;
  const w = (cols - 1) * scale;
  const h = (rows - 1) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const tl = globalWorldToGeo(x0, y0);
  const br = globalWorldToGeo(x0 + patchWidth, y0 + patchHeight);
  const minLon = Math.min(tl.lon, br.lon) - 1;
  const maxLon = Math.max(tl.lon, br.lon) + 1;
  const minLat = Math.min(tl.lat, br.lat) - 1;
  const maxLat = Math.max(tl.lat, br.lat) + 1;

  const sxFactor = w / patchWidth;
  const syFactor = h / patchHeight;

  ctx.fillStyle = '#ffffff';
  for (let c = 0; c < countries.length; c++) {
    const country = countries[c];
    if (
      country.b &&
      (country.b[2] < minLon ||
        country.b[0] > maxLon ||
        country.b[3] < minLat ||
        country.b[1] > maxLat)
    ) {
      continue;
    }
    for (let r = 0; r < country.rings.length; r++) {
      const ring = country.rings[r];
      if (ring.length < 3) continue;
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const pt = geoToGlobalWorld(ring[i][0], ring[i][1]);
        const px = (pt.x - x0) * sxFactor;
        const py = (pt.y - y0) * syFactor;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  const maskData = ctx.getImageData(0, 0, w, h).data;
  canvas.width = 0;
  canvas.height = 0;
  return maskData;
}

function rasterizeTerrainGrid(
  elevationGrid: Float32Array,
  hillshadeGrid: Float32Array,
  forestGrid: Float32Array,
  cols: number,
  rows: number,
  stylePreset: MapStylePreset,
  layers: LayerVisibility,
  isWorld = false,
  renderOceanFromDem = true,
  landMask?: Uint8ClampedArray | null
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
      const outIdx = (py * w + px) * 4;
      const isLandByMask = landMask ? landMask[outIdx + 3] > 32 : false;
      const isOcean = isWorld && renderOceanFromDem && !isLandByMask && elev <= 0;
      const landElev = Math.max(0, elev);

      let rgb: [number, number, number];
      if (isWorld) {
        if (stylePreset === 'dark') {
          if (isOcean) {
            const t = Math.max(0, Math.min(1, (elev + 7000) / 7000));
            rgb = layers.hypsometry
              ? lerpRgb([11, 20, 32], [22, 38, 56], t)
              : [16, 26, 38];
          } else {
            rgb = layers.hypsometry
              ? evaluateSmoothColorStops(landElev, [
                  [0, [24, 35, 42]],
                  [350, [31, 42, 49]],
                  [900, [40, 51, 58]],
                  [1800, [52, 62, 69]],
                  [3200, [68, 77, 85]],
                  [5500, [92, 102, 112]],
                ])
              : [34, 44, 52];
          }
        } else if (stylePreset === 'light') {
          if (isOcean) {
            const t = Math.max(0, Math.min(1, (elev + 7000) / 7000));
            rgb = layers.hypsometry
              ? lerpRgb([180, 212, 238], [216, 235, 249], t)
              : [204, 226, 244];
          } else {
            rgb = layers.hypsometry
              ? evaluateSmoothColorStops(landElev, [
                  [0, [241, 246, 234]],
                  [300, [248, 247, 239]],
                  [850, [245, 239, 227]],
                  [1700, [237, 227, 210]],
                  [3000, [227, 214, 196]],
                  [5200, [238, 234, 228]],
                ])
              : [246, 245, 240];
          }
        } else if (stylePreset === 'natural') {
          rgb = layers.hypsometry
            ? isOcean
              ? evaluateSmoothColorStops(elev, WORLD_OCEAN_NATURAL_STOPS)
              : evaluateSmoothColorStops(landElev, WORLD_LAND_NATURAL_STOPS)
            : isOcean
              ? [148, 198, 236]
              : [242, 241, 232];
        } else {
          rgb = layers.hypsometry
            ? isOcean
              ? evaluateSmoothColorStops(elev, WORLD_OCEAN_ATLAS_STOPS)
              : evaluateSmoothColorStops(landElev, WORLD_LAND_ATLAS_STOPS)
            : isOcean
              ? [166, 213, 247]
              : [246, 244, 236];
        }
      } else if (stylePreset === 'dark') {
        rgb = layers.hypsometry
          ? evaluateSmoothColorStops(elev, CZ_DARK_STOPS)
          : [34, 44, 52];
      } else if (stylePreset === 'light') {
        rgb = layers.hypsometry
          ? evaluateSmoothColorStops(elev, CZ_LIGHT_STOPS)
          : [250, 249, 245];
      } else if (stylePreset === 'natural') {
        rgb = layers.hypsometry ? naturalTerrainColor(elev) : [242, 241, 232];
      } else {
        rgb = layers.hypsometry
          ? hypsometricAtlasColor(elev)
          : [246, 244, 236];
      }

      if (layers.forests && forest > 0.02 && (!isWorld || !isOcean)) {
        rgb = lerpRgb(rgb, pal.forestColor, forest * pal.forestOpacity);
      }

      if (layers.hillshade) {
        const elevBoost = isOcean
          ? 0.42
          : isWorld
            ? elev < 0
              ? 0.35
              : 0.92 + Math.min(0.28, landElev / 9500)
            : 0.92 + Math.min(0.26, Math.max(0, elev - 200) / 3800);
        const rawDelta = (hs - 0.67) * pal.hillshadeStrength * elevBoost * 255;

        // Imhof chromatic relief shading: warm golden sunlight on NW slopes, cool crisp slate-umbral shadows on SE slopes
        if (rawDelta >= 0) {
          rgb = [
            Math.max(0, Math.min(255, rgb[0] + rawDelta * 1.06)),
            Math.max(0, Math.min(255, rgb[1] + rawDelta * 1.01)),
            Math.max(0, Math.min(255, rgb[2] + rawDelta * 0.86)),
          ];
        } else {
          rgb = [
            Math.max(0, Math.min(255, rgb[0] + rawDelta * 1.05)),
            Math.max(0, Math.min(255, rgb[1] + rawDelta * 0.98)),
            Math.max(0, Math.min(255, rgb[2] + rawDelta * 0.84)),
          ];
        }
      }

      const grain = (((px * 73856093) ^ (py * 19349663)) & 7) - 3.5;
      data[outIdx] = Math.max(0, Math.min(255, rgb[0] + grain * 0.35));
      data[outIdx + 1] = Math.max(0, Math.min(255, rgb[1] + grain * 0.35));
      data[outIdx + 2] = Math.max(0, Math.min(255, rgb[2] + grain * 0.35));
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
  layers: LayerVisibility,
  countries?: RealWorldDataset['countries']
): HTMLCanvasElement {
  const landMask = buildWorldLandMask(
    countries,
    WORLD_DEM_COLS,
    WORLD_DEM_ROWS,
    0,
    0,
    GLOBAL_WIDTH,
    GLOBAL_HEIGHT
  );
  return rasterizeTerrainGrid(
    worldTerrain.elevationGrid,
    worldTerrain.hillshadeGrid,
    worldTerrain.forestGrid,
    WORLD_DEM_COLS,
    WORLD_DEM_ROWS,
    stylePreset,
    layers,
    true,
    true,
    landMask
  );
}

function drawCroppedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  viewW: number,
  viewH: number
) {
  if (dw <= 0 || dh <= 0 || img.width <= 0 || img.height <= 0) return;
  const cdx0 = Math.max(0, dx);
  const cdy0 = Math.max(0, dy);
  const cdx1 = Math.min(viewW, dx + dw);
  const cdy1 = Math.min(viewH, dy + dh);
  const cdw = cdx1 - cdx0;
  const cdh = cdy1 - cdy0;
  if (cdw <= 0 || cdh <= 0) return;

  const sx = Math.max(
    0,
    Math.min(img.width - 0.01, ((cdx0 - dx) / dw) * img.width)
  );
  const sy = Math.max(
    0,
    Math.min(img.height - 0.01, ((cdy0 - dy) / dh) * img.height)
  );
  const sw = Math.min(img.width - sx, (cdw / dw) * img.width);
  const sh = Math.min(img.height - sy, (cdh / dh) * img.height);
  if (sw <= 0.001 || sh <= 0.001) return;

  ctx.drawImage(img, sx, sy, sw, sh, cdx0, cdy0, cdw, cdh);
}

// ============================================================================
// SKIA-SAFE VIEWPORT CLIPPING (Prevents ±5M px coords & dashed-line OOM crashes)
// ============================================================================

function cohenOutCode(
  x: number,
  y: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): number {
  let code = 0;
  if (x < minX) code |= 1;
  else if (x > maxX) code |= 2;
  if (y < minY) code |= 4;
  else if (y > maxY) code |= 8;
  return code;
}

/**
 * Clips a single line segment (x0,y0)-(x1,y1) to [minX,maxX] x [minY,maxY]
 * using Cohen-Sutherland and appends it to the current Canvas2D path.
 * Guarantees zero offscreen dashes and bounded coordinates for Skia.
 */
function addClippedSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): boolean {
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1)
  ) {
    return false;
  }
  let c0 = cohenOutCode(x0, y0, minX, minY, maxX, maxY);
  let c1 = cohenOutCode(x1, y1, minX, minY, maxX, maxY);

  // Bounded Cohen-Sutherland (a valid clip always completes within <= 4 steps)
  for (let iter = 0; iter < 6; iter++) {
    if ((c0 | c1) === 0) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      return true;
    }
    if ((c0 & c1) !== 0) return false;

    const out = c0 !== 0 ? c0 : c1;
    let x = 0;
    let y = 0;
    if (out & 8) {
      const dy = y1 - y0;
      if (Math.abs(dy) < 1e-9) return false;
      x = x0 + ((x1 - x0) * (maxY - y0)) / dy;
      y = maxY;
    } else if (out & 4) {
      const dy = y1 - y0;
      if (Math.abs(dy) < 1e-9) return false;
      x = x0 + ((x1 - x0) * (minY - y0)) / dy;
      y = minY;
    } else if (out & 2) {
      const dx = x1 - x0;
      if (Math.abs(dx) < 1e-9) return false;
      y = y0 + ((y1 - y0) * (maxX - x0)) / dx;
      x = maxX;
    } else {
      const dx = x1 - x0;
      if (Math.abs(dx) < 1e-9) return false;
      y = y0 + ((y1 - y0) * (minX - x0)) / dx;
      x = minX;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    if (out === c0) {
      x0 = x;
      y0 = y;
      c0 = cohenOutCode(x0, y0, minX, minY, maxX, maxY);
    } else {
      x1 = x;
      y1 = y;
      c1 = cohenOutCode(x1, y1, minX, minY, maxX, maxY);
    }
  }
  return false;
}

/**
 * Traces a geo polyline/ring onto ctx with exact viewport segment clipping.
 * Returns true if at least one clipped segment was added.
 */
function traceClippedGeoPolyline(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  project: (lon: number, lat: number) => Point2D,
  wxToSx: (wx: number) => number,
  wyToSy: (wy: number) => number,
  width: number,
  height: number,
  closed = false
): boolean {
  const len = pts.length;
  if (len < 2) return false;
  const pad = 32;
  const minX = -pad;
  const minY = -pad;
  const maxX = width + pad;
  const maxY = height + pad;

  const p0 = project(pts[0][0], pts[0][1]);
  let prevX = wxToSx(p0.x);
  let prevY = wyToSy(p0.y);
  const startX = prevX;
  const startY = prevY;
  let drew = false;

  for (let i = 1; i < len; i++) {
    const p = project(pts[i][0], pts[i][1]);
    const nx = wxToSx(p.x);
    const ny = wyToSy(p.y);
    if (addClippedSegment(ctx, prevX, prevY, nx, ny, minX, minY, maxX, maxY)) {
      drew = true;
    }
    prevX = nx;
    prevY = ny;
  }
  if (closed && len >= 3) {
    if (
      addClippedSegment(ctx, prevX, prevY, startX, startY, minX, minY, maxX, maxY)
    ) {
      drew = true;
    }
  }
  return drew;
}

/**
 * Traces a world-space Point2D polyline/ring with exact viewport segment clipping.
 */
function traceClippedWorldPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Point2D[],
  wxToSx: (wx: number) => number,
  wyToSy: (wy: number) => number,
  width: number,
  height: number,
  closed = false
): boolean {
  const len = pts.length;
  if (len < 2) return false;
  const pad = 32;
  const minX = -pad;
  const minY = -pad;
  const maxX = width + pad;
  const maxY = height + pad;

  let prevX = wxToSx(pts[0].x);
  let prevY = wyToSy(pts[0].y);
  const startX = prevX;
  const startY = prevY;
  let drew = false;

  for (let i = 1; i < len; i++) {
    const nx = wxToSx(pts[i].x);
    const ny = wyToSy(pts[i].y);
    if (addClippedSegment(ctx, prevX, prevY, nx, ny, minX, minY, maxX, maxY)) {
      drew = true;
    }
    prevX = nx;
    prevY = ny;
  }
  if (closed && len >= 3) {
    if (
      addClippedSegment(ctx, prevX, prevY, startX, startY, minX, minY, maxX, maxY)
    ) {
      drew = true;
    }
  }
  return drew;
}

/**
 * Sutherland-Hodgman polygon clipping against [minX, maxX] x [minY, maxY].
 * Keeps filled polygons (such as the 5,957-vertex Czech border mask) strictly
 * bounded to the screen rect so Skia evenodd tessellation is fast and crash-free.
 */
function clipPolygonToRect(
  pts: Point2D[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Point2D[] {
  if (pts.length < 3) return [];

  const clipEdge = (
    input: Point2D[],
    inside: (p: Point2D) => boolean,
    intersect: (a: Point2D, b: Point2D) => Point2D
  ): Point2D[] => {
    if (input.length === 0) return [];
    const output: Point2D[] = [];
    let s = input[input.length - 1];
    let sIn = inside(s);
    for (let i = 0; i < input.length; i++) {
      const e = input[i];
      const eIn = inside(e);
      if (eIn) {
        if (!sIn) output.push(intersect(s, e));
        output.push(e);
      } else if (sIn) {
        output.push(intersect(s, e));
      }
      s = e;
      sIn = eIn;
    }
    return output;
  };

  let out = clipEdge(
    pts,
    (p) => p.x >= minX,
    (a, b) => ({
      x: minX,
      y: a.y + ((b.y - a.y) * (minX - a.x)) / (b.x - a.x || 1e-9),
    })
  );
  out = clipEdge(
    out,
    (p) => p.x <= maxX,
    (a, b) => ({
      x: maxX,
      y: a.y + ((b.y - a.y) * (maxX - a.x)) / (b.x - a.x || 1e-9),
    })
  );
  out = clipEdge(
    out,
    (p) => p.y >= minY,
    (a, b) => ({
      x: a.x + ((b.x - a.x) * (minY - a.y)) / (b.y - a.y || 1e-9),
      y: minY,
    })
  );
  out = clipEdge(
    out,
    (p) => p.y <= maxY,
    (a, b) => ({
      x: a.x + ((b.x - a.x) * (maxY - a.y)) / (b.y - a.y || 1e-9),
      y: maxY,
    })
  );
  return out;
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
    50,
    100,
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
    onEnterDetailScale,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [viewportSize, setViewportSize] = useState({ width: 1050, height: 700 });

  const activeWidth = mapScope === 'world' ? GLOBAL_WIDTH : WORLD_WIDTH;
  const activeHeight = mapScope === 'world' ? GLOBAL_HEIGHT : WORLD_HEIGHT;
  const minZoom = mapScope === 'world' ? 0.000018 : 0.0008;

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

  const zoomLevels = useMemo(
    () => buildFixedZoomLevels(mapScope, fitZoom),
    [mapScope, fitZoom]
  );

  const [camera, setCamera] = useState({
    cx: activeWidth * 0.5,
    cy: activeHeight * 0.49,
    zoom: zoomLevels[0].zoom,
  });

  const activeZoomIndex = useMemo(
    () => findNearestZoomIndex(zoomLevels, camera.zoom),
    [zoomLevels, camera.zoom]
  );
  const activeZoomLevel = zoomLevels[activeZoomIndex] ?? zoomLevels[0];

  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const wheelCooldownRef = useRef<number>(0);
  const wheelAccumRef = useRef<number>(0);
  const lastHoverCheckRef = useRef<number>(0);

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

  const setZoomToLevelIndex = useCallback(
    (targetIdx: number, anchorSx?: number, anchorSy?: number) => {
      const clampedIdx = Math.max(
        0,
        Math.min(zoomLevels.length - 1, targetIdx)
      );
      const nextZoom = zoomLevels[clampedIdx].zoom;
      setCamera((c) => {
        if (Math.abs(c.zoom - nextZoom) < 1e-9) return c;
        if (anchorSx !== undefined && anchorSy !== undefined) {
          const wx = c.cx + (anchorSx - viewportSize.width / 2) / c.zoom;
          const wy = c.cy + (anchorSy - viewportSize.height / 2) / c.zoom;
          return {
            zoom: nextZoom,
            cx: wx - (anchorSx - viewportSize.width / 2) / nextZoom,
            cy: wy - (anchorSy - viewportSize.height / 2) / nextZoom,
          };
        }
        return { ...c, zoom: nextZoom };
      });
    },
    [zoomLevels, viewportSize.width, viewportSize.height]
  );

  // Fit on initial mount
  const initializedRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setViewportSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );
      if (!initializedRef.current && w > 0 && h > 0) {
        initializedRef.current = true;
        const zx = (w * 0.95) / activeWidth;
        const zy = (h * 0.92) / activeHeight;
        const initFit = Math.max(minZoom, Math.min(zx, zy));
        const initLevels = buildFixedZoomLevels(mapScope, initFit);
        setCamera({
          cx: activeWidth * 0.5,
          cy: activeHeight * 0.49,
          zoom: initLevels[0].zoom,
        });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeWidth, activeHeight, mapScope, minZoom]);

  // Reset camera when switching between Czechia and World scope
  const prevScopeRef = useRef<MapScope>(mapScope);
  useEffect(() => {
    if (prevScopeRef.current !== mapScope) {
      prevScopeRef.current = mapScope;
      const w = viewportSize.width || 1050;
      const h = viewportSize.height || 700;
      const sw = mapScope === 'world' ? GLOBAL_WIDTH : WORLD_WIDTH;
      const sh = mapScope === 'world' ? GLOBAL_HEIGHT : WORLD_HEIGHT;
      const sMin = mapScope === 'world' ? 0.000018 : 0.0008;
      const zx = (w * 0.95) / sw;
      const zy = (h * 0.92) / sh;
      const nextLevels = buildFixedZoomLevels(
        mapScope,
        Math.max(sMin, Math.min(zx, zy))
      );
      setCamera({
        cx: sw * 0.5,
        cy: sh * 0.49,
        zoom: nextLevels[0].zoom,
      });
      setLocalPatch(null);
      setCursorWorld(null);
      setZoomMenuOpen(false);
    }
  }, [mapScope, viewportSize.width, viewportSize.height]);

  // Build terrain raster ONLY for the active scope & ONLY when terrain-affecting flags change
  const activeTerrainRaster = useMemo(() => {
    const terrainLayerFlags: LayerVisibility = {
      ...layers,
      forests: mapScope === 'world' ? layers.forests : false,
    };
    return mapScope === 'world'
      ? buildWorldTerrainRaster(
          worldTerrain,
          stylePreset,
          terrainLayerFlags,
          worldDataset?.countries
        )
      : buildCzechTerrainRaster(terrain, stylePreset, terrainLayerFlags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapScope,
    terrain,
    worldTerrain,
    worldDataset,
    stylePreset,
    layers.hillshade,
    layers.hypsometry,
    layers.forests,
  ]);

  // Safely release ONLY replaced terrain raster GPU backing stores
  const prevTerrainRasterRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const prev = prevTerrainRasterRef.current;
    if (prev && prev !== activeTerrainRaster) {
      prev.width = 0;
      prev.height = 0;
    }
    prevTerrainRasterRef.current = activeTerrainRaster;
  }, [activeTerrainRaster]);

  // Local high-res viewport terrain refinement + live AWS Terrarium streaming
  const [localPatch, setLocalPatch] = useState<{
    patch: LocalTerrainPatch;
    raster: HTMLCanvasElement;
    scope: MapScope;
  } | null>(null);

  const prevLocalPatchRasterRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const nextRaster = localPatch?.raster ?? null;
    const prev = prevLocalPatchRasterRef.current;
    if (prev && prev !== nextRaster) {
      prev.width = 0;
      prev.height = 0;
    }
    prevLocalPatchRasterRef.current = nextRaster;
  }, [localPatch]);
  const [tileRevision, setTileRevision] = useState(0);
  const [blockRevision, setBlockRevision] = useState(0);
  const [osmRevision, setOsmRevision] = useState(0);

  const osmTimerRef = useRef<number | null>(null);
  const blockTimerRef = useRef<number | null>(null);

  const scheduleOsmRedraw = useCallback(() => {
    if (osmTimerRef.current !== null) return;
    osmTimerRef.current = window.setTimeout(() => {
      osmTimerRef.current = null;
      setOsmRevision((v) => v + 1);
    }, 65);
  }, []);

  const scheduleBlockRedraw = useCallback(() => {
    if (blockTimerRef.current !== null) return;
    blockTimerRef.current = window.setTimeout(() => {
      blockTimerRef.current = null;
      setBlockRevision((v) => v + 1);
    }, 65);
  }, []);

  useEffect(() => {
    return () => {
      if (osmTimerRef.current !== null) window.clearTimeout(osmTimerRef.current);
      if (blockTimerRef.current !== null)
        window.clearTimeout(blockTimerRef.current);
    };
  }, []);

  // Trigger lazy loading of global places index & Czech dataset only when user enters detail scale
  useEffect(() => {
    if (!onEnterDetailScale || mapScope !== 'world') return;
    if (camera.zoom < DETAIL_WORLD_ZOOM) return;
    const halfW = (viewportSize.width / 2) / camera.zoom;
    const halfH = (viewportSize.height / 2) / camera.zoom;
    const tl = globalWorldToGeo(camera.cx - halfW, camera.cy - halfH);
    const br = globalWorldToGeo(camera.cx + halfW, camera.cy + halfH);
    const overlapsCz =
      br.lon >= CZ_BOUNDS.minLon - 0.5 &&
      tl.lon <= CZ_BOUNDS.maxLon + 0.5 &&
      tl.lat >= CZ_BOUNDS.minLat - 0.5 &&
      br.lat <= CZ_BOUNDS.maxLat + 0.5;
    onEnterDetailScale(overlapsCz);
  }, [
    onEnterDetailScale,
    mapScope,
    camera.cx,
    camera.cy,
    camera.zoom,
    viewportSize.width,
    viewportSize.height,
  ]);

  useEffect(() => {
    const thresholdZoom = mapScope === 'world' ? 0.00011 : 0.0036;
    if (camera.zoom < thresholdZoom) {
      setLocalPatch(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const halfW = (viewportSize.width / camera.zoom) * 0.68;
      const halfH = (viewportSize.height / camera.zoom) * 0.68;
      const x0 = Math.max(0, camera.cx - halfW);
      const y0 = Math.max(0, camera.cy - halfH);
      const x1 = Math.min(activeWidth, camera.cx + halfW);
      const y1 = Math.min(activeHeight, camera.cy + halfH);
      if (x1 - x0 < 300 || y1 - y0 < 300) return;

      const patchLayers = {
        hypsometry: layers.hypsometry,
        hillshade: layers.hillshade,
        contours: layers.contours,
        forests: layers.forests,
        hydrology: false,
        highways: false,
        railways: false,
        borders: false,
        districts: false,
        cities: false,
        peaks: false,
        graticule: false,
      };

      if (mapScope === 'world') {
        if (!worldDataset?.dem) return;
        const targetZ = pickWorldTerrariumZoom(camera.zoom);
        if (targetZ > 0) {
          const tl = globalWorldToGeo(x0, y0);
          const br = globalWorldToGeo(x1, y1);
          const loadedNew = await ensureViewportTerrariumTiles(
            tl.lon,
            br.lon,
            br.lat,
            tl.lat,
            targetZ
          );
          if (cancelled) return;
          if (loadedNew) {
            setTileRevision((v) => v + 1);
          }
        }

        const patch = compileWorldViewportTerrain(
          x0,
          y0,
          x1 - x0,
          y1 - y0,
          camera.zoom,
          patchLayers.contours,
          worldDataset.dem,
          targetZ > 0 ? targetZ : undefined,
          realDataset?.dem
        );
        const isDetailWorld = camera.zoom >= DETAIL_WORLD_ZOOM;
        const worldPatchLayers = isDetailWorld
          ? { ...patchLayers, forests: false }
          : patchLayers;
        const patchLandMask = isDetailWorld
          ? null
          : buildWorldLandMask(
              worldDataset.countries,
              patch.cols,
              patch.rows,
              patch.x0,
              patch.y0,
              patch.width,
              patch.height
            );
        const raster = rasterizeTerrainGrid(
          patch.elevationGrid,
          patch.hillshadeGrid,
          patch.forestGrid,
          patch.cols,
          patch.rows,
          stylePreset,
          worldPatchLayers,
          true,
          !isDetailWorld,
          patchLandMask
        );
        if (!cancelled) {
          setLocalPatch({ patch, raster, scope: 'world' });
        }
      } else {
        if (!realDataset?.dem) return;
        const targetZ = pickTerrariumZoom(camera.zoom);
        if (targetZ > 0) {
          const tl = worldToGeo(x0, y0);
          const br = worldToGeo(x1, y1);
          const loadedNew = await ensureViewportTerrariumTiles(
            tl.lon,
            br.lon,
            br.lat,
            tl.lat,
            targetZ
          );
          if (cancelled) return;
          if (loadedNew) {
            setTileRevision((v) => v + 1);
          }
        }

        const patch = compileLocalViewportTerrain(
          x0,
          y0,
          x1 - x0,
          y1 - y0,
          camera.zoom,
          patchLayers.contours,
          realDataset.dem,
          targetZ > 0 ? targetZ : undefined
        );
        const raster = rasterizeTerrainGrid(
          patch.elevationGrid,
          patch.hillshadeGrid,
          patch.forestGrid,
          patch.cols,
          patch.rows,
          stylePreset,
          { ...patchLayers, forests: false },
          false
        );
        if (!cancelled) {
          setLocalPatch({ patch, raster, scope: 'cz' });
        }
      }
    }, 160);

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
    layers.hypsometry,
    layers.hillshade,
    layers.contours,
    layers.forests,
    realDataset,
    worldDataset,
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

      // 1. Draw Base Terrain Raster + Local High-Res Refinement Patch (viewport-cropped for Skia safety)
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const patchThreshold = mapScope === 'world' ? 0.00011 : 0.0036;
      const hasActivePatch = Boolean(
        localPatch &&
          localPatch.scope === mapScope &&
          !forExport &&
          cam.zoom >= patchThreshold
      );
      let patchCoversViewport = false;
      if (hasActivePatch && localPatch) {
        const px0 = wxToSx(localPatch.patch.x0);
        const py0 = wyToSy(localPatch.patch.y0);
        const pw = localPatch.patch.width * cam.zoom;
        const ph = localPatch.patch.height * cam.zoom;
        patchCoversViewport =
          px0 <= 0 && py0 <= 0 && px0 + pw >= width && py0 + ph >= height;
      }

      if (!patchCoversViewport) {
        drawCroppedImage(
          ctx,
          activeTerrainRaster,
          sheetX,
          sheetY,
          sheetW,
          sheetH,
          width,
          height
        );
      }

      if (hasActivePatch && localPatch) {
        const { patch, raster } = localPatch;
        drawCroppedImage(
          ctx,
          raster,
          wxToSx(patch.x0),
          wyToSy(patch.y0),
          patch.width * cam.zoom,
          patch.height * cam.zoom,
          width,
          height
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
          cam.cx - (width * 0.505) / cam.zoom,
          cam.cy - (height * 0.505) / cam.zoom
        );
        const brGeo = globalWorldToGeo(
          cam.cx + (width * 0.505) / cam.zoom,
          cam.cy + (height * 0.505) / cam.zoom
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
              scheduleBlockRedraw,
              1.8
            )
          : { loadedBlocks: [], activeMetas: [] };

        // Stream pre-rasterized OpenStreetMap tile bitmaps at fixed discrete zoom levels (>= Stupeň 6 / 1 : 3 000 000)
        const worldLevelSpec =
          zoomLevels[findNearestZoomIndex(zoomLevels, cam.zoom)];
        const worldOsmTargetZ = worldLevelSpec?.osmZ ?? 7;
        const worldOsmOpts = buildOsmRenderOptions(
          stylePreset,
          layers,
          pal,
          layers.borders,
          layers.districts
        );
        const worldOsmRes =
          isDetailScale && worldLevelSpec?.osmZ !== null
            ? ensureOsmVectorTilesForViewport(
                viewMinLon,
                viewMaxLon,
                viewMinLat,
                viewMaxLat,
                worldOsmTargetZ,
                worldOsmOpts,
                scheduleOsmRedraw
              )
            : { tiles: [], targetZ: worldOsmTargetZ };
        const worldOsmTiles = worldOsmRes.tiles;
        const worldHasOsm = worldOsmTiles.length > 0;
        const worldOsmRc: OsmRenderContext = {
          ctx,
          width,
          height,
          zoom: cam.zoom,
          targetZ: worldOsmTargetZ,
          stylePreset,
          pal,
          layers,
          projectGeo: geoToGlobalWorld,
          wxToSx,
          wyToSy,
          tryPlaceBox,
        };

        // 1bW. Pre-rasterized OSM Base Bitmaps (Forests, Wetlands, Glaciers, Parks, Built-up Urban & Buildings)
        if (isDetailScale && worldHasOsm) {
          renderOsmBaseBitmaps(worldOsmTiles, worldOsmRc);
        }

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
          const showMinor = useLocalContours || cam.zoom >= 0.006;
          ctx.save();
          if (cam.zoom < 0.012) {
            ctx.globalAlpha = cam.zoom < 0.005 ? 0.35 : 0.6;
          }
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (showMinor) {
            ctx.strokeStyle = pal.contourMinor;
            ctx.lineWidth = isDetailScale ? 0.42 : 0.38;
            let segCount = 0;
            ctx.beginPath();
            for (const level of activeContours) {
              if (level.isIndex) continue;
              for (const poly of level.polylines) {
                if (
                  traceClippedWorldPolyline(
                    ctx,
                    poly,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  segCount += poly.length;
                  if (segCount >= 3500) {
                    ctx.stroke();
                    ctx.beginPath();
                    segCount = 0;
                  }
                }
              }
            }
            if (segCount > 0) ctx.stroke();
          }

          ctx.strokeStyle = pal.contourIndex;
          ctx.lineWidth = isDetailScale
            ? 0.72
            : cam.zoom >= 0.0002
              ? 0.64
              : 0.52;
          {
            let segCount = 0;
            ctx.beginPath();
            for (const level of activeContours) {
              if (!level.isIndex) continue;
              for (const poly of level.polylines) {
                if (
                  traceClippedWorldPolyline(
                    ctx,
                    poly,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  segCount += poly.length;
                  if (segCount >= 3500) {
                    ctx.stroke();
                    ctx.beginPath();
                    segCount = 0;
                  }
                }
              }
            }
            if (segCount > 0) ctx.stroke();
          }
          ctx.restore();

          // Inline contour elevation numbers only at close tourist zoom
          if (cam.zoom >= 0.024) {
            ctx.font = '500 8.5px "JetBrains Mono", monospace';
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
                ctx.lineWidth = 2.6;
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
            const cx0 = Math.max(-16, Math.min(width + 16, x0));
            const cy0 = Math.max(-16, Math.min(height + 16, y0));
            const cx1 = Math.max(-16, Math.min(width + 16, x1));
            const cy1 = Math.max(-16, Math.min(height + 16, y1));
            if (cx1 > cx0 && cy1 > cy0) {
              ctx.strokeRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
            }
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
        if (isDetailScale && layers.districts && !worldHasOsm) {
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
                  if (
                    traceClippedGeoPolyline(
                      ctx,
                      line,
                      geoToGlobalWorld,
                      wxToSx,
                      wyToSy,
                      width,
                      height,
                      false
                    )
                  ) {
                    ctx.stroke();
                  }
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
                if (
                  traceClippedGeoPolyline(
                    ctx,
                    ring,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    true
                  )
                ) {
                  ctx.stroke();
                }
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
                if (
                  traceClippedGeoPolyline(
                    ctx,
                    ring,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    true
                  )
                ) {
                  ctx.stroke();
                }
              }
            }
            ctx.restore();
          }
        }

        // 5W. World Country Borders & Coastlines (OSM precision at <= 1 : 3 000 000; 50m overview borders hidden in detail view)
        if (layers.borders || (isDetailScale && layers.districts && worldHasOsm)) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          if (isDetailScale) {
            // 1) Fallback 10m coastlines & borders while OSM tiles load (when OSM tiles are loaded, exact OSM coastlines & borders replace them)
            if (layers.borders && !worldHasOsm) {
              for (const blk of loadedBlocks) {
                if (!blk.borders) continue;
                for (const bnd of blk.borders) {
                  if (!bboxVisible(bnd.b)) continue;
                  const isCoast = bnd.c === 1;
                  for (const line of bnd.l) {
                    if (line.length < 2) continue;
                    ctx.beginPath();
                    if (
                      !traceClippedGeoPolyline(
                        ctx,
                        line,
                        geoToGlobalWorld,
                        wxToSx,
                        wyToSy,
                        width,
                        height,
                        false
                      )
                    ) {
                      continue;
                    }
                    if (isCoast) {
                      ctx.strokeStyle = pal.waterStroke;
                      ctx.lineWidth = 1.15;
                      ctx.stroke();
                    } else {
                      ctx.strokeStyle = pal.borderOuter;
                      ctx.lineWidth = 1.7;
                      ctx.stroke();
                      ctx.strokeStyle = pal.borderInner;
                      ctx.lineWidth = 0.85;
                      ctx.stroke();
                    }
                  }
                }
              }
            }

            // 2) Fallback official Czech border while OSM tile loads (OSM overlay bitmap paints crisp borders on pass 6W)
            if (!worldHasOsm && layers.borders && overlapsCz && realDataset) {
              ctx.beginPath();
              if (
                traceClippedGeoPolyline(
                  ctx,
                  realDataset.admin.border,
                  geoToGlobalWorld,
                  wxToSx,
                  wyToSy,
                  width,
                  height,
                  true
                )
              ) {
                ctx.strokeStyle = pal.borderOuter;
                ctx.lineWidth = 1.8;
                ctx.stroke();
                ctx.strokeStyle = pal.borderInner;
                ctx.lineWidth = 0.9;
                ctx.stroke();
              }
            }
          } else if (layers.borders && worldDataset) {
            // Coarse 50m overview country borders (shown ONLY when scale > 1 : 3 000 000)
            for (const country of worldDataset.countries) {
              if (country.b && !bboxVisible(country.b)) continue;
              const isCz = country.iso === 'CZE';
              for (const ring of country.rings) {
                if (ring.length < 3) continue;
                ctx.beginPath();
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    ring,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    true
                  )
                ) {
                  continue;
                }
                if (isCz) {
                  ctx.strokeStyle = pal.borderInner;
                  ctx.lineWidth = cam.zoom >= 0.0002 ? 1.1 : 0.8;
                  ctx.stroke();
                } else {
                  ctx.strokeStyle = pal.isDark
                    ? 'rgba(148, 163, 184, 0.58)'
                    : 'rgba(24, 28, 24, 0.68)';
                  ctx.lineWidth = cam.zoom >= 0.0002 ? 0.82 : 0.6;
                  ctx.stroke();
                }
              }
            }
          }
          ctx.restore();
        }

        // 5bW. Composite Pre-Rasterized OSM Overlay Bitmaps (Water, Waterways, Aeroways, Railways, Roads & Borders)
        if (isDetailScale && worldHasOsm) {
          renderOsmOverlayBitmaps(worldOsmTiles, worldOsmRc);
        }

        // 6W. Global Hydrology fallback (50m overview or block vectors while OSM tiles load)
        if (layers.hydrology && (!isDetailScale || !worldHasOsm)) {
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
            for (const blk of loadedBlocks) {
              for (const river of blk.rivers) {
                if (!bboxVisible(river.b)) continue;
                const wScale = Math.max(0.85, Math.min(2.2, river.w * 1.55));
                for (const line of river.l) {
                  if (line.length < 2) continue;
                  ctx.beginPath();
                  if (
                    !traceClippedGeoPolyline(
                      ctx,
                      line,
                      geoToGlobalWorld,
                      wxToSx,
                      wyToSy,
                      width,
                      height,
                      false
                    )
                  ) {
                    continue;
                  }
                  ctx.strokeStyle = pal.waterStroke;
                  ctx.lineWidth = Math.max(
                    0.75,
                    wScale * (0.42 + Math.min(1.8, cam.zoom * 115))
                  );
                  ctx.stroke();
                  ctx.strokeStyle = pal.waterFill;
                  ctx.lineWidth = Math.max(
                    0.4,
                    wScale * (0.22 + Math.min(1.0, cam.zoom * 65))
                  );
                  ctx.stroke();
                }
              }
            }

            if (overlapsCz) {
              for (const river of CZECH_RIVERS) {
                if (!SUPPLEMENTAL_RIVER_IDS.has(river.id)) continue;
                ctx.beginPath();
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    river.points,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = Math.max(
                  0.75,
                  river.width * (0.42 + Math.min(1.7, cam.zoom * 115))
                );
                ctx.stroke();
                ctx.strokeStyle = pal.waterFill;
                ctx.lineWidth = Math.max(
                  0.4,
                  river.width * (0.22 + Math.min(0.95, cam.zoom * 65))
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
                ctx.lineWidth = 0.55;
                ctx.stroke();
              }
            }

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const river of worldDataset.rivers) {
              if (river.b && !bboxVisible(river.b)) continue;
              if (cam.zoom < 0.00005 && river.w < 0.75) continue;
              if (cam.zoom < 0.00012 && river.w < 0.45) continue;
              const wScale = Math.max(0.65, Math.min(1.9, river.w * 1.1));
              for (const line of river.lines) {
                if (line.length < 2) continue;
                ctx.beginPath();
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    line,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
                ctx.strokeStyle = pal.waterStroke;
                ctx.lineWidth = Math.max(
                  0.55,
                  wScale * (0.48 + Math.min(1.25, cam.zoom * 2200))
                );
                ctx.stroke();
              }
            }
          }
        }

        // 6bW. Global Built-up Urban Footprints fallback (when OSM tiles are still loading)
        if (isDetailScale && layers.cities && !worldHasOsm) {
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
                const screenRing = ring.map(([lon, lat]) => {
                  const wPt = geoToGlobalWorld(lon, lat);
                  return { x: wxToSx(wPt.x), y: wyToSy(wPt.y) };
                });
                const clipped = clipPolygonToRect(
                  screenRing,
                  -16,
                  -16,
                  width + 16,
                  height + 16
                );
                if (clipped.length < 3) continue;
                ctx.beginPath();
                ctx.moveTo(clipped[0].x, clipped[0].y);
                for (let i = 1; i < clipped.length; i++) {
                  ctx.lineTo(clipped[i].x, clipped[i].y);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }

        // 7aW. Global Railway Network fallback (while OSM tiles load)
        if (isDetailScale && layers.railways && !worldHasOsm) {
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
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    line,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
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
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    line,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
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

        // 7bW. Global Motorways & Trunk Roads fallback (while OSM tiles load)
        if (isDetailScale && layers.highways && !worldHasOsm) {
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
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    line,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
                ctx.strokeStyle = pal.isDark
                  ? 'rgba(148, 163, 184, 0.45)'
                  : isSec
                    ? 'rgba(198, 126, 28, 0.76)'
                    : 'rgba(202, 142, 46, 0.66)';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 1.95
                    : 1.35
                  : cam.zoom >= 0.006
                    ? 1.4
                    : 0.9;
                ctx.stroke();

                ctx.strokeStyle = pal.isDark
                  ? '#475569'
                  : isSec
                    ? '#F7AC38'
                    : '#F9C75E';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 1.1
                    : 0.75
                  : cam.zoom >= 0.006
                    ? 0.75
                    : 0.48;
                ctx.stroke();
              }
            }

            // Pass 2: Major Highways / Motorways (Mapy.com green motorways)
            for (const rd of blk.roads) {
              if (rd.t !== 2) continue;
              if (!bboxVisible(rd.b)) continue;
              for (const line of rd.l) {
                ctx.beginPath();
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    line,
                    geoToGlobalWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
                ctx.strokeStyle = pal.highwayCasing;
                ctx.lineWidth = cam.zoom >= 0.004 ? 2.45 : 1.68;
                ctx.stroke();
                ctx.strokeStyle = pal.highwayCore;
                ctx.lineWidth = cam.zoom >= 0.004 ? 1.38 : 0.92;
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
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.lineWidth = 0.9;
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
                ctx.fillStyle = isPrimary ? '#3E82B8' : pal.highwayBadgeBg;
                ctx.fillRect(mx - bw / 2, my - bh / 2, bw, bh);
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 0.9;
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
            const isVillage = !isOverview && !isCap && !isReg && pop < 3200;
            const isLocality = !isOverview && !isCap && !isReg && pop < 400;
            const r = isOverview
              ? isCap
                ? cam.zoom >= 0.00012
                  ? 3.1
                  : 2.5
                : pop >= 3000000
                  ? 2.5
                  : 1.9
              : isCap
                ? 3.6
                : isReg
                  ? 2.8
                  : pop >= 80000
                    ? 2.4
                    : pop >= 15000
                      ? 2.0
                      : pop >= 3200
                        ? 1.75
                        : 1.35;

            ctx.font = isOverview
              ? isCap
                ? '700 10.2px "Plus Jakarta Sans", sans-serif'
                : '500 9.2px "Plus Jakarta Sans", sans-serif'
              : isCap
                ? '700 12.2px "Plus Jakarta Sans", sans-serif'
                : isReg
                  ? '600 10.8px "Plus Jakarta Sans", sans-serif'
                  : pop >= 35000
                    ? '600 10px "Plus Jakarta Sans", sans-serif'
                    : pop >= 3200
                      ? '500 9.3px "Plus Jakarta Sans", sans-serif'
                      : isLocality
                        ? '500 8.3px "Plus Jakarta Sans", sans-serif'
                        : '500 8.8px "Plus Jakarta Sans", sans-serif';

            const displayLabel =
              !isOverview && isCap ? name.toUpperCase() : name;
            const tw = ctx.measureText(displayLabel).width;
            const boxH = isCap ? 14 : isLocality ? 10 : 12;
            const lx = sx;
            const ly = isLocality
              ? sy
              : sy - r - boxH * 0.45 - 1.4;

            // Reserve bounding box covering both the city dot and its centered label above
            if (
              !tryPlaceBox(
                sx - Math.max(tw * 0.5 + 3, r + 2),
                ly - boxH * 0.5,
                Math.max(tw + 6, r * 2 + 4),
                boxH + (isLocality ? 2 : r * 2 + 3),
                false
              )
            ) {
              return;
            }

            placedCities.push({ x: sx, y: sy });

            if (!isLocality) {
              ctx.beginPath();
              ctx.arc(sx, sy, r, 0, Math.PI * 2);
              ctx.fillStyle = pal.cityRing;
              ctx.fill();
              ctx.lineWidth = isCap ? 1.25 : isVillage ? 0.9 : 1.05;
              ctx.strokeStyle = pal.cityDot;
              ctx.stroke();
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = isLocality ? 2.5 : 3.0;
            ctx.strokeStyle = pal.textHalo;
            ctx.strokeText(displayLabel, lx, ly);
            ctx.fillStyle = isLocality ? pal.textSecondary : pal.textPrimary;
            ctx.fillText(displayLabel, lx, ly);
          };

          if (isDetailScale && (loadedBlocks.length > 0 || worldHasOsm)) {
            // Progressive zoom thresholds and spatial spacing across all detail zoom levels (osmZ 7..14)
            const minCityDistPx =
              cam.zoom < 0.0022
                ? 76
                : cam.zoom < 0.0042
                  ? 68
                  : cam.zoom < 0.0085
                    ? 60
                    : cam.zoom < 0.017
                      ? 54
                      : cam.zoom < 0.035
                        ? 48
                        : cam.zoom < 0.07
                          ? 44
                          : cam.zoom < 0.13
                            ? 40
                            : 34;

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
                  cam.zoom < 0.0022
                    ? city.t === 2 ||
                      (city.t === 1 && city.p >= 60000) ||
                      city.p >= 110000
                    : cam.zoom < 0.0042
                      ? city.t >= 1 || city.p >= 45000
                      : cam.zoom < 0.0085
                        ? city.t >= 1 || city.p >= 22000
                        : cam.zoom < 0.017
                          ? city.t >= 1 || city.p >= 10000
                          : cam.zoom < 0.035
                            ? city.p >= 3500
                            : cam.zoom < 0.07
                              ? city.p >= 1000
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
                  cam.zoom < 0.0022
                    ? mappedTier === 2 ||
                      (mappedTier === 1 && city.p >= 45000) ||
                      city.p >= 85000
                    : cam.zoom < 0.0042
                      ? mappedTier >= 1 || city.p >= 24000
                      : cam.zoom < 0.0085
                        ? mappedTier >= 1 || city.p >= 11000
                        : cam.zoom < 0.017
                          ? city.t >= 1 || city.p >= 4800
                          : cam.zoom < 0.035
                            ? city.p >= 1800
                            : cam.zoom < 0.07
                              ? city.p >= 600
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

            const seenCityNames = new Set<string>();
            for (const c of candidates) {
              seenCityNames.add(c.n.toLowerCase());
              tryDrawCity(c.x, c.y, c.n, c.p, c.t, minCityDistPx, false);
            }

            // Supplement with OSM towns/villages (and suburbs/hamlets only at z >= 13)
            if (worldHasOsm && worldOsmTargetZ >= 10) {
              const osmPlaceCandidates: {
                lon: number;
                lat: number;
                name: string;
                rank: number;
                cls: string;
              }[] = [];
              for (const tile of worldOsmTiles) {
                if (tile.clipBounds) continue;
                for (const pl of tile.labels.places) {
                  if (
                    pl.lon < viewMinLon ||
                    pl.lon > viewMaxLon ||
                    pl.lat < viewMinLat ||
                    pl.lat > viewMaxLat
                  ) {
                    continue;
                  }
                  if (
                    worldOsmTargetZ <= 10 &&
                    pl.cls !== 'city' &&
                    pl.cls !== 'town'
                  ) {
                    continue;
                  }
                  if (
                    worldOsmTargetZ <= 12 &&
                    (pl.cls === 'hamlet' ||
                      pl.cls === 'quarter' ||
                      pl.cls === 'suburb')
                  ) {
                    continue;
                  }
                  const key = pl.name.toLowerCase();
                  if (seenCityNames.has(key)) continue;
                  seenCityNames.add(key);
                  osmPlaceCandidates.push(pl);
                }
              }
              osmPlaceCandidates.sort((a, b) => a.rank - b.rank);
              for (const pl of osmPlaceCandidates) {
                const isLocality =
                  pl.cls === 'hamlet' ||
                  pl.cls === 'quarter' ||
                  pl.cls === 'suburb';
                tryDrawCity(
                  pl.lon,
                  pl.lat,
                  pl.name,
                  pl.cls === 'city'
                    ? 40000
                    : pl.cls === 'town'
                      ? 8000
                      : isLocality
                        ? 150
                        : 1200,
                  0,
                  isLocality ? Math.max(46, minCityDistPx) : minCityDistPx,
                  false
                );
              }
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

        // 9W. World Mountain Peaks (Progressive multi-tier LOD & generous spatial decluttering)
        if (layers.peaks && worldDataset) {
          const placedPeaks: { x: number; y: number }[] = [];

          const minPeakDistPx = !isDetailScale
            ? cam.zoom < 0.00005
              ? 130
              : cam.zoom < 0.00014
                ? 115
                : cam.zoom < 0.00045
                  ? 100
                  : 90
            : cam.zoom < 0.0025
              ? 165
              : cam.zoom < 0.005
                ? 145
                : cam.zoom < 0.01
                  ? 130
                  : cam.zoom < 0.022
                    ? 120
                    : cam.zoom < 0.05
                      ? 112
                      : cam.zoom < 0.1
                        ? 102
                        : 86;

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

            // Enforce generous screen distance between peaks so dominant summits stand out cleanly
            for (let i = 0; i < placedPeaks.length; i++) {
              const dx = placedPeaks[i].x - sx;
              const dy = placedPeaks[i].y - sy;
              if (dx * dx + dy * dy < minPeakDistPx * minPeakDistPx) return;
            }

            const label = `${name} ${elev}`;
            ctx.font = 'italic 500 8.5px "Plus Jakarta Sans", sans-serif';
            const tw = ctx.measureText(label).width;
            const lx = sx + 4.8;
            const ly = sy + 0.5;
            if (!tryPlaceBox(sx - 4, ly - 5.5, tw + 11, 11, false)) return;

            placedPeaks.push({ x: sx, y: sy });

            ctx.beginPath();
            ctx.moveTo(sx, sy - 2.9);
            ctx.lineTo(sx + 2.5, sy + 1.9);
            ctx.lineTo(sx - 2.5, sy + 1.9);
            ctx.closePath();
            ctx.fillStyle = pal.peakColor;
            ctx.strokeStyle = pal.textHalo;
            ctx.lineWidth = 1.05;
            ctx.stroke();
            ctx.fill();

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 2.3;
            ctx.strokeStyle = pal.textHalo;
            ctx.strokeText(label, lx, ly);
            ctx.fillStyle = pal.peakColor;
            ctx.fillText(label, lx, ly);
          };

          if (isDetailScale && (loadedBlocks.length > 0 || worldHasOsm)) {
            const minElevForDetailZoom =
              cam.zoom < 0.0025
                ? 1350
                : cam.zoom < 0.005
                  ? 1150
                  : cam.zoom < 0.01
                    ? 980
                    : cam.zoom < 0.022
                      ? 820
                      : cam.zoom < 0.05
                        ? 650
                        : cam.zoom < 0.1
                          ? 480
                          : 260;

            const peakCandidates: {
              x: number;
              y: number;
              n: string;
              e: number;
            }[] = [];
            const seenPeakNames = new Set<string>();

            for (const blk of loadedBlocks) {
              for (const peak of blk.peaks) {
                if (
                  peak.e < minElevForDetailZoom ||
                  peak.x < viewMinLon ||
                  peak.x > viewMaxLon ||
                  peak.y < viewMinLat ||
                  peak.y > viewMaxLat
                ) {
                  continue;
                }
                seenPeakNames.add(peak.n.toLowerCase());
                peakCandidates.push(peak);
              }
            }

            if (overlapsCz && realDataset) {
              for (const peak of realDataset.places.peaks) {
                if (
                  peak.e < minElevForDetailZoom ||
                  peak.x < viewMinLon ||
                  peak.x > viewMaxLon ||
                  peak.y < viewMinLat ||
                  peak.y > viewMaxLat
                ) {
                  continue;
                }
                seenPeakNames.add(peak.n.toLowerCase());
                peakCandidates.push(peak);
              }
            }

            if (worldHasOsm && worldOsmTargetZ >= 11) {
              for (const tile of worldOsmTiles) {
                if (tile.clipBounds) continue;
                for (const pk of tile.labels.peaks) {
                  if (
                    pk.ele < minElevForDetailZoom ||
                    pk.lon < viewMinLon ||
                    pk.lon > viewMaxLon ||
                    pk.lat < viewMinLat ||
                    pk.lat > viewMaxLat
                  ) {
                    continue;
                  }
                  const key = pk.name.toLowerCase();
                  if (seenPeakNames.has(key)) continue;
                  seenPeakNames.add(key);
                  peakCandidates.push({
                    x: pk.lon,
                    y: pk.lat,
                    n: pk.name,
                    e: pk.ele,
                  });
                }
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

        // 9bW. OSM Water & Transport Labels (placed after cities & peaks so arriving tiles never shift settlement or summit labels)
        if (isDetailScale && worldHasOsm) {
          if (layers.hydrology) {
            renderOsmWaterLabels(worldOsmTiles, worldOsmRc);
          }
          renderOsmTransportLabels(worldOsmTiles, worldOsmRc);
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
        const czTlGeo = worldToGeo(
          cam.cx - (width * 0.505) / cam.zoom,
          cam.cy - (height * 0.505) / cam.zoom
        );
        const czBrGeo = worldToGeo(
          cam.cx + (width * 0.505) / cam.zoom,
          cam.cy + (height * 0.505) / cam.zoom
        );
        const czMinLon = Math.min(czTlGeo.lon, czBrGeo.lon);
        const czMaxLon = Math.max(czTlGeo.lon, czBrGeo.lon);
        const czMinLat = Math.min(czTlGeo.lat, czBrGeo.lat);
        const czMaxLat = Math.max(czTlGeo.lat, czBrGeo.lat);
        const czLevelSpec =
          zoomLevels[findNearestZoomIndex(zoomLevels, cam.zoom)];
        const czOsmTargetZ = czLevelSpec?.osmZ ?? 8;
        const czOsmOpts = buildOsmRenderOptions(
          stylePreset,
          layers,
          pal,
          layers.borders,
          layers.districts
        );
        const czOsmRes = ensureOsmVectorTilesForViewport(
          czMinLon,
          czMaxLon,
          czMinLat,
          czMaxLat,
          czOsmTargetZ,
          czOsmOpts,
          scheduleOsmRedraw
        );
        const czOsmTiles = czOsmRes.tiles;
        const czHasOsm = czOsmTiles.length > 0;
        const czOsmRc: OsmRenderContext = {
          ctx,
          width,
          height,
          zoom: cam.zoom,
          targetZ: czOsmTargetZ,
          stylePreset,
          pal,
          layers,
          projectGeo: geoToWorld,
          wxToSx,
          wyToSy,
          tryPlaceBox,
        };

        // 1b. Pre-rasterized OSM Base Bitmaps (Forests, Wetlands, NP/CHKO, Built-up Urban & Buildings)
        if (czHasOsm) {
          renderOsmBaseBitmaps(czOsmTiles, czOsmRc);
        }

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
          const showMinor = useLocalContours || cam.zoom >= 0.008;
          ctx.save();
          if (cam.zoom < 0.015) {
            ctx.globalAlpha = cam.zoom < 0.007 ? 0.32 : 0.55;
          }
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (showMinor) {
            ctx.strokeStyle = pal.contourMinor;
            ctx.lineWidth = 0.42;
            let segCount = 0;
            ctx.beginPath();
            for (const level of activeContours) {
              if (level.isIndex) continue;
              for (const poly of level.polylines) {
                if (
                  traceClippedWorldPolyline(
                    ctx,
                    poly,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  segCount += poly.length;
                  if (segCount >= 3500) {
                    ctx.stroke();
                    ctx.beginPath();
                    segCount = 0;
                  }
                }
              }
            }
            if (segCount > 0) ctx.stroke();
          }

          ctx.strokeStyle = pal.contourIndex;
          ctx.lineWidth = cam.zoom >= 0.01 ? 0.72 : 0.52;
          {
            let segCount = 0;
            ctx.beginPath();
            for (const level of activeContours) {
              if (!level.isIndex) continue;
              for (const poly of level.polylines) {
                if (
                  traceClippedWorldPolyline(
                    ctx,
                    poly,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  segCount += poly.length;
                  if (segCount >= 3500) {
                    ctx.stroke();
                    ctx.beginPath();
                    segCount = 0;
                  }
                }
              }
            }
            if (segCount > 0) ctx.stroke();
          }
          ctx.restore();

          // Inline contour elevation numbers only at close tourist zoom
          if (cam.zoom >= 0.028) {
            ctx.font = '500 8.5px "JetBrains Mono", monospace';
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
                ctx.lineWidth = 2.6;
                ctx.strokeStyle = pal.contourHalo;
                ctx.strokeText(`${level.elevation}`, 0, 0);
                ctx.fillStyle = pal.contourIndex;
                ctx.fillText(`${level.elevation}`, 0, 0);
                ctx.restore();
              }
            }
          }
        }

        // 5. Administrative Borders: Okresy (77), Kraje (14), and National Border fallback
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
              if (
                traceClippedGeoPolyline(
                  ctx,
                  ring,
                  geoToWorld,
                  wxToSx,
                  wyToSy,
                  width,
                  height,
                  true
                )
              ) {
                ctx.stroke();
              }
            }
          }
          if (!czHasOsm) {
            ctx.strokeStyle = pal.regionBorder;
            ctx.lineWidth = 0.85;
            ctx.setLineDash([4, 4]);
            for (const kraj of realDataset.admin.kraje) {
              for (const ring of kraj.rings) {
                ctx.beginPath();
                if (
                  traceClippedGeoPolyline(
                    ctx,
                    ring,
                    geoToWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    true
                  )
                ) {
                  ctx.stroke();
                }
              }
            }
          }
          ctx.restore();
        }

        if (layers.borders && !czHasOsm) {
          // Fallback National Border while OSM tiles load
          ctx.save();
          ctx.beginPath();
          if (
            traceClippedWorldPolyline(
              ctx,
              borderWorld,
              wxToSx,
              wyToSy,
              width,
              height,
              true
            )
          ) {
            ctx.lineJoin = 'round';
            ctx.strokeStyle = pal.borderOuter;
            ctx.lineWidth = 1.8;
            ctx.stroke();

            ctx.strokeStyle = pal.borderInner;
            ctx.lineWidth = 0.9;
            ctx.stroke();
          }
          ctx.restore();
        }

        // 5b. Composite Pre-Rasterized OSM Overlay Bitmaps (Water, Waterways, Aeroways, Railways & Roads)
        if (czHasOsm) {
          renderOsmOverlayBitmaps(czOsmTiles, czOsmRc);
        }

        // 6. Hydrology fallback (viewport-clipped geometry while OSM tiles load)
        if (layers.hydrology && !czHasOsm) {
          {
            for (const lake of CZECH_LAKES) {
              const screenRing = lake.points.map(([lon, lat]) => {
                const wPt = geoToWorld(lon, lat);
                return { x: wxToSx(wPt.x), y: wyToSy(wPt.y) };
              });
              const clipped = clipPolygonToRect(
                screenRing,
                -16,
                -16,
                width + 16,
                height + 16
              );
              if (clipped.length < 3) continue;
              ctx.beginPath();
              ctx.moveTo(clipped[0].x, clipped[0].y);
              for (let i = 1; i < clipped.length; i++) {
                ctx.lineTo(clipped[i].x, clipped[i].y);
              }
              ctx.closePath();
              ctx.fillStyle = pal.waterFill;
              ctx.fill();
              ctx.strokeStyle = pal.waterStroke;
              ctx.lineWidth = 0.75;
              ctx.stroke();
            }

            if (realDataset) {
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              for (const river of realDataset.vectors.rivers) {
                const wScale = Math.max(0.85, Math.min(2.2, river.w * 1.55));
                for (const line of river.lines) {
                  if (line.length < 2) continue;
                  ctx.beginPath();
                  if (
                    !traceClippedGeoPolyline(
                      ctx,
                      line,
                      geoToWorld,
                      wxToSx,
                      wyToSy,
                      width,
                      height,
                      false
                    )
                  ) {
                    continue;
                  }
                  ctx.strokeStyle = pal.waterStroke;
                  ctx.lineWidth = Math.max(
                    0.75,
                    wScale * (0.42 + Math.min(1.75, cam.zoom * 115))
                  );
                  ctx.stroke();
                  ctx.strokeStyle = pal.waterFill;
                  ctx.lineWidth = Math.max(
                    0.4,
                    wScale * (0.22 + Math.min(0.98, cam.zoom * 65))
                  );
                  ctx.stroke();
                }
              }
            }

            for (const river of CZECH_RIVERS) {
              if (realDataset && !SUPPLEMENTAL_RIVER_IDS.has(river.id)) continue;
              ctx.beginPath();
              if (
                !traceClippedGeoPolyline(
                  ctx,
                  river.points,
                  geoToWorld,
                  wxToSx,
                  wyToSy,
                  width,
                  height,
                  false
                )
              ) {
                continue;
              }
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.strokeStyle = pal.waterStroke;
              ctx.lineWidth = Math.max(
                0.75,
                river.width * (0.42 + Math.min(1.75, cam.zoom * 115))
              );
              ctx.stroke();
              ctx.strokeStyle = pal.waterFill;
              ctx.lineWidth = Math.max(
                0.4,
                river.width * (0.22 + Math.min(0.98, cam.zoom * 65))
              );
              ctx.stroke();
            }
          }
        }

        // 6b. Built-up Urban Footprints fallback (when OSM tiles are still loading)
        if (layers.cities && !czHasOsm) {
          ctx.save();
          ctx.fillStyle = pal.isDark
            ? 'rgba(203, 213, 225, 0.09)'
            : 'rgba(218, 196, 168, 0.18)';
          ctx.strokeStyle = pal.isDark
            ? 'rgba(203, 213, 225, 0.14)'
            : 'rgba(180, 152, 122, 0.14)';
          ctx.lineWidth = 0.5;

          for (const area of CZECH_URBAN_AREAS) {
            const screenRing = area.points.map(([lon, lat]) => {
              const wPt = geoToWorld(lon, lat);
              return { x: wxToSx(wPt.x), y: wyToSy(wPt.y) };
            });
            const clipped = clipPolygonToRect(
              screenRing,
              -16,
              -16,
              width + 16,
              height + 16
            );
            if (clipped.length < 3) continue;
            ctx.beginPath();
            ctx.moveTo(clipped[0].x, clipped[0].y);
            for (let i = 1; i < clipped.length; i++) {
              ctx.lineTo(clipped[i].x, clipped[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }

        // 7a. Real Czech Railway Network fallback (while OSM tiles load)
        if (layers.railways && !czHasOsm && realDataset && cam.zoom >= 0.0022) {
          ctx.save();
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'round';
          for (const rail of realDataset.vectors.railways) {
            if (cam.zoom < 0.0036 && rail.rank > 5) continue;
            for (const line of rail.lines) {
              if (line.length < 2) continue;
              ctx.beginPath();
              if (
                !traceClippedGeoPolyline(
                  ctx,
                  line,
                  geoToWorld,
                  wxToSx,
                  wyToSy,
                  width,
                  height,
                  false
                )
              ) {
                continue;
              }
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

        // 7b. Motorways, Secondary Highways & Trunk Roads fallback (while OSM tiles load)
        if (layers.highways && !czHasOsm) {
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
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    line,
                    geoToWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
                ctx.strokeStyle = pal.isDark
                  ? 'rgba(148, 163, 184, 0.45)'
                  : isSec
                    ? 'rgba(198, 126, 28, 0.76)'
                    : 'rgba(202, 142, 46, 0.66)';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 1.98
                    : 1.35
                  : cam.zoom >= 0.006
                    ? 1.4
                    : 0.9;
                ctx.stroke();

                ctx.strokeStyle = pal.isDark
                  ? '#475569'
                  : isSec
                    ? '#F7AC38'
                    : '#F9C75E';
                ctx.lineWidth = isSec
                  ? cam.zoom >= 0.006
                    ? 1.1
                    : 0.75
                  : cam.zoom >= 0.006
                    ? 0.75
                    : 0.48;
                ctx.stroke();
              }
            }

            // Second pass: Major Highways / Expressways (Dálnice — Mapy.com green)
            for (const rd of realDataset.vectors.roads) {
              if (rd.type !== 'Major Highway' && rd.exp !== 1) continue;
              for (const line of rd.lines) {
                ctx.beginPath();
                if (
                  !traceClippedGeoPolyline(
                    ctx,
                    line,
                    geoToWorld,
                    wxToSx,
                    wyToSy,
                    width,
                    height,
                    false
                  )
                ) {
                  continue;
                }
                ctx.strokeStyle = pal.highwayCasing;
                ctx.lineWidth = cam.zoom >= 0.004 ? 2.45 : 1.68;
                ctx.stroke();
                ctx.strokeStyle = pal.highwayCore;
                ctx.lineWidth = cam.zoom >= 0.004 ? 1.38 : 0.92;
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
                  ctx.fillStyle = isPrimary ? '#3E82B8' : pal.highwayBadgeBg;
                  ctx.fillRect(mx - bw / 2, my - bh / 2, bw, bh);
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
                  ctx.lineWidth = 0.9;
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
                  ? 'rgba(198, 126, 28, 0.72)'
                  : pal.highwayCasing;
              ctx.lineWidth = hw.roadType === 'primary' ? 1.45 : 2.1;
              ctx.stroke();

              drawSmoothPoints(ctx, sPts);
              ctx.strokeStyle =
                hw.roadType === 'primary' ? '#F7AC38' : pal.highwayCore;
              ctx.lineWidth = hw.roadType === 'primary' ? 0.8 : 1.15;
              ctx.stroke();
            }
          }
        }

        // 8. Cities, Towns & Villages (Multi-stage LOD across all 8 zoom levels with clear hierarchy)
        if (layers.cities) {
          const placedCzCities: { x: number; y: number }[] = [];
          const minCzCityDistPx =
            cam.zoom < 0.0032
              ? 74
              : cam.zoom < 0.0068
                ? 66
                : cam.zoom < 0.0135
                  ? 58
                  : cam.zoom < 0.027
                    ? 52
                    : cam.zoom < 0.055
                      ? 48
                      : cam.zoom < 0.11
                        ? 44
                        : cam.zoom < 0.2
                          ? 40
                          : 34;

          if (realDataset) {
            const sortedCzCities = [...realDataset.places.cities].sort(
              (a, b) => b.t - a.t || b.p - a.p
            );

            for (const city of sortedCzCities) {
              const visibleAtZoom =
                cam.zoom < 0.0032
                  ? city.t >= 2 || city.p >= 44000
                  : cam.zoom < 0.0068
                    ? city.t >= 2 || (city.t >= 1 && city.p >= 18000) || city.p >= 22000
                    : cam.zoom < 0.0135
                      ? city.t >= 1 || city.p >= 10500
                      : cam.zoom < 0.027
                        ? city.t >= 1 || city.p >= 4600
                        : cam.zoom < 0.055
                          ? city.p >= 1600
                          : cam.zoom < 0.11
                            ? city.p >= 520
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
              const isDist = city.t === 1;
              const isVillage = !isCap && !isReg && !isDist && city.p < 2500;
              const r = isCap
                ? 3.6
                : isReg
                  ? 2.8
                  : isDist || city.p >= 25000
                    ? 2.35
                    : city.p >= 5000
                      ? 1.95
                      : city.p >= 1500
                        ? 1.65
                        : 1.35;

              ctx.font = isCap
                ? '700 12.6px "Plus Jakarta Sans", sans-serif'
                : isReg
                  ? '600 11px "Plus Jakarta Sans", sans-serif'
                  : isDist || city.p >= 20000
                    ? '600 10px "Plus Jakarta Sans", sans-serif'
                    : city.p >= 4000
                      ? '500 9.4px "Plus Jakarta Sans", sans-serif'
                      : '500 8.8px "Plus Jakarta Sans", sans-serif';
              const displayLabel = isCap ? city.n.toUpperCase() : city.n;
              const tw = ctx.measureText(displayLabel).width;
              const boxH = isCap ? 14 : 11.5;
              const lx = sx;
              const ly = sy - r - boxH * 0.45 - 1.4;
              if (
                !tryPlaceBox(
                  sx - Math.max(tw * 0.5 + 3, r + 2),
                  ly - boxH * 0.5,
                  Math.max(tw + 6, r * 2 + 4),
                  boxH + r * 2 + 3,
                  false
                )
              ) {
                continue;
              }

              placedCzCities.push({ x: sx, y: sy });

              ctx.beginPath();
              ctx.arc(sx, sy, r, 0, Math.PI * 2);
              ctx.fillStyle = pal.cityRing;
              ctx.fill();
              ctx.lineWidth = isCap ? 1.3 : isVillage ? 0.9 : 1.05;
              ctx.strokeStyle = pal.cityDot;
              ctx.stroke();

              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.0;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(displayLabel, lx, ly);
              ctx.fillStyle = pal.textPrimary;
              ctx.fillText(displayLabel, lx, ly);
            }

            // Supplement with OSM cities/towns (including neighboring foreign cities at z >= 7), villages at z >= 11, and localities at z >= 13
            if (czHasOsm && czOsmTargetZ >= 7) {
              const seenCzNames = new Set(
                realDataset.places.cities.map((c) => c.n.toLowerCase())
              );
              const osmExtraPlaces: {
                lon: number;
                lat: number;
                name: string;
                cls: string;
                rank: number;
              }[] = [];
              for (const tile of czOsmTiles) {
                if (tile.clipBounds) continue;
                for (const pl of tile.labels.places) {
                  if (
                    pl.lon < czMinLon ||
                    pl.lon > czMaxLon ||
                    pl.lat < czMinLat ||
                    pl.lat > czMaxLat
                  ) {
                    continue;
                  }
                  if (
                    czOsmTargetZ <= 8 &&
                    pl.cls !== 'city' &&
                    !(pl.cls === 'town' && pl.rank <= 6)
                  ) {
                    continue;
                  }
                  if (
                    czOsmTargetZ === 9 &&
                    pl.cls !== 'city' &&
                    !(pl.cls === 'town' && pl.rank <= 7)
                  ) {
                    continue;
                  }
                  if (
                    czOsmTargetZ === 10 &&
                    pl.cls !== 'city' &&
                    pl.cls !== 'town'
                  ) {
                    continue;
                  }
                  if (
                    czOsmTargetZ <= 12 &&
                    (pl.cls === 'hamlet' ||
                      pl.cls === 'quarter' ||
                      pl.cls === 'suburb')
                  ) {
                    continue;
                  }
                  const key = pl.name.toLowerCase();
                  if (seenCzNames.has(key)) continue;
                  seenCzNames.add(key);
                  osmExtraPlaces.push(pl);
                }
              }
              const clsOrder = (c: string) =>
                c === 'city'
                  ? 0
                  : c === 'town'
                    ? 1
                    : c === 'village'
                      ? 2
                      : 3;
              osmExtraPlaces.sort(
                (a, b) => clsOrder(a.cls) - clsOrder(b.cls) || a.rank - b.rank
              );
              for (const pl of osmExtraPlaces) {
                const wPt = geoToWorld(pl.lon, pl.lat);
                const sx = wxToSx(wPt.x);
                const sy = wyToSy(wPt.y);
                if (
                  sx < -25 ||
                  sx > width + 25 ||
                  sy < -25 ||
                  sy > height + 25
                ) {
                  continue;
                }
                const isLocality =
                  pl.cls === 'suburb' ||
                  pl.cls === 'quarter' ||
                  pl.cls === 'hamlet';
                const reqDist = isLocality
                  ? Math.max(46, minCzCityDistPx)
                  : minCzCityDistPx;
                let tooClose = false;
                for (let i = 0; i < placedCzCities.length; i++) {
                  const dx = placedCzCities[i].x - sx;
                  const dy = placedCzCities[i].y - sy;
                  if (dx * dx + dy * dy < reqDist * reqDist) {
                    tooClose = true;
                    break;
                  }
                }
                if (tooClose) continue;
                const isMajorCity = pl.cls === 'city';
                const isTown = pl.cls === 'town';
                const r = isMajorCity ? 2.6 : isTown ? 2.0 : 1.4;
                ctx.font = isMajorCity
                  ? '600 10.6px "Plus Jakarta Sans", sans-serif'
                  : isTown
                    ? '500 9.5px "Plus Jakarta Sans", sans-serif'
                    : isLocality
                      ? '500 8.3px "Plus Jakarta Sans", sans-serif'
                      : '500 8.8px "Plus Jakarta Sans", sans-serif';
                const tw = ctx.measureText(pl.name).width;
                const boxH = isMajorCity ? 12.5 : isLocality ? 10 : 11;
                const lx = sx;
                const ly = isLocality ? sy : sy - r - boxH * 0.45 - 1.4;
                if (
                  !tryPlaceBox(
                    sx - Math.max(tw * 0.5 + 3, r + 2),
                    ly - boxH * 0.5,
                    Math.max(tw + 6, r * 2 + 4),
                    boxH + (isLocality ? 2 : r * 2 + 3),
                    false
                  )
                ) {
                  continue;
                }
                placedCzCities.push({ x: sx, y: sy });
                if (!isLocality) {
                  ctx.beginPath();
                  ctx.arc(sx, sy, r, 0, Math.PI * 2);
                  ctx.fillStyle = pal.cityRing;
                  ctx.fill();
                  ctx.lineWidth = isMajorCity || isTown ? 1.05 : 0.9;
                  ctx.strokeStyle = pal.cityDot;
                  ctx.stroke();
                }
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.lineWidth = isLocality ? 2.5 : 2.9;
                ctx.strokeStyle = pal.textHalo;
                ctx.strokeText(pl.name, lx, ly);
                ctx.fillStyle = isLocality
                  ? pal.textSecondary
                  : pal.textPrimary;
                ctx.fillText(pl.name, lx, ly);
              }
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
                ? 3.6
                : city.isRegionalSeat
                  ? 2.8
                  : city.population >= 45000
                    ? 2.35
                    : 1.95;

              ctx.font = city.isCapital
                ? '700 12.6px "Plus Jakarta Sans", sans-serif'
                : city.isRegionalSeat
                  ? '600 11px "Plus Jakarta Sans", sans-serif'
                  : '500 9.6px "Plus Jakarta Sans", sans-serif';
              const displayLabel = city.isCapital
                ? city.name.toUpperCase()
                : city.name;
              const tw = ctx.measureText(displayLabel).width;
              const boxH = city.isCapital ? 14 : 11.5;
              const lx = sx;
              const ly = sy - r - boxH * 0.45 - 1.4;
              if (
                !tryPlaceBox(
                  sx - Math.max(tw * 0.5 + 3, r + 2),
                  ly - boxH * 0.5,
                  Math.max(tw + 6, r * 2 + 4),
                  boxH + r * 2 + 3,
                  false
                )
              ) {
                continue;
              }

              ctx.beginPath();
              ctx.arc(sx, sy, r, 0, Math.PI * 2);
              ctx.fillStyle = pal.cityRing;
              ctx.fill();
              ctx.lineWidth = city.isCapital ? 1.3 : 1.05;
              ctx.strokeStyle = pal.cityDot;
              ctx.stroke();

              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.0;
              ctx.strokeStyle = pal.textHalo;
              ctx.strokeText(displayLabel, lx, ly);
              ctx.fillStyle = pal.textPrimary;
              ctx.fillText(displayLabel, lx, ly);
            }
          }
        }

        // 9. Mountain Peaks (▲) (Unified elevation-sorted LOD across all 8 zoom levels with generous spacing)
        if (layers.peaks) {
          const placedCzPeaks: { x: number; y: number }[] = [];
          const minCzPeakDistPx =
            cam.zoom < 0.0032
              ? 170
              : cam.zoom < 0.0068
                ? 145
                : cam.zoom < 0.0135
                  ? 130
                  : cam.zoom < 0.027
                    ? 120
                    : cam.zoom < 0.055
                      ? 112
                      : cam.zoom < 0.11
                        ? 105
                        : cam.zoom < 0.2
                          ? 92
                          : 78;

          const minPeakElev =
            cam.zoom < 0.0032
              ? 1380
              : cam.zoom < 0.0068
                ? 1200
                : cam.zoom < 0.0135
                  ? 1020
                  : cam.zoom < 0.027
                    ? 840
                    : cam.zoom < 0.055
                      ? 700
                      : cam.zoom < 0.11
                        ? 540
                        : cam.zoom < 0.2
                          ? 360
                          : 200;

          if (realDataset) {
            const unifiedPeaks: {
              x: number;
              y: number;
              n: string;
              e: number;
            }[] = [];
            const seenCzPeaks = new Set<string>();

            for (const peak of realDataset.places.peaks) {
              if (peak.e < minPeakElev) continue;
              if (
                peak.x < czMinLon ||
                peak.x > czMaxLon ||
                peak.y < czMinLat ||
                peak.y > czMaxLat
              ) {
                continue;
              }
              seenCzPeaks.add(peak.n.toLowerCase());
              unifiedPeaks.push(peak);
            }

            if (czHasOsm && czOsmTargetZ >= 11) {
              for (const tile of czOsmTiles) {
                if (tile.clipBounds) continue;
                for (const pk of tile.labels.peaks) {
                  if (pk.ele < minPeakElev) continue;
                  if (
                    pk.lon < czMinLon ||
                    pk.lon > czMaxLon ||
                    pk.lat < czMinLat ||
                    pk.lat > czMaxLat
                  ) {
                    continue;
                  }
                  const key = pk.name.toLowerCase();
                  if (seenCzPeaks.has(key)) continue;
                  seenCzPeaks.add(key);
                  unifiedPeaks.push({
                    x: pk.lon,
                    y: pk.lat,
                    n: pk.name,
                    e: pk.ele,
                  });
                }
              }
            }

            // Sort all candidate peaks by elevation descending so the highest summits in every range win
            unifiedPeaks.sort((a, b) => b.e - a.e);

            for (const peak of unifiedPeaks) {
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
              ctx.font = 'italic 500 8.5px "Plus Jakarta Sans", sans-serif';
              const tw = ctx.measureText(label).width;
              const lx = sx + 4.8;
              const ly = sy + 0.5;
              if (!tryPlaceBox(sx - 4, ly - 5.5, tw + 11, 11, false)) continue;

              placedCzPeaks.push({ x: sx, y: sy });

              ctx.beginPath();
              ctx.moveTo(sx, sy - 2.9);
              ctx.lineTo(sx + 2.5, sy + 1.9);
              ctx.lineTo(sx - 2.5, sy + 1.9);
              ctx.closePath();
              ctx.fillStyle = pal.peakColor;
              ctx.strokeStyle = pal.textHalo;
              ctx.lineWidth = 1.05;
              ctx.stroke();
              ctx.fill();

              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 2.3;
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

        // 9b. OSM Water & Transport Labels (placed after cities & peaks so arriving tiles never shift settlement or summit labels)
        if (czHasOsm) {
          if (layers.hydrology) {
            renderOsmWaterLabels(czOsmTiles, czOsmRc);
          }
          renderOsmTransportLabels(czOsmTiles, czOsmRc);
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

        // Build viewport-clipped path
        ctx.beginPath();
        let hasTrackSeg = false;
        {
          const p0 = projectGeo(track.points[0].lon, track.points[0].lat);
          let prevX = wxToSx(p0.x);
          let prevY = wyToSy(p0.y);
          for (let idx = 1; idx < track.points.length; idx++) {
            const p = projectGeo(track.points[idx].lon, track.points[idx].lat);
            const nx = wxToSx(p.x);
            const ny = wyToSy(p.y);
            if (
              addClippedSegment(
                ctx,
                prevX,
                prevY,
                nx,
                ny,
                -32,
                -32,
                width + 32,
                height + 32
              )
            ) {
              hasTrackSeg = true;
            }
            prevX = nx;
            prevY = ny;
          }
        }

        if (hasTrackSeg) {
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
        }

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
      osmRevision,
      scheduleOsmRedraw,
      scheduleBlockRedraw,
      borderWorld,
      layers,
      terrain.contours,
      worldTerrain.contours,
      zoomLevels,
      selectedPoint,
      gpxTracks,
      activeGpxId,
      gpxHoverGeo,
    ]
  );

  // Redraw canvas on state changes (cap DPR & total backing pixels to keep GPU VRAM light inside iframe)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = viewportSize.width;
    const h = viewportSize.height;
    if (w === 0 || h === 0) return;

    const rawDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const maxPixels = 2_600_000;
    const pixelBudgetScale = Math.sqrt(maxPixels / Math.max(1, w * h));
    const dpr = Math.max(1, Math.min(rawDpr, pixelBudgetScale));

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderMap(ctx, w, h, camera);
    ctx.restore();
  }, [viewportSize, camera, renderMap]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => setZoomToLevelIndex(activeZoomIndex + 1),
      zoomOut: () => setZoomToLevelIndex(activeZoomIndex - 1),
      resetView: () =>
        setCamera({
          cx: activeWidth * 0.5,
          cy: activeHeight * 0.49,
          zoom: zoomLevels[0].zoom,
        }),
      focusGeo: (lon: number, lat: number, targetZoom?: number) => {
        const wPt = projectGeo(lon, lat);
        const defaultZoom = mapScope === 'world' ? 0.0025 : 0.0058;
        setCamera((c) => {
          const desired = targetZoom ?? Math.max(c.zoom, defaultZoom);
          const snappedIdx = findNearestZoomIndex(zoomLevels, desired);
          return {
            cx: wPt.x,
            cy: wPt.y,
            zoom: zoomLevels[snappedIdx].zoom,
          };
        });
      },
      fitGeoBounds: (bounds) => {
        const topLeft = projectGeo(bounds.minLon, bounds.maxLat);
        const botRight = projectGeo(bounds.maxLon, bounds.minLat);
        const bw = Math.max(4000, botRight.x - topLeft.x);
        const bh = Math.max(3000, botRight.y - topLeft.y);
        const zx = (viewportSize.width * 0.72) / bw;
        const zy = (viewportSize.height * 0.66) / bh;
        const rawZoom = Math.min(zx, zy);
        let chosenIdx = 0;
        for (let i = 0; i < zoomLevels.length; i++) {
          if (zoomLevels[i].zoom <= rawZoom * 1.15) chosenIdx = i;
        }
        setCamera({
          cx: (topLeft.x + botRight.x) * 0.5,
          cy: (topLeft.y + botRight.y) * 0.5,
          zoom: zoomLevels[chosenIdx].zoom,
        });
      },
      exportPng: () => {
        const outW = 1920;
        const outH = 1248;
        const mapH = 1152;
        const off = document.createElement('canvas');
        off.width = outW;
        off.height = outH;
        const ctx = off.getContext('2d')!;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, outW, mapH);
        ctx.clip();
        renderMap(
          ctx,
          outW,
          mapH,
          {
            cx: camera.cx,
            cy: camera.cy,
            zoom: camera.zoom * (outW / Math.max(1, viewportSize.width)),
          },
          true
        );
        ctx.restore();

        // Footer cartouche
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, mapH, outW, outH - mapH);
        ctx.strokeStyle = '#D6D3C9';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, mapH);
        ctx.lineTo(outW, mapH);
        ctx.stroke();

        ctx.fillStyle = '#1A1F1C';
        ctx.font = '700 26px "Outfit", sans-serif';
        ctx.fillText(
          mapScope === 'world'
            ? 'Fyzická a batymetrická mapa světa — Kartografický atlas'
            : 'Česká republika — Topografický mapový podklad',
          38,
          mapH + 42
        );

        ctx.fillStyle = '#545E58';
        ctx.font = '500 15px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(
          mapScope === 'world'
            ? 'Globální reliéf a batymetrie oceánů · 240 států · Vodní síť · Světové metropole a velehorstva · WGS84'
            : 'Reliéfní hypsometrie · Stínovaný terén · Vodní síť · Silniční tahy · Vrstevnice 10–200 m · WGS84',
          38,
          mapH + 72
        );

        const sb = pickScaleBar(camera.zoom * (outW / Math.max(1, viewportSize.width)));
        const sbX = outW - sb.px - 48;
        ctx.fillStyle = '#1A1F1C';
        ctx.fillRect(sbX, mapH + 56, sb.px, 6);
        ctx.font = '500 15px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(sb.label, outW - 48, mapH + 44);

        const url = off.toDataURL('image/png');
        off.width = 0;
        off.height = 0;
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
      activeZoomIndex,
      zoomLevels,
      setZoomToLevelIndex,
      projectGeo,
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
      return;
    }

    const now = performance.now();
    if (now - lastHoverCheckRef.current < 120) return;
    lastHoverCheckRef.current = now;

    if (
      wPt.x >= 0 &&
      wPt.x <= activeWidth &&
      wPt.y >= 0 &&
      wPt.y <= activeHeight
    ) {
      setCursorWorld((prev) => {
        if (
          prev &&
          Math.hypot(prev.x - wPt.x, prev.y - wPt.y) * camera.zoom < 2.5
        ) {
          return prev;
        }
        return wPt;
      });
    } else {
      setCursorWorld((prev) => (prev === null ? null : null));
    }

    const hitGpx = findNearestGpxTrack(wPt.x, wPt.y);
    setHoveredEntity((prev) => (prev === hitGpx ? prev : hitGpx));
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
    const now = performance.now();
    if (now - wheelCooldownRef.current < 135) return;

    wheelAccumRef.current += e.deltaY;
    if (Math.abs(wheelAccumRef.current) < 12) return;

    const direction = wheelAccumRef.current < 0 ? 1 : -1;
    wheelAccumRef.current = 0;
    wheelCooldownRef.current = now;

    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setZoomToLevelIndex(activeZoomIndex + direction, sx, sy);
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
    if (mapScope === 'cz') {
      return `· Stupeň ${activeZoomLevel.level}/${zoomLevels.length} (${activeZoomLevel.label}) · OSM z${activeZoomLevel.osmZ ?? 7}`;
    }
    if (activeZoomLevel.osmZ === null) {
      return `· Stupeň ${activeZoomLevel.level}/${zoomLevels.length} (${activeZoomLevel.label}) · Detail OSM od stupně 6`;
    }
    const tl = globalWorldToGeo(
      camera.cx - (viewportSize.width * 0.56) / camera.zoom,
      camera.cy - (viewportSize.height * 0.56) / camera.zoom
    );
    const br = globalWorldToGeo(
      camera.cx + (viewportSize.width * 0.56) / camera.zoom,
      camera.cy + (viewportSize.height * 0.56) / camera.zoom
    );
    const minLon = Math.min(tl.lon, br.lon);
    const maxLon = Math.max(tl.lon, br.lon);
    const minLat = Math.min(tl.lat, br.lat);
    const maxLat = Math.max(tl.lat, br.lat);
    const activeMetas = worldPlacesIndex
      ? getIntersectingWorldBlocks(
          worldPlacesIndex,
          minLon,
          maxLon,
          minLat,
          maxLat,
          1.8
        )
      : [];
    const primaryCode = activeMetas[0]?.code ?? 'OCEÁN';
    return `· Stupeň ${activeZoomLevel.level}/${zoomLevels.length} · Blok ${primaryCode}${
      activeMetas.length > 1 ? ` +${activeMetas.length - 1}` : ''
    } · OSM z${activeZoomLevel.osmZ}`;
  }, [
    mapScope,
    activeZoomLevel,
    zoomLevels.length,
    camera.cx,
    camera.cy,
    camera.zoom,
    viewportSize.width,
    viewportSize.height,
    worldPlacesIndex,
    blockRevision,
    osmRevision,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-[#F5F3EB]"
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

      {/* Top-right Navigation & Fixed Zoom Level Controls */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-1.5 z-10">
        <div className="flex flex-col bg-white/95 backdrop-blur-sm border border-[#1C2420]/12 rounded-lg shadow-sm overflow-hidden">
          <button
            type="button"
            disabled={activeZoomIndex >= zoomLevels.length - 1}
            onClick={() => setZoomToLevelIndex(activeZoomIndex + 1)}
            title="Přiblížit o 1 stupeň"
            aria-label="Přiblížit mapu"
            className="w-10 h-10 flex items-center justify-center text-[#1C2420] hover:bg-[#F2F0E8] disabled:opacity-35 disabled:hover:bg-transparent transition-colors border-b border-[#1C2420]/10"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoomMenuOpen((v) => !v)}
            title={`Pevný stupeň přiblížení ${activeZoomLevel.level} z ${zoomLevels.length} (${activeZoomLevel.label})`}
            aria-label="Vybrat stupeň přiblížení"
            className="w-10 h-9 flex flex-col items-center justify-center text-[#1E5631] bg-[#F5F8F4] hover:bg-[#E8F2EC] transition-colors border-b border-[#1C2420]/10"
          >
            <span className="text-[11px] font-mono-tabular font-bold leading-none">
              {activeZoomLevel.level}/{zoomLevels.length}
            </span>
          </button>
          <button
            type="button"
            disabled={activeZoomIndex <= 0}
            onClick={() => setZoomToLevelIndex(activeZoomIndex - 1)}
            title="Oddálit o 1 stupeň"
            aria-label="Oddálit mapu"
            className="w-10 h-10 flex items-center justify-center text-[#1C2420] hover:bg-[#F2F0E8] disabled:opacity-35 disabled:hover:bg-transparent transition-colors border-b border-[#1C2420]/10"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              setCamera({
                cx: activeWidth * 0.5,
                cy: activeHeight * 0.49,
                zoom: zoomLevels[0].zoom,
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

        {zoomMenuOpen && (
          <div className="w-48 bg-white/97 backdrop-blur-sm border border-[#1C2420]/15 rounded-lg shadow-lg p-1.5 max-h-[340px] overflow-y-auto">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#5B6760]">
              Stupně přiblížení
            </div>
            {zoomLevels.map((lvl, idx) => {
              const active = idx === activeZoomIndex;
              return (
                <button
                  key={lvl.level}
                  type="button"
                  onClick={() => {
                    setZoomToLevelIndex(idx);
                    setZoomMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-xs transition-colors ${
                    active
                      ? 'bg-[#E8F2EC] text-[#1E5631] font-semibold'
                      : 'text-[#1C2420] hover:bg-[#F5F3EC]'
                  }`}
                >
                  <span className="truncate">
                    <span className="font-mono-tabular mr-1.5">
                      {lvl.level}.
                    </span>
                    {lvl.label}
                  </span>
                  {lvl.osmZ !== null && (
                    <span className="text-[10px] font-mono-tabular text-[#5B6760] ml-1 shrink-0">
                      z{lvl.osmZ}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

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
