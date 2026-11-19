import {
  CzechCity,
  CzechHighway,
  CzechLake,
  CzechPeak,
  CzechRegionLabel,
  CzechRiver,
  ReliefMassif,
  UrbanArea,
} from '../types/map';

export const CZ_BOUNDS = {
  minLon: 11.75,
  maxLon: 19.15,
  minLat: 48.35,
  maxLat: 51.25,
};

// High-precision WGS84 [lon, lat] outline of the Czech Republic (~155 vertices)
// Accurately traces all border salients (Ašský, Šluknovský, Frýdlantský, Broumovský, Javornický, Osoblažský, Jablunkovský, Břeclavský)
export const CZECH_BORDER: [number, number][] = [
  [12.100, 50.317], [12.182, 50.321], [12.238, 50.258], [12.342, 50.212],
  [12.404, 50.262], [12.445, 50.325], [12.512, 50.352], [12.592, 50.402],
  [12.732, 50.432], [12.860, 50.415], [12.922, 50.410], [12.990, 50.432],
  [13.035, 50.495], [13.145, 50.518], [13.255, 50.522], [13.385, 50.585],
  [13.550, 50.652], [13.685, 50.715], [13.775, 50.732], [13.910, 50.768],
  [13.972, 50.790], [14.115, 50.835], [14.232, 50.888], [14.265, 50.872],
  [14.315, 50.945], [14.315, 51.055], [14.405, 51.045], [14.455, 51.012],
  [14.570, 50.992], [14.562, 50.948], [14.622, 50.912], [14.585, 50.878],
  [14.705, 50.848], [14.832, 50.868], [14.915, 50.922], [15.052, 51.022],
  [15.165, 50.992], [15.242, 50.962], [15.272, 50.891], [15.365, 50.822],
  [15.422, 50.782], [15.545, 50.785], [15.642, 50.762], [15.740, 50.736],
  [15.822, 50.752], [15.910, 50.662], [15.982, 50.665], [16.088, 50.652],
  [16.242, 50.642], [16.272, 50.652], [16.362, 50.622], [16.412, 50.562],
  [16.382, 50.522], [16.342, 50.502], [16.272, 50.502], [16.172, 50.432],
  [16.252, 50.392], [16.312, 50.372], [16.392, 50.322], [16.472, 50.282],
  [16.562, 50.212], [16.632, 50.102], [16.752, 50.145], [16.847, 50.207],
  [16.922, 50.232], [16.932, 50.362], [16.902, 50.442], [17.012, 50.422],
  [17.092, 50.402], [17.182, 50.382], [17.142, 50.352], [17.245, 50.325],
  [17.322, 50.302], [17.402, 50.272], [17.492, 50.262], [17.522, 50.252],
  [17.582, 50.172], [17.612, 50.262], [17.682, 50.222], [17.722, 50.282],
  [17.712, 50.242], [17.665, 50.165], [17.702, 50.092], [17.872, 49.972],
  [18.045, 49.985], [18.182, 49.982], [18.352, 49.922], [18.542, 49.872],
  [18.622, 49.752], [18.682, 49.682], [18.775, 49.615], [18.859, 49.551],
  [18.852, 49.522], [18.752, 49.492], [18.585, 49.465], [18.412, 49.412],
  [18.322, 49.362], [18.215, 49.285], [18.082, 49.172], [18.032, 49.082],
  [17.872, 48.962], [17.745, 48.885], [17.676, 48.858], [17.455, 48.842],
  [17.272, 48.872], [17.132, 48.842], [17.025, 48.745], [16.942, 48.622],
  [16.852, 48.742], [16.752, 48.732], [16.632, 48.792], [16.465, 48.768],
  [16.382, 48.752], [16.215, 48.768], [16.062, 48.762], [15.812, 48.882],
  [15.615, 48.912], [15.352, 48.992], [15.102, 49.012], [14.962, 48.772],
  [14.782, 48.782], [14.702, 48.612], [14.565, 48.612], [14.452, 48.652],
  [14.333, 48.552], [14.172, 48.622], [13.972, 48.732], [13.802, 48.772],
  [13.712, 48.902], [13.592, 48.972], [13.482, 49.022], [13.345, 49.092],
  [13.212, 49.132], [13.112, 49.202], [12.982, 49.342], [12.842, 49.352],
  [12.782, 49.382], [12.675, 49.495], [12.592, 49.582], [12.542, 49.672],
  [12.562, 49.822], [12.602, 49.892], [12.475, 49.972], [12.342, 50.062],
  [12.252, 50.092], [12.142, 50.222], [12.100, 50.317],
];

// Accurate 14 Kraje boundaries including Prague loop
export const CZECH_REGION_LINES: [number, number][][] = [
  // Hlavní město Praha (enclave inside Středočeský kraj)
  [
    [14.22, 50.10], [14.32, 50.16], [14.52, 50.17], [14.70, 50.10],
    [14.66, 49.98], [14.46, 49.94], [14.32, 49.96], [14.22, 50.10],
  ],
  // Karlovarský / Plzeňský
  [[12.48, 49.97], [12.75, 50.00], [13.02, 50.04], [13.28, 50.10]],
  // Karlovarský / Ústecký
  [[13.28, 50.10], [13.20, 50.28], [13.08, 50.45], [13.04, 50.50]],
  // Ústecký / Plzeňský / Středočeský
  [[13.28, 50.10], [13.52, 50.14], [13.85, 50.28], [14.12, 50.42], [14.38, 50.46]],
  // Ústecký / Liberecký
  [[14.38, 50.46], [14.48, 50.65], [14.42, 50.85], [14.45, 51.01]],
  // Plzeňský / Středočeský
  [[13.28, 50.10], [13.52, 49.92], [13.76, 49.72], [13.82, 49.55]],
  // Plzeňský / Jihočeský
  [[13.21, 49.13], [13.48, 49.28], [13.72, 49.42], [13.82, 49.55]],
  // Středočeský / Jihočeský
  [[13.82, 49.55], [14.18, 49.52], [14.62, 49.54], [14.95, 49.55]],
  // Středočeský / Liberecký
  [[14.38, 50.46], [14.82, 50.48], [15.16, 50.45]],
  // Liberecký / Královéhradecký
  [[15.16, 50.45], [15.32, 50.56], [15.52, 50.65], [15.55, 50.79]],
  // Středočeský / Královéhradecký & Pardubický & Vysočina
  [[15.16, 50.45], [15.32, 50.22], [15.42, 50.02], [15.48, 49.82], [15.22, 49.68], [14.95, 49.55]],
  // Královéhradecký / Pardubický
  [[15.42, 50.02], [15.78, 50.14], [16.12, 50.08], [16.52, 50.08], [16.63, 50.10]],
  // Jihočeský / Vysočina
  [[14.95, 49.55], [15.04, 49.34], [15.16, 49.12], [15.35, 48.99]],
  // Pardubický / Vysočina
  [[15.48, 49.82], [15.86, 49.76], [16.18, 49.64], [16.44, 49.60]],
  // Pardubický / Olomoucký
  [[16.63, 50.10], [16.74, 49.92], [16.68, 49.72], [16.44, 49.60]],
  // Vysočina / Jihomoravský
  [[16.44, 49.60], [16.32, 49.42], [16.22, 49.18], [16.02, 48.96], [15.81, 48.88]],
  // Olomoucký / Jihomoravský
  [[16.44, 49.60], [16.72, 49.54], [17.02, 49.38], [17.16, 49.26]],
  // Jihomoravský / Zlínský
  [[17.16, 49.26], [17.28, 49.08], [17.34, 48.87]],
  // Olomoucký / Zlínský
  [[17.16, 49.26], [17.44, 49.36], [17.68, 49.44], [17.88, 49.46]],
  // Olomoucký / Moravskoslezský
  [[17.24, 50.32], [17.34, 50.04], [17.52, 49.76], [17.78, 49.56], [17.88, 49.46]],
  // Zlínský / Moravskoslezský
  [[17.88, 49.46], [18.18, 49.42], [18.41, 49.41]],
];

export const CZECH_REGION_LABELS: CzechRegionLabel[] = [
  { id: 'pha', name: 'Praha', lon: 14.43, lat: 50.08 },
  { id: 'stc', name: 'Středočeský kraj', lon: 14.52, lat: 49.84 },
  { id: 'jhc', name: 'Jihočeský kraj', lon: 14.38, lat: 49.10 },
  { id: 'plz', name: 'Plzeňský kraj', lon: 13.28, lat: 49.62 },
  { id: 'kvk', name: 'Karlovarský kraj', lon: 12.74, lat: 50.18 },
  { id: 'ulk', name: 'Ústecký kraj', lon: 13.82, lat: 50.56 },
  { id: 'lbk', name: 'Liberecký kraj', lon: 15.04, lat: 50.72 },
  { id: 'khk', name: 'Královéhradecký kraj', lon: 15.88, lat: 50.38 },
  { id: 'pak', name: 'Pardubický kraj', lon: 16.05, lat: 49.90 },
  { id: 'vys', name: 'Kraj Vysočina', lon: 15.62, lat: 49.42 },
  { id: 'jhm', name: 'Jihomoravský kraj', lon: 16.65, lat: 49.06 },
  { id: 'olk', name: 'Olomoucký kraj', lon: 17.15, lat: 49.74 },
  { id: 'zlk', name: 'Zlínský kraj', lon: 17.72, lat: 49.22 },
  { id: 'msk', name: 'Moravskoslezský kraj', lon: 18.08, lat: 49.78 },
];

// Calibrated 65-massif geomorphological elevation & basin model of Czechia
export const CZECH_RELIEF_MASSIFS: ReliefMassif[] = [
  // Krkonoše & Podkrkonoší
  { name: 'Krkonoše hlavní hřeben', lon: 15.64, lat: 50.73, radiusLon: 0.34, radiusLat: 0.11, rotationDeg: -14, amplitude: 1050 },
  { name: 'Sněžka', lon: 15.740, lat: 50.736, radiusLon: 0.08, radiusLat: 0.05, amplitude: 380 },
  { name: 'Černá hora', lon: 15.74, lat: 50.65, radiusLon: 0.10, radiusLat: 0.06, amplitude: 340 },
  // Jizerské & Lužické hory
  { name: 'Jizerské hory', lon: 15.24, lat: 50.83, radiusLon: 0.24, radiusLat: 0.10, rotationDeg: -8, amplitude: 720 },
  { name: 'Ještědský hřbet', lon: 14.98, lat: 50.73, radiusLon: 0.12, radiusLat: 0.07, rotationDeg: -35, amplitude: 480 },
  { name: 'Lužické hory', lon: 14.62, lat: 50.84, radiusLon: 0.22, radiusLat: 0.08, rotationDeg: -12, amplitude: 450 },
  { name: 'Šluknovská pahorkatina', lon: 14.42, lat: 50.98, radiusLon: 0.18, radiusLat: 0.08, amplitude: 220 },
  // Krušné hory & SZ Čechy
  { name: 'Krušné hory západ', lon: 12.88, lat: 50.40, radiusLon: 0.42, radiusLat: 0.10, rotationDeg: 18, amplitude: 760 },
  { name: 'Klínovec', lon: 12.968, lat: 50.396, radiusLon: 0.08, radiusLat: 0.04, amplitude: 240 },
  { name: 'Krušné hory střed', lon: 13.45, lat: 50.56, radiusLon: 0.35, radiusLat: 0.09, rotationDeg: 22, amplitude: 560 },
  { name: 'Krušné hory východ', lon: 13.86, lat: 50.72, radiusLon: 0.34, radiusLat: 0.09, rotationDeg: 20, amplitude: 510 },
  { name: 'Děčínská vrchovina', lon: 14.14, lat: 50.82, radiusLon: 0.18, radiusLat: 0.08, amplitude: 280 },
  { name: 'Slavkovský les', lon: 12.74, lat: 50.06, radiusLon: 0.22, radiusLat: 0.13, rotationDeg: 20, amplitude: 450 },
  { name: 'Smrčiny / Ašsko', lon: 12.22, lat: 50.22, radiusLon: 0.16, radiusLat: 0.12, amplitude: 310 },
  { name: 'Doupovské hory', lon: 13.15, lat: 50.25, radiusLon: 0.16, radiusLat: 0.10, amplitude: 420 },
  { name: 'České středohoří', lon: 14.02, lat: 50.56, radiusLon: 0.28, radiusLat: 0.11, rotationDeg: 15, amplitude: 340 },
  { name: 'Ralská pahorkatina / Kokořínsko', lon: 14.68, lat: 50.56, radiusLon: 0.28, radiusLat: 0.14, amplitude: 190 },
  // Český les, Šumava & Novohradské hory
  { name: 'Český les sever', lon: 12.60, lat: 49.74, radiusLon: 0.14, radiusLat: 0.18, rotationDeg: -15, amplitude: 440 },
  { name: 'Český les jih / Čerchov', lon: 12.76, lat: 49.40, radiusLon: 0.14, radiusLat: 0.16, rotationDeg: -22, amplitude: 520 },
  { name: 'Šumava západ', lon: 13.38, lat: 49.10, radiusLon: 0.36, radiusLat: 0.15, rotationDeg: -36, amplitude: 820 },
  { name: 'Šumava střed / Boubín', lon: 13.78, lat: 48.95, radiusLon: 0.28, radiusLat: 0.14, rotationDeg: -32, amplitude: 790 },
  { name: 'Šumava východ / Plechý', lon: 13.98, lat: 48.74, radiusLon: 0.30, radiusLat: 0.12, rotationDeg: -30, amplitude: 730 },
  { name: 'Šumavské podhůří', lon: 13.95, lat: 49.02, radiusLon: 0.38, radiusLat: 0.18, amplitude: 320 },
  { name: 'Novohradské hory', lon: 14.68, lat: 48.62, radiusLon: 0.20, radiusLat: 0.10, rotationDeg: -18, amplitude: 560 },
  // Orlické hory, Broumovsko, Kralický Sněžník, Jeseníky
  { name: 'Broumovská vrchovina', lon: 16.24, lat: 50.56, radiusLon: 0.18, radiusLat: 0.12, amplitude: 390 },
  { name: 'Orlické hory', lon: 16.42, lat: 50.25, radiusLon: 0.14, radiusLat: 0.24, rotationDeg: -26, amplitude: 660 },
  { name: 'Kralický Sněžník', lon: 16.85, lat: 50.20, radiusLon: 0.14, radiusLat: 0.11, amplitude: 870 },
  { name: 'Rychlebské hory', lon: 17.04, lat: 50.32, radiusLon: 0.16, radiusLat: 0.11, rotationDeg: -30, amplitude: 540 },
  { name: 'Hrubý Jeseník', lon: 17.22, lat: 50.10, radiusLon: 0.24, radiusLat: 0.17, rotationDeg: 22, amplitude: 920 },
  { name: 'Praděd', lon: 17.23, lat: 50.083, radiusLon: 0.08, radiusLat: 0.05, amplitude: 270 },
  { name: 'Nízký Jeseník', lon: 17.56, lat: 49.82, radiusLon: 0.34, radiusLat: 0.20, rotationDeg: 10, amplitude: 380 },
  { name: 'Zábřežská vrchovina', lon: 16.80, lat: 49.82, radiusLon: 0.18, radiusLat: 0.14, amplitude: 290 },
  // Moravské Karpaty (Beskydy, Hostýnsko, Bílé Karpaty, Chřiby)
  { name: 'Moravskoslezské Beskydy', lon: 18.42, lat: 49.52, radiusLon: 0.36, radiusLat: 0.14, rotationDeg: 12, amplitude: 800 },
  { name: 'Lysá hora', lon: 18.448, lat: 49.546, radiusLon: 0.08, radiusLat: 0.05, amplitude: 250 },
  { name: 'Hostýnsko-vsetínská hornatina', lon: 17.95, lat: 49.36, radiusLon: 0.30, radiusLat: 0.11, rotationDeg: 18, amplitude: 480 },
  { name: 'Javorníky', lon: 18.25, lat: 49.30, radiusLon: 0.22, radiusLat: 0.10, rotationDeg: 25, amplitude: 560 },
  { name: 'Vizovická vrchovina', lon: 17.84, lat: 49.18, radiusLon: 0.24, radiusLat: 0.12, amplitude: 290 },
  { name: 'Bílé Karpaty', lon: 17.75, lat: 48.95, radiusLon: 0.32, radiusLat: 0.12, rotationDeg: 40, amplitude: 470 },
  { name: 'Chřiby', lon: 17.28, lat: 49.12, radiusLon: 0.18, radiusLat: 0.08, rotationDeg: 32, amplitude: 240 },
  { name: 'Ždánický les', lon: 16.95, lat: 49.08, radiusLon: 0.16, radiusLat: 0.08, amplitude: 170 },
  { name: 'Pálava', lon: 16.65, lat: 48.86, radiusLon: 0.07, radiusLat: 0.05, amplitude: 240 },
  // Interior Bohemian & Moravian Uplands
  { name: 'Brdy', lon: 13.86, lat: 49.68, radiusLon: 0.25, radiusLat: 0.12, rotationDeg: 28, amplitude: 430 },
  { name: 'Křivoklátsko', lon: 13.84, lat: 50.02, radiusLon: 0.24, radiusLat: 0.12, amplitude: 210 },
  { name: 'Džbán', lon: 13.72, lat: 50.22, radiusLon: 0.18, radiusLat: 0.09, amplitude: 200 },
  { name: 'Středočeská pahorkatina', lon: 14.52, lat: 49.55, radiusLon: 0.44, radiusLat: 0.22, amplitude: 200 },
  { name: 'Českomoravská vrchovina', lon: 15.55, lat: 49.42, radiusLon: 0.72, radiusLat: 0.40, rotationDeg: -22, amplitude: 360 },
  { name: 'Žďárské vrchy', lon: 16.05, lat: 49.64, radiusLon: 0.25, radiusLat: 0.15, amplitude: 260 },
  { name: 'Javořice / Jihlavské vrchy', lon: 15.34, lat: 49.22, radiusLon: 0.20, radiusLat: 0.13, amplitude: 280 },
  { name: 'Železné hory', lon: 15.68, lat: 49.84, radiusLon: 0.22, radiusLat: 0.09, rotationDeg: -30, amplitude: 260 },
  { name: 'Drahanská vrchovina a Moravský kras', lon: 16.75, lat: 49.42, radiusLon: 0.22, radiusLat: 0.19, amplitude: 330 },
  { name: 'Svitavská pahorkatina', lon: 16.32, lat: 49.82, radiusLon: 0.25, radiusLat: 0.15, amplitude: 190 },
  // Lowlands, Basins & River Corridors
  { name: 'Polabská nížina západ', lon: 14.55, lat: 50.24, radiusLon: 0.48, radiusLat: 0.16, amplitude: -155 },
  { name: 'Polabská nížina východ', lon: 15.48, lat: 50.10, radiusLon: 0.56, radiusLat: 0.18, rotationDeg: -10, amplitude: -150 },
  { name: 'Dolnooharská tabule', lon: 14.08, lat: 50.40, radiusLon: 0.36, radiusLat: 0.14, amplitude: -145 },
  { name: 'Mostecká pánev', lon: 13.62, lat: 50.52, radiusLon: 0.26, radiusLat: 0.08, rotationDeg: 22, amplitude: -120 },
  { name: 'Sokolovská a Chebská pánev', lon: 12.52, lat: 50.14, radiusLon: 0.22, radiusLat: 0.08, rotationDeg: 18, amplitude: -60 },
  { name: 'Plzeňská kotlina', lon: 13.38, lat: 49.75, radiusLon: 0.26, radiusLat: 0.17, amplitude: -75 },
  { name: 'Českobudějovická pánev', lon: 14.42, lat: 49.02, radiusLon: 0.24, radiusLat: 0.15, amplitude: -40 },
  { name: 'Třeboňská pánev', lon: 14.78, lat: 49.04, radiusLon: 0.20, radiusLat: 0.16, amplitude: -25 },
  { name: 'Hornomoravský úval', lon: 17.24, lat: 49.52, radiusLon: 0.22, radiusLat: 0.26, rotationDeg: -18, amplitude: -165 },
  { name: 'Dyjskosvratecký úval', lon: 16.56, lat: 48.92, radiusLon: 0.42, radiusLat: 0.20, rotationDeg: 15, amplitude: -175 },
  { name: 'Dolnomoravský úval', lon: 17.20, lat: 48.92, radiusLon: 0.32, radiusLat: 0.22, rotationDeg: 35, amplitude: -185 },
  { name: 'Moravská brána', lon: 17.78, lat: 49.60, radiusLon: 0.24, radiusLat: 0.10, rotationDeg: 28, amplitude: -120 },
  { name: 'Ostravská pánev', lon: 18.28, lat: 49.84, radiusLon: 0.28, radiusLat: 0.13, amplitude: -145 },
];

export const CZECH_RIVERS: CzechRiver[] = [
  {
    id: 'labe',
    name: 'Labe',
    width: 3.0,
    points: [
      [15.53, 50.77], [15.61, 50.72], [15.61, 50.62], [15.72, 50.52],
      [15.81, 50.43], [15.92, 50.34], [15.83, 50.21], [15.78, 50.04],
      [15.60, 50.04], [15.32, 50.02], [15.20, 50.03], [15.12, 50.14],
      [15.04, 50.18], [14.78, 50.18], [14.66, 50.19], [14.52, 50.27],
      [14.47, 50.35], [14.37, 50.42], [14.24, 50.43], [14.13, 50.53],
      [14.04, 50.66], [14.18, 50.76], [14.23, 50.89],
    ],
  },
  {
    id: 'vltava',
    name: 'Vltava',
    width: 3.0,
    points: [
      [13.60, 48.98], [13.78, 48.88], [13.94, 48.78], [14.12, 48.69],
      [14.23, 48.64], [14.31, 48.62], [14.37, 48.69], [14.32, 48.81],
      [14.47, 48.97], [14.44, 49.06], [14.44, 49.22], [14.26, 49.36],
      [14.16, 49.45], [14.20, 49.55], [14.21, 49.64], [14.34, 49.75],
      [14.43, 49.82], [14.40, 49.94], [14.41, 50.08], [14.39, 50.18],
      [14.32, 50.24], [14.47, 50.35],
    ],
  },
  {
    id: 'morava',
    name: 'Morava',
    width: 2.8,
    points: [
      [16.84, 50.15], [16.92, 50.07], [16.93, 49.94], [16.97, 49.82],
      [17.07, 49.71], [17.25, 49.59], [17.30, 49.45], [17.39, 49.30],
      [17.52, 49.18], [17.46, 49.07], [17.38, 48.96], [17.24, 48.90],
      [17.13, 48.84], [17.02, 48.74], [16.94, 48.62],
    ],
  },
  {
    id: 'ohre',
    name: 'Ohře',
    width: 2.1,
    points: [
      [12.26, 50.09], [12.37, 50.08], [12.52, 50.12], [12.64, 50.18],
      [12.87, 50.23], [13.03, 50.32], [13.25, 50.38], [13.38, 50.36],
      [13.54, 50.33], [13.80, 50.36], [14.02, 50.42], [14.13, 50.53],
    ],
  },
  {
    id: 'berounka',
    name: 'Berounka',
    width: 2.1,
    points: [
      [13.38, 49.75], [13.52, 49.84], [13.66, 49.92], [13.86, 50.02],
      [14.07, 49.96], [14.24, 49.94], [14.40, 49.99],
    ],
  },
  {
    id: 'sazava',
    name: 'Sázava',
    width: 1.9,
    points: [
      [15.92, 49.64], [15.72, 49.57], [15.58, 49.61], [15.42, 49.68],
      [15.26, 49.71], [15.05, 49.78], [14.91, 49.87], [14.72, 49.88],
      [14.54, 49.87], [14.40, 49.88],
    ],
  },
  {
    id: 'dyje',
    name: 'Dyje',
    width: 2.2,
    points: [
      [15.52, 49.04], [15.72, 48.94], [15.82, 48.91], [16.05, 48.85],
      [16.28, 48.81], [16.52, 48.86], [16.65, 48.88], [16.82, 48.82],
      [16.88, 48.75], [16.94, 48.62],
    ],
  },
  {
    id: 'svratka',
    name: 'Svratka',
    width: 1.8,
    points: [
      [16.06, 49.65], [16.25, 49.56], [16.36, 49.42], [16.46, 49.33],
      [16.55, 49.23], [16.61, 49.19], [16.62, 49.03], [16.65, 48.88],
    ],
  },
  {
    id: 'jihlava',
    name: 'Jihlava',
    width: 1.6,
    points: [
      [15.32, 49.26], [15.59, 49.40], [15.88, 49.21], [16.16, 49.12],
      [16.42, 49.08], [16.61, 48.96], [16.64, 48.89],
    ],
  },
  {
    id: 'otava',
    name: 'Otava',
    width: 1.7,
    points: [
      [13.52, 49.12], [13.66, 49.23], [13.78, 49.26], [13.90, 49.26],
      [14.15, 49.31], [14.20, 49.42],
    ],
  },
  {
    id: 'luznice',
    name: 'Lužnice',
    width: 1.8,
    points: [
      [14.92, 48.82], [14.84, 48.92], [14.77, 49.02], [14.70, 49.18],
      [14.70, 49.26], [14.66, 49.41], [14.54, 49.34], [14.44, 49.22],
    ],
  },
  {
    id: 'jizera',
    name: 'Jizera',
    width: 1.7,
    points: [
      [15.34, 50.81], [15.42, 50.74], [15.33, 50.62], [15.22, 50.62],
      [15.15, 50.58], [14.98, 50.51], [14.90, 50.41], [14.78, 50.19],
    ],
  },
  {
    id: 'odra',
    name: 'Odra',
    width: 2.3,
    points: [
      [17.55, 49.61], [17.78, 49.62], [17.94, 49.69], [18.12, 49.76],
      [18.28, 49.84], [18.35, 49.92],
    ],
  },
  {
    id: 'ostravice',
    name: 'Ostravice',
    width: 1.5,
    points: [
      [18.42, 49.46], [18.38, 49.58], [18.35, 49.69], [18.29, 49.84],
    ],
  },
  {
    id: 'opava',
    name: 'Opava',
    width: 1.6,
    points: [
      [17.44, 50.12], [17.70, 50.09], [17.90, 49.94], [18.14, 49.89],
      [18.25, 49.85],
    ],
  },
  {
    id: 'becva',
    name: 'Bečva',
    width: 1.7,
    points: [
      [18.26, 49.41], [18.00, 49.34], [17.96, 49.46], [17.74, 49.54],
      [17.45, 49.45], [17.32, 49.42],
    ],
  },
  {
    id: 'orlice',
    name: 'Divoká a Tichá Orlice',
    width: 1.6,
    points: [
      [16.52, 50.22], [16.38, 50.12], [16.16, 50.14], [16.02, 50.17],
      [15.83, 50.21],
    ],
  },
  {
    id: 'chrudimka',
    name: 'Chrudimka',
    width: 1.4,
    points: [
      [15.92, 49.76], [15.72, 49.84], [15.79, 49.95], [15.78, 50.03],
    ],
  },
  {
    id: 'ploucnice',
    name: 'Ploučnice',
    width: 1.4,
    points: [
      [14.92, 50.70], [14.66, 50.68], [14.54, 50.68], [14.36, 50.72],
      [14.21, 50.78],
    ],
  },
  {
    id: 'mze',
    name: 'Mže',
    width: 1.5,
    points: [
      [12.64, 49.81], [12.82, 49.76], [13.00, 49.75], [13.20, 49.78],
      [13.38, 49.75],
    ],
  },
  {
    id: 'radbuza',
    name: 'Radbuza',
    width: 1.4,
    points: [
      [12.78, 49.48], [12.93, 49.55], [13.12, 49.62], [13.32, 49.71],
      [13.38, 49.75],
    ],
  },
  {
    id: 'uhlava',
    name: 'Úhlava',
    width: 1.4,
    points: [
      [13.18, 49.20], [13.29, 49.39], [13.32, 49.55], [13.38, 49.73],
    ],
  },
];

export const CZECH_LAKES: CzechLake[] = [
  {
    id: 'lipno',
    name: 'VN Lipno',
    elevation: 726,
    points: [
      [13.94, 48.78], [14.03, 48.74], [14.12, 48.69], [14.23, 48.64],
      [14.18, 48.62], [14.04, 48.66], [13.92, 48.74],
    ],
  },
  {
    id: 'orlik',
    name: 'VN Orlík',
    elevation: 353,
    points: [
      [14.15, 49.42], [14.22, 49.48], [14.20, 49.60], [14.16, 49.59],
      [14.17, 49.48], [14.11, 49.43],
    ],
  },
  {
    id: 'slapy',
    name: 'VN Slapy',
    elevation: 271,
    points: [
      [14.28, 49.71], [14.38, 49.76], [14.43, 49.82], [14.40, 49.83],
      [14.34, 49.77], [14.24, 49.72],
    ],
  },
  {
    id: 'nove-mlyny',
    name: 'VN Nové Mlýny',
    elevation: 170,
    points: [
      [16.56, 48.89], [16.68, 48.90], [16.72, 48.88], [16.67, 48.86],
      [16.56, 48.87],
    ],
  },
  {
    id: 'nechranice',
    name: 'VN Nechranice',
    elevation: 269,
    points: [
      [13.34, 50.36], [13.42, 50.37], [13.43, 50.34], [13.34, 50.34],
    ],
  },
  {
    id: 'zelivka',
    name: 'VN Švihov',
    elevation: 378,
    points: [
      [15.08, 49.68], [15.16, 49.63], [15.19, 49.60], [15.13, 49.62],
      [15.06, 49.67],
    ],
  },
  {
    id: 'slezska-harta',
    name: 'VN Slezská Harta',
    elevation: 499,
    points: [
      [17.52, 49.89], [17.59, 49.88], [17.58, 49.86], [17.51, 49.87],
    ],
  },
  {
    id: 'rozkos',
    name: 'VN Rozkoš',
    elevation: 281,
    points: [
      [16.05, 50.38], [16.10, 50.37], [16.09, 50.34], [16.04, 50.35],
    ],
  },
  {
    id: 'vranov',
    name: 'VN Vranov',
    elevation: 348,
    points: [
      [15.72, 48.93], [15.81, 48.92], [15.82, 48.90], [15.72, 48.91],
    ],
  },
  {
    id: 'dalesice',
    name: 'VN Dalešice',
    elevation: 381,
    points: [
      [16.04, 49.16], [16.13, 49.14], [16.12, 49.12], [16.03, 49.14],
    ],
  },
  {
    id: 'brnenska',
    name: 'Brněnská přehrada',
    elevation: 230,
    points: [
      [16.46, 49.26], [16.52, 49.24], [16.51, 49.22], [16.45, 49.24],
    ],
  },
  {
    id: 'hracholusky',
    name: 'VN Hracholusky',
    elevation: 356,
    points: [
      [13.06, 49.79], [13.15, 49.79], [13.15, 49.77], [13.05, 49.77],
    ],
  },
  {
    id: 'jesenice',
    name: 'VN Jesenice',
    elevation: 441,
    points: [
      [12.42, 50.08], [12.48, 50.08], [12.48, 50.05], [12.42, 50.06],
    ],
  },
  {
    id: 'rozmberk',
    name: 'Rybník Rožmberk',
    elevation: 424,
    points: [
      [14.76, 49.06], [14.79, 49.06], [14.79, 49.04], [14.76, 49.04],
    ],
  },
];

// Motorways (D) and Key Class I Highways (I/)
export const CZECH_HIGHWAYS: CzechHighway[] = [
  // Motorways
  { id: 'd0', code: 'D0', roadType: 'motorway', points: [[14.28, 50.06], [14.34, 49.98], [14.52, 49.97], [14.62, 50.02], [14.58, 50.10]] },
  { id: 'd1', code: 'D1', roadType: 'motorway', points: [[14.49, 50.04], [14.66, 49.94], [14.92, 49.75], [15.26, 49.62], [15.58, 49.42], [16.01, 49.36], [16.25, 49.28], [16.61, 49.17], [16.99, 49.28], [17.18, 49.29], [17.42, 49.36], [17.54, 49.48], [17.95, 49.65], [18.28, 49.84], [18.35, 49.92]] },
  { id: 'd2', code: 'D2', roadType: 'motorway', points: [[16.61, 49.17], [16.72, 48.96], [16.88, 48.77], [16.98, 48.68]] },
  { id: 'd3', code: 'D3', roadType: 'motorway', points: [[14.68, 49.55], [14.66, 49.38], [14.64, 49.22], [14.48, 48.98], [14.46, 48.72]] },
  { id: 'd4', code: 'D4', roadType: 'motorway', points: [[14.36, 49.95], [14.16, 49.74], [14.08, 49.54], [14.04, 49.36]] },
  { id: 'd5', code: 'D5', roadType: 'motorway', points: [[14.28, 50.05], [14.06, 49.96], [13.78, 49.84], [13.38, 49.70], [12.92, 49.71], [12.56, 49.67]] },
  { id: 'd6', code: 'D6', roadType: 'motorway', points: [[14.28, 50.10], [13.82, 50.14], [13.35, 50.14], [12.88, 50.23], [12.64, 50.18], [12.38, 50.08]] },
  { id: 'd7', code: 'D7', roadType: 'motorway', points: [[14.28, 50.11], [14.08, 50.22], [13.80, 50.35], [13.42, 50.46]] },
  { id: 'd8', code: 'D8', roadType: 'motorway', points: [[14.46, 50.14], [14.35, 50.28], [14.16, 50.46], [14.03, 50.66], [13.96, 50.77]] },
  { id: 'd10', code: 'D10', roadType: 'motorway', points: [[14.58, 50.12], [14.76, 50.24], [14.90, 50.41], [15.05, 50.56], [15.14, 50.62]] },
  { id: 'd11', code: 'D11', roadType: 'motorway', points: [[14.60, 50.10], [15.12, 50.13], [15.52, 50.16], [15.83, 50.21], [15.93, 50.42], [15.96, 50.64]] },
  { id: 'd35', code: 'D35', roadType: 'motorway', points: [[15.14, 50.62], [15.52, 50.42], [15.83, 50.21], [16.12, 49.98], [16.48, 49.84], [16.78, 49.76], [17.08, 49.68], [17.25, 49.59], [17.46, 49.50]] },
  { id: 'd46', code: 'D46', roadType: 'motorway', points: [[16.99, 49.28], [17.11, 49.47], [17.25, 49.59]] },
  { id: 'd48', code: 'D48', roadType: 'motorway', points: [[17.74, 49.55], [18.02, 49.60], [18.35, 49.68], [18.62, 49.75]] },
  { id: 'd52', code: 'D52', roadType: 'motorway', points: [[16.61, 49.17], [16.56, 49.02], [16.54, 48.91]] },
  { id: 'd55', code: 'D55', roadType: 'motorway', points: [[17.45, 49.45], [17.46, 49.28], [17.46, 49.07], [17.22, 48.90], [16.92, 48.75]] },
  // Primary Class I trunk roads connecting regions
  { id: 'i13', code: 'I/13', roadType: 'primary', points: [[12.37, 50.08], [12.87, 50.23], [13.42, 50.46], [13.64, 50.50], [13.82, 50.64], [14.03, 50.66], [14.21, 50.78], [14.54, 50.69], [15.05, 50.77], [15.24, 50.93]] },
  { id: 'i14', code: 'I/14', roadType: 'primary', points: [[15.05, 50.77], [15.42, 50.77], [15.61, 50.62], [15.91, 50.56], [16.16, 50.42], [16.46, 50.08]] },
  { id: 'i20', code: 'I/20', roadType: 'primary', points: [[12.87, 50.23], [13.15, 50.01], [13.37, 49.74], [13.68, 49.46], [13.90, 49.26], [14.15, 49.31], [14.47, 48.97]] },
  { id: 'i27', code: 'I/27', roadType: 'primary', points: [[13.64, 50.50], [13.55, 50.33], [13.52, 50.02], [13.37, 49.74], [13.30, 49.40], [13.21, 49.14]] },
  { id: 'i38', code: 'I/38', roadType: 'primary', points: [[14.54, 50.69], [14.90, 50.41], [15.20, 50.03], [15.28, 49.94], [15.58, 49.61], [15.59, 49.40], [15.88, 49.21], [16.05, 48.86]] },
  { id: 'i43', code: 'I/43', roadType: 'primary', points: [[16.61, 49.20], [16.65, 49.48], [16.47, 49.76], [16.58, 49.98], [16.74, 50.10]] },
  { id: 'i44', code: 'I/44', roadType: 'primary', points: [[17.07, 49.72], [16.97, 49.97], [17.20, 50.23], [17.32, 50.30]] },
  { id: 'i50', code: 'I/50', roadType: 'primary', points: [[16.61, 49.17], [17.00, 49.15], [17.46, 49.07], [17.65, 49.02], [17.87, 48.96]] },
  { id: 'i11', code: 'I/11', roadType: 'primary', points: [[15.83, 50.21], [16.24, 50.14], [16.63, 50.04], [16.97, 49.97], [17.46, 49.99], [17.90, 49.94], [18.26, 49.82], [18.62, 49.75], [18.75, 49.55]] },
  { id: 'i34', code: 'I/34', roadType: 'primary', points: [[14.47, 48.97], [15.00, 49.14], [15.22, 49.43], [15.59, 49.40], [15.94, 49.56], [16.47, 49.76]] },
];

// Subtle urban footprint polygons for largest Czech cities
export const CZECH_URBAN_AREAS: UrbanArea[] = [
  {
    id: 'u-praha',
    name: 'Praha',
    points: [
      [14.30, 50.12], [14.42, 50.15], [14.58, 50.13], [14.62, 50.06],
      [14.54, 49.99], [14.38, 49.99], [14.28, 50.05],
    ],
  },
  {
    id: 'u-brno',
    name: 'Brno',
    points: [
      [16.52, 49.23], [16.62, 49.25], [16.69, 49.20], [16.66, 49.14],
      [16.55, 49.15], [16.51, 49.19],
    ],
  },
  {
    id: 'u-ostrava',
    name: 'Ostrava',
    points: [
      [18.17, 49.86], [18.29, 49.87], [18.36, 49.81], [18.30, 49.76],
      [18.18, 49.78],
    ],
  },
  {
    id: 'u-plzen',
    name: 'Plzeň',
    points: [
      [13.31, 49.77], [13.41, 49.78], [13.44, 49.72], [13.34, 49.70],
    ],
  },
  {
    id: 'u-liberec',
    name: 'Liberec',
    points: [
      [15.01, 50.79], [15.09, 50.79], [15.10, 50.74], [15.02, 50.74],
    ],
  },
  {
    id: 'u-olomouc',
    name: 'Olomouc',
    points: [
      [17.20, 49.62], [17.29, 49.62], [17.29, 49.57], [17.21, 49.57],
    ],
  },
  {
    id: 'u-cb',
    name: 'České Budějovice',
    points: [
      [14.43, 49.00], [14.51, 49.00], [14.51, 48.95], [14.43, 48.95],
    ],
  },
  {
    id: 'u-hk',
    name: 'Hradec Králové',
    points: [
      [15.79, 50.23], [15.87, 50.23], [15.87, 50.19], [15.79, 50.19],
    ],
  },
  {
    id: 'u-pardubice',
    name: 'Pardubice',
    points: [
      [15.73, 50.06], [15.82, 50.06], [15.82, 50.01], [15.73, 50.01],
    ],
  },
];

// 100+ Czech cities & towns with accurate WGS84 coordinates
export const CZECH_CITIES: CzechCity[] = [
  { id: 'praha', name: 'Praha', lon: 14.4378, lat: 50.0755, population: 1384000, isCapital: true, isRegionalSeat: true, region: 'Praha' },
  { id: 'brno', name: 'Brno', lon: 16.6068, lat: 49.1951, population: 400000, isRegionalSeat: true, region: 'Jihomoravský' },
  { id: 'ostrava', name: 'Ostrava', lon: 18.2625, lat: 49.8209, population: 284000, isRegionalSeat: true, region: 'Moravskoslezský' },
  { id: 'plzen', name: 'Plzeň', lon: 13.3736, lat: 49.7384, population: 185000, isRegionalSeat: true, region: 'Plzeňský' },
  { id: 'liberec', name: 'Liberec', lon: 15.0543, lat: 50.7663, population: 107000, isRegionalSeat: true, region: 'Liberecký' },
  { id: 'olomouc', name: 'Olomouc', lon: 17.2509, lat: 49.5938, population: 102000, isRegionalSeat: true, region: 'Olomoucký' },
  { id: 'cb', name: 'České Budějovice', lon: 14.4743, lat: 48.9745, population: 97000, isRegionalSeat: true, region: 'Jihočeský' },
  { id: 'hk', name: 'Hradec Králové', lon: 15.8328, lat: 50.2104, population: 93000, isRegionalSeat: true, region: 'Královéhradecký' },
  { id: 'pardubice', name: 'Pardubice', lon: 15.7766, lat: 50.0343, population: 92000, isRegionalSeat: true, region: 'Pardubický' },
  { id: 'usti', name: 'Ústí nad Labem', lon: 14.0323, lat: 50.6607, population: 91000, isRegionalSeat: true, region: 'Ústecký' },
  { id: 'zlin', name: 'Zlín', lon: 17.6667, lat: 49.2264, population: 74000, isRegionalSeat: true, region: 'Zlínský' },
  { id: 'jihlava', name: 'Jihlava', lon: 15.5912, lat: 49.3961, population: 53000, isRegionalSeat: true, region: 'Vysočina' },
  { id: 'kv', name: 'Karlovy Vary', lon: 12.8712, lat: 50.2305, population: 49000, isRegionalSeat: true, region: 'Karlovarský' },
  { id: 'havirov', name: 'Havířov', lon: 18.4369, lat: 49.7798, population: 69000, region: 'Moravskoslezský' },
  { id: 'kladno', name: 'Kladno', lon: 14.1028, lat: 50.1473, population: 69000, region: 'Středočeský' },
  { id: 'most', name: 'Most', lon: 13.6362, lat: 50.5030, population: 63000, region: 'Ústecký' },
  { id: 'opava', name: 'Opava', lon: 17.9026, lat: 49.9387, population: 55000, region: 'Moravskoslezský' },
  { id: 'fm', name: 'Frýdek-Místek', lon: 18.3484, lat: 49.6856, population: 54000, region: 'Moravskoslezský' },
  { id: 'karvina', name: 'Karviná', lon: 18.5417, lat: 49.8540, population: 50000, region: 'Moravskoslezský' },
  { id: 'teplice', name: 'Teplice', lon: 13.8245, lat: 50.6404, population: 50000, region: 'Ústecký' },
  { id: 'decin', name: 'Děčín', lon: 14.2148, lat: 50.7822, population: 47000, region: 'Ústecký' },
  { id: 'chomutov', name: 'Chomutov', lon: 13.4178, lat: 50.4605, population: 46000, region: 'Ústecký' },
  { id: 'mb', name: 'Mladá Boleslav', lon: 14.9032, lat: 50.4113, population: 46000, region: 'Středočeský' },
  { id: 'jablonec', name: 'Jablonec nad Nisou', lon: 15.1711, lat: 50.7243, population: 45800, region: 'Liberecký' },
  { id: 'prostejov', name: 'Prostějov', lon: 17.1105, lat: 49.4719, population: 43000, region: 'Olomoucký' },
  { id: 'prerov', name: 'Přerov', lon: 17.4509, lat: 49.4554, population: 41000, region: 'Olomoucký' },
  { id: 'ceska-lipa', name: 'Česká Lípa', lon: 14.5376, lat: 50.6855, population: 37000, region: 'Liberecký' },
  { id: 'trebic', name: 'Třebíč', lon: 15.8817, lat: 49.2149, population: 35000, region: 'Vysočina' },
  { id: 'trinec', name: 'Třinec', lon: 18.6708, lat: 49.6776, population: 34500, region: 'Moravskoslezský' },
  { id: 'tabor', name: 'Tábor', lon: 14.6578, lat: 49.4144, population: 34000, region: 'Jihočeský' },
  { id: 'znojmo', name: 'Znojmo', lon: 16.0488, lat: 48.8555, population: 34000, region: 'Jihomoravský' },
  { id: 'kolin', name: 'Kolín', lon: 15.2006, lat: 50.0281, population: 33000, region: 'Středočeský' },
  { id: 'pribram', name: 'Příbram', lon: 14.0104, lat: 49.6899, population: 32000, region: 'Středočeský' },
  { id: 'cheb', name: 'Cheb', lon: 12.3739, lat: 50.0796, population: 32000, region: 'Karlovarský' },
  { id: 'pisek', name: 'Písek', lon: 14.1475, lat: 49.3088, population: 31000, region: 'Jihočeský' },
  { id: 'trutnov', name: 'Trutnov', lon: 15.9127, lat: 50.5610, population: 30000, region: 'Královéhradecký' },
  { id: 'kromeriz', name: 'Kroměříž', lon: 17.3931, lat: 49.2979, population: 28000, region: 'Zlínský' },
  { id: 'orlova', name: 'Orlová', lon: 18.4302, lat: 49.8453, population: 27800, region: 'Moravskoslezský' },
  { id: 'sumperk', name: 'Šumperk', lon: 16.9706, lat: 49.9653, population: 25000, region: 'Olomoucký' },
  { id: 'vsetin', name: 'Vsetín', lon: 17.9962, lat: 49.3387, population: 25000, region: 'Zlínský' },
  { id: 'uh', name: 'Uherské Hradiště', lon: 17.4597, lat: 49.0698, population: 25000, region: 'Zlínský' },
  { id: 'breclav', name: 'Břeclav', lon: 16.8820, lat: 48.7590, population: 24500, region: 'Jihomoravský' },
  { id: 'hodonin', name: 'Hodonín', lon: 17.1324, lat: 48.8489, population: 24000, region: 'Jihomoravský' },
  { id: 'cesky-tesin', name: 'Český Těšín', lon: 18.6261, lat: 49.7461, population: 23500, region: 'Moravskoslezský' },
  { id: 'litomerice', name: 'Litoměřice', lon: 14.1319, lat: 50.5335, population: 23000, region: 'Ústecký' },
  { id: 'novy-jicin', name: 'Nový Jičín', lon: 18.0103, lat: 49.5944, population: 23000, region: 'Moravskoslezský' },
  { id: 'chrudim', name: 'Chrudim', lon: 15.7956, lat: 49.9511, population: 23000, region: 'Pardubický' },
  { id: 'hb', name: 'Havlíčkův Brod', lon: 15.5807, lat: 49.6079, population: 23000, region: 'Vysočina' },
  { id: 'klatovy', name: 'Klatovy', lon: 13.2951, lat: 49.3955, population: 22500, region: 'Plzeňský' },
  { id: 'krnov', name: 'Krnov', lon: 17.7039, lat: 50.0897, population: 22500, region: 'Moravskoslezský' },
  { id: 'strakonice', name: 'Strakonice', lon: 13.9024, lat: 49.2614, population: 22000, region: 'Jihočeský' },
  { id: 'sokolov', name: 'Sokolov', lon: 12.6401, lat: 50.1814, population: 22000, region: 'Karlovarský' },
  { id: 'valmez', name: 'Valašské Meziříčí', lon: 17.9711, lat: 49.4718, population: 22000, region: 'Zlínský' },
  { id: 'koprivnice', name: 'Kopřivnice', lon: 18.1448, lat: 49.5995, population: 21500, region: 'Moravskoslezský' },
  { id: 'kutna-hora', name: 'Kutná Hora', lon: 15.2682, lat: 49.9484, population: 21400, region: 'Středočeský' },
  { id: 'jindrichuv-hradec', name: 'Jindřichův Hradec', lon: 15.0030, lat: 49.1440, population: 21000, region: 'Jihočeský' },
  { id: 'beroun', name: 'Beroun', lon: 14.0720, lat: 49.9638, population: 21000, region: 'Středočeský' },
  { id: 'zdar', name: 'Žďár nad Sázavou', lon: 15.9392, lat: 49.5626, population: 20500, region: 'Vysočina' },
  { id: 'vyskov', name: 'Vyškov', lon: 16.9990, lat: 49.2775, population: 20500, region: 'Jihomoravský' },
  { id: 'bohumin', name: 'Bohumín', lon: 18.3575, lat: 49.9041, population: 20400, region: 'Moravskoslezský' },
  { id: 'nachod', name: 'Náchod', lon: 16.1629, lat: 50.4167, population: 20000, region: 'Královéhradecký' },
  { id: 'blansko', name: 'Blansko', lon: 16.6445, lat: 49.3631, population: 20000, region: 'Jihomoravský' },
  { id: 'melnik', name: 'Mělník', lon: 14.4741, lat: 50.3505, population: 20000, region: 'Středočeský' },
  { id: 'brandys', name: 'Brandýs n. L.-Stará Boleslav', lon: 14.6633, lat: 50.1872, population: 19800, region: 'Středočeský' },
  { id: 'zatec', name: 'Žatec', lon: 13.5458, lat: 50.3272, population: 19000, region: 'Ústecký' },
  { id: 'kralupy', name: 'Kralupy nad Vltavou', lon: 14.3114, lat: 50.2414, population: 18700, region: 'Středočeský' },
  { id: 'louny', name: 'Louny', lon: 13.7967, lat: 50.3570, population: 18000, region: 'Ústecký' },
  { id: 'kadan', name: 'Kadaň', lon: 13.2714, lat: 50.3833, population: 18000, region: 'Ústecký' },
  { id: 'hranicena', name: 'Hranice', lon: 17.7347, lat: 49.5480, population: 17900, region: 'Olomoucký' },
  { id: 'benesov', name: 'Benešov', lon: 14.6870, lat: 49.7816, population: 17000, region: 'Středočeský' },
  { id: 'slany', name: 'Slaný', lon: 14.0869, lat: 50.2305, population: 16500, region: 'Středočeský' },
  { id: 'pelhrimov', name: 'Pelhřimov', lon: 15.2234, lat: 49.4313, population: 16500, region: 'Vysočina' },
  { id: 'svitavy', name: 'Svitavy', lon: 16.4683, lat: 49.7559, population: 16300, region: 'Pardubický' },
  { id: 'roznov', name: 'Rožnov pod Radhoštěm', lon: 18.1430, lat: 49.4585, population: 16200, region: 'Zlínský' },
  { id: 'dvur', name: 'Dvůr Králové nad Labem', lon: 15.8140, lat: 50.4317, population: 15500, region: 'Královéhradecký' },
  { id: 'bruntal', name: 'Bruntál', lon: 17.4647, lat: 49.9884, population: 15200, region: 'Moravskoslezský' },
  { id: 'rakovnik', name: 'Rakovník', lon: 13.7334, lat: 50.1037, population: 15500, region: 'Středočeský' },
  { id: 'jicin', name: 'Jičín', lon: 15.3516, lat: 50.4372, population: 16200, region: 'Královéhradecký' },
  { id: 'varnsdorf', name: 'Varnsdorf', lon: 14.6184, lat: 50.9116, population: 14800, region: 'Ústecký' },
  { id: 'rokycany', name: 'Rokycany', lon: 13.5946, lat: 49.7427, population: 14500, region: 'Plzeňský' },
  { id: 'nymburk', name: 'Nymburk', lon: 15.0417, lat: 50.1861, population: 15400, region: 'Středočeský' },
  { id: 'podebrady', name: 'Poděbrady', lon: 15.1188, lat: 50.1424, population: 15000, region: 'Středočeský' },
  { id: 'turnov', name: 'Turnov', lon: 15.1569, lat: 50.5873, population: 14400, region: 'Liberecký' },
  { id: 'usti-nad-orlici', name: 'Ústí nad Orlicí', lon: 16.3936, lat: 49.9739, population: 14000, region: 'Pardubický' },
  { id: 'roudnice', name: 'Roudnice nad Labem', lon: 14.2617, lat: 50.4253, population: 12900, region: 'Ústecký' },
  { id: 'ck', name: 'Český Krumlov', lon: 14.3152, lat: 48.8127, population: 12800, region: 'Jihočeský' },
  { id: 'tachov', name: 'Tachov', lon: 12.6337, lat: 49.7953, population: 13800, region: 'Plzeňský' },
  { id: 'ml', name: 'Mariánské Lázně', lon: 12.7012, lat: 49.9646, population: 13600, region: 'Karlovarský' },
  { id: 'vysoke-myto', name: 'Vysoké Mýto', lon: 16.1617, lat: 49.9533, population: 12400, region: 'Pardubický' },
  { id: 'vrchlabi', name: 'Vrchlabí', lon: 15.6094, lat: 50.6270, population: 12200, region: 'Královéhradecký' },
  { id: 'boskovice', name: 'Boskovice', lon: 16.6599, lat: 49.4875, population: 11900, region: 'Jihomoravský' },
  { id: 'susice', name: 'Sušice', lon: 13.5204, lat: 49.2311, population: 10800, region: 'Plzeňský' },
  { id: 'rumburk', name: 'Rumburk', lon: 14.5569, lat: 50.9515, population: 10800, region: 'Ústecký' },
  { id: 'domazlice', name: 'Domažlice', lon: 12.9298, lat: 49.4405, population: 11000, region: 'Plzeňský' },
  { id: 'jesenik', name: 'Jeseník', lon: 17.2046, lat: 50.2294, population: 10600, region: 'Olomoucký' },
  { id: 'kyjov', name: 'Kyjov', lon: 17.1225, lat: 49.0102, population: 10800, region: 'Jihomoravský' },
  { id: 'prachatice', name: 'Prachatice', lon: 13.9975, lat: 49.0129, population: 10700, region: 'Jihočeský' },
  { id: 'litomysl', name: 'Litomyšl', lon: 16.3125, lat: 49.8686, population: 10400, region: 'Pardubický' },
  { id: 'trebon', name: 'Třeboň', lon: 14.7707, lat: 49.0036, population: 8200, region: 'Jihočeský' },
  { id: 'mikulov', name: 'Mikulov', lon: 16.6378, lat: 48.8056, population: 7600, region: 'Jihomoravský' },
  { id: 'vimperk', name: 'Vimperk', lon: 13.7828, lat: 49.0586, population: 7300, region: 'Jihočeský' },
  { id: 'spindleruv-mlyn', name: 'Špindlerův Mlýn', lon: 15.6095, lat: 50.7263, population: 1150, region: 'Královéhradecký' },
];

export const CZECH_PEAKS: CzechPeak[] = [
  { id: 'snezka', name: 'Sněžka', lon: 15.7397, lat: 50.7360, elevation: 1603, range: 'Krkonoše' },
  { id: 'lucni-hora', name: 'Luční hora', lon: 15.6820, lat: 50.7280, elevation: 1555, range: 'Krkonoše' },
  { id: 'praded', name: 'Praděd', lon: 17.2309, lat: 50.0830, elevation: 1491, range: 'Hrubý Jeseník' },
  { id: 'kralicky-sneznik', name: 'Kralický Sněžník', lon: 16.8473, lat: 50.2075, elevation: 1423, range: 'Kralický Sněžník' },
  { id: 'keprnik', name: 'Keprník', lon: 17.1167, lat: 50.1708, elevation: 1423, range: 'Hrubý Jeseník' },
  { id: 'plechy', name: 'Plechý', lon: 13.8580, lat: 48.7717, elevation: 1378, range: 'Šumava' },
  { id: 'boubin', name: 'Boubín', lon: 13.8169, lat: 48.9912, elevation: 1362, range: 'Šumava' },
  { id: 'lysa-hora', name: 'Lysá hora', lon: 18.4478, lat: 49.5461, elevation: 1323, range: 'Beskydy' },
  { id: 'polednik', name: 'Poledník', lon: 13.3951, lat: 49.0641, elevation: 1315, range: 'Šumava' },
  { id: 'cerna-hora', name: 'Černá hora', lon: 15.7417, lat: 50.6525, elevation: 1299, range: 'Krkonoše' },
  { id: 'smrk-beskydy', name: 'Smrk', lon: 18.3711, lat: 49.5081, elevation: 1276, range: 'Beskydy' },
  { id: 'klinovec', name: 'Klínovec', lon: 12.9679, lat: 50.3964, elevation: 1244, range: 'Krušné hory' },
  { id: 'spicak-sum', name: 'Špičák', lon: 13.2078, lat: 49.1725, elevation: 1202, range: 'Šumava' },
  { id: 'radhost', name: 'Radhošť', lon: 18.2225, lat: 49.4919, elevation: 1129, range: 'Beskydy' },
  { id: 'smrk-jiz', name: 'Smrk', lon: 15.2725, lat: 50.8891, elevation: 1124, range: 'Jizerské hory' },
  { id: 'velka-destna', name: 'Velká Deštná', lon: 16.3976, lat: 50.3016, elevation: 1115, range: 'Orlické hory' },
  { id: 'kamenec', name: 'Kamenec', lon: 14.6689, lat: 48.5861, elevation: 1072, range: 'Novohradské hory' },
  { id: 'cerchov', name: 'Čerchov', lon: 12.7836, lat: 49.3831, elevation: 1042, range: 'Český les' },
  { id: 'jested', name: 'Ještěd', lon: 14.9845, lat: 50.7326, elevation: 1012, range: 'Ještědský hřbet' },
  { id: 'lesny', name: 'Lesný', lon: 12.6480, lat: 50.0361, elevation: 983, range: 'Slavkovský les' },
  { id: 'velka-javorina', name: 'Velká Javořina', lon: 17.6756, lat: 48.8578, elevation: 970, range: 'Bílé Karpaty' },
  { id: 'hrob', name: 'Hradiště', lon: 13.1264, lat: 50.2178, elevation: 934, range: 'Doupovské hory' },
  { id: 'tok', name: 'Tok', lon: 13.8775, lat: 49.7047, elevation: 865, range: 'Brdy' },
  { id: 'javorice', name: 'Javořice', lon: 15.3396, lat: 49.2211, elevation: 837, range: 'Jihlavské vrchy' },
  { id: 'milesovka', name: 'Milešovka', lon: 13.9314, lat: 50.5551, elevation: 837, range: 'České středohoří' },
  { id: 'devet-skal', name: 'Devět skal', lon: 16.0324, lat: 49.6708, elevation: 836, range: 'Žďárské vrchy' },
  { id: 'bourenak', name: 'Bouřňák', lon: 13.7042, lat: 50.6861, elevation: 869, range: 'Krušné hory' },
  { id: 'luz', name: 'Luž', lon: 14.6467, lat: 50.8489, elevation: 793, range: 'Lužické hory' },
  { id: 'skalky', name: 'Skalky', lon: 16.7917, lat: 49.5008, elevation: 735, range: 'Drahanská vrchovina' },
  { id: 'decinsky-sneznik', name: 'Děčínský Sněžník', lon: 14.1086, lat: 50.7931, elevation: 723, range: 'Děčínská vrchovina' },
  { id: 'blanik', name: 'Velký Blaník', lon: 14.8722, lat: 49.6422, elevation: 638, range: 'Vlašimská pahorkatina' },
  { id: 'brdo', name: 'Brdo', lon: 17.3094, lat: 49.1711, elevation: 587, range: 'Chřiby' },
  { id: 'devin-palava', name: 'Děvín', lon: 16.6497, lat: 48.8694, elevation: 550, range: 'Pavlovské vrchy' },
  { id: 'rip', name: 'Říp', lon: 14.2894, lat: 50.3865, elevation: 461, range: 'Dolnooharská tabule' },
];
