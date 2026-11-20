import { ContourLevel, Point2D } from '../types/map';

interface ContourSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Marching Squares contour line extraction with polyline chaining.
 * Produces continuous, smooth contour polylines for minor (10m) and index (50m) levels.
 */
export function extractContours(
  grid: Float32Array,
  cols: number,
  rows: number,
  cellSizeX: number,
  cellSizeY: number,
  interval = 10,
  indexInterval = 50
): ContourLevel[] {
  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (!Number.isFinite(v) || v < -12000 || v > 9500) continue;
    if (v < minE) minE = v;
    if (v > maxE) maxE = v;
  }
  if (!Number.isFinite(minE) || !Number.isFinite(maxE) || maxE <= minE) {
    return [];
  }

  // Ensure at most 55 contour levels even on extreme mountain relief (e.g. Himalaya 0..8849 m)
  let effInterval = Math.max(5, interval);
  while ((maxE - minE) / effInterval > 55) {
    effInterval *= 2;
  }
  const effIndexInterval = Math.max(effInterval, indexInterval);

  const startLevel = Math.ceil(minE / effInterval) * effInterval;
  const endLevel = Math.floor(maxE / effInterval) * effInterval;
  const levels: ContourLevel[] = [];
  const maxSegmentsPerLevel = 9000;

  for (let level = startLevel; level <= endLevel; level += effInterval) {
    const segments: ContourSegment[] = [];

    for (let r = 0; r < rows - 1 && segments.length < maxSegmentsPerLevel; r++) {
      const y0 = r * cellSizeY;
      const y1 = (r + 1) * cellSizeY;
      const rowOffset = r * cols;
      const nextRowOffset = (r + 1) * cols;

      for (let c = 0; c < cols - 1; c++) {
        const v0 = grid[rowOffset + c]; // top-left
        const v1 = grid[rowOffset + c + 1]; // top-right
        const v2 = grid[nextRowOffset + c + 1]; // bottom-right
        const v3 = grid[nextRowOffset + c]; // bottom-left

        let mask = 0;
        if (v0 >= level) mask |= 8;
        if (v1 >= level) mask |= 4;
        if (v2 >= level) mask |= 2;
        if (v3 >= level) mask |= 1;

        if (mask === 0 || mask === 15) continue;

        const x0 = c * cellSizeX;
        const x1 = (c + 1) * cellSizeX;

        const interp = (a: number, b: number) => {
          const d = b - a;
          if (Math.abs(d) < 1e-6) return 0.5;
          return Math.max(0, Math.min(1, (level - a) / d));
        };

        // Edge midpoints: top(0), right(1), bottom(2), left(3)
        const top: Point2D = { x: x0 + interp(v0, v1) * cellSizeX, y: y0 };
        const right: Point2D = { x: x1, y: y0 + interp(v1, v2) * cellSizeY };
        const bottom: Point2D = { x: x0 + interp(v3, v2) * cellSizeX, y: y1 };
        const left: Point2D = { x: x0, y: y0 + interp(v0, v3) * cellSizeY };

        const addSeg = (p: Point2D, q: Point2D) => {
          segments.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
        };

        switch (mask) {
          case 1:
          case 14:
            addSeg(left, bottom);
            break;
          case 2:
          case 13:
            addSeg(bottom, right);
            break;
          case 3:
          case 12:
            addSeg(left, right);
            break;
          case 4:
          case 11:
            addSeg(top, right);
            break;
          case 5: {
            const center = (v0 + v1 + v2 + v3) * 0.25;
            if (center >= level) {
              addSeg(left, top);
              addSeg(bottom, right);
            } else {
              addSeg(left, bottom);
              addSeg(top, right);
            }
            break;
          }
          case 6:
          case 9:
            addSeg(top, bottom);
            break;
          case 7:
          case 8:
            addSeg(left, top);
            break;
          case 10: {
            const center = (v0 + v1 + v2 + v3) * 0.25;
            if (center >= level) {
              addSeg(left, bottom);
              addSeg(top, right);
            } else {
              addSeg(left, top);
              addSeg(bottom, right);
            }
            break;
          }
        }
      }
    }

    if (segments.length > 0) {
      levels.push({
        elevation: level,
        isIndex: level % effIndexInterval === 0,
        polylines: chainSegments(segments),
      });
    }
  }

  return levels;
}

function keyOf(x: number, y: number): string {
  return `${Math.round(x * 10)},${Math.round(y * 10)}`;
}

function chainSegments(segments: ContourSegment[]): Point2D[][] {
  const adj = new Map<string, number[]>();
  const used = new Uint8Array(segments.length);

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const k1 = keyOf(s.x1, s.y1);
    const k2 = keyOf(s.x2, s.y2);
    let a1 = adj.get(k1);
    if (!a1) {
      a1 = [];
      adj.set(k1, a1);
    }
    a1.push(i);
    let a2 = adj.get(k2);
    if (!a2) {
      a2 = [];
      adj.set(k2, a2);
    }
    a2.push(i);
  }

  const polylines: Point2D[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segments[i];
    const forward: Point2D[] = [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ];

    // Extend forward in O(1)
    let extended = true;
    while (extended) {
      extended = false;
      const tail = forward[forward.length - 1];
      const kTail = keyOf(tail.x, tail.y);
      const candidates = adj.get(kTail);
      if (!candidates) break;
      for (let c = 0; c < candidates.length; c++) {
        const idx = candidates[c];
        if (used[idx]) continue;
        used[idx] = 1;
        const seg = segments[idx];
        if (keyOf(seg.x1, seg.y1) === kTail) {
          forward.push({ x: seg.x2, y: seg.y2 });
        } else {
          forward.push({ x: seg.x1, y: seg.y1 });
        }
        extended = true;
        break;
      }
    }

    // Extend backward in O(1) via separate array + reverse
    const backward: Point2D[] = [];
    let head = forward[0];
    extended = true;
    while (extended) {
      extended = false;
      const kHead = keyOf(head.x, head.y);
      const candidates = adj.get(kHead);
      if (!candidates) break;
      for (let c = 0; c < candidates.length; c++) {
        const idx = candidates[c];
        if (used[idx]) continue;
        used[idx] = 1;
        const seg = segments[idx];
        const nextPt =
          keyOf(seg.x1, seg.y1) === kHead
            ? { x: seg.x2, y: seg.y2 }
            : { x: seg.x1, y: seg.y1 };
        backward.push(nextPt);
        head = nextPt;
        extended = true;
        break;
      }
    }

    const totalLen = backward.length + forward.length;
    if (totalLen >= 3) {
      if (backward.length > 0) {
        backward.reverse();
        for (let k = 0; k < forward.length; k++) backward.push(forward[k]);
        polylines.push(backward);
      } else {
        polylines.push(forward);
      }
    }
  }

  return polylines;
}
