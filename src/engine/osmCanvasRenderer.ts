import { LayerVisibility, MapStylePreset, Point2D } from '../types/map';
import { RenderedOsmTile } from './osmVectorTiles';

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

function getBoundsScreenRect(
  bounds: [number, number, number, number],
  rc: OsmRenderContext
): { x: number; y: number; w: number; h: number } {
  const [minLon, minLat, maxLon, maxLat] = bounds;
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

function getTileScreenRect(
  tile: RenderedOsmTile,
  rc: OsmRenderContext
): { x: number; y: number; w: number; h: number } {
  return getBoundsScreenRect(tile.bounds, rc);
}

function drawCroppedTileBitmap(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  viewW: number,
  viewH: number,
  clipRect?: { x: number; y: number; w: number; h: number }
) {
  if (dw <= 0 || dh <= 0 || img.width <= 0 || img.height <= 0) return;
  let cdx0 = Math.max(0, dx);
  let cdy0 = Math.max(0, dy);
  let cdx1 = Math.min(viewW, dx + dw);
  let cdy1 = Math.min(viewH, dy + dh);
  if (clipRect) {
    cdx0 = Math.max(cdx0, clipRect.x);
    cdy0 = Math.max(cdy0, clipRect.y);
    cdx1 = Math.min(cdx1, clipRect.x + clipRect.w + 0.6);
    cdy1 = Math.min(cdy1, clipRect.y + clipRect.h + 0.6);
  }
  const cdw = cdx1 - cdx0;
  const cdh = cdy1 - cdy0;
  if (cdw <= 0 || cdh <= 0) return;

  const sx = Math.max(0, Math.min(img.width - 0.01, ((cdx0 - dx) / dw) * img.width));
  const sy = Math.max(0, Math.min(img.height - 0.01, ((cdy0 - dy) / dh) * img.height));
  const sw = Math.min(img.width - sx, (cdw / dw) * img.width);
  const sh = Math.min(img.height - sy, (cdh / dh) * img.height);
  if (sw <= 0.001 || sh <= 0.001) return;

  ctx.drawImage(img, sx, sy, sw, sh, cdx0, cdy0, cdw, cdh);
}

// Single shared 256x256 blit canvas used to composite CPU ImageData tiles (zero tile canvas hoarding!)
let sharedBlitCanvas: HTMLCanvasElement | null = null;
let sharedBlitCtx: CanvasRenderingContext2D | null = null;

function getSharedBlitCanvas(
  imgData: ImageData
): HTMLCanvasElement | null {
  if (!sharedBlitCanvas) {
    sharedBlitCanvas = document.createElement('canvas');
    sharedBlitCanvas.width = imgData.width;
    sharedBlitCanvas.height = imgData.height;
    sharedBlitCtx = sharedBlitCanvas.getContext('2d');
  }
  if (!sharedBlitCtx) return null;
  if (
    sharedBlitCanvas.width !== imgData.width ||
    sharedBlitCanvas.height !== imgData.height
  ) {
    sharedBlitCanvas.width = imgData.width;
    sharedBlitCanvas.height = imgData.height;
  }
  sharedBlitCtx.putImageData(imgData, 0, 0);
  return sharedBlitCanvas;
}

/**
 * Pass 1 (under contours): Composites cached 512x512 OSM base ImageData
 * (forests, wetlands, glaciers, parks, built-up urban areas, close-zoom buildings).
 * Uses 'multiply' blending in light/atlas/natural themes so 100% of 3D terrain hillshade shines through forests!
 */
export function renderOsmBaseBitmaps(
  tiles: RenderedOsmTile[],
  rc: OsmRenderContext
) {
  if (tiles.length === 0) return;
  const { ctx, width, height, pal } = rc;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (!pal.isDark) {
    ctx.globalCompositeOperation = 'multiply';
  }
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (!tile.baseImageData) continue;
    const rect = getTileScreenRect(tile, rc);
    if (
      rect.x + rect.w < -2 ||
      rect.x > width + 2 ||
      rect.y + rect.h < -2 ||
      rect.y > height + 2
    ) {
      continue;
    }
    const blitCanvas = getSharedBlitCanvas(tile.baseImageData);
    if (!blitCanvas) continue;
    const clipRect = tile.clipBounds
      ? getBoundsScreenRect(tile.clipBounds, rc)
      : undefined;
    drawCroppedTileBitmap(
      ctx,
      blitCanvas,
      rect.x,
      rect.y,
      rect.w + 0.6,
      rect.h + 0.6,
      width,
      height,
      clipRect
    );
  }
  ctx.restore();
}

/**
 * Pass 2 (over contours): Composites cached 512x512 OSM overlay ImageData
 * (lakes, ponds, rivers, streams, aeroways, borders, railways, full road hierarchy).
 */
export function renderOsmOverlayBitmaps(
  tiles: RenderedOsmTile[],
  rc: OsmRenderContext
) {
  if (tiles.length === 0) return;
  const { ctx, width, height } = rc;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (!tile.overlayImageData) continue;
    const rect = getTileScreenRect(tile, rc);
    if (
      rect.x + rect.w < -2 ||
      rect.x > width + 2 ||
      rect.y + rect.h < -2 ||
      rect.y > height + 2
    ) {
      continue;
    }
    const blitCanvas = getSharedBlitCanvas(tile.overlayImageData);
    if (!blitCanvas) continue;
    const clipRect = tile.clipBounds
      ? getBoundsScreenRect(tile.clipBounds, rc)
      : undefined;
    drawCroppedTileBitmap(
      ctx,
      blitCanvas,
      rect.x,
      rect.y,
      rect.w + 0.6,
      rect.h + 0.6,
      width,
      height,
      clipRect
    );
  }
  ctx.restore();
}

/**
 * Pass 3: Crisp deduplicated water body & river name labels with zoom-stage filtering and spatial spacing.
 */
export function renderOsmWaterLabels(
  tiles: RenderedOsmTile[],
  rc: OsmRenderContext
) {
  const { ctx, layers, pal, targetZ, width, height } = rc;
  if (!layers.hydrology || tiles.length === 0) return;

  const waterLabelColor = pal.isDark ? '#78B2E0' : '#357EC2';
  const labeled = new Set<string>();
  const placedWater: { x: number; y: number }[] = [];
  const minWaterDistSq = (targetZ <= 9 ? 130 : 105) ** 2;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Lake & reservoir names (from z >= 9)
  if (targetZ >= 9) {
    ctx.font =
      targetZ >= 12
        ? 'italic 600 9.4px "Plus Jakarta Sans", sans-serif'
        : 'italic 600 8.8px "Plus Jakarta Sans", sans-serif';
    for (let t = 0; t < tiles.length; t++) {
      if (tiles[t].clipBounds) continue;
      const list = tiles[t].labels.waterLabels;
      for (let i = 0; i < list.length; i++) {
        const wl = list[i];
        if (labeled.has(wl.name)) continue;
        const wPt = rc.projectGeo(wl.lon, wl.lat);
        const sx = rc.wxToSx(wPt.x);
        const sy = rc.wyToSy(wPt.y);
        if (sx < 35 || sx > width - 35 || sy < 20 || sy > height - 20) continue;
        let tooClose = false;
        for (let k = 0; k < placedWater.length; k++) {
          const dx = placedWater[k].x - sx;
          const dy = placedWater[k].y - sy;
          if (dx * dx + dy * dy < minWaterDistSq) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        const tw = ctx.measureText(wl.name).width;
        if (!rc.tryPlaceBox(sx - tw / 2 - 4, sy - 7, tw + 8, 14, false)) {
          continue;
        }
        labeled.add(wl.name);
        placedWater.push({ x: sx, y: sy });
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = pal.textHalo;
        ctx.strokeText(wl.name, sx, sy);
        ctx.fillStyle = waterLabelColor;
        ctx.fillText(wl.name, sx, sy);
      }
    }
  }

  // River & stream names
  for (let t = 0; t < tiles.length; t++) {
    if (tiles[t].clipBounds) continue;
    const list = tiles[t].labels.riverLabels;
    for (let i = 0; i < list.length; i++) {
      const rl = list[i];
      if (!rl.isRiver && targetZ < 12) continue;
      if (labeled.has(rl.name)) continue;
      const wPt = rc.projectGeo(rl.lon, rl.lat);
      const sx = rc.wxToSx(wPt.x);
      const sy = rc.wyToSy(wPt.y);
      if (sx < 36 || sx > width - 36 || sy < 24 || sy > height - 24) continue;
      let tooClose = false;
      for (let k = 0; k < placedWater.length; k++) {
        const dx = placedWater[k].x - sx;
        const dy = placedWater[k].y - sy;
        if (dx * dx + dy * dy < minWaterDistSq) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      ctx.font = rl.isRiver
        ? targetZ >= 11
          ? 'italic 600 9.4px "Plus Jakarta Sans", sans-serif'
          : 'italic 600 8.9px "Plus Jakarta Sans", sans-serif'
        : 'italic 500 8.3px "Plus Jakarta Sans", sans-serif';
      const tw = ctx.measureText(rl.name).width;
      if (!rc.tryPlaceBox(sx - tw / 2 - 3, sy - 7, tw + 6, 14, false)) {
        continue;
      }
      labeled.add(rl.name);
      placedWater.push({ x: sx, y: sy });
      ctx.save();
      ctx.translate(sx, sy - 3);
      ctx.rotate(rl.angle);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = pal.textHalo;
      ctx.strokeText(rl.name, 0, 0);
      ctx.fillStyle = waterLabelColor;
      ctx.fillText(rl.name, 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();
}

/**
 * Pass 4: Crisp Mapy.com highway route shields (E50, E55, E65, D1, D5...) & close-zoom street names.
 */
export function renderOsmTransportLabels(
  tiles: RenderedOsmTile[],
  rc: OsmRenderContext
) {
  const { ctx, layers, pal, targetZ, width, height } = rc;
  if (!layers.highways || tiles.length === 0) return;

  ctx.save();
  const placedShields: { x: number; y: number }[] = [];
  const shieldMinDist = targetZ <= 8 ? 132 : targetZ <= 10 ? 118 : 112;
  const shieldMinDistSq = shieldMinDist * shieldMinDist;

  ctx.font = '700 7.8px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let t = 0; t < tiles.length; t++) {
    if (tiles[t].clipBounds) continue;
    const shields = tiles[t].labels.roadShields;
    for (let i = 0; i < shields.length; i++) {
      const sh = shields[i];
      const isMotorway = sh.cls === 'motorway';
      const isTrunk = sh.cls === 'trunk';
      const isPrimary = sh.cls === 'primary';
      const isERoute = /^E\s?\d+$/i.test(sh.ref);

      // At overview zoom (z <= 9), only display green motorway / trunk / E-route shields like Mapy.com
      if (targetZ <= 9 && !isMotorway && !isTrunk && !isERoute) continue;
      // At medium zoom (z == 10), skip secondary road shields
      if (targetZ === 10 && !isMotorway && !isTrunk && !isPrimary && !isERoute) {
        continue;
      }

      const wPt = rc.projectGeo(sh.lon, sh.lat);
      const sx = rc.wxToSx(wPt.x);
      const sy = rc.wyToSy(wPt.y);
      if (sx < 38 || sx > width - 38 || sy < 26 || sy > height - 26) continue;

      let tooClose = false;
      for (let s = 0; s < placedShields.length; s++) {
        const dx = placedShields[s].x - sx;
        const dy = placedShields[s].y - sy;
        if (dx * dx + dy * dy < shieldMinDistSq) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const cleanRef = sh.ref.replace(/\s+/g, '');
      const bw = Math.max(18, cleanRef.length * 5.0 + 6.5);
      const bh = 11.5;
      if (!rc.tryPlaceBox(sx - bw / 2, sy - bh / 2, bw, bh, false)) continue;

      placedShields.push({ x: sx, y: sy });

      ctx.fillStyle = isERoute
        ? '#38983E'
        : isMotorway || isTrunk
          ? pal.highwayBadgeBg
          : isPrimary
            ? '#3E82B8'
            : '#FAF9F6';
      ctx.fillRect(sx - bw / 2, sy - bh / 2, bw, bh);
      ctx.strokeStyle =
        isMotorway || isTrunk || isPrimary || isERoute
          ? 'rgba(255, 255, 255, 0.94)'
          : '#8A949E';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(sx - bw / 2, sy - bh / 2, bw, bh);

      ctx.fillStyle =
        isMotorway || isTrunk || isPrimary || isERoute ? '#FFFFFF' : '#334155';
      ctx.fillText(cleanRef, sx, sy + 0.5);
    }
  }

  // Street names at close zoom (z >= 13)
  if (targetZ >= 13) {
    const labeledStreets = new Set<string>();
    for (let t = 0; t < tiles.length; t++) {
      if (tiles[t].clipBounds) continue;
      const streets = tiles[t].labels.streetLabels;
      for (let i = 0; i < streets.length; i++) {
        const sc = streets[i];
        if (labeledStreets.has(sc.name)) continue;
        const wPt = rc.projectGeo(sc.lon, sc.lat);
        const sx = rc.wxToSx(wPt.x);
        const sy = rc.wyToSy(wPt.y);
        if (sx < 38 || sx > width - 38 || sy < 26 || sy > height - 26) continue;
        ctx.font = sc.isMajor
          ? '600 9px "Plus Jakarta Sans", sans-serif'
          : '500 8.3px "Plus Jakarta Sans", sans-serif';
        const tw = ctx.measureText(sc.name).width;
        if (!rc.tryPlaceBox(sx - tw / 2 - 4, sy - 6, tw + 8, 12, false)) {
          continue;
        }
        labeledStreets.add(sc.name);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(sc.angle);
        ctx.lineWidth = 2.5;
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
