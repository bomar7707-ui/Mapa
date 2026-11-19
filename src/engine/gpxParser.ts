import { CZ_BOUNDS } from '../data/czechGeo';
import {
  CompiledCzechTerrain,
  geoToWorld,
  sampleCzechElevation,
} from './czechTerrain';
import { sampleWorldDemBilinear } from './realCzechData';
import {
  GpxTrackPoint,
  GpxWaypoint,
  ImportedGpxTrack,
  RealDemGrid,
} from '../types/map';

const GPX_TRACK_COLORS = [
  '#DC2626', // Crimson red
  '#1D4ED8', // Cobalt blue
  '#7C3AED', // Deep violet
  '#0F766E', // Teal
  '#C2410C', // Burnt orange
];

function haversineMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatTrackDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

export function parseGpxContent(
  xmlText: string,
  fileName: string,
  terrain: CompiledCzechTerrain,
  colorIndex = 0,
  worldDem?: RealDemGrid | null
): ImportedGpxTrack {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Soubor není platný XML / GPX dokument.');
  }

  // Extract track name from <trk><name>, <rte><name>, <metadata><name>, or fileName
  const rawName =
    doc.querySelector('trk > name')?.textContent?.trim() ||
    doc.querySelector('rte > name')?.textContent?.trim() ||
    doc.querySelector('metadata > name')?.textContent?.trim() ||
    fileName.replace(/\.gpx$/i, '');

  // Prefer <trkpt>, fallback to <rtept>
  let ptNodes = Array.from(doc.querySelectorAll('trkpt'));
  if (ptNodes.length === 0) {
    ptNodes = Array.from(doc.querySelectorAll('rtept'));
  }

  if (ptNodes.length === 0) {
    throw new Error('GPX soubor neobsahuje žádné body trasy (<trkpt> ani <rtept>).');
  }

  const rawCoords: { lon: number; lat: number; ele: number | null }[] = [];
  for (const node of ptNodes) {
    const latStr = node.getAttribute('lat');
    const lonStr = node.getAttribute('lon');
    if (!latStr || !lonStr) continue;
    const lat = Number.parseFloat(latStr);
    const lon = Number.parseFloat(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const eleText = node.querySelector('ele')?.textContent;
    const parsedEle = eleText ? Number.parseFloat(eleText) : NaN;
    rawCoords.push({
      lon,
      lat,
      ele: Number.isFinite(parsedEle) ? parsedEle : null,
    });
  }

  if (rawCoords.length < 2) {
    throw new Error('Trasa musí obsahovat alespoň 2 platné zeměpisné body.');
  }

  // Parse optional <wpt> waypoints
  const wptNodes = Array.from(doc.querySelectorAll('wpt'));
  const waypoints: GpxWaypoint[] = [];
  for (const w of wptNodes) {
    const lat = Number.parseFloat(w.getAttribute('lat') || '');
    const lon = Number.parseFloat(w.getAttribute('lon') || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = w.querySelector('name')?.textContent?.trim() || 'Bod';
    const eleVal = Number.parseFloat(
      w.querySelector('ele')?.textContent || ''
    );
    waypoints.push({
      name,
      lon,
      lat,
      ele: Number.isFinite(eleVal) ? eleVal : undefined,
    });
  }

  const points: GpxTrackPoint[] = [];
  let totalDist = 0;
  let ascent = 0;
  let descent = 0;
  let minElev = Infinity;
  let maxElev = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  // Threshold filter (2.5m) to smooth GPS vertical noise on ascent/descent
  let lastAcceptedEle: number | null = null;

  for (let i = 0; i < rawCoords.length; i++) {
    const cur = rawCoords[i];
    if (cur.lon < minLon) minLon = cur.lon;
    if (cur.lon > maxLon) maxLon = cur.lon;
    if (cur.lat < minLat) minLat = cur.lat;
    if (cur.lat > maxLat) maxLat = cur.lat;

    let segDist = 0;
    if (i > 0) {
      const prev = rawCoords[i - 1];
      segDist = haversineMeters(prev.lon, prev.lat, cur.lon, cur.lat);
      totalDist += segDist;
    }

    let ele = cur.ele;
    if (ele === null) {
      const inCz =
        cur.lon >= CZ_BOUNDS.minLon &&
        cur.lon <= CZ_BOUNDS.maxLon &&
        cur.lat >= CZ_BOUNDS.minLat &&
        cur.lat <= CZ_BOUNDS.maxLat;
      if (inCz) {
        const wPt = geoToWorld(cur.lon, cur.lat);
        ele = sampleCzechElevation(terrain, wPt.x, wPt.y);
      } else if (worldDem) {
        ele = Math.max(0, sampleWorldDemBilinear(worldDem, cur.lon, cur.lat));
      } else {
        ele = 0;
      }
    }

    if (ele < minElev) minElev = ele;
    if (ele > maxElev) maxElev = ele;

    let slopePercent = 0;
    if (i > 0) {
      const prevEle = points[i - 1].ele;
      if (segDist > 1) {
        slopePercent = Math.round(((ele - prevEle) / segDist) * 100);
      }
      if (lastAcceptedEle === null) {
        lastAcceptedEle = prevEle;
      }
      const delta = ele - lastAcceptedEle;
      if (Math.abs(delta) >= 2.5) {
        if (delta > 0) ascent += delta;
        else descent += Math.abs(delta);
        lastAcceptedEle = ele;
      }
    } else {
      lastAcceptedEle = ele;
    }

    points.push({
      lon: cur.lon,
      lat: cur.lat,
      ele,
      distanceFromStart: totalDist,
      slopePercent,
    });
  }

  return {
    id: `gpx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: rawName,
    color: GPX_TRACK_COLORS[colorIndex % GPX_TRACK_COLORS.length],
    visible: true,
    points,
    waypoints,
    distanceMeters: Math.round(totalDist),
    ascentMeters: Math.round(ascent),
    descentMeters: Math.round(descent),
    minElevation: Math.round(minElev),
    maxElevation: Math.round(maxElev),
    bounds: { minLon, maxLon, minLat, maxLat },
  };
}
