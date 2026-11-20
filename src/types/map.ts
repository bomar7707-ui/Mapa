export type MapStylePreset = 'atlas' | 'natural' | 'light' | 'dark' | 'satellite';

export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface CzechCity {
  id: string;
  name: string;
  lon: number;
  lat: number;
  population: number; // determines symbol size & zoom visibility tier
  isCapital?: boolean;
  isRegionalSeat?: boolean;
  region: string;
}

export interface CzechPeak {
  id: string;
  name: string;
  lon: number;
  lat: number;
  elevation: number; // meters a.s.l.
  range: string;
}

export interface CzechRiver {
  id: string;
  name: string;
  width: number; // 1 = secondary, 2 = major, 3 = main stem
  points: [number, number][]; // [lon, lat]
}

export interface CzechLake {
  id: string;
  name: string;
  elevation: number;
  points: [number, number][]; // [lon, lat]
}

export interface CzechHighway {
  id: string;
  code: string; // e.g. D1, I/35
  roadType: 'motorway' | 'primary';
  points: [number, number][]; // [lon, lat]
}

export interface UrbanArea {
  id: string;
  name: string;
  points: [number, number][]; // [lon, lat] polygon
}

export interface CzechRegionLabel {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

export interface ReliefMassif {
  name: string;
  lon: number;
  lat: number;
  radiusLon: number; // degrees
  radiusLat: number; // degrees
  rotationDeg?: number;
  amplitude: number; // meters (+ mountain/ridge, - basin/valley)
  sharpness?: number; // exponent modifier (default 1)
}

export interface LayerVisibility {
  hillshade: boolean;
  hypsometry: boolean;
  forests: boolean;
  contours: boolean;
  hydrology: boolean;
  highways: boolean;
  railways: boolean;
  cities: boolean;
  peaks: boolean;
  borders: boolean;
  districts: boolean;
  graticule: boolean;
}

export interface RealDemGrid {
  cols: number;
  rows: number;
  elevations: Float32Array;
}

export interface RealAdminRegion {
  name: string;
  rings: [number, number][][];
}

export interface RealCzechAdmin {
  border: [number, number][];
  kraje: RealAdminRegion[];
  okresy: RealAdminRegion[];
}

export interface RealCzechRiver {
  name: string;
  rank: number;
  w: number;
  lines: [number, number][][];
}

export interface RealCzechLake {
  name: string;
  rings: [number, number][][];
}

export interface RealCzechRoad {
  type: string;
  name: string;
  rank: number;
  exp: number;
  lines: [number, number][][];
}

export interface RealCzechRailway {
  rank: number;
  cat: number;
  lines: [number, number][][];
}

export interface RealCzechUrban {
  rings: [number, number][][];
}

export interface RealCzechVectors {
  rivers: RealCzechRiver[];
  lakes: RealCzechLake[];
  roads: RealCzechRoad[];
  railways: RealCzechRailway[];
  urban: RealCzechUrban[];
}

export interface RealPlaceCity {
  n: string;
  x: number;
  y: number;
  p: number;
  e: number;
  t: number; // 3 = capital, 2 = regional, 1 = district, 0 = other
  a: string;
}

export interface RealPlacePeak {
  n: string;
  x: number;
  y: number;
  e: number;
}

export interface RealCzechPlaces {
  cities: RealPlaceCity[];
  peaks: RealPlacePeak[];
}

export type MapScope = 'cz' | 'world';

export interface RealCzechDataset {
  dem: RealDemGrid;
  admin: RealCzechAdmin;
  vectors: RealCzechVectors;
  places: RealCzechPlaces;
}

export type GeoBbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

export interface WorldCountry {
  n: string;
  en: string;
  iso: string;
  p: number;
  x: number;
  y: number;
  b?: GeoBbox;
  rings: [number, number][][];
}

export interface WorldRiver {
  n: string;
  w: number;
  b?: GeoBbox;
  lines: [number, number][][];
}

export interface WorldLake {
  n: string;
  b?: GeoBbox;
  rings: [number, number][][];
}

export interface WorldCity {
  n: string;
  c: string;
  x: number;
  y: number;
  p: number;
  cap: number; // 1 = capital, 0 = other
}

export interface WorldPeak {
  n: string;
  r: string;
  x: number;
  y: number;
  e: number;
}

export interface RealWorldDataset {
  dem: RealDemGrid;
  countries: WorldCountry[];
  rivers: WorldRiver[];
  lakes: WorldLake[];
  cities: WorldCity[];
  peaks: WorldPeak[];
}

export interface WorldDetailRoad {
  t: number; // 2 = motorway, 1 = secondary highway, 0 = road
  n?: string; // route code / name
  r?: number; // scalerank
  b: GeoBbox;
  l: [number, number][][];
}

export interface WorldDetailRailway {
  r: number;
  b: GeoBbox;
  l: [number, number][][];
}

export interface WorldDetailUrban {
  b: GeoBbox;
  g: [number, number][][];
}

export interface WorldDetailAdmin1 {
  b: GeoBbox;
  l: [number, number][][];
}

export interface WorldDetailRiver {
  n?: string;
  w: number;
  r?: number;
  b: GeoBbox;
  l: [number, number][][];
}

export interface WorldDetailLake {
  n?: string;
  r?: number;
  b: GeoBbox;
  g: [number, number][][];
}

export interface WorldDetailCity {
  n: string;
  c: string;
  a: string;
  x: number;
  y: number;
  p: number;
  t: number; // 2 = national capital, 1 = admin-1 capital, 0 = city/town
  r: number;
}

export interface WorldDetailPeak {
  n: string;
  r: string;
  x: number;
  y: number;
  e: number;
}

export interface WorldDetailBorder {
  c: number; // 0 = international land border (10m), 1 = coastline (10m)
  b: GeoBbox;
  l: [number, number][][];
}

export interface RealWorldDetailDataset {
  borders?: WorldDetailBorder[];
  roads: WorldDetailRoad[];
  railways: WorldDetailRailway[];
  urban: WorldDetailUrban[];
  admin1: WorldDetailAdmin1[];
  rivers: WorldDetailRiver[];
  lakes: WorldDetailLake[];
  cities: WorldDetailCity[];
  peaks: WorldDetailPeak[];
}

export interface WorldBlockMeta {
  id: string;
  code: string;
  col: number;
  row: number;
  b: GeoBbox;
  count: number;
}

export interface WorldDetailBlock extends RealWorldDetailDataset {
  id: string;
  code: string;
  col: number;
  row: number;
  b: GeoBbox;
}

export interface WorldPlacesIndex {
  blockSizeDeg: number;
  cols: number;
  rows: number;
  blocks: Record<string, WorldBlockMeta>;
  cities: WorldDetailCity[];
  peaks: WorldDetailPeak[];
}

export interface ContourLevel {
  elevation: number;
  isIndex: boolean;
  polylines: Point2D[][];
}

export interface SelectedMapPoint {
  title: string;
  subtitle: string;
  lon: number;
  lat: number;
  elevation: number;
  kind: 'city' | 'peak' | 'lake' | 'terrain' | 'country';
}

export interface GpxTrackPoint {
  lon: number;
  lat: number;
  ele: number; // meters a.s.l.
  distanceFromStart: number; // meters
  slopePercent: number;
}

export interface GpxWaypoint {
  name: string;
  lon: number;
  lat: number;
  ele?: number;
}

export interface ImportedGpxTrack {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  points: GpxTrackPoint[];
  waypoints: GpxWaypoint[];
  distanceMeters: number;
  ascentMeters: number;
  descentMeters: number;
  minElevation: number;
  maxElevation: number;
  bounds: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  };
}
