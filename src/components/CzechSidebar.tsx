import React, { useMemo, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Globe,
  Layers,
  LocateFixed,
  MapPin,
  Mountain,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { CZECH_CITIES, CZECH_LAKES, CZECH_PEAKS } from '../data/czechGeo';
import {
  CompiledCzechTerrain,
  geoToWorld,
  sampleCzechElevation,
} from '../engine/czechTerrain';
import { formatTrackDistance } from '../engine/gpxParser';
import {
  ImportedGpxTrack,
  LayerVisibility,
  MapScope,
  MapStylePreset,
  RealCzechDataset,
  RealWorldDataset,
  SelectedMapPoint,
  WorldPlacesIndex,
} from '../types/map';

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

interface CzechSidebarProps {
  mapScope: MapScope;
  terrain: CompiledCzechTerrain;
  realDataset: RealCzechDataset | null;
  worldDataset: RealWorldDataset | null;
  worldPlacesIndex: WorldPlacesIndex | null;
  stylePreset: MapStylePreset;
  layers: LayerVisibility;
  gpxTracks: ImportedGpxTrack[];
  activeGpxId: string | null;
  gpxError: string | null;
  onChangeScope: (scope: MapScope) => void;
  onChangeStyle: (style: MapStylePreset) => void;
  onToggleLayer: (key: keyof LayerVisibility) => void;
  onJumpToPoint: (pt: SelectedMapPoint, zoom?: number, targetScope?: MapScope) => void;
  onImportGpxFile: (file: File) => void;
  onSelectGpxTrack: (id: string) => void;
  onToggleGpxVisibility: (id: string) => void;
  onFocusGpxTrack: (track: ImportedGpxTrack) => void;
  onRemoveGpxTrack: (id: string) => void;
  onClearGpxError: () => void;
  onNeedSearchIndexes?: () => void;
}

const STYLE_PRESETS: { id: MapStylePreset; label: string; desc: string }[] = [
  {
    id: 'atlas',
    label: 'Fyzický atlas',
    desc: 'Hypsometrická výšková pásma, batymetrie a stínovaný reliéf',
  },
  {
    id: 'natural',
    label: 'Přírodní terén',
    desc: 'Biomy, lesnatost pohoří, údolní nivy a výrazný stín',
  },
  {
    id: 'light',
    label: 'Světlý kartografický',
    desc: 'Čistý podklad vhodný pro tisk a datové překryvy',
  },
  {
    id: 'dark',
    label: 'Tmavý reliéf',
    desc: 'Kontrastní tmavý podklad se zvýrazněným vodstvem',
  },
  {
    id: 'satellite',
    label: 'Satelitní (Sentinel-2)',
    desc: 'Bezoblačné satelitní snímky ESA Sentinel-2 (CC BY 4.0) s hybridními popisky',
  },
];

const QUICK_PLACES_CZ: {
  label: string;
  lon: number;
  lat: number;
  zoom: number;
  kind: SelectedMapPoint['kind'];
  subtitle: string;
}[] = [
  {
    label: 'Praha',
    lon: 14.4378,
    lat: 50.0755,
    zoom: 0.0065,
    kind: 'city',
    subtitle: 'Hlavní město ČR · Pražská kotlina',
  },
  {
    label: 'Krkonoše · Sněžka',
    lon: 15.7397,
    lat: 50.736,
    zoom: 0.0065,
    kind: 'peak',
    subtitle: 'Nejvyšší hora ČR (1 603 m n. m.)',
  },
  {
    label: 'Šumava · VN Lipno',
    lon: 14.08,
    lat: 48.72,
    zoom: 0.0055,
    kind: 'lake',
    subtitle: 'Šumavské pohoří a vodní nádrž Lipno',
  },
  {
    label: 'Hrubý Jeseník · Praděd',
    lon: 17.2309,
    lat: 50.083,
    zoom: 0.0062,
    kind: 'peak',
    subtitle: 'Nejvyšší hora Moravy (1 491 m n. m.)',
  },
  {
    label: 'Brno a Pálava',
    lon: 16.6068,
    lat: 49.06,
    zoom: 0.0052,
    kind: 'city',
    subtitle: 'Jihomoravský kraj · Dyjskosvratecký úval',
  },
  {
    label: 'Beskydy · Lysá hora',
    lon: 18.4478,
    lat: 49.5461,
    zoom: 0.0062,
    kind: 'peak',
    subtitle: 'Moravskoslezské Beskydy (1 323 m n. m.)',
  },
];

const QUICK_PLACES_WORLD: {
  label: string;
  lon: number;
  lat: number;
  zoom: number;
  elev: number;
  kind: SelectedMapPoint['kind'];
  subtitle: string;
}[] = [
  {
    label: 'Evropa · Česko (detail)',
    lon: 15.3,
    lat: 49.8,
    zoom: 0.0024,
    elev: 430,
    kind: 'city',
    subtitle: 'Střední Evropa · Detailní měřítko < 1 : 3 000 000',
  },
  {
    label: 'Alpy · Mont Blanc',
    lon: 6.865,
    lat: 45.832,
    zoom: 0.0025,
    elev: 4808,
    kind: 'peak',
    subtitle: 'Nejvyšší vrchol Alp (4 808 m n. m.) · Detail 1 : 1,5M',
  },
  {
    label: 'Himálaj · Everest',
    lon: 86.925,
    lat: 27.988,
    zoom: 0.0024,
    elev: 8849,
    kind: 'peak',
    subtitle: 'Nejvyšší vrchol světa (8 849 m n. m.) · Detail 1 : 1,5M',
  },
  {
    label: 'Japonsko · Tokio & Fudži',
    lon: 139.25,
    lat: 35.5,
    zoom: 0.0024,
    elev: 3776,
    kind: 'peak',
    subtitle: 'Metropolitní oblast Tokia a Fudži · Detail 1 : 1,5M',
  },
  {
    label: 'Andy · Aconcagua',
    lon: -70.011,
    lat: -32.653,
    zoom: 0.0023,
    elev: 6961,
    kind: 'peak',
    subtitle: 'Jižní Amerika · Andy (6 961 m n. m.) · Detail 1 : 1,6M',
  },
  {
    label: 'Kilimandžáro',
    lon: 37.355,
    lat: -3.067,
    zoom: 0.0023,
    elev: 5895,
    kind: 'peak',
    subtitle: 'Nejvyšší hora Afriky (5 895 m n. m.) · Detail 1 : 1,6M',
  },
];

export const CzechSidebar: React.FC<CzechSidebarProps> = ({
  mapScope,
  terrain,
  realDataset,
  worldDataset,
  worldPlacesIndex,
  stylePreset,
  layers,
  gpxTracks,
  activeGpxId,
  gpxError,
  onChangeScope,
  onChangeStyle,
  onToggleLayer,
  onJumpToPoint,
  onImportGpxFile,
  onSelectGpxTrack,
  onToggleGpxVisibility,
  onFocusGpxTrack,
  onRemoveGpxTrack,
  onClearGpxError,
  onNeedSearchIndexes,
}) => {
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const results: {
      point: SelectedMapPoint;
      zoom: number;
      scope: MapScope;
    }[] = [];

    if (mapScope === 'world' && worldDataset) {
      for (const country of worldDataset.countries) {
        if (
          country.n.toLowerCase().includes(q) ||
          country.en.toLowerCase().includes(q) ||
          country.iso.toLowerCase() === q
        ) {
          results.push({
            point: {
              title: country.n,
              subtitle:
                country.p > 0
                  ? `Stát (${country.iso}) · ${country.p.toLocaleString('cs-CZ')} obyv.`
                  : 'Stát světa',
              lon: country.x,
              lat: country.y,
              elevation: 250,
              kind: 'country',
            },
            zoom: 0.0021, // Zoom directly to ~1 : 1 800 000 so detailed view renders
            scope: 'world',
          });
          if (results.length >= 5) break;
        }
      }

      if (worldPlacesIndex) {
        for (const city of worldPlacesIndex.cities) {
          if (
            city.n.toLowerCase().includes(q) ||
            city.c.toLowerCase().includes(q) ||
            city.a.toLowerCase().includes(q)
          ) {
            results.push({
              point: {
                title: city.n,
                subtitle: `${city.a ? `${city.a}, ` : ''}${city.c}${
                  city.p > 0 ? ` · ${city.p.toLocaleString('cs-CZ')} obyv.` : ''
                }`,
                lon: city.x,
                lat: city.y,
                elevation: 150,
                kind: 'city',
              },
              zoom: 0.0032, // 1 : 1 180 000 detail scale
              scope: 'world',
            });
            if (results.length >= 12) break;
          }
        }
      } else {
        for (const city of worldDataset.cities) {
          if (
            city.n.toLowerCase().includes(q) ||
            city.c.toLowerCase().includes(q)
          ) {
            results.push({
              point: {
                title: city.n,
                subtitle: `${city.c}${
                  city.p > 0 ? ` · ${city.p.toLocaleString('cs-CZ')} obyv.` : ''
                }`,
                lon: city.x,
                lat: city.y,
                elevation: 150,
                kind: 'city',
              },
              zoom: 0.0032,
              scope: 'world',
            });
            if (results.length >= 12) break;
          }
        }
      }

      const peakList = worldPlacesIndex
        ? [
            ...worldDataset.peaks,
            ...worldPlacesIndex.peaks.filter(
              (dp) => !worldDataset.peaks.some((wp) => wp.n === dp.n)
            ),
          ]
        : worldDataset.peaks;

      for (const pk of peakList) {
        if (
          pk.n.toLowerCase().includes(q) ||
          pk.r.toLowerCase().includes(q)
        ) {
          results.push({
            point: {
              title: pk.n,
              subtitle: `${pk.r ? `${pk.r} · ` : ''}${pk.e} m n. m.`,
              lon: pk.x,
              lat: pk.y,
              elevation: pk.e,
              kind: 'peak',
            },
            zoom: 0.0034,
            scope: 'world',
          });
          if (results.length >= 16) break;
        }
      }
    }

    // Also search Czechia places (primary in 'cz' mode, supplemental in 'world' mode)
    if (realDataset) {
      for (const c of realDataset.places.cities) {
        const kraj = ADMIN1_KRAJ[c.a] || 'Česká republika';
        if (c.n.toLowerCase().includes(q) || kraj.toLowerCase().includes(q)) {
          const w = geoToWorld(c.x, c.y);
          const elev =
            c.e > 0
              ? c.e
              : Math.round(
                  sampleCzechElevation(terrain, w.x, w.y, realDataset.dem)
                );
          results.push({
            point: {
              title: c.n,
              subtitle:
                c.p > 0
                  ? `${kraj} · ${c.p.toLocaleString('cs-CZ')} obyv.`
                  : kraj,
              lon: c.x,
              lat: c.y,
              elevation: elev,
              kind: 'city',
            },
            zoom:
              mapScope === 'world'
                ? 0.0055
                : c.p >= 40000
                  ? 0.0065
                  : c.p >= 5000
                    ? 0.011
                    : 0.018,
            scope: mapScope,
          });
          if (results.length >= 14) break;
        }
      }

      for (const p of realDataset.places.peaks) {
        if (p.n.toLowerCase().includes(q)) {
          results.push({
            point: {
              title: p.n,
              subtitle: `Vrchol ČR · ${p.e} m n. m.`,
              lon: p.x,
              lat: p.y,
              elevation: p.e,
              kind: 'peak',
            },
            zoom: mapScope === 'world' ? 0.006 : 0.012,
            scope: mapScope,
          });
          if (results.length >= 16) break;
        }
      }
    } else {
      for (const c of CZECH_CITIES) {
        if (
          c.name.toLowerCase().includes(q) ||
          c.region.toLowerCase().includes(q)
        ) {
          const w = geoToWorld(c.lon, c.lat);
          results.push({
            point: {
              title: c.name,
              subtitle: `${c.region} kraj · ${c.population.toLocaleString('cs-CZ')} obyv.`,
              lon: c.lon,
              lat: c.lat,
              elevation: Math.round(sampleCzechElevation(terrain, w.x, w.y)),
              kind: 'city',
            },
            zoom: 0.0065,
            scope: 'cz',
          });
        }
      }

      for (const p of CZECH_PEAKS) {
        if (
          p.name.toLowerCase().includes(q) ||
          p.range.toLowerCase().includes(q)
        ) {
          results.push({
            point: {
              title: p.name,
              subtitle: `${p.range} · ${p.elevation} m n. m.`,
              lon: p.lon,
              lat: p.lat,
              elevation: p.elevation,
              kind: 'peak',
            },
            zoom: 0.007,
            scope: 'cz',
          });
        }
      }
    }

    // If in CZ mode and user searches a global peak/country/city, include world results too
    if (mapScope === 'cz' && worldDataset && results.length < 10) {
      for (const country of worldDataset.countries) {
        if (
          country.n.toLowerCase().includes(q) ||
          country.en.toLowerCase().includes(q)
        ) {
          results.push({
            point: {
              title: country.n,
              subtitle: `Stát světa · ${country.p.toLocaleString('cs-CZ')} obyv.`,
              lon: country.x,
              lat: country.y,
              elevation: 250,
              kind: 'country',
            },
            zoom: 0.0021,
            scope: 'world',
          });
          if (results.length >= 14) break;
        }
      }
      for (const pk of worldDataset.peaks) {
        if (pk.n.toLowerCase().includes(q)) {
          results.push({
            point: {
              title: pk.n,
              subtitle: `Světový vrchol · ${pk.e} m n. m.`,
              lon: pk.x,
              lat: pk.y,
              elevation: pk.e,
              kind: 'peak',
            },
            zoom: 0.0034,
            scope: 'world',
          });
          if (results.length >= 14) break;
        }
      }
    }

    for (const l of CZECH_LAKES) {
      if (l.name.toLowerCase().includes(q)) {
        const lon = l.points.reduce((a, b) => a + b[0], 0) / l.points.length;
        const lat = l.points.reduce((a, b) => a + b[1], 0) / l.points.length;
        results.push({
          point: {
            title: l.name,
            subtitle: `Vodní nádrž · ${l.elevation} m n. m.`,
            lon,
            lat,
            elevation: l.elevation,
            kind: 'lake',
          },
          zoom: mapScope === 'world' ? 0.0055 : 0.0085,
          scope: mapScope,
        });
      }
    }

    return results.slice(0, 14);
  }, [
    search,
    mapScope,
    terrain,
    realDataset,
    worldDataset,
    worldPlacesIndex,
  ]);

  const layerItems =
    mapScope === 'world'
      ? ([
          { key: 'hillshade', label: 'Stínovaný reliéf a batymetrie' },
          { key: 'hypsometry', label: 'Výšková a hloubková škála' },
          { key: 'forests', label: 'Lesy, biomy, mokřady a NP' },
          { key: 'contours', label: 'Vrstevnice (adaptivní 10–2000 m)' },
          { key: 'hydrology', label: 'Řeky, potoky, jezera a vodní plochy' },
          { key: 'highways', label: 'Dálnice, silnice I.–III. tř. a ulice' },
          { key: 'railways', label: 'Železniční síť a tratě' },
          { key: 'cities', label: 'Města, obce, zástavba a budovy' },
          { key: 'peaks', label: 'Hory a vrcholy světa (▲)' },
          { key: 'borders', label: 'Hranice států světa (detailní)' },
          { key: 'districts', label: 'Regiony, země, kraje a okresy' },
          { key: 'graticule', label: 'Zeměpisná síť WGS84' },
        ] as const)
      : ([
          { key: 'hillshade', label: 'Stínovaný reliéf (SRTM DEM)' },
          { key: 'hypsometry', label: 'Výšková hypsometrie' },
          { key: 'forests', label: 'Lesy, mokřady, NP a CHKO' },
          { key: 'contours', label: 'Vrstevnice (adaptivní 10–200 m)' },
          { key: 'hydrology', label: 'Řeky, potoky, přehrady a rybníky' },
          { key: 'highways', label: 'Dálnice, silnice I.–III. tř. a ulice' },
          { key: 'railways', label: 'Železniční síť a tratě' },
          { key: 'cities', label: 'Města, obce, zástavba a budovy' },
          { key: 'peaks', label: 'Vrcholy a kóty (▲)' },
          { key: 'borders', label: 'Státní hranice a kraje' },
          { key: 'districts', label: 'Hranice okresů (77)' },
          { key: 'graticule', label: 'Zeměpisná síť WGS84' },
        ] as const);

  return (
    <aside className="w-full md:w-[320px] shrink-0 bg-white border-r border-[#1C2420]/12 flex flex-col h-full overflow-hidden">
      {/* Scope Switcher + Search Header */}
      <div className="p-4 border-b border-[#1C2420]/10 space-y-2.5">
        <div className="grid grid-cols-2 gap-1 p-1 bg-[#F3F1EA] rounded-lg border border-[#1C2420]/10">
          <button
            type="button"
            onClick={() => onChangeScope('cz')}
            className={`h-8 px-2.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
              mapScope === 'cz'
                ? 'bg-white text-[#1E5631] shadow-xs'
                : 'text-[#5B6760] hover:text-[#1C2420]'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Česká republika</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeScope('world')}
            className={`h-8 px-2.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
              mapScope === 'world'
                ? 'bg-white text-[#1E5631] shadow-xs'
                : 'text-[#5B6760] hover:text-[#1C2420]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Celý svět</span>
          </button>
        </div>

        <div className="text-xs font-medium text-[#5B6760]">
          {mapScope === 'world'
            ? 'Planeta Země · 240 států · 510 mil. km²'
            : 'Česká republika · 14 krajů · 78 866 km²'}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-[#5B6760] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              const next = e.target.value;
              setSearch(next);
              if (next.trim() !== '') {
                onNeedSearchIndexes?.();
              }
            }}
            placeholder={
              mapScope === 'world'
                ? 'Hledat stát, metropoli, horu...'
                : 'Hledat město, obec, horu, přehradu...'
            }
            className="w-full h-9 pl-9 pr-8 text-sm bg-[#F7F6F2] border border-[#1C2420]/12 rounded-lg text-[#1C2420] placeholder:text-[#78857D] focus:outline-none focus:ring-2 focus:ring-[#1E5631]/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Vymazat hledání"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5B6760] hover:text-[#1C2420] p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {search.trim() !== '' && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-[#5B6760]">
              Výsledky hledání ({searchResults.length})
            </h3>
            {searchResults.length === 0 ? (
              <p className="text-xs text-[#5B6760] py-2">
                Nenalezen žádný stát, sídlo ani vrchol.
              </p>
            ) : (
              <div className="divide-y divide-[#1C2420]/8 border border-[#1C2420]/12 rounded-lg overflow-hidden">
                {searchResults.map(({ point, zoom, scope }, idx) => (
                  <button
                    key={`${scope}-${point.kind}-${point.title}-${idx}`}
                    type="button"
                    onClick={() => onJumpToPoint(point, zoom, scope)}
                    className="w-full px-3 py-2 text-left hover:bg-[#F7F6F2] flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#1C2420] truncate">
                        {point.title}
                      </div>
                      <div className="text-[11px] text-[#5B6760] truncate">
                        {point.subtitle}
                      </div>
                    </div>
                    {point.kind === 'peak' ? (
                      <Mountain className="w-3.5 h-3.5 text-[#5B6760] shrink-0" />
                    ) : scope === 'world' ? (
                      <Globe className="w-3.5 h-3.5 text-[#1E5631] shrink-0" />
                    ) : (
                      <MapPin className="w-3.5 h-3.5 text-[#1E5631] shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Imported GPX Routes Section */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#5B6760]">
              GPX trasy ({gpxTracks.length})
            </h3>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gpx,application/gpx+xml,text/xml"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  Array.from(files).forEach((f) => onImportGpxFile(f));
                  e.target.value = '';
                }
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-9 px-3 inline-flex items-center justify-center gap-2 text-xs font-semibold text-[#1E5631] bg-[#F1F6F2] hover:bg-[#E4EFE6] border border-[#1E5631]/25 rounded-lg transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Importovat GPX soubor</span>
          </button>

          {gpxError && (
            <div className="p-2.5 text-xs text-[#B91C1C] bg-[#FEF2F2] border border-[#B91C1C]/20 rounded-lg flex items-start justify-between gap-2">
              <span>{gpxError}</span>
              <button
                type="button"
                onClick={onClearGpxError}
                aria-label="Zavřít chybu"
                className="p-0.5 hover:text-[#7F1D1D]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {gpxTracks.length === 0 ? (
            <p className="text-xs text-[#5B6760] leading-relaxed">
              Nahrajte soubor <span className="font-mono-tabular">.gpx</span>{' '}
              z ČR nebo libovolného místa na světě.
            </p>
          ) : (
            <div className="space-y-1.5">
              {gpxTracks.map((track) => {
                const isActive = track.id === activeGpxId;
                return (
                  <div
                    key={track.id}
                    className={`p-2.5 rounded-lg border transition-colors ${
                      isActive
                        ? 'bg-[#F4F7F4] border-[#1E5631]/45'
                        : 'bg-white border-[#1C2420]/12 hover:bg-[#F8F7F3]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectGpxTrack(track.id);
                          onFocusGpxTrack(track);
                        }}
                        className="flex items-start gap-2 text-left min-w-0 flex-1"
                      >
                        <span
                          className="w-3 h-3 mt-1 rounded-xs shrink-0"
                          style={{ backgroundColor: track.color }}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#1C2420] truncate">
                            {track.name}
                          </div>
                          <div className="text-[11px] font-mono-tabular text-[#4A5A50] mt-0.5">
                            {formatTrackDistance(track.distanceMeters)} · +
                            {track.ascentMeters} m
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleGpxVisibility(track.id)}
                          title={track.visible ? 'Skrýt trasu' : 'Zobrazit trasu'}
                          aria-label={
                            track.visible ? 'Skrýt trasu' : 'Zobrazit trasu'
                          }
                          className="w-7 h-7 inline-flex items-center justify-center rounded text-[#5B6760] hover:text-[#1C2420] hover:bg-[#EAE7DD]"
                        >
                          {track.visible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onFocusGpxTrack(track)}
                          title="Přiblížit na trasu"
                          aria-label="Přiblížit na trasu"
                          className="w-7 h-7 inline-flex items-center justify-center rounded text-[#5B6760] hover:text-[#1C2420] hover:bg-[#EAE7DD]"
                        >
                          <LocateFixed className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveGpxTrack(track.id)}
                          title="Odebrat trasu"
                          aria-label="Odebrat trasu"
                          className="w-7 h-7 inline-flex items-center justify-center rounded text-[#5B6760] hover:text-[#B91C1C] hover:bg-[#FEF2F2]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Map Style Presets */}
        <section>
          <h3 className="text-xs font-semibold text-[#5B6760] mb-2.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            <span>Styl mapového podkladu</span>
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {STYLE_PRESETS.map((opt) => {
              const active = stylePreset === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeStyle(opt.id)}
                  className={`w-full px-3 py-2.5 text-left rounded-lg border transition-colors ${
                    active
                      ? 'bg-[#F4F7F4] border-[#1E5631]/50 text-[#1C2420]'
                      : 'bg-white border-[#1C2420]/12 hover:bg-[#F8F7F3] text-[#1C2420]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {active && (
                      <span className="text-xs font-medium text-[#1E5631]">
                        Aktivní
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#5B6760] mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Layer Controls */}
        <section>
          <h3 className="text-xs font-semibold text-[#5B6760] mb-2.5">
            Kartografické vrstvy
          </h3>
          <div className="divide-y divide-[#1C2420]/8 border border-[#1C2420]/12 rounded-lg">
            {layerItems.map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between px-3 py-2.5 text-sm text-[#1C2420] cursor-pointer hover:bg-[#F8F7F3]"
              >
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={layers[item.key]}
                  onChange={() => onToggleLayer(item.key)}
                  className="w-4 h-4 accent-[#1E5631] rounded cursor-pointer"
                />
              </label>
            ))}
          </div>
        </section>

        {/* Hypsometric Color Scale */}
        <section>
          <h3 className="text-xs font-semibold text-[#5B6760] mb-2">
            {mapScope === 'world'
              ? 'Batymetrie a výšková škála (m)'
              : 'Výšková škála ČR (m n. m.)'}
          </h3>
          {mapScope === 'world' ? (
            <>
              <div className="h-3 rounded-sm overflow-hidden border border-[#1C2420]/15 bg-[linear-gradient(90deg,#68A8E0_0%,#86C1EF_16%,#BCE6FE_30%,#C6E0B4_35%,#F1F3E7_46%,#F3F0E4_58%,#ECE7D8_70%,#E4DDD0_82%,#ECE9E1_91%,#FDFEFF_100%)]" />
              <div className="flex justify-between text-[10px] font-mono-tabular text-[#5B6760] mt-1">
                <span>−8 000 m</span>
                <span>0 m</span>
                <span>1 500 m</span>
                <span>4 500 m</span>
                <span>8 849 m</span>
              </div>
            </>
          ) : (
            <>
              <div className="h-3 rounded-sm overflow-hidden border border-[#1C2420]/15 bg-[linear-gradient(90deg,#C5E0B0_0%,#D6E8C4_16%,#F0F3E7_32%,#F4F2E7_48%,#EFECE0_64%,#E8E3D4_80%,#E2DDD0_92%,#EAE7DA_100%)]" />
              <div className="flex justify-between text-[10px] font-mono-tabular text-[#5B6760] mt-1">
                <span>115 m</span>
                <span>350 m</span>
                <span>750 m</span>
                <span>1 200 m</span>
                <span>1 603 m</span>
              </div>
            </>
          )}
        </section>

        {/* Quick Jump Highlights */}
        <section>
          <h3 className="text-xs font-semibold text-[#5B6760] mb-2.5">
            Rychlý přesun na oblasti
          </h3>
          {mapScope === 'world' ? (
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_PLACES_WORLD.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() =>
                    onJumpToPoint(
                      {
                        title: q.label,
                        subtitle: q.subtitle,
                        lon: q.lon,
                        lat: q.lat,
                        elevation: q.elev,
                        kind: q.kind,
                      },
                      q.zoom,
                      'world'
                    )
                  }
                  className="px-2.5 py-2 text-left text-xs font-medium text-[#1C2420] bg-[#F7F6F2] hover:bg-[#EAE7DD] border border-[#1C2420]/10 rounded-lg transition-colors truncate"
                >
                  {q.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_PLACES_CZ.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    const w = geoToWorld(q.lon, q.lat);
                    onJumpToPoint(
                      {
                        title: q.label,
                        subtitle: q.subtitle,
                        lon: q.lon,
                        lat: q.lat,
                        elevation: Math.round(
                          sampleCzechElevation(
                            terrain,
                            w.x,
                            w.y,
                            realDataset?.dem
                          )
                        ),
                        kind: q.kind,
                      },
                      q.zoom,
                      'cz'
                    );
                  }}
                  className="px-2.5 py-2 text-left text-xs font-medium text-[#1C2420] bg-[#F7F6F2] hover:bg-[#EAE7DD] border border-[#1C2420]/10 rounded-lg transition-colors truncate"
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Footer Info */}
      <div className="px-4 py-3 border-t border-[#1C2420]/10 bg-[#FAF9F5] text-[11px] text-[#5B6760] flex items-center justify-between">
        <span>
          {mapScope === 'world'
            ? 'Verze 1.3 · Globální WGS84 · SRTM/ETOPO'
            : 'Verze 1.3 · Projekce WGS84 · ČR'}
        </span>
        <span className="font-mono-tabular">
          {mapScope === 'world' ? '−9 337–8 849 m' : '115–1 603 m'}
        </span>
      </div>
    </aside>
  );
};
