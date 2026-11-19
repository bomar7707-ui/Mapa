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
    if (grid[i] < minE) minE = grid[i];
    if (grid[i] > maxE) maxE = grid[i];
  }

  const startLevel = Math.ceil(minE / interval) * interval;
  const endLevel = Math.floor(maxE / interval) * interval;
  const levels: ContourLevel[] = [];

  for (let level = startLevel; level <= endLevel; level += interval) {
    const segments: ContourSegment[] = [];

    for (let r = 0; r < rows - 1; r++) {
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
        isIndex: level % indexInterval === 0,
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
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1)!.push(i);
    adj.get(k2)!.push(i);
  }

  const polylines: Point2D[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segments[i];
    const line: Point2D[] = [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ];

    // Extend forward
    let extended = true;
    while (extended) {
      extended = false;
      const tail = line[line.length - 1];
      const candidates = adj.get(keyOf(tail.x, tail.y));
      if (!candidates) break;
      for (const idx of candidates) {
        if (used[idx]) continue;
        used[idx] = 1;
        const seg = segments[idx];
        const kTail = keyOf(tail.x, tail.y);
        if (keyOf(seg.x1, seg.y1) === kTail) {
          line.push({ x: seg.x2, y: seg.y2 });
        } else {
          line.push({ x: seg.x1, y: seg.y1 });
        }
        extended = true;
        break;
      }
    }

    // Extend backward
    extended = true;
    while (extended) {
      extended = false;
      const head = line[0];
      const candidates = adj.get(keyOf(head.x, head.y));
      if (!candidates) break;
      for (const idx of candidates) {
        if (used[idx]) continue;
        used[idx] = 1;
        const seg = segments[idx];
        const kHead = keyOf(head.x, head.y);
        if (keyOf(seg.x1, seg.y1) === kHead) {
          line.unshift({ x: seg.x2, y: seg.y2 });
        } else {
          line.unshift({ x: seg.x1, y: seg.y1 });
        }
        extended = true;
        break;
      }
    }

    if (line.length >= 3) {
      polylines.push(line);
    }
  }

  return polylines;
}
