import { LayerVisibility, MapStylePreset, Point2D } from '../types/map';
import { DecodedOsmTile, OsmRoadClass } from './osmVectorTiles';

export interface OsmRenderPalette {
  isDark: boolean;
  waterFill: string;
  waterStroke: string;
  highwayCasing: string;
  highwayCore: string;
  highwayBadgeBg: string;
  highwayBadgeText: string;
  borderOuter: string;
  borderInner: string;
  regionBorder: string;
  textPrimary: string;
  textSecondary: string;
  textHalo: string;
}

export interface OsmRenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  zoom: number;
  targetZ: number;
  stylePreset: MapStylePreset;
  pal: OsmRenderPalette;
  layers: LayerVisibility;
  projectGeo: (lon: number, lat: number) => Point2D;
  wxToSx: (wx: number) => number;
  wyToSy: (wy: number) => number;
  tryPlaceBox: (
    x: number,
    y: number,
    w: number,
    h: number,
    force?: boolean
  ) => boolean;
}

function getTileScreenRect(
  tile: DecodedOsmTile,
  rc: OsmRenderContext
): { x: number; y: number; w: number; h: number } {
  const [minLon, minLat, maxLon, maxLat] = tile.bounds;
  const tl = rc.projectGeo(minLon, maxLat);
  const br = rc.projectGeo(maxLon, minLat);
  const x0 = rc.wxToSx(tl.x);
  const y0 = rc.wyToSy(tl.y);
  const x1 = rc.wxToSx(br.x);
  const y1 = rc.wyToSy(br.y);
  return {
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
  };
}

function traceFlatRing(
  ctx: CanvasRenderingContext2D,
  arr: Float32Array,
  rc: OsmRenderContext,
  close: boolean
) {
  const len = arr.length;
  if (len < 4) return;
  const p0 = rc.projectGeo(arr[0], arr[1]);
  ctx.moveTo(rc.wxToSx(p0.x), rc.wyToSy(p0.y));
  for (let i = 2; i < len; i += 2) {
    const p = rc.projectGeo(arr[i], arr[i + 1]);
    ctx.lineTo(rc.wxToSx(p.x), rc.wyToSy(p.y));
  }
  if (close) ctx.closePath();
}

/**
 * Pass 1: Real OSM forest cover, wetlands, glaciers, protected parks,
 * built-up urban areas, and close-zoom building footprints.
 * Drawn right over the shaded terrain raster and beneath contours & hydrology.
 */
export function renderOsmLandcoverAndUrban(
  tiles: DecodedOsmTile[],
  rc: OsmRenderContext
) {
  const { ctx, layers, stylePreset, pal, targetZ } = rc;
  if (tiles.length === 0) return;

  const forestFill =
    stylePreset === 'dark'
      ? 'rgba(42, 78, 58, 0.34)'
      : stylePreset === 'natural'
        ? 'rgba(72, 118, 66, 0.34)'
        : stylePreset === 'light'
          ? 'rgba(176, 202, 166, 0.28)'
          : 'rgba(116, 164, 96, 0.25)';

  const wetlandFill = pal.isDark
    ? 'rgba(56, 118, 128, 0.24)'
    : 'rgba(116, 178, 172, 0.24)';

  const glacierFill = pal.isDark
    ? 'rgba(203, 213, 225, 0.22)'
    : 'rgba(244, 249, 255, 0.62)';

  const urbanFill = pal.isDark
    ? 'rgba(203, 213, 225, 0.08)'
    : stylePreset === 'light'
      ? 'rgba(224, 212, 194, 0.22)'
      : 'rgba(222, 202, 176, 0.20)';

  const urbanStroke = pal.isDark
    ? 'rgba(203, 213, 225, 0.12)'
    : 'rgba(178, 152, 124, 0.16)';

  const buildingFill = pal.isDark
    ? 'rgba(148, 163, 184, 0.24)'
    : 'rgba(166, 148, 130, 0.26)';
  const buildingStroke = pal.isDark
    ? 'rgba(203, 213, 225, 0.22)'
    : 'rgba(128, 112, 96, 0.32)';

  for (const tile of tiles) {
    const rect = getTileScreenRect(tile, rc);
    if (
      rect.x + rect.w < -10 ||
      rect.x > rc.width + 10 ||
      rect.y + rect.h < -10 ||
      rect.y > rc.height + 10
    ) {
      continue;
    }

    ctx.save();
    // Clip to exact tile screen rectangle so MVT polygon buffers never double-blend at tile edges
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w + 0.6, rect.h + 0.6);
    ctx.clip();

    // 1. Forests, wetlands & glaciers
    if (layers.forests) {
      if (tile.forests.length > 0) {
        ctx.beginPath();
        for (let i = 0; i < tile.forests.length; i++) {
          traceFlatRing(ctx, tile.forests[i], rc, true);
        }
        ctx.fillStyle = forestFill;
        ctx.fill('evenodd');
      }

      if (tile.wetlands.length > 0) {
        ctx.beginPath();
        for (let i = 0; i < tile.wetlands.length; i++) {
          traceFlatRing(ctx, tile.wetlands[i], rc, true);
        }
        ctx.fillStyle = wetlandFill;
        ctx.fill('evenodd');
      }

      if (tile.glaciers.length > 0) {
        ctx.beginPath();
        for (let i = 0; i < tile.glaciers.length; i++) {
          traceFlatRing(ctx, tile.glaciers[i], rc, true);
        }
        ctx.fillStyle = glacierFill;
        ctx.fill('evenodd');
      }

      // National parks & CHKO boundaries at z >= 9
      if (targetZ >= 9 && tile.parks.length > 0) {
        ctx.strokeStyle = pal.isDark
          ? 'rgba(74, 222, 128, 0.28)'
          : 'rgba(34, 108, 56, 0.32)';
        ctx.lineWidth = targetZ >= 11 ? 1.15 : 0.85;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        for (let i = 0; i < tile.parks.length; i++) {
          const pk = tile.parks[i];
          if (targetZ < 10 && !pk.isNational) continue;
          for (let r = 0; r < pk.rings.length; r++) {
            traceFlatRing(ctx, pk.rings[r], rc, true);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 2. Real OSM built-up urban footprints (subtle & light)
    if (layers.cities && tile.urban.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < tile.urban.length; i++) {
        traceFlatRing(ctx, tile.urban[i], rc, true);
      }
      ctx.fillStyle = urbanFill;
      ctx.fill('evenodd');
      if (targetZ >= 10) {
        ctx.strokeStyle = urbanStroke;
        ctx.lineWidth = 0.45;
        ctx.stroke();
      }
    }

    // 3. Individual building footprints at street zoom (z >= 13)
    if (layers.cities && targetZ >= 13 && tile.buildings.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < tile.buildings.length; i++) {
        traceFlatRing(ctx, tile.buildings[i], rc, true);
      }
      ctx.fillStyle = buildingFill;
      ctx.fill('evenodd');
      ctx.strokeStyle = buildingStroke;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    ctx.restore();
  }
}

/**
 * Pass 2: Real OSM Hydrology — lakes, reservoirs, ponds, wide river polygons,
 * rivers, canals, streams, and water body / river name labels.
 */
export function renderOsmHydrology(
  tiles: DecodedOsmTile[],
  rc: OsmRenderContext
) {
  const { ctx, layers, pal, targetZ } = rc;
  if (!layers.hydrology || tiles.length === 0) return;

  // 2a. Filled water polygons (lakes, reservoirs, ponds, river channels) — clipped per tile
  for (const tile of tiles) {
    if (tile.waterPolys.length === 0) continue;
    const rect = getTileScreenRect(tile, rc);
    if (
      rect.x + rect.w < -10 ||
      rect.x > rc.width + 10 ||
      rect.y + rect.h < -10 ||
      rect.y > rc.height + 10
    ) {
      continue;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w + 0.6, rect.h + 0.6);
    ctx.clip();

    ctx.beginPath();
    for (let i = 0; i < tile.waterPolys.length; i++) {
      const wp = tile.waterPolys[i];
      for (let r = 0; r < wp.rings.length; r++) {
        traceFlatRing(ctx, wp.rings[r], rc, true);
      }
    }
    ctx.fillStyle = pal.waterFill;
    ctx.fill('evenodd');
    ctx.strokeStyle = pal.waterStroke;
    ctx.lineWidth = targetZ >= 11 ? 0.9 : 0.7;
    ctx.stroke();
    ctx.restore();
  }

  // 2b. Linear waterways (streams -> canals -> rivers)
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const streamW = targetZ >= 13 ? 1.15 : targetZ >= 11 ? 0.85 : 0.65;
  const canalW = targetZ >= 12 ? 2.0 : targetZ >= 10 ? 1.45 : 1.05;
  const riverOuterW =
    targetZ >= 13
      ? 3.6
      : targetZ >= 11
        ? 2.8
        : targetZ >= 9
          ? 2.1
          : 1.55;
  const riverInnerW = riverOuterW * 0.52;

  const labeledWaterNames = new Set<string>();
  const riverLabelCandidates: {
    name: string;
    sx: number;
    sy: number;
    ang: number;
    isRiver: boolean;
  }[] = [];

  for (const tile of tiles) {
    if (tile.waterways.length === 0) continue;
    const rect = getTileScreenRect(tile, rc);
    if (
      rect.x + rect.w < -10 ||
      rect.x > rc.width + 10 ||
      rect.y + rect.h < -10 ||
      rect.y > rc.height + 10
    ) {
      continue;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
    ctx.clip();

    // Streams (potoky)
    if (targetZ >= 10) {
      ctx.strokeStyle = pal.waterStroke;
      ctx.lineWidth = streamW;
      ctx.beginPath();
      for (let i = 0; i < tile.waterways.length; i++) {
        const ww = tile.waterways[i];
        if (ww.cls !== 'stream' || ww.intermittent) continue;
        for (let l = 0; l < ww.lines.length; l++) {
          traceFlatRing(ctx, ww.lines[l], rc, false);
        }
      }
      ctx.stroke();

      // Intermittent streams dashed
      if (targetZ >= 12) {
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (let i = 0; i < tile.waterways.length; i++) {
          const ww = tile.waterways[i];
          if (ww.cls !== 'stream' || !ww.intermittent) continue;
          for (let l = 0; l < ww.lines.length; l++) {
            traceFlatRing(ctx, ww.lines[l], rc, false);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Canals
    ctx.strokeStyle = pal.waterStroke;
    ctx.lineWidth = canalW;
    ctx.beginPath();
    for (let i = 0; i < tile.waterways.length; i++) {
      const ww = tile.waterways[i];
      if (ww.cls !== 'canal') continue;
      for (let l = 0; l < ww.lines.length; l++) {
        traceFlatRing(ctx, ww.lines[l], rc, false);
      }
    }
    ctx.stroke();

    // Rivers (casing + waterFill core)
    ctx.beginPath();
    for (let i = 0; i < tile.waterways.length; i++) {
      const ww = tile.waterways[i];
      if (ww.cls !== 'river') continue;
      for (let l = 0; l < ww.lines.length; l++) {
        traceFlatRing(ctx, ww.lines[l], rc, false);
      }
    }
    ctx.strokeStyle = pal.waterStroke;
    ctx.lineWidth = riverOuterW;
    ctx.stroke();
    ctx.strokeStyle = pal.waterFill;
    ctx.lineWidth = riverInnerW;
    ctx.stroke();

    ctx.restore();

    // Collect river / stream labels
    for (let i = 0; i < tile.waterways.length; i++) {
      const ww = tile.waterways[i];
      if (!ww.name) continue;
      if (ww.cls === 'stream' && targetZ < 12) continue;
      const line = ww.lines[0];
      if (!line || line.length < 6) continue;
      const midPtIdx = Math.floor(line.length / 4) * 2;
      const prevIdx = Math.max(0, midPtIdx - 2);
      const nextIdx = Math.min(line.length - 2, midPtIdx + 2);
      const pM = rc.projectGeo(line[midPtIdx], line[midPtIdx + 1]);
      const pA = rc.projectGeo(line[prevIdx], line[prevIdx + 1]);
      const pB = rc.projectGeo(line[nextIdx], line[nextIdx + 1]);
      const sx = rc.wxToSx(pM.x);
      const sy = rc.wyToSy(pM.y);
      if (sx < 36 || sx > rc.width - 36 || sy < 24 || sy > rc.height - 24)
        continue;
      let ang = Math.atan2(
        rc.wyToSy(pB.y) - rc.wyToSy(pA.y),
        rc.wxToSx(pB.x) - rc.wxToSx(pA.x)
      );
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      riverLabelCandidates.push({
        name: ww.name,
        sx,
        sy,
        ang,
        isRiver: ww.cls === 'river',
      });
    }
  }

  // 2c. Lake & Reservoir Names
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const tile of tiles) {
    for (let i = 0; i < tile.waterLabels.length; i++) {
      const wl = tile.waterLabels[i];
      if (labeledWaterNames.has(wl.name)) continue;
      const wPt = rc.projectGeo(wl.lon, wl.lat);
      const sx = rc.wxToSx(wPt.x);
      const sy = rc.wyToSy(wPt.y);
      if (sx < 35 || sx > rc.width - 35 || sy < 20 || sy > rc.height - 20)
        continue;
      ctx.font = 'italic 600 10px "Plus Jakarta Sans", sans-serif';
      const tw = ctx.measureText(wl.name).width;
      if (!rc.tryPlaceBox(sx - tw / 2 - 4, sy - 7, tw + 8, 14, false))
        continue;
      labeledWaterNames.add(wl.name);
      ctx.lineWidth = 2.8;
      ctx.strokeStyle = pal.textHalo;
      ctx.strokeText(wl.name, sx, sy);
      ctx.fillStyle = pal.waterStroke;
      ctx.fillText(wl.name, sx, sy);
    }
  }

  // 2d. River & Stream Names
  riverLabelCandidates.sort((a, b) => Number(b.isRiver) - Number(a.isRiver));
  for (let i = 0; i < riverLabelCandidates.length; i++) {
    const rl = riverLabelCandidates[i];
    if (labeledWaterNames.has(rl.name)) continue;
    ctx.font = rl.isRiver
      ? 'italic 600 10px "Plus Jakarta Sans", sans-serif'
      : 'italic 500 8.8px "Plus Jakarta Sans", sans-serif';
    const tw = ctx.measureText(rl.name).width;
    if (!rc.tryPlaceBox(rl.sx - tw / 2 - 3, rl.sy - 7, tw + 6, 14, false))
      continue;
    labeledWaterNames.add(rl.name);
    ctx.save();
    ctx.translate(rl.sx, rl.sy - 5);
    ctx.rotate(rl.ang);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = pal.textHalo;
    ctx.strokeText(rl.name, 0, 0);
    ctx.fillStyle = pal.waterStroke;
    ctx.fillText(rl.name, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

interface RoadStyleSpec {
  minZ: number;
  casing: string;
  core: string;
  casingW: number;
  coreW: number;
  dash?: number[];
}

function getRoadStyles(
  targetZ: number,
  pal: OsmRenderPalette
): Record<OsmRoadClass, RoadStyleSpec> {
  const zScale =
    targetZ >= 14
      ? 1.55
      : targetZ >= 13
        ? 1.35
        : targetZ >= 12
          ? 1.18
          : targetZ >= 11
            ? 1.04
            : targetZ >= 9
              ? 0.92
              : 0.78;

  if (pal.isDark) {
    return {
      ferry: {
        minZ: 8,
        casing: 'rgba(96, 165, 250, 0.45)',
        core: 'rgba(96, 165, 250, 0.45)',
        casingW: 1.0,
        coreW: 0,
        dash: [4, 4],
      },
      path: {
        minZ: 13,
        casing: 'rgba(148, 163, 184, 0.30)',
        core: '',
        casingW: 0.75 * zScale,
        coreW: 0,
        dash: [2.5, 2.5],
      },
      track: {
        minZ: 12,
        casing: 'rgba(148, 163, 184, 0.36)',
        core: '',
        casingW: 0.9 * zScale,
        coreW: 0,
        dash: [4, 2.5],
      },
      service: {
        minZ: 13,
        casing: 'rgba(100, 116, 139, 0.45)',
        core: '#334155',
        casingW: 1.5 * zScale,
        coreW: 0.7 * zScale,
      },
      minor: {
        minZ: 11,
        casing: 'rgba(100, 116, 139, 0.55)',
        core: '#475569',
        casingW: 2.0 * zScale,
        coreW: 1.0 * zScale,
      },
      tertiary: {
        minZ: 10,
        casing: 'rgba(148, 163, 184, 0.55)',
        core: '#64748B',
        casingW: 2.5 * zScale,
        coreW: 1.35 * zScale,
      },
      secondary: {
        minZ: 9,
        casing: '#78350F',
        core: '#B45309',
        casingW: 3.0 * zScale,
        coreW: 1.65 * zScale,
      },
      primary: {
        minZ: 7,
        casing: '#92400E',
        core: '#D97706',
        casingW: 3.5 * zScale,
        coreW: 1.95 * zScale,
      },
      trunk: {
        minZ: 7,
        casing: '#7C2D12',
        core: '#EA580C',
        casingW: 4.0 * zScale,
        coreW: 2.25 * zScale,
      },
      motorway: {
        minZ: 7,
        casing: '#991B1B',
        core: '#F59E0B',
        casingW: 4.5 * zScale,
        coreW: 2.5 * zScale,
      },
    };
  }

  return {
    ferry: {
      minZ: 8,
      casing: 'rgba(46, 111, 163, 0.55)',
      core: '',
      casingW: 1.0,
      coreW: 0,
      dash: [4, 4],
    },
    path: {
      minZ: 13,
      casing: 'rgba(136, 112, 86, 0.55)',
      core: '',
      casingW: 0.75 * zScale,
      coreW: 0,
      dash: [2.5, 2.5],
    },
    track: {
      minZ: 12,
      casing: 'rgba(128, 102, 74, 0.62)',
      core: '',
      casingW: 0.9 * zScale,
      coreW: 0,
      dash: [4, 2.5],
    },
    service: {
      minZ: 13,
      casing: 'rgba(156, 146, 134, 0.55)',
      core: '#F8F7F4',
      casingW: 1.55 * zScale,
      coreW: 0.8 * zScale,
    },
    minor: {
      minZ: 11,
      casing: 'rgba(140, 130, 118, 0.62)',
      core: '#FFFFFF',
      casingW: 2.1 * zScale,
      coreW: 1.2 * zScale,
    },
    tertiary: {
      minZ: 10,
      casing: 'rgba(148, 126, 96, 0.72)',
      core: '#FEFCE8',
      casingW: 2.6 * zScale,
      coreW: 1.55 * zScale,
    },
    secondary: {
      minZ: 9,
      casing: '#B4823C',
      core: '#FEF08A',
      casingW: 3.1 * zScale,
      coreW: 1.85 * zScale,
    },
    primary: {
      minZ: 7,
      casing: '#B45309',
      core: '#FCD34D',
      casingW: 3.6 * zScale,
      coreW: 2.15 * zScale,
    },
    trunk: {
      minZ: 7,
      casing: '#9A3412',
      core: '#F59E0B',
      casingW: 4.1 * zScale,
      coreW: 2.45 * zScale,
    },
    motorway: {
      minZ: 7,
      casing: '#991B1B',
      core: '#FB923C',
      casingW: 4.7 * zScale,
      coreW: 2.75 * zScale,
    },
  };
}

const ROAD_DRAW_ORDER: OsmRoadClass[] = [
  'ferry',
  'path',
  'track',
  'service',
  'minor',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'motorway',
];

/**
 * Pass 3: Real OSM Aeroways, Railways, Complete Road Network (motorway -> path),
 * Route Number Shields, and Close-Zoom Street Names.
 */
export function renderOsmTransport(
  tiles: DecodedOsmTile[],
  rc: OsmRenderContext
) {
  const { ctx, layers, pal, targetZ } = rc;
  if ((!layers.highways && !layers.railways) || tiles.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 3a. Aeroways (runways & aprons at z >= 10)
  if (layers.highways && targetZ >= 10) {
    for (const tile of tiles) {
      if (tile.aeroways.length === 0) continue;
      for (let i = 0; i < tile.aeroways.length; i++) {
        const aw = tile.aeroways[i];
        if (aw.rings.length > 0) {
          ctx.beginPath();
          for (let r = 0; r < aw.rings.length; r++) {
            traceFlatRing(ctx, aw.rings[r], rc, true);
          }
          ctx.fillStyle = pal.isDark
            ? 'rgba(148, 163, 184, 0.25)'
            : 'rgba(148, 144, 138, 0.35)';
          ctx.fill();
        }
        if (aw.lines.length > 0) {
          ctx.beginPath();
          for (let l = 0; l < aw.lines.length; l++) {
            traceFlatRing(ctx, aw.lines[l], rc, false);
          }
          ctx.strokeStyle = pal.isDark ? '#64748B' : '#94908A';
          ctx.lineWidth = aw.isRunway
            ? targetZ >= 12
              ? 4.2
              : 2.4
            : 1.2;
          ctx.stroke();
        }
      }
    }
  }

  // 3b. Railways (authentic European dashed rail lines, muted in tunnels)
  if (layers.railways) {
    const railBaseW = targetZ >= 12 ? 2.2 : targetZ >= 10 ? 1.65 : 1.25;
    const railDashW = railBaseW * 0.52;
    ctx.lineCap = 'butt';

    // Surface & bridge rails
    ctx.beginPath();
    for (const tile of tiles) {
      for (let i = 0; i < tile.railways.length; i++) {
        const rl = tile.railways[i];
        if (rl.brunnel === 2) continue;
        if (rl.isTransit && targetZ < 12) continue;
        for (let l = 0; l < rl.lines.length; l++) {
          traceFlatRing(ctx, rl.lines[l], rc, false);
        }
      }
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = pal.isDark
      ? 'rgba(148, 163, 184, 0.58)'
      : 'rgba(58, 54, 50, 0.62)';
    ctx.lineWidth = railBaseW;
    ctx.stroke();

    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = pal.isDark ? '#0F172A' : '#FAF9F5';
    ctx.lineWidth = railDashW;
    ctx.stroke();

    // Tunnel rails
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (const tile of tiles) {
      for (let i = 0; i < tile.railways.length; i++) {
        const rl = tile.railways[i];
        if (rl.brunnel !== 2) continue;
        for (let l = 0; l < rl.lines.length; l++) {
          traceFlatRing(ctx, rl.lines[l], rc, false);
        }
      }
    }
    ctx.strokeStyle = pal.isDark
      ? 'rgba(148, 163, 184, 0.28)'
      : 'rgba(82, 76, 70, 0.30)';
    ctx.lineWidth = Math.max(1.0, railBaseW * 0.72);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  }

  // 3c. Roads (layered bottom-to-top, casings then cores for seamless junctions)
  if (layers.highways) {
    const styles = getRoadStyles(targetZ, pal);

    for (const roadCls of ROAD_DRAW_ORDER) {
      const st = styles[roadCls];
      if (targetZ < st.minZ) continue;

      // Normal & bridge segments — casing pass
      ctx.beginPath();
      let hasAny = false;
      for (const tile of tiles) {
        for (let i = 0; i < tile.roads.length; i++) {
          const rd = tile.roads[i];
          if (rd.cls !== roadCls || rd.brunnel === 2) continue;
          hasAny = true;
          for (let l = 0; l < rd.lines.length; l++) {
            traceFlatRing(ctx, rd.lines[l], rc, false);
          }
        }
      }
      if (hasAny) {
        if (st.dash) ctx.setLineDash(st.dash);
        else ctx.setLineDash([]);
        ctx.strokeStyle = st.casing;
        ctx.lineWidth = st.casingW;
        ctx.stroke();

        if (st.core && st.coreW > 0) {
          ctx.setLineDash([]);
          ctx.strokeStyle = st.core;
          ctx.lineWidth = st.coreW;
          ctx.stroke();
        }
      }

      // Tunnel segments (dashed, muted)
      if (roadCls !== 'ferry' && roadCls !== 'path' && roadCls !== 'track') {
        ctx.beginPath();
        let hasTunnel = false;
        for (const tile of tiles) {
          for (let i = 0; i < tile.roads.length; i++) {
            const rd = tile.roads[i];
            if (rd.cls !== roadCls || rd.brunnel !== 2) continue;
            hasTunnel = true;
            for (let l = 0; l < rd.lines.length; l++) {
              traceFlatRing(ctx, rd.lines[l], rc, false);
            }
          }
        }
        if (hasTunnel) {
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = st.casing;
          ctx.lineWidth = st.casingW * 0.85;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.setLineDash([]);

    // 3d. Highway Route Shields (D1, D5, I/35, 35, E50, A1...) & Street Names
    const placedShields: { x: number; y: number }[] = [];
    const shieldMinDist = targetZ >= 12 ? 120 : targetZ >= 10 ? 105 : 95;
    const streetCandidates: {
      name: string;
      sx: number;
      sy: number;
      ang: number;
      isMajor: boolean;
    }[] = [];

    for (const tile of tiles) {
      for (let i = 0; i < tile.roadLabels.length; i++) {
        const rl = tile.roadLabels[i];
        const line = rl.lines[0];
        if (!line || line.length < 4) continue;
        const midPtIdx = Math.floor(line.length / 4) * 2;
        const pM = rc.projectGeo(line[midPtIdx], line[midPtIdx + 1]);
        const sx = rc.wxToSx(pM.x);
        const sy = rc.wyToSy(pM.y);
        if (sx < 38 || sx > rc.width - 38 || sy < 26 || sy > rc.height - 26)
          continue;

        // Route shield
        if (
          rl.ref &&
          (rl.cls === 'motorway' ||
            rl.cls === 'trunk' ||
            rl.cls === 'primary' ||
            (rl.cls === 'secondary' && targetZ >= 10))
        ) {
          const primaryRef = rl.ref.split(';')[0].trim();
          if (primaryRef.length >= 1 && primaryRef.length <= 7) {
            let tooClose = false;
            for (let s = 0; s < placedShields.length; s++) {
              const dx = placedShields[s].x - sx;
              const dy = placedShields[s].y - sy;
              if (dx * dx + dy * dy < shieldMinDist * shieldMinDist) {
                tooClose = true;
                break;
              }
            }
            if (!tooClose) {
              const bw = Math.max(22, primaryRef.length * 5.8 + 8);
              const bh = 13.5;
              if (rc.tryPlaceBox(sx - bw / 2, sy - bh / 2, bw, bh, false)) {
                placedShields.push({ x: sx, y: sy });
                const isMotorway = rl.cls === 'motorway';
                const isTrunk = rl.cls === 'trunk';
                const isPrimary = rl.cls === 'primary';
                const isERoute = /^E\s?\d+$/i.test(primaryRef);

                ctx.fillStyle = isERoute
                  ? '#15803D'
                  : isMotorway || isTrunk
                    ? pal.highwayBadgeBg
                    : isPrimary
                      ? '#1D4ED8'
                      : '#FFFFFF';
                ctx.fillRect(sx - bw / 2, sy - bh / 2, bw, bh);
                ctx.strokeStyle =
                  isMotorway || isTrunk || isPrimary || isERoute
                    ? '#FFFFFF'
                    : '#475569';
                ctx.lineWidth = 0.85;
                ctx.strokeRect(sx - bw / 2, sy - bh / 2, bw, bh);

                ctx.fillStyle =
                  isMotorway || isTrunk || isPrimary || isERoute
                    ? '#FFFFFF'
                    : '#1E293B';
                ctx.font = '700 8px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(primaryRef, sx, sy + 0.5);
              }
            }
          }
        }

        // Street names at close zoom (z >= 12)
        if (
          targetZ >= 12 &&
          rl.name &&
          line.length >= 6 &&
          (rl.cls === 'primary' ||
            rl.cls === 'secondary' ||
            rl.cls === 'tertiary' ||
            (rl.cls === 'minor' && targetZ >= 13))
        ) {
          const prevIdx = Math.max(0, midPtIdx - 2);
          const nextIdx = Math.min(line.length - 2, midPtIdx + 2);
          const pA = rc.projectGeo(line[prevIdx], line[prevIdx + 1]);
          const pB = rc.projectGeo(line[nextIdx], line[nextIdx + 1]);
          let ang = Math.atan2(
            rc.wyToSy(pB.y) - rc.wyToSy(pA.y),
            rc.wxToSx(pB.x) - rc.wxToSx(pA.x)
          );
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
          streetCandidates.push({
            name: rl.name,
            sx,
            sy,
            ang,
            isMajor: rl.cls === 'primary' || rl.cls === 'secondary',
          });
        }
      }
    }

    if (streetCandidates.length > 0) {
      const labeledStreets = new Set<string>();
      streetCandidates.sort((a, b) => Number(b.isMajor) - Number(a.isMajor));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < streetCandidates.length; i++) {
        const sc = streetCandidates[i];
        if (labeledStreets.has(sc.name)) continue;
        ctx.font = sc.isMajor
          ? '600 9.2px "Plus Jakarta Sans", sans-serif'
          : '500 8.5px "Plus Jakarta Sans", sans-serif';
        const tw = ctx.measureText(sc.name).width;
        if (!rc.tryPlaceBox(sc.sx - tw / 2 - 4, sc.sy - 6, tw + 8, 12, false))
          continue;
        labeledStreets.add(sc.name);
        ctx.save();
        ctx.translate(sc.sx, sc.sy);
        ctx.rotate(sc.ang);
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = pal.textHalo;
        ctx.strokeText(sc.name, 0, 0);
        ctx.fillStyle = pal.textSecondary;
        ctx.fillText(sc.name, 0, 0);
        ctx.restore();
      }
    }
  }

  ctx.restore();
}

/**
 * Pass 4: Ultra-accurate OSM international (level 2), regional/state (level 4),
 * and district/county (level 6) administrative borders.
 */
export function renderOsmBorders(
  tiles: DecodedOsmTile[],
  rc: OsmRenderContext,
  options: { drawCountryBorders: boolean; drawRegionalBorders: boolean }
) {
  const { ctx, pal, targetZ } = rc;
  if (
    tiles.length === 0 ||
    (!options.drawCountryBorders && !options.drawRegionalBorders)
  ) {
    return;
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // District / county borders (admin_level === 6 at z >= 9)
  if (options.drawRegionalBorders && targetZ >= 9) {
    ctx.beginPath();
    for (const tile of tiles) {
      for (let i = 0; i < tile.borders.length; i++) {
        const b = tile.borders[i];
        if (b.level !== 6) continue;
        for (let l = 0; l < b.lines.length; l++) {
          traceFlatRing(ctx, b.lines[l], rc, false);
        }
      }
    }
    ctx.strokeStyle = pal.isDark
      ? 'rgba(148, 163, 184, 0.22)'
      : 'rgba(72, 64, 56, 0.24)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
  }

  // Regional / state / kraj borders (admin_level === 4)
  if (options.drawRegionalBorders) {
    ctx.beginPath();
    for (const tile of tiles) {
      for (let i = 0; i < tile.borders.length; i++) {
        const b = tile.borders[i];
        if (b.level !== 4) continue;
        for (let l = 0; l < b.lines.length; l++) {
          traceFlatRing(ctx, b.lines[l], rc, false);
        }
      }
    }
    ctx.strokeStyle = pal.regionBorder;
    ctx.lineWidth = 1.05;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
  }

  // National / international borders (admin_level === 2)
  if (options.drawCountryBorders) {
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const tile of tiles) {
      for (let i = 0; i < tile.borders.length; i++) {
        const b = tile.borders[i];
        if (b.level !== 2) continue;
        for (let l = 0; l < b.lines.length; l++) {
          traceFlatRing(ctx, b.lines[l], rc, false);
        }
      }
    }
    ctx.strokeStyle = pal.borderOuter;
    ctx.lineWidth = 3.8;
    ctx.stroke();
    ctx.strokeStyle = pal.borderInner;
    ctx.lineWidth = 1.65;
    ctx.stroke();
  }

  ctx.restore();
}
