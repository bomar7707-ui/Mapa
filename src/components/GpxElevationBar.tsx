import React, { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatTrackDistance } from '../engine/gpxParser';
import { GeoPoint, ImportedGpxTrack } from '../types/map';

interface GpxElevationBarProps {
  track: ImportedGpxTrack;
  onHoverPoint: (pt: GeoPoint | null) => void;
  onClose: () => void;
}

export const GpxElevationBar: React.FC<GpxElevationBarProps> = ({
  track,
  onHoverPoint,
  onClose,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 760;
  const height = 104;
  const padL = 46;
  const padR = 14;
  const padT = 10;
  const padB = 20;

  // Downsample visually to max ~300 points so large 10k-point GPX files render fast
  const chartPoints = useMemo(() => {
    const pts = track.points;
    if (pts.length <= 320) return pts;
    const step = (pts.length - 1) / 319;
    const sampled = [];
    for (let i = 0; i < 320; i++) {
      sampled.push(pts[Math.round(i * step)]);
    }
    return sampled;
  }, [track.points]);

  const { pathD, areaD, minE, maxE, ticks } = useMemo(() => {
    if (chartPoints.length < 2) {
      return { pathD: '', areaD: '', minE: 0, maxE: 100, ticks: [] as number[] };
    }
    const span = Math.max(30, track.maxElevation - track.minElevation);
    const minElev = Math.floor((track.minElevation - span * 0.08) / 10) * 10;
    const maxElev = Math.ceil((track.maxElevation + span * 0.1) / 10) * 10;
    const totalD = Math.max(1, track.distanceMeters);
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const coords = chartPoints.map((p) => {
      const x = padL + (p.distanceFromStart / totalD) * plotW;
      const y =
        padT + plotH - ((p.ele - minElev) / (maxElev - minElev)) * plotH;
      return { x, y };
    });

    const line = coords
      .map(
        (c, idx) =>
          `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`
      )
      .join(' ');
    const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(
      padT + plotH
    ).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

    const midTick = Math.round((minElev + maxElev) / 2 / 10) * 10;
    return {
      pathD: line,
      areaD: area,
      minE: minElev,
      maxE: maxElev,
      ticks: [minElev, midTick, maxElev],
    };
  }, [chartPoints, track.minElevation, track.maxElevation, track.distanceMeters]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || chartPoints.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const plotW = width - padL - padR;
    const ratio = Math.max(0, Math.min(1, (relX - padL) / plotW));
    const targetDist = ratio * track.distanceMeters;

    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < chartPoints.length; i++) {
      const d = Math.abs(chartPoints[i].distanceFromStart - targetDist);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    setHoverIdx(bestIdx);
    const p = chartPoints[bestIdx];
    onHoverPoint({ lon: p.lon, lat: p.lat });
  };

  const handleMouseLeave = () => {
    setHoverIdx(null);
    onHoverPoint(null);
  };

  const hovered = hoverIdx !== null ? chartPoints[hoverIdx] : null;
  const hoveredCoords = useMemo(() => {
    if (!hovered || track.distanceMeters === 0) return null;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const x = padL + (hovered.distanceFromStart / track.distanceMeters) * plotW;
    const y =
      padT +
      plotH -
      ((hovered.ele - minE) / Math.max(1, maxE - minE)) * plotH;
    return { x, y };
  }, [hovered, track.distanceMeters, minE, maxE]);

  return (
    <div className="bg-white border-t border-[#1C2420]/12 px-5 py-3 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-3 h-3 rounded-xs shrink-0"
              style={{ backgroundColor: track.color }}
            />
            <h3 className="text-sm font-semibold text-[#1C2420] truncate">
              {track.name}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono-tabular text-[#4A5A50]">
            <span>{formatTrackDistance(track.distanceMeters)}</span>
            <span aria-hidden="true">·</span>
            <span>+{track.ascentMeters} m</span>
            <span aria-hidden="true">·</span>
            <span>−{track.descentMeters} m</span>
            <span aria-hidden="true">·</span>
            <span>
              {track.minElevation}–{track.maxElevation} m n. m.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hovered && (
            <div className="text-xs font-mono-tabular text-[#1C2420] pr-1 whitespace-nowrap">
              <span>{formatTrackDistance(hovered.distanceFromStart)}</span>
              <span className="text-[#5B6760] mx-1.5" aria-hidden="true">
                ·
              </span>
              <span className="font-semibold">
                {Math.round(hovered.ele)} m n. m.
              </span>
              <span className="text-[#5B6760] mx-1.5" aria-hidden="true">
                ·
              </span>
              <span>sklon {hovered.slopePercent}%</span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Skrýt výškový profil GPX"
            className="w-8 h-8 inline-flex items-center justify-center text-[#5B6760] hover:text-[#1C2420] hover:bg-[#F5F3EC] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[98px] overflow-visible cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {ticks.map((t) => {
          const plotH = height - padT - padB;
          const y =
            padT + plotH - ((t - minE) / Math.max(1, maxE - minE)) * plotH;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="rgba(28, 36, 32, 0.08)"
                strokeDasharray="3 3"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-[#5B6760] text-[10px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {t} m
              </text>
            </g>
          );
        })}

        <path d={areaD} fill={track.color} fillOpacity={0.14} />
        <path
          d={pathD}
          fill="none"
          stroke={track.color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const x = padL + (width - padL - padR) * r;
          const d = track.distanceMeters * r;
          return (
            <text
              key={r}
              x={x}
              y={height - 3}
              textAnchor={r === 0 ? 'start' : r === 1 ? 'end' : 'middle'}
              className="fill-[#5B6760] text-[10px]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {formatTrackDistance(d)}
            </text>
          );
        })}

        {hoveredCoords && (
          <g>
            <line
              x1={hoveredCoords.x}
              y1={padT}
              x2={hoveredCoords.x}
              y2={height - padB}
              stroke="#1C2420"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={hoveredCoords.x}
              cy={hoveredCoords.y}
              r={4.2}
              fill={track.color}
              stroke="#FFFFFF"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
    </div>
  );
};
