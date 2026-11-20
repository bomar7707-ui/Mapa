import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, MapPin, Menu, Upload, X } from 'lucide-react';
import {
  CzechMapCanvas,
  CzechMapCanvasHandle,
} from './components/CzechMapCanvas';
import { CzechSidebar } from './components/CzechSidebar';
import { GpxElevationBar } from './components/GpxElevationBar';
import { CZ_BOUNDS } from './data/czechGeo';
import { compileCzechTerrain } from './engine/czechTerrain';
import { parseGpxContent } from './engine/gpxParser';
import {
  loadRealCzechDataset,
  loadRealWorldDataset,
  loadWorldPlacesIndex,
} from './engine/realCzechData';
import { compileWorldTerrain } from './engine/worldTerrain';
import {
  GeoPoint,
  ImportedGpxTrack,
  LayerVisibility,
  MapScope,
  MapStylePreset,
  RealCzechDataset,
  RealWorldDataset,
  SelectedMapPoint,
  WorldPlacesIndex,
} from './types/map';

const DEFAULT_LAYERS: LayerVisibility = {
  hillshade: true,
  hypsometry: true,
  forests: true,
  contours: true,
  hydrology: true,
  highways: true,
  railways: true,
  cities: true,
  peaks: true,
  borders: true,
  districts: false,
  graticule: false,
};

function isPointInsideCzBounds(lon: number, lat: number): boolean {
  return (
    lon >= CZ_BOUNDS.minLon &&
    lon <= CZ_BOUNDS.maxLon &&
    lat >= CZ_BOUNDS.minLat &&
    lat <= CZ_BOUNDS.maxLat
  );
}

export default function App() {
  const mapRef = useRef<CzechMapCanvasHandle>(null);

  const [mapScope, setMapScope] = useState<MapScope>('world');
  const [realDataset, setRealDataset] = useState<RealCzechDataset | null>(null);
  const [worldDataset, setWorldDataset] = useState<RealWorldDataset | null>(
    null
  );
  const [worldPlacesIndex, setWorldPlacesIndex] =
    useState<WorldPlacesIndex | null>(null);
  const [stylePreset, setStylePreset] = useState<MapStylePreset>('atlas');
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [selectedPoint, setSelectedPoint] = useState<SelectedMapPoint | null>(
    null
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [gpxTracks, setGpxTracks] = useState<ImportedGpxTrack[]>([]);
  const [activeGpxId, setActiveGpxId] = useState<string | null>(null);
  const [gpxHoverGeo, setGpxHoverGeo] = useState<GeoPoint | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const mountedRef = useRef(true);
  const realDatasetRequestedRef = useRef(false);
  const worldPlacesRequestedRef = useRef(false);

  const ensureRealDataset = useCallback(() => {
    if (realDatasetRequestedRef.current) return;
    realDatasetRequestedRef.current = true;
    loadRealCzechDataset().then((ds) => {
      if (mountedRef.current && ds) {
        setRealDataset(ds);
      }
    });
  }, []);

  const ensureWorldPlacesIndex = useCallback(() => {
    if (worldPlacesRequestedRef.current) return;
    worldPlacesRequestedRef.current = true;
    loadWorldPlacesIndex().then((wpi) => {
      if (mountedRef.current && wpi) {
        setWorldPlacesIndex(wpi);
      }
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadRealWorldDataset().then((wds) => {
      if (mountedRef.current && wds) {
        setWorldDataset(wds);
      }
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (mapScope === 'cz') {
      ensureRealDataset();
    }
  }, [mapScope, ensureRealDataset]);

  const handleEnterDetailScale = useCallback(
    (overlapsCz: boolean) => {
      ensureWorldPlacesIndex();
      if (overlapsCz) {
        ensureRealDataset();
      }
    },
    [ensureWorldPlacesIndex, ensureRealDataset]
  );

  const handleNeedSearchIndexes = useCallback(() => {
    ensureWorldPlacesIndex();
    ensureRealDataset();
  }, [ensureWorldPlacesIndex, ensureRealDataset]);

  const terrain = useMemo(
    () => compileCzechTerrain(realDataset?.dem),
    [realDataset]
  );

  const worldTerrain = useMemo(
    () => compileWorldTerrain(worldDataset?.dem),
    [worldDataset]
  );

  const activeGpxTrack = useMemo(
    () =>
      gpxTracks.find((t) => t.id === activeGpxId && t.visible) ?? null,
    [gpxTracks, activeGpxId]
  );

  const handleToggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleChangeScope = useCallback((nextScope: MapScope) => {
    setMapScope(nextScope);
    setSelectedPoint(null);
  }, []);

  const handleJumpToPoint = useCallback(
    (pt: SelectedMapPoint, zoom?: number, targetScope?: MapScope) => {
      setSelectedPoint(pt);
      if (targetScope && targetScope !== mapScope) {
        setMapScope(targetScope);
        window.setTimeout(() => {
          mapRef.current?.focusGeo(pt.lon, pt.lat, zoom);
        }, 30);
      } else {
        mapRef.current?.focusGeo(pt.lon, pt.lat, zoom);
      }
      setMobileSidebarOpen(false);
    },
    [mapScope]
  );

  const handleImportGpxFile = useCallback(
    async (file: File) => {
      setGpxError(null);
      ensureRealDataset();
      try {
        const text = await file.text();
        setGpxTracks((prev) => {
          const parsed = parseGpxContent(
            text,
            file.name,
            terrain,
            prev.length,
            worldDataset?.dem
          );
          setActiveGpxId(parsed.id);
          setSelectedPoint(null);
          setGpxHoverGeo(null);

          const inCz =
            isPointInsideCzBounds(parsed.bounds.minLon, parsed.bounds.minLat) &&
            isPointInsideCzBounds(parsed.bounds.maxLon, parsed.bounds.maxLat);
          const targetScope: MapScope = inCz ? mapScope : 'world';
          if (targetScope !== mapScope) {
            setMapScope(targetScope);
          }

          window.setTimeout(() => {
            mapRef.current?.fitGeoBounds(parsed.bounds);
          }, 30);
          return [...prev, parsed];
        });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Nepodařilo se načíst GPX soubor.';
        setGpxError(msg);
      }
    },
    [terrain, worldDataset, mapScope, ensureRealDataset]
  );

  const handleToggleGpxVisibility = useCallback((id: string) => {
    setGpxTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: !t.visible } : t))
    );
  }, []);

  const handleRemoveGpxTrack = useCallback((id: string) => {
    setGpxTracks((prev) => prev.filter((t) => t.id !== id));
    setActiveGpxId((cur) => (cur === id ? null : cur));
    setGpxHoverGeo(null);
  }, []);

  const handleDropOnMap = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      setIsDraggingFile(false);
      const files = Array.from(e.dataTransfer.files);
      const gpxFiles = files.filter(
        (f) => f.name.toLowerCase().endsWith('.gpx') || f.type.includes('xml')
      );
      if (gpxFiles.length === 0) {
        setGpxError('Přetáhněte prosím soubor s příponou .gpx.');
        return;
      }
      gpxFiles.forEach((f) => handleImportGpxFile(f));
    },
    [handleImportGpxFile]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === '+' || e.key === '=') {
        mapRef.current?.zoomIn();
      } else if (e.key === '-') {
        mapRef.current?.zoomOut();
      } else if (e.key === '0') {
        mapRef.current?.resetView();
      } else if (e.key === 'Escape') {
        setSelectedPoint(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectedPointInCz =
    selectedPoint &&
    isPointInsideCzBounds(selectedPoint.lon, selectedPoint.lat);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#F6F5F1] text-[#1C2420]">
      {/* Top Bar Contract: 3 zones (Brand — Nav style links — 1 Primary Action) */}
      <header className="h-14 shrink-0 bg-white border-b border-[#1C2420]/12 px-4 md:px-6 flex items-center justify-between gap-8 z-30">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            aria-label="Přepnout boční panel"
            className="md:hidden w-9 h-9 inline-flex items-center justify-center rounded-lg border border-[#1C2420]/12 text-[#1C2420] hover:bg-[#F5F3EC]"
          >
            {mobileSidebarOpen ? (
              <X className="w-4 h-4" />
            ) : (
              <Menu className="w-4 h-4" />
            )}
          </button>
          <span className="font-display text-lg font-bold tracking-tight text-[#1C2420] whitespace-nowrap shrink-0">
            {mapScope === 'world'
              ? 'Mapový podklad — Celý svět & ČR'
              : 'Mapový podklad ČR'}
          </span>
          <span className="px-1.5 py-0.5 text-[11px] font-mono-tabular font-semibold text-[#1E5631] bg-[#E8F2EC] border border-[#1E5631]/20 rounded">
            v1.3
          </span>
        </div>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#5B6760]">
          {(
            [
              { id: 'atlas', label: 'Fyzický atlas' },
              { id: 'natural', label: 'Přírodní terén' },
              { id: 'light', label: 'Světlý podklad' },
              { id: 'dark', label: 'Tmavý reliéf' },
              { id: 'satellite', label: 'Satelitní (Sentinel-2)' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStylePreset(item.id)}
              className={`transition-colors whitespace-nowrap shrink-0 hover:text-[#1C2420] ${
                stylePreset === item.id
                  ? 'text-[#1E5631] underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => mapRef.current?.exportPng()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E5631] hover:bg-[#174325] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportovat PNG</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0 relative">
        <div
          className={`${
            mobileSidebarOpen
              ? 'fixed inset-y-14 left-0 z-30 block shadow-xl'
              : 'hidden md:block'
          } h-[calc(100vh-3.5rem)] md:h-full`}
        >
          <CzechSidebar
            mapScope={mapScope}
            terrain={terrain}
            realDataset={realDataset}
            worldDataset={worldDataset}
            worldPlacesIndex={worldPlacesIndex}
            stylePreset={stylePreset}
            layers={layers}
            gpxTracks={gpxTracks}
            activeGpxId={activeGpxId}
            gpxError={gpxError}
            onChangeScope={handleChangeScope}
            onChangeStyle={setStylePreset}
            onToggleLayer={handleToggleLayer}
            onJumpToPoint={handleJumpToPoint}
            onImportGpxFile={handleImportGpxFile}
            onSelectGpxTrack={(id) => {
              setActiveGpxId(id);
              setGpxHoverGeo(null);
            }}
            onToggleGpxVisibility={handleToggleGpxVisibility}
            onFocusGpxTrack={(track) => {
              setActiveGpxId(track.id);
              const inCz =
                isPointInsideCzBounds(
                  track.bounds.minLon,
                  track.bounds.minLat
                ) &&
                isPointInsideCzBounds(
                  track.bounds.maxLon,
                  track.bounds.maxLat
                );
              if (!inCz && mapScope === 'cz') {
                setMapScope('world');
                window.setTimeout(() => {
                  mapRef.current?.fitGeoBounds(track.bounds);
                }, 30);
              } else {
                mapRef.current?.fitGeoBounds(track.bounds);
              }
              setMobileSidebarOpen(false);
            }}
            onRemoveGpxTrack={handleRemoveGpxTrack}
            onClearGpxError={() => setGpxError(null)}
            onNeedSearchIndexes={handleNeedSearchIndexes}
          />
        </div>

        <main
          className="flex-1 flex flex-col min-w-0 min-h-0 relative"
          onDragOver={(e) => {
            e.preventDefault();
            if (!isDraggingFile) setIsDraggingFile(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setIsDraggingFile(false);
          }}
          onDrop={handleDropOnMap}
        >
          <div className="flex-1 relative min-h-0">
            <CzechMapCanvas
              ref={mapRef}
              mapScope={mapScope}
              terrain={terrain}
              worldTerrain={worldTerrain}
              realDataset={realDataset}
              worldDataset={worldDataset}
              worldPlacesIndex={worldPlacesIndex}
              stylePreset={stylePreset}
              layers={layers}
              selectedPoint={selectedPoint}
              gpxTracks={gpxTracks}
              activeGpxId={activeGpxId}
              gpxHoverGeo={gpxHoverGeo}
              onSelectPoint={setSelectedPoint}
              onSelectGpxTrack={(id) => {
                setActiveGpxId(id);
                setGpxHoverGeo(null);
              }}
              onEnterDetailScale={handleEnterDetailScale}
            />

            {/* Selected Point / City / Peak / Country Floating Inspector */}
            {selectedPoint && (
              <div className="absolute top-4 left-4 w-[300px] max-w-[calc(100%-2rem)] bg-white/95 backdrop-blur-sm border border-[#1C2420]/15 rounded-xl shadow-md p-4 z-20">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-[#5B6760] truncate">
                      {selectedPoint.subtitle}
                    </div>
                    <h3 className="text-base font-semibold text-[#1C2420] mt-0.5 truncate">
                      {selectedPoint.title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPoint(null)}
                    aria-label="Zavřít detail"
                    className="w-8 h-8 inline-flex items-center justify-center rounded-md text-[#5B6760] hover:text-[#1C2420] hover:bg-[#F4F2EA] shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono-tabular text-[#1C2420]">
                  <span className="font-semibold">
                    {selectedPoint.elevation.toLocaleString('cs-CZ')} m n. m.
                  </span>
                  <span className="text-[#5B6760]" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-[#4A5A50]">
                    {Math.abs(selectedPoint.lat).toFixed(4)}°{' '}
                    {selectedPoint.lat >= 0 ? 'N' : 'S'},{' '}
                    {Math.abs(selectedPoint.lon).toFixed(4)}°{' '}
                    {selectedPoint.lon >= 0 ? 'E' : 'W'}
                  </span>
                </div>

                {mapScope === 'world' && selectedPointInCz && (
                  <button
                    type="button"
                    onClick={() => {
                      const pt = selectedPoint;
                      setMapScope('cz');
                      window.setTimeout(() => {
                        mapRef.current?.focusGeo(pt.lon, pt.lat, 0.0045);
                      }, 35);
                    }}
                    className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1E5631] bg-[#E8F2EC] hover:bg-[#DCECE2] rounded-lg transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Otevřít v detailní mapě ČR</span>
                  </button>
                )}
              </div>
            )}

            {/* Drag & Drop GPX Overlay */}
            {isDraggingFile && (
              <div className="absolute inset-4 z-40 bg-white/88 backdrop-blur-xs border-2 border-dashed border-[#1E5631] rounded-2xl flex flex-col items-center justify-center gap-2 pointer-events-none">
                <Upload className="w-8 h-8 text-[#1E5631]" />
                <div className="text-base font-semibold text-[#1C2420]">
                  Pusťte GPX soubor pro zobrazení trasy v mapě
                </div>
              </div>
            )}
          </div>

          {activeGpxTrack && (
            <GpxElevationBar
              track={activeGpxTrack}
              onHoverPoint={setGpxHoverGeo}
              onClose={() => {
                setActiveGpxId(null);
                setGpxHoverGeo(null);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
