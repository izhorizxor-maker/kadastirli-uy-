import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Crosshair,
  Layers,
  List,
  MapPin,
  MapPinOff,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import {
  OBJECT_TYPE_LABELS,
  type AuthUser,
  type ClickedBuildingInspection,
  type MapAddressSearchResponse,
  type MapGeoCandidate,
  type MarkerColor,
  type ObjectType,
  type PropertyRecord,
  type RegionItem,
  type UzRegionDirectoryItem,
} from '../types';
import {
  CadastralStatusText,
  InspectionStatusText,
  MarkerCategoryText,
} from './StatusIndicator';

interface SatelliteMapViewProps {
  currentUser: AuthUser;
  regions: RegionItem[];
  focusTarget: {
    propertyId: number;
    lat: number | null;
    lng: number | null;
    correctionMode?: boolean;
  } | null;
  onClearFocusTarget: () => void;
  onOpenPropertyCard: (propertyId: number) => void;
  onFindInList: (systemUid: string) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

interface ClusterGroup {
  isCluster: true;
  id: string;
  lat: number;
  lng: number;
  items: PropertyRecord[];
}

type MapRenderNode = ClusterGroup | ({ isCluster: false } & PropertyRecord);

function buildPinSvg(color: MarkerColor, isSelected: boolean, hasPendingFix: boolean): string {
  const palette: Record<MarkerColor, { bg: string; stroke: string; symbol: string }> = {
    green: {
      bg: '#16a34a',
      stroke: '#14532d',
      symbol: '<path d="M9 12.5l2 2 4-4.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    yellow: {
      bg: '#d97706',
      stroke: '#78350f',
      symbol:
        '<line x1="12" y1="8" x2="12" y2="12.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.2" fill="#fff"/>',
    },
    red: {
      bg: '#dc2626',
      stroke: '#7f1d1d',
      symbol:
        '<path d="M9.5 9.5l5 5M14.5 9.5l-5 5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
    },
    gray: {
      bg: '#64748b',
      stroke: '#1e293b',
      symbol: '<circle cx="12" cy="12" r="2.5" fill="#fff"/>',
    },
  };

  const c = palette[color];
  const size = isSelected ? 34 : 28;
  const ring = isSelected
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="#ffffff" stroke-width="2.5"/>`
    : hasPendingFix
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="3 2"/>`
    : '';

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45));">
      <circle cx="12" cy="12" r="9.5" fill="${c.bg}" stroke="#ffffff" stroke-width="2"/>
      ${ring}
      ${c.symbol}
    </svg>
  `;
}

function buildClusterHtml(items: PropertyRecord[]): string {
  const greenCount = items.filter((i) => i.marker_color === 'green').length;
  const redCount = items.filter((i) => i.marker_color === 'red').length;
  const yellowCount = items.length - greenCount - redCount;

  const dominantBg =
    redCount > 0 && redCount >= yellowCount
      ? '#b91c1c'
      : yellowCount > 0
      ? '#b45309'
      : '#15803d';

  return `
    <div style="
      width: 38px;
      height: 38px;
      border-radius: 9999px;
      background: ${dominantBg};
      border: 2.5px solid #ffffff;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      box-shadow: 0 4px 10px rgba(0,0,0,0.45);
    ">
      ${items.length}
    </div>
  `;
}

export function SatelliteMapView({
  currentUser,
  regions,
  focusTarget,
  onClearFocusTarget,
  onOpenPropertyCard,
  onFindInList,
  onToast,
}: SatelliteMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const inspectedRoofLayerRef = useRef<L.LayerGroup | null>(null);
  const tempPinRef = useRef<L.Marker | null>(null);
  const geoTargetPinRef = useRef<L.Marker | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const satTileRef = useRef<L.TileLayer | null>(null);
  const labelsTileRef = useRef<L.TileLayer | null>(null);
  const streetTileRef = useRef<L.TileLayer | null>(null);

  const [mapMode, setMapMode] = useState<'satellite_hybrid' | 'satellite_clean' | 'street'>(
    'satellite_hybrid'
  );
  const [zoomLevel, setZoomLevel] = useState<number>(15);
  const [bounds, setBounds] = useState<{
    south: number;
    north: number;
    west: number;
    east: number;
  } | null>(null);

  // Nationwide Uzbekistan Directory + Filters & Full Address Search
  const [uzDirectory, setUzDirectory] = useState<UzRegionDirectoryItem[]>([]);
  const [selectedUzVilCode, setSelectedUzVilCode] = useState<string>('UZ-AN');
  const [selectedUzDistCode, setSelectedUzDistCode] = useState<string>('');
  const [selectedTumanId, setSelectedTumanId] = useState<string>(
    currentUser.tuman_id ? String(currentUser.tuman_id) : ''
  );
  const [selectedMahallaId, setSelectedMahallaId] = useState<string>(
    currentUser.mahalla_id ? String(currentUser.mahalla_id) : ''
  );
  const [markerFilter, setMarkerFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchingAddress, setSearchingAddress] = useState<boolean>(false);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState<boolean>(false);
  const [dbMatches, setDbMatches] = useState<PropertyRecord[]>([]);
  const [geoMatches, setGeoMatches] = useState<MapGeoCandidate[]>([]);
  const [foundGeoPin, setFoundGeoPin] = useState<MapGeoCandidate | null>(null);

  // Loaded data
  const [viewportItems, setViewportItems] = useState<PropertyRecord[]>([]);
  const [unlocatedItems, setUnlocatedItems] = useState<PropertyRecord[]>([]);
  const [loadingMapData, setLoadingMapData] = useState(false);

  // Selection, Clicked Rooftop Inspection & Interactive Pinning states
  const [selectedProperty, setSelectedProperty] = useState<PropertyRecord | null>(null);
  const [clickedHouseInfo, setClickedHouseInfo] = useState<ClickedBuildingInspection | null>(null);
  const [inspectingClick, setInspectingClick] = useState<boolean>(false);
  const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showUnlocatedPanel, setShowUnlocatedPanel] = useState(false);

  const [interactionMode, setInteractionMode] = useState<'browse' | 'pin_new' | 'fix_location'>(
    'browse'
  );
  const [correctionTarget, setCorrectionTarget] = useState<PropertyRecord | null>(null);
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [correctionNote, setCorrectionNote] = useState('');
  const [submittingPin, setSubmittingPin] = useState(false);

  // New House Form State (including technical passport fields)
  const [newTumanId, setNewTumanId] = useState<string>(
    currentUser.tuman_id ? String(currentUser.tuman_id) : ''
  );
  const [newMahallaId, setNewMahallaId] = useState<string>(
    currentUser.mahalla_id ? String(currentUser.mahalla_id) : ''
  );
  const [newAddress, setNewAddress] = useState('');
  const [newObjectType, setNewObjectType] = useState<ObjectType>('residential_house');
  const [newCadNum, setNewCadNum] = useState('');
  const [newBuiltYear, setNewBuiltYear] = useState('');
  const [newFloorsCount, setNewFloorsCount] = useState('');
  const [newRoomsCount, setNewRoomsCount] = useState('');
  const [newLandArea, setNewLandArea] = useState('');
  const [newBuildingArea, setNewBuildingArea] = useState('');
  const [newWallMaterial, setNewWallMaterial] = useState('Pishiq g‘isht');
  const [newReason, setNewReason] = useState(
    'Xarita orqali belgilangan uy-joyning kadastr holatini vakolatli manbadan tekshirish'
  );

  // Load full Uzbekistan 14 Viloyat & 208 Tuman/Shahar directory
  useEffect(() => {
    apiRequest<UzRegionDirectoryItem[]>('/api/uzbekistan-directory')
      .then((list) => {
        setUzDirectory(list);
        if (currentUser.tuman_name) {
          const andijon = list.find((v) => v.code === 'UZ-AN');
          const matchDist = andijon?.districts.find(
            (d) => d.name.toLowerCase() === currentUser.tuman_name?.toLowerCase()
          );
          if (matchDist) setSelectedUzDistCode(matchDist.code);
        }
      })
      .catch(() => {
        // ignore
      });
  }, [currentUser.tuman_name]);

  const activeUzViloyat = useMemo(
    () => uzDirectory.find((v) => v.code === selectedUzVilCode) || null,
    [uzDirectory, selectedUzVilCode]
  );

  const uzDistrictOptions = useMemo(
    () => (activeUzViloyat ? activeUzViloyat.districts : []),
    [activeUzViloyat]
  );

  const tumanOptions = useMemo(
    () => regions.filter((r) => r.level === 'tuman'),
    [regions]
  );

  const mahallaOptions = useMemo(
    () =>
      regions.filter(
        (r) =>
          r.level === 'mahalla' &&
          (!selectedTumanId || r.parent_id === Number(selectedTumanId))
      ),
    [regions, selectedTumanId]
  );

  const newFormMahallas = useMemo(
    () =>
      regions.filter(
        (r) =>
          r.level === 'mahalla' &&
          (!newTumanId || r.parent_id === Number(newTumanId))
      ),
    [regions, newTumanId]
  );

  // Determine initial center based on user's regional assignment
  const initialView = useMemo(() => {
    if (currentUser.mahalla_id) {
      const m = regions.find((r) => r.id === currentUser.mahalla_id);
      if (m) return { lat: m.center_lat, lng: m.center_lng, zoom: 17 };
    }
    if (currentUser.tuman_id) {
      const t = regions.find((r) => r.id === currentUser.tuman_id);
      if (t) return { lat: t.center_lat, lng: t.center_lng, zoom: 15 };
    }
    // Default pilot highlight: Andijon shahri center so satellite rooftops are immediately visible
    return { lat: 40.7834, lng: 72.3455, zoom: 16 };
  }, [currentUser, regions]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [initialView.lat, initialView.lng],
      zoom: initialView.zoom,
      zoomControl: false,
      maxZoom: 21,
      minZoom: 7,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const esriTileUrl = (z: number, y: number, x: number) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

    const isEsriPlaceholder = (res: Response, size: number) => {
      const etag = res.headers.get('etag') || '';
      return !res.ok || size === 2521 || size < 1200 || etag.includes('vvvvvvvv');
    };

    const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const objUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objUrl);
          resolve(img);
        };
        img.onerror = (err) => {
          URL.revokeObjectURL(objUrl);
          reject(err);
        };
        img.src = objUrl;
      });

    const SmartSatelliteLayer = L.TileLayer.extend({
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const loadWithFallback = async () => {
          try {
            // At zoom <= 15 Esri has universal global imagery
            const maxStepBack = coords.z >= 16 ? Math.min(4, coords.z - 14) : 0;
            for (let dz = 0; dz <= maxStepBack; dz++) {
              const scale = 1 << dz;
              const tz = coords.z - dz;
              const tx = Math.floor(coords.x / scale);
              const ty = Math.floor(coords.y / scale);

              const res = await fetch(esriTileUrl(tz, ty, tx));
              if (!res.ok) continue;
              const blob = await res.blob();

              if (dz < maxStepBack && isEsriPlaceholder(res, blob.size)) {
                continue;
              }

              const img = await loadBlobImage(blob);
              if (ctx) {
                const srcW = img.naturalWidth || 256;
                const srcH = img.naturalHeight || 256;
                const subW = srcW / scale;
                const subH = srcH / scale;
                const sx = (coords.x % scale) * subW;
                const sy = (coords.y % scale) * subH;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, sx, sy, subW, subH, 0, 0, 256, 256);
              }
              done(undefined, canvas);
              return;
            }
            done(undefined, canvas);
          } catch (err: any) {
            done(err, canvas);
          }
        };

        loadWithFallback();
        return canvas;
      },
    });

    const satLayer: L.TileLayer = new (SmartSatelliteLayer as any)(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxNativeZoom: 18,
        maxZoom: 21,
        keepBuffer: 4,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
      }
    );

    const labelsLayer = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {
        maxNativeZoom: 17,
        maxZoom: 21,
        opacity: 0.85,
      }
    );

    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      maxZoom: 21,
      keepBuffer: 4,
      attribution: '&copy; OpenStreetMap contributors',
    });

    satLayer.addTo(map);
    labelsLayer.addTo(map);

    satTileRef.current = satLayer;
    labelsTileRef.current = labelsLayer;
    streetTileRef.current = streetLayer;

    const inspectedLayer = L.layerGroup().addTo(map);
    inspectedRoofLayerRef.current = inspectedLayer;

    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;

    const syncBounds = () => {
      const b = map.getBounds();
      setZoomLevel(map.getZoom());
      setBounds({
        south: Number(b.getSouth().toFixed(5)),
        north: Number(b.getNorth().toFixed(5)),
        west: Number(b.getWest().toFixed(5)),
        east: Number(b.getEast().toFixed(5)),
      });
    };

    map.on('moveend', syncBounds);
    map.on('zoomend', syncBounds);
    syncBounds();

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    resizeObserver.observe(mapContainerRef.current);

    mapInstanceRef.current = map;

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Switch Base Layers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !satTileRef.current || !labelsTileRef.current || !streetTileRef.current) return;

    if (mapMode === 'street') {
      if (map.hasLayer(satTileRef.current)) map.removeLayer(satTileRef.current);
      if (map.hasLayer(labelsTileRef.current)) map.removeLayer(labelsTileRef.current);
      if (!map.hasLayer(streetTileRef.current)) streetTileRef.current.addTo(map);
    } else if (mapMode === 'satellite_clean') {
      if (map.hasLayer(streetTileRef.current)) map.removeLayer(streetTileRef.current);
      if (!map.hasLayer(satTileRef.current)) satTileRef.current.addTo(map);
      if (map.hasLayer(labelsTileRef.current)) map.removeLayer(labelsTileRef.current);
    } else {
      if (map.hasLayer(streetTileRef.current)) map.removeLayer(streetTileRef.current);
      if (!map.hasLayer(satTileRef.current)) satTileRef.current.addTo(map);
      if (!map.hasLayer(labelsTileRef.current)) labelsTileRef.current.addTo(map);
    }
  }, [mapMode]);

  // Render clicked rooftop polygon & selection marker on map
  useEffect(() => {
    const layer = inspectedRoofLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (interactionMode !== 'browse') return;

    if (clickedHouseInfo?.osmBuilding?.polygon && clickedHouseInfo.osmBuilding.polygon.length >= 3) {
      L.polygon(clickedHouseInfo.osmBuilding.polygon, {
        color: '#38bdf8',
        weight: 2.5,
        fillColor: '#0ea5e9',
        fillOpacity: 0.22,
      }).addTo(layer);
    }

    if (clickedCoords && !selectedProperty) {
      L.marker([clickedCoords.lat, clickedCoords.lng], {
        icon: L.divIcon({
          className: 'ekadastr-pin-icon',
          html: `<div style="width:28px;height:28px;border-radius:9999px;background:#0284c7;border:2.5px solid #ffffff;box-shadow:0 0 0 4px rgba(14,165,233,0.35),0 3px 10px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;"><div style="width:7px;height:7px;border-radius:9999px;background:#ffffff;"></div></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(layer);
    }
  }, [clickedHouseInfo, clickedCoords, selectedProperty, interactionMode]);

  // Handle Map Click:
  // - In 'browse' mode: clicking ANY house on the satellite map inspects that house (DB record + OSM building footprint + reverse address)
  // - In 'pin_new' / 'fix_location' mode: places coordinate pin (and auto-prefills address/footprint in 'pin_new')
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let activeReqId = 0;

    const handleMapClick = async (e: L.LeafletMouseEvent) => {
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));

      if (interactionMode !== 'browse') {
        setPickedCoords({ lat, lng });

        if (tempPinRef.current) {
          tempPinRef.current.setLatLng([lat, lng]);
        } else {
          tempPinRef.current = L.marker([lat, lng], {
            icon: L.divIcon({
              className: 'ekadastr-pin-icon',
              html: `<div style="width:30px;height:30px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.5);"></div>`,
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            }),
          }).addTo(map);
        }

        if (interactionMode === 'pin_new') {
          try {
            const info = await apiRequest<ClickedBuildingInspection>(
              `/api/map/inspect-point?lat=${lat}&lng=${lng}`
            );
            setNewAddress((prev) => prev || info.street_house || info.address);
            if (info.osmBuilding.footprint_area_m2) {
              setNewBuildingArea((prev) => prev || String(info.osmBuilding.footprint_area_m2));
            }
            if (info.osmBuilding.built_year) {
              setNewBuiltYear((prev) => prev || String(info.osmBuilding.built_year));
            }
            if (info.osmBuilding.floors_count) {
              setNewFloorsCount((prev) => prev || String(info.osmBuilding.floors_count));
            }
          } catch {
            // ignore optional prefill error
          }
        }
        return;
      }

      // Browse mode: inspect clicked house!
      if (map.getZoom() < 13) {
        map.flyTo([lat, lng], Math.min(16, map.getZoom() + 3), { duration: 0.65 });
      }

      const reqId = ++activeReqId;
      setFoundGeoPin(null);
      setSelectedProperty(null);
      setClickedHouseInfo(null);
      setClickedCoords({ lat, lng });
      setInspectingClick(true);

      try {
        const res = await apiRequest<ClickedBuildingInspection>(
          `/api/map/inspect-point?lat=${lat}&lng=${lng}`
        );
        if (reqId !== activeReqId) return;

        setClickedHouseInfo(res);
        if (res.matchedProperty) {
          setSelectedProperty(res.matchedProperty);
        }
      } catch (err: any) {
        if (reqId === activeReqId) {
          onToast(err.message || 'Tanlangan nuqta ma’lumotini olishda xatolik.', 'error');
        }
      } finally {
        if (reqId === activeReqId) {
          setInspectingClick(false);
        }
      }
    };

    map.on('click', handleMapClick);
    return () => {
      activeReqId++;
      map.off('click', handleMapClick);
    };
  }, [interactionMode, onToast]);

  // Clear temporary picked pin when returning to browse mode
  useEffect(() => {
    if (interactionMode === 'browse' && tempPinRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(tempPinRef.current);
      tempPinRef.current = null;
      setPickedCoords(null);
    }
  }, [interactionMode]);

  // Handle incoming external focusTarget (e.g. "Xaritada ko'rish" or "Joylashuvni tuzatish")
  useEffect(() => {
    if (!focusTarget || !mapInstanceRef.current) return;

    const run = async () => {
      try {
        const detail = await apiRequest<{ property: PropertyRecord }>(
          `/api/properties/${focusTarget.propertyId}`
        );
        const p = detail.property;

        if (focusTarget.correctionMode) {
          setCorrectionTarget(p);
          setSelectedProperty(p);
          setInteractionMode('fix_location');
          if (p.latitude !== null && p.longitude !== null) {
            mapInstanceRef.current?.setView([p.latitude, p.longitude], 18);
          } else {
            const m = regions.find((r) => r.id === p.mahalla_id);
            if (m) {
              mapInstanceRef.current?.setView([m.center_lat, m.center_lng], 17);
            }
          }
        } else if (p.latitude !== null && p.longitude !== null) {
          setSelectedProperty(p);
          mapInstanceRef.current?.setView([p.latitude, p.longitude], 18);
        }
      } catch {
        // ignore
      } finally {
        onClearFocusTarget();
      }
    };

    run();
  }, [focusTarget, regions, onClearFocusTarget]);

  // Fetch Viewport Data (Debounced — without restricting viewport markers by partial search text so surrounding context stays visible)
  const fetchMapObjects = useCallback(async () => {
    if (!bounds) return;
    setLoadingMapData(true);
    try {
      const qs = new URLSearchParams({
        south: String(bounds.south),
        north: String(bounds.north),
        west: String(bounds.west),
        east: String(bounds.east),
      });
      if (selectedTumanId) qs.set('tumanId', selectedTumanId);
      if (selectedMahallaId) qs.set('mahallaId', selectedMahallaId);
      if (markerFilter && markerFilter !== 'gray') qs.set('markerColor', markerFilter);

      const res = await apiRequest<{
        viewportItems: PropertyRecord[];
        unlocatedItems: PropertyRecord[];
      }>(`/api/properties/map?${qs.toString()}`);

      setViewportItems(res.viewportItems);
      setUnlocatedItems(res.unlocatedItems);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setLoadingMapData(false);
    }
  }, [bounds, selectedTumanId, selectedMahallaId, markerFilter, onToast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMapObjects();
    }, 180);
    return () => clearTimeout(timer);
  }, [fetchMapObjects]);

  // Live Autocomplete Address Search (DB + Uzbekistan Geocoder)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setDbMatches([]);
      setGeoMatches([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchingAddress(true);
      try {
        const res = await apiRequest<MapAddressSearchResponse>(
          `/api/map/search-address?q=${encodeURIComponent(q)}`
        );
        if (!cancelled) {
          setDbMatches(res.dbMatches);
          setGeoMatches(res.geoMatches);
        }
      } catch {
        // ignore transient typing errors
      } finally {
        if (!cancelled) setSearchingAddress(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Close search dropdown on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Render / clear geocoded address target marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!foundGeoPin) {
      if (geoTargetPinRef.current) {
        map.removeLayer(geoTargetPinRef.current);
        geoTargetPinRef.current = null;
      }
      return;
    }

    const icon = L.divIcon({
      className: 'ekadastr-pin-icon',
      html: `<div style="width:34px;height:34px;border-radius:9999px;background:#2563eb;border:3px solid #ffffff;box-shadow:0 0 0 4px rgba(37,99,235,0.35),0 4px 12px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:9999px;background:#ffffff;"></div></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

    if (geoTargetPinRef.current) {
      geoTargetPinRef.current.setLatLng([foundGeoPin.lat, foundGeoPin.lng]);
      geoTargetPinRef.current.setIcon(icon);
    } else {
      geoTargetPinRef.current = L.marker([foundGeoPin.lat, foundGeoPin.lng], { icon }).addTo(map);
    }
  }, [foundGeoPin]);

  const focusOnDbProperty = useCallback(
    (prop: PropertyRecord) => {
      setSearchDropdownOpen(false);
      setFoundGeoPin(null);
      setInteractionMode('browse');
      if (markerFilter) setMarkerFilter('');

      if (!currentUser.tuman_id && selectedTumanId && Number(selectedTumanId) !== prop.tuman_id) {
        setSelectedTumanId(String(prop.tuman_id));
      }
      if (
        !currentUser.mahalla_id &&
        selectedMahallaId &&
        Number(selectedMahallaId) !== prop.mahalla_id
      ) {
        setSelectedMahallaId(String(prop.mahalla_id));
      }

      setSelectedProperty(prop);

      if (prop.latitude !== null && prop.longitude !== null) {
        mapInstanceRef.current?.flyTo([prop.latitude, prop.longitude], 19, {
          duration: 0.75,
        });
      } else {
        const m = regions.find((r) => r.id === prop.mahalla_id);
        if (m) {
          mapInstanceRef.current?.flyTo([m.center_lat, m.center_lng], 17, {
            duration: 0.75,
          });
        }
        onToast(
          `${prop.system_uid} manzili topildi, biroq xaritadagi nuqtasi hali belgilanmagan.`,
          'error'
        );
      }
    },
    [currentUser, markerFilter, selectedTumanId, selectedMahallaId, regions, onToast]
  );

  const focusOnGeoCandidate = useCallback((geo: MapGeoCandidate) => {
    setSearchDropdownOpen(false);
    setSelectedProperty(null);
    setInteractionMode('browse');
    const targetZoom = geo.zoom ?? 18;
    setFoundGeoPin(geo);
    mapInstanceRef.current?.flyTo([geo.lat, geo.lng], targetZoom, {
      duration: 0.8,
    });
  }, []);

  const handleAddressSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setSearchingAddress(true);
    try {
      const res = await apiRequest<MapAddressSearchResponse>(
        `/api/map/search-address?q=${encodeURIComponent(q)}`
      );
      setDbMatches(res.dbMatches);
      setGeoMatches(res.geoMatches);

      if (res.dbMatches.length > 0) {
        focusOnDbProperty(res.dbMatches[0]);
      } else if (res.geoMatches.length > 0) {
        focusOnGeoCandidate(res.geoMatches[0]);
      } else {
        onToast(
          'Kiritilgan joy nomi yoki manzil topilmadi. Viloyat, tuman, qishloq yoki ko‘cha nomini tekshiring.',
          'error'
        );
      }
    } catch (err: any) {
      onToast(err.message || 'Qidirishda xatolik.', 'error');
    } finally {
      setSearchingAddress(false);
    }
  };

  // Spatial Clustering Calculation (TZ Section 6 & 15)
  const renderNodes: MapRenderNode[] = useMemo(() => {
    const mergedItems =
      selectedProperty &&
      selectedProperty.latitude !== null &&
      selectedProperty.longitude !== null &&
      !viewportItems.some((p) => p.id === selectedProperty.id)
        ? [...viewportItems, selectedProperty]
        : viewportItems;

    if (zoomLevel >= 16) {
      return mergedItems.map((p) => ({ ...p, isCluster: false as const }));
    }

    // Cell size scales with zoom level so close markers group cleanly
    const cellDegrees = 0.22 / Math.pow(2, zoomLevel - 9);
    const buckets = new Map<string, PropertyRecord[]>();

    for (const p of mergedItems) {
      if (p.latitude === null || p.longitude === null) continue;
      const gx = Math.floor(p.latitude / cellDegrees);
      const gy = Math.floor(p.longitude / cellDegrees);
      const key = `${gx}_${gy}`;
      const arr = buckets.get(key);
      if (arr) arr.push(p);
      else buckets.set(key, [p]);
    }

    const nodes: MapRenderNode[] = [];
    buckets.forEach((items, key) => {
      if (items.length === 1) {
        nodes.push({ ...items[0], isCluster: false });
      } else {
        const avgLat = items.reduce((acc, i) => acc + (i.latitude ?? 0), 0) / items.length;
        const avgLng = items.reduce((acc, i) => acc + (i.longitude ?? 0), 0) / items.length;
        nodes.push({
          isCluster: true,
          id: key,
          lat: avgLat,
          lng: avgLng,
          items,
        });
      }
    });
    return nodes;
  }, [viewportItems, selectedProperty, zoomLevel]);

  // Render Markers & Clusters onto Leaflet Layer
  useEffect(() => {
    const layer = markersLayerRef.current;
    const map = mapInstanceRef.current;
    if (!layer || !map) return;

    layer.clearLayers();

    for (const node of renderNodes) {
      if (node.isCluster) {
        const marker = L.marker([node.lat, node.lng], {
          icon: L.divIcon({
            className: 'ekadastr-pin-icon',
            html: buildClusterHtml(node.items),
            iconSize: [38, 38],
            iconAnchor: [19, 19],
          }),
        });
        marker.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          map.setView([node.lat, node.lng], Math.min(18, map.getZoom() + 2));
        });
        marker.addTo(layer);
      } else {
        if (node.latitude === null || node.longitude === null) continue;
        const isSelected = selectedProperty?.id === node.id;
        const hasPendingFix = node.pending_lat !== null;
        const size = isSelected ? 34 : 28;

        const marker = L.marker([node.latitude, node.longitude], {
          icon: L.divIcon({
            className: 'ekadastr-pin-icon',
            html: buildPinSvg(node.marker_color, isSelected, hasPendingFix),
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }),
        });

        marker.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          setClickedHouseInfo(null);
          setClickedCoords(null);
          setFoundGeoPin(null);
          setSelectedProperty(node);
          if (node.latitude !== null && node.longitude !== null) {
            apiRequest<ClickedBuildingInspection>(
              `/api/map/inspect-point?lat=${node.latitude}&lng=${node.longitude}`
            )
              .then((res) => {
                setClickedHouseInfo(res);
              })
              .catch(() => {
                // ignore optional polygon lookup failure
              });
          }
        });
        marker.addTo(layer);
      }
    }
  }, [renderNodes, selectedProperty]);

  const handleUzViloyatChange = (vilCode: string) => {
    setSelectedUzVilCode(vilCode);
    setSelectedUzDistCode('');
    setSelectedMahallaId('');
    setFoundGeoPin(null);

    const map = mapInstanceRef.current;
    if (!map) return;

    if (!vilCode) {
      setSelectedTumanId('');
      map.flyTo([41.3775, 64.5853], 6, { duration: 0.8 });
      return;
    }

    const vil = uzDirectory.find((v) => v.code === vilCode);
    if (vil) {
      if (vilCode !== 'UZ-AN') {
        setSelectedTumanId('');
      }
      map.flyTo([vil.lat, vil.lng], vil.zoom || 9, { duration: 0.8 });
    }
  };

  const handleUzDistrictChange = (distCode: string) => {
    setSelectedUzDistCode(distCode);
    setSelectedMahallaId('');
    setFoundGeoPin(null);

    const map = mapInstanceRef.current;
    if (!map) return;

    if (!distCode) {
      setSelectedTumanId('');
      if (activeUzViloyat) {
        map.flyTo([activeUzViloyat.lat, activeUzViloyat.lng], activeUzViloyat.zoom || 9, {
          duration: 0.75,
        });
      }
      return;
    }

    const dist = uzDistrictOptions.find((d) => d.code === distCode);
    if (dist) {
      const dbTum = tumanOptions.find(
        (t) => t.name.toLowerCase() === dist.name.toLowerCase()
      );
      setSelectedTumanId(dbTum ? String(dbTum.id) : '');
      map.flyTo([dist.lat, dist.lng], dist.zoom || 13, { duration: 0.8 });
    }
  };

  const handleMahallaSelect = (mahallaVal: string) => {
    setSelectedMahallaId(mahallaVal);
    setFoundGeoPin(null);
    const map = mapInstanceRef.current;
    if (!map) return;

    if (mahallaVal) {
      const m = regions.find((r) => r.id === Number(mahallaVal));
      if (m) map.flyTo([m.center_lat, m.center_lng], m.default_zoom || 17, { duration: 0.75 });
    } else if (selectedUzDistCode) {
      const dist = uzDistrictOptions.find((d) => d.code === selectedUzDistCode);
      if (dist) map.flyTo([dist.lat, dist.lng], dist.zoom || 13, { duration: 0.75 });
    }
  };

  const startPinNewHouse = () => {
    setSelectedProperty(null);
    setClickedHouseInfo(null);
    setClickedCoords(null);
    setCorrectionTarget(null);
    setPickedCoords(null);
    setNewBuiltYear('');
    setNewFloorsCount('');
    setNewRoomsCount('');
    setNewLandArea('');
    setNewBuildingArea('');
    const defaultTuman = selectedTumanId || (tumanOptions[0] ? String(tumanOptions[0].id) : '');
    setNewTumanId(currentUser.tuman_id ? String(currentUser.tuman_id) : defaultTuman);
    if (currentUser.mahalla_id) {
      setNewMahallaId(String(currentUser.mahalla_id));
    } else if (selectedMahallaId) {
      setNewMahallaId(selectedMahallaId);
    } else {
      const firstM = regions.find(
        (r) => r.level === 'mahalla' && (!defaultTuman || r.parent_id === Number(defaultTuman))
      );
      setNewMahallaId(firstM ? String(firstM.id) : '');
    }
    setInteractionMode('pin_new');
  };

  const handleCreatePinnedHouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickedCoords) {
      onToast('Avval sun’iy yo‘ldosh xaritasida uy tomini bosib joylashuvni belgilang.', 'error');
      return;
    }
    setSubmittingPin(true);
    try {
      const created = await apiRequest<PropertyRecord>('/api/properties', {
        method: 'POST',
        body: JSON.stringify({
          tuman_id: Number(newTumanId),
          mahalla_id: Number(newMahallaId),
          address: newAddress,
          object_type: newObjectType,
          latitude: pickedCoords.lat,
          longitude: pickedCoords.lng,
          cadastral_number: newCadNum || null,
          built_year: newBuiltYear ? Number(newBuiltYear) : null,
          floors_count: newFloorsCount ? Number(newFloorsCount) : null,
          rooms_count: newRoomsCount ? Number(newRoomsCount) : null,
          land_area_m2: newLandArea ? Number(newLandArea) : null,
          building_area_m2: newBuildingArea ? Number(newBuildingArea) : null,
          wall_material: newWallMaterial || null,
          request_inspection: true,
          inspection_reason: newReason,
        }),
      });
      onToast(`Yangi obyekt (${created.system_uid}) xaritaga kiritildi va tekshiruvga yuborildi.`, 'success');
      setNewAddress('');
      setNewCadNum('');
      setNewBuiltYear('');
      setNewFloorsCount('');
      setNewRoomsCount('');
      setNewLandArea('');
      setNewBuildingArea('');
      setInteractionMode('browse');
      await fetchMapObjects();
      setSelectedProperty(created);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSubmittingPin(false);
    }
  };

  const handleSaveLocationFix = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionTarget || !pickedCoords) {
      onToast('Xaritadan obyekting haqiqiy joylashuv nuqtasini tanlang.', 'error');
      return;
    }
    setSubmittingPin(true);
    try {
      const updated = await apiRequest<PropertyRecord>(
        `/api/properties/${correctionTarget.id}/location`,
        {
          method: 'POST',
          body: JSON.stringify({
            latitude: pickedCoords.lat,
            longitude: pickedCoords.lng,
            note: correctionNote,
          }),
        }
      );
      onToast(
        currentUser.role === 'mahalla' && correctionTarget.latitude !== null
          ? 'Joylashuvni tuzatish so‘rovi mas’ul xodimga yuborildi.'
          : 'Obyekt koordinatalari xaritada saqlandi.',
        'success'
      );
      setCorrectionNote('');
      setCorrectionTarget(null);
      setInteractionMode('browse');
      await fetchMapObjects();
      setSelectedProperty(updated);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSubmittingPin(false);
    }
  };

  return (
    <div className="h-[calc(100vh-57px)] flex flex-col bg-slate-100">
      {/* Top Map Filter & Action Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Nationwide Uzbekistan Viloyat Selector (All 14 Regions) */}
          <select
            value={selectedUzVilCode}
            onChange={(e) => handleUzViloyatChange(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 max-w-44"
            aria-label="O‘zbekiston viloyatlari"
          >
            <option value="">O‘zbekiston (barcha viloyatlar)</option>
            {uzDirectory.map((v) => (
              <option key={v.code} value={v.code}>
                {v.name}
              </option>
            ))}
          </select>

          {/* Nationwide Uzbekistan Tuman / Shahar Selector (All 208 Districts/Cities) */}
          <select
            value={selectedUzDistCode}
            disabled={!selectedUzVilCode}
            onChange={(e) => handleUzDistrictChange(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 disabled:bg-slate-100 max-w-48"
            aria-label="Tuman va shaharlar"
          >
            <option value="">Barcha tuman va shaharlar</option>
            {uzDistrictOptions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Mahalla Filter (when registered MFYs exist for selected area) */}
          {selectedUzVilCode === 'UZ-AN' && mahallaOptions.length > 0 && (
            <select
              value={selectedMahallaId}
              onChange={(e) => handleMahallaSelect(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 max-w-40"
              aria-label="Mahallalar"
            >
              <option value="">Barcha MFYlar</option>
              {mahallaOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          {/* Nationwide Uzbekistan Viloyat / Tuman / Qishloq / Uy Search Form + Autocomplete */}
          <div ref={searchBoxRef} className="relative">
            <form onSubmit={handleAddressSearchSubmit} className="flex items-center gap-1">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onFocus={() => setSearchDropdownOpen(true)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchDropdownOpen(true);
                  }}
                  placeholder="Viloyat, tuman, qishloq, MFY yoki uy manzili..."
                  className="pl-8 pr-7 py-1.5 text-xs border border-slate-300 rounded-lg w-60 sm:w-76 focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-900"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setDbMatches([]);
                      setGeoMatches([]);
                      setFoundGeoPin(null);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    aria-label="Tozalash"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={searchingAddress || !searchQuery.trim()}
                className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                {searchingAddress ? '...' : 'Topish'}
              </button>
            </form>

            {/* Autocomplete Dropdown */}
            {searchDropdownOpen && searchQuery.trim().length >= 2 && (
              <div className="absolute left-0 top-full mt-1.5 w-80 sm:w-[420px] max-h-96 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl z-[700] divide-y divide-slate-100 text-xs">
                {searchingAddress && dbMatches.length === 0 && geoMatches.length === 0 && (
                  <div className="p-3 text-slate-500">O‘zbekiston xaritasi bo‘yicha qidirilmoqda...</div>
                )}

                {!searchingAddress && dbMatches.length === 0 && geoMatches.length === 0 && (
                  <div className="p-3 text-slate-500">
                    Mos joy topilmadi. Viloyat, tuman, qishloq, mahalla yoki ko‘cha va uy raqamini kiriting.
                  </div>
                )}

                {dbMatches.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Tizimdagi uy-joylar ({dbMatches.length})
                    </div>
                    {dbMatches.map((item) => (
                      <button
                        key={`db-${item.id}`}
                        type="button"
                        onClick={() => focusOnDbProperty(item)}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50/70 transition-colors flex items-start justify-between gap-2 cursor-pointer border-t border-slate-100 first:border-t-0"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">{item.address}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {item.tuman_name} · {item.mahalla_name}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-[11px] font-semibold text-blue-700">
                            {item.system_uid}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {item.latitude !== null ? 'Uy ustiga o‘tish' : 'Joylashuvsiz'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {geoMatches.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      O‘zbekiston bo‘yicha hududlar, qishloqlar va manzillar ({geoMatches.length})
                    </div>
                    {geoMatches.map((geo) => (
                      <button
                        key={geo.id}
                        type="button"
                        onClick={() => focusOnGeoCandidate(geo)}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50/70 transition-colors flex items-start justify-between gap-2 cursor-pointer border-t border-slate-100 first:border-t-0"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                              {geo.short_address}
                            </div>
                            <div className="text-[11px] text-slate-500 line-clamp-2">
                              {geo.display_name}
                            </div>
                          </div>
                        </div>
                        {geo.category_label && (
                          <span className="text-[10px] font-semibold text-slate-500 shrink-0 mt-0.5">
                            {geo.category_label}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interactive Marker Status Segmented Filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: '', label: 'Barchasi' },
              { id: 'green', label: 'Yashil' },
              { id: 'yellow', label: 'Sariq' },
              { id: 'red', label: 'Qizil' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMarkerFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  markerFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Gray Unlocated Objects Button */}
          <button
            type="button"
            onClick={() => setShowUnlocatedPanel((v) => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              showUnlocatedPanel
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <MapPinOff className="w-3.5 h-3.5" />
            <span>Kulrang / Joylashuvsiz ({unlocatedItems.length})</span>
          </button>

          {/* Pin New House Button */}
          <button
            type="button"
            onClick={() =>
              interactionMode === 'pin_new' ? setInteractionMode('browse') : startPinNewHouse()
            }
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              interactionMode === 'pin_new'
                ? 'bg-blue-700 text-white'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>
              {interactionMode === 'pin_new' ? 'Belgilashni bekor qilish' : 'Uy-joyni belgilash'}
            </span>
          </button>
        </div>
      </div>

      {/* Main Map + Side Inspector Split */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Map Canvas Container */}
        <div className="flex-1 relative h-full">
          <div ref={mapContainerRef} className="w-full h-full z-0" />

          {/* Active Mode Instruction Overlay */}
          {interactionMode !== 'browse' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-slate-900/95 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2.5 text-xs">
              <Crosshair className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                {interactionMode === 'pin_new'
                  ? 'Yangi uy-joyni kiritish uchun sun’iy yo‘ldosh tasviridagi bino ustini bosing'
                  : `"${correctionTarget?.system_uid}" obyektining haqiqiy joylashuvini xaritadan bosing`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setInteractionMode('browse');
                  setCorrectionTarget(null);
                }}
                className="ml-2 text-slate-300 hover:text-white underline whitespace-nowrap cursor-pointer"
              >
                Bekor qilish
              </button>
            </div>
          )}

          {/* Layer Switcher (Top Right inside map) */}
          <div className="absolute top-3 right-3 z-[500] bg-white/95 backdrop-blur border border-slate-200 rounded-lg p-1 flex items-center gap-1 shadow-sm">
            <Layers className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-0.5" />
            {[
              { id: 'satellite_hybrid' as const, label: 'Sun’iy yo‘ldosh + Yozuvlar' },
              { id: 'satellite_clean' as const, label: 'Toza tasvir' },
              { id: 'street' as const, label: 'Sxema' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMapMode(m.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  mapMode === m.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Map Legend + Official Disclaimer (Bottom Left) */}
          <div className="absolute bottom-3 left-3 z-[500] bg-white/95 backdrop-blur border border-slate-200 rounded-lg p-3 shadow-sm max-w-md space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-slate-800">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
                <span>Tasdiqlangan</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" />
                <span>Tekshiruv talab</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
                <span>Yo‘qligi tasdiqlangan</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" />
                <span>Joylashuvsiz</span>
              </span>
            </div>
            <div className="text-[10px] text-slate-500 leading-snug">
              Ko‘rinayotgan maydonda:{' '}
              <span className="font-mono font-semibold text-slate-800">{viewportItems.length}</span>{' '}
              ta obyekt {loadingMapData ? '(yangilanmoqda...)' : ''}. Istalgan uy ustiga bosing —
              uyning qurilgan yili va texnik pasport ma’lumotlari ochiladi.
            </div>
          </div>
        </div>

        {/* Right Side Contextual Panel (Selected Property OR Clicked Rooftop House OR Geocoded Address OR Pin New OR Fix Location OR Gray List) */}
        {(selectedProperty ||
          inspectingClick ||
          clickedHouseInfo ||
          foundGeoPin ||
          interactionMode !== 'browse' ||
          showUnlocatedPanel) && (
          <div className="w-full sm:w-96 bg-white border-l border-slate-200 h-full overflow-y-auto p-4 space-y-4 shrink-0 z-10">
            {/* Loading Skeleton when user clicks any rooftop on the map */}
            {interactionMode === 'browse' && inspectingClick && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <div className="text-xs font-bold text-slate-900">
                    Tanlangan uy ma’lumotlari aniqlanmoqda...
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInspectingClick(false);
                      setClickedCoords(null);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {clickedCoords && (
                  <div className="text-xs font-mono text-slate-600 tabular-nums">
                    GPS: {clickedCoords.lat.toFixed(6)}, {clickedCoords.lng.toFixed(6)}
                  </div>
                )}
                <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-28 bg-slate-100 rounded-lg animate-pulse" />
              </div>
            )}

            {/* Clicked Rooftop Card (for ANY house on Uzbekistan satellite map not yet registered in SQLite) */}
            {interactionMode === 'browse' &&
              !inspectingClick &&
              !selectedProperty &&
              clickedHouseInfo && (
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-sky-700">
                        {clickedHouseInfo.osmBuilding.building_type_label}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                        {clickedHouseInfo.osmBuilding.name || clickedHouseInfo.address}
                      </h3>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {[
                          clickedHouseInfo.mahalla_or_village,
                          clickedHouseInfo.district,
                          clickedHouseInfo.region,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClickedHouseInfo(null);
                        setClickedCoords(null);
                      }}
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Technical & Cadastral Attributes of Clicked Rooftop */}
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-slate-500">Kadastr holati</span>
                      <span className="font-semibold text-amber-700 text-right">
                        Bazaga kiritilmagan (Tekshiruv talab)
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-slate-500">Qurilgan yili</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {clickedHouseInfo.osmBuilding.built_year
                          ? `${clickedHouseInfo.osmBuilding.built_year}-yil`
                          : 'Kadastr bazasiga kiritilmagan'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-slate-500">Qavatlar soni</span>
                      <span className="font-mono text-slate-900 tabular-nums">
                        {clickedHouseInfo.osmBuilding.floors_count
                          ? `${clickedHouseInfo.osmBuilding.floors_count} qavat`
                          : 'Kiritilmagan'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-slate-500">Xaritadagi tom / bino izi</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {clickedHouseInfo.osmBuilding.footprint_area_m2
                          ? `${clickedHouseInfo.osmBuilding.footprint_area_m2} m² (~${(
                              clickedHouseInfo.osmBuilding.footprint_area_m2 / 100
                            ).toFixed(2)} sotix)`
                          : 'Chegarasi belgilanmagan'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-slate-500">Devor / tom materiali</span>
                      <span className="text-slate-900 text-right">
                        {[
                          clickedHouseInfo.osmBuilding.wall_material,
                          clickedHouseInfo.osmBuilding.roof_material,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Kiritilmagan'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-slate-500">Manzil</span>
                      <span className="text-slate-800 text-right">{clickedHouseInfo.address}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 gap-2">
                      <span className="text-slate-500">Koordinata</span>
                      <span className="font-mono text-slate-800 tabular-nums">
                        {clickedHouseInfo.lat}, {clickedHouseInfo.lng}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const info = clickedHouseInfo;
                      startPinNewHouse();
                      setPickedCoords({ lat: info.lat, lng: info.lng });
                      setNewAddress(info.street_house || info.address);
                      if (info.osmBuilding.built_year) {
                        setNewBuiltYear(String(info.osmBuilding.built_year));
                      }
                      if (info.osmBuilding.floors_count) {
                        setNewFloorsCount(String(info.osmBuilding.floors_count));
                      }
                      if (info.osmBuilding.footprint_area_m2) {
                        setNewBuildingArea(String(info.osmBuilding.footprint_area_m2));
                      }
                      if (info.osmBuilding.wall_material) {
                        setNewWallMaterial(info.osmBuilding.wall_material);
                      }
                      if (mapInstanceRef.current) {
                        if (tempPinRef.current) {
                          tempPinRef.current.setLatLng([info.lat, info.lng]);
                        } else {
                          tempPinRef.current = L.marker([info.lat, info.lng], {
                            icon: L.divIcon({
                              className: 'ekadastr-pin-icon',
                              html: `<div style="width:30px;height:30px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.5);"></div>`,
                              iconSize: [30, 30],
                              iconAnchor: [15, 15],
                            }),
                          }).addTo(mapInstanceRef.current);
                        }
                      }
                    }}
                    className="w-full py-2 px-3 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Uy ma’lumotlarini bazaga kiritish (qurilgan yili, maydoni)</span>
                  </button>
                </div>
              )}

            {/* Found Geocoded External House Card */}
            {interactionMode === 'browse' &&
              !inspectingClick &&
              !selectedProperty &&
              !clickedHouseInfo &&
              foundGeoPin && (
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-blue-700">
                      Xaritadan topilgan manzil
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                      {foundGeoPin.short_address}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFoundGeoPin(null)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="text-xs text-slate-600 leading-relaxed">
                  {foundGeoPin.display_name}
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                  <span className="text-slate-500">Aniq koordinata:</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {foundGeoPin.lat}, {foundGeoPin.lng}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const geo = foundGeoPin;
                    startPinNewHouse();
                    setFoundGeoPin(null);
                    setPickedCoords({ lat: geo.lat, lng: geo.lng });
                    setNewAddress(geo.short_address);
                    if (mapInstanceRef.current) {
                      if (tempPinRef.current) {
                        tempPinRef.current.setLatLng([geo.lat, geo.lng]);
                      } else {
                        tempPinRef.current = L.marker([geo.lat, geo.lng], {
                          icon: L.divIcon({
                            className: 'ekadastr-pin-icon',
                            html: `<div style="width:30px;height:30px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.5);"></div>`,
                            iconSize: [30, 30],
                            iconAnchor: [15, 15],
                          }),
                        }).addTo(mapInstanceRef.current);
                      }
                    }
                  }}
                  className="w-full py-2 px-3 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Ushbu uy-joyni tizimga kiritish</span>
                </button>
              </div>
            )}
            {/* 1. Pin New House Form */}
            {interactionMode === 'pin_new' && (
              <form onSubmit={handleCreatePinnedHouse} className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <h3 className="text-sm font-bold text-slate-900">
                    Xarita orqali uy-joy kiritish
                  </h3>
                  <button
                    type="button"
                    onClick={() => setInteractionMode('browse')}
                    className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <div className="text-slate-500 mb-0.5">Tanlangan koordinata:</div>
                  {pickedCoords ? (
                    <div className="font-mono font-semibold text-blue-700">
                      {pickedCoords.lat}, {pickedCoords.lng}
                    </div>
                  ) : (
                    <div className="text-amber-700 font-medium">
                      Xaritadan uy tomi ustini bosing...
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Tuman
                    </label>
                    <select
                      value={newTumanId}
                      disabled={Boolean(currentUser.tuman_id)}
                      onChange={(e) => {
                        setNewTumanId(e.target.value);
                        const m = regions.find(
                          (r) => r.level === 'mahalla' && r.parent_id === Number(e.target.value)
                        );
                        setNewMahallaId(m ? String(m.id) : '');
                      }}
                      required
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      {tumanOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Mahalla
                    </label>
                    <select
                      value={newMahallaId}
                      disabled={Boolean(currentUser.mahalla_id)}
                      onChange={(e) => setNewMahallaId(e.target.value)}
                      required
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      {newFormMahallas.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Manzil (ko‘cha va uy raqami)
                  </label>
                  <input
                    type="text"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    required
                    placeholder="Masalan: Boburshoh ko‘chasi, 49-uy"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Obyekt turi
                    </label>
                    <select
                      value={newObjectType}
                      onChange={(e) => setNewObjectType(e.target.value as ObjectType)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="residential_house">Uy-joy binosi</option>
                      <option value="auxiliary_building">Qo‘shimcha bino</option>
                      <option value="land_parcel">Yer uchastkasi</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Kadastr raqami (agar ma’lum bo‘lsa)
                    </label>
                    <input
                      type="text"
                      value={newCadNum}
                      onChange={(e) => setNewCadNum(e.target.value)}
                      placeholder="17:03:..."
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Qurilgan yili
                    </label>
                    <input
                      type="number"
                      min={1850}
                      max={2030}
                      value={newBuiltYear}
                      onChange={(e) => setNewBuiltYear(e.target.value)}
                      placeholder="2015"
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Qavatlar
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={newFloorsCount}
                      onChange={(e) => setNewFloorsCount(e.target.value)}
                      placeholder="1"
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Xonalar
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={newRoomsCount}
                      onChange={(e) => setNewRoomsCount(e.target.value)}
                      placeholder="4"
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Yer (m²)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={newLandArea}
                      onChange={(e) => setNewLandArea(e.target.value)}
                      placeholder="600"
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Bino (m²)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={newBuildingArea}
                      onChange={(e) => setNewBuildingArea(e.target.value)}
                      placeholder="140"
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Devor
                    </label>
                    <select
                      value={newWallMaterial}
                      onChange={(e) => setNewWallMaterial(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Pishiq g‘isht">Pishiq g‘isht</option>
                      <option value="Xom g‘isht (suvoqli)">Xom g‘isht</option>
                      <option value="Shlakoblok">Shlakoblok</option>
                      <option value="Gazoblok">Gazoblok</option>
                      <option value="Temir-beton">Temir-beton</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Tekshiruv uchun izoh / xabar
                  </label>
                  <textarea
                    rows={2}
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!pickedCoords || submittingPin}
                  className="w-full py-2 px-4 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg cursor-pointer"
                >
                  {submittingPin ? 'Saqlanmoqda...' : 'Saqlash va tekshiruvga yuborish'}
                </button>
              </form>
            )}

            {/* 2. Fix Location Form */}
            {interactionMode === 'fix_location' && correctionTarget && (
              <form onSubmit={handleSaveLocationFix} className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {correctionTarget.system_uid}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Joylashuv koordinatasini belgilash
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInteractionMode('browse');
                      setCorrectionTarget(null);
                    }}
                    className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="text-xs text-slate-700">{correctionTarget.address}</div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                  <div className="text-slate-500">
                    Joriy koordinata:{' '}
                    <span className="font-mono text-slate-800">
                      {correctionTarget.latitude !== null
                        ? `${correctionTarget.latitude}, ${correctionTarget.longitude}`
                        : 'Mavjud emas'}
                    </span>
                  </div>
                  <div className="text-slate-500">
                    Yangi nuqta:{' '}
                    {pickedCoords ? (
                      <span className="font-mono font-semibold text-blue-700">
                        {pickedCoords.lat}, {pickedCoords.lng}
                      </span>
                    ) : (
                      <span className="text-amber-700">Xaritadan bosing...</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Tuzatish izohi
                  </label>
                  <textarea
                    rows={2}
                    value={correctionNote}
                    onChange={(e) => setCorrectionNote(e.target.value)}
                    placeholder="Masalan: Xaritada haqiqiy uy tomi markazi ko‘rsatildi..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!pickedCoords || submittingPin}
                  className="w-full py-2 px-4 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg cursor-pointer"
                >
                  {submittingPin
                    ? 'Yuborilmoqda...'
                    : currentUser.role === 'mahalla' && correctionTarget.latitude !== null
                    ? 'Tasdiqlash uchun yuborish'
                    : 'Koordinatani saqlash'}
                </button>
              </form>
            )}

            {/* 3. Selected Property Card Preview */}
            {interactionMode === 'browse' && selectedProperty && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-blue-700">
                      {selectedProperty.system_uid}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                      {selectedProperty.address}
                    </h3>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {selectedProperty.tuman_name} · {selectedProperty.mahalla_name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProperty(null);
                      setClickedHouseInfo(null);
                      setClickedCoords(null);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Xarita toifasi:</span>
                    <MarkerCategoryText color={selectedProperty.marker_color} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Kadastr holati:</span>
                    <CadastralStatusText status={selectedProperty.cadastral_status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Tekshiruv holati:</span>
                    <InspectionStatusText status={selectedProperty.inspection_status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Kadastr raqami:</span>
                    <span className="font-mono text-slate-900">
                      {selectedProperty.cadastral_number || 'Aniqlanmagan'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Obyekt turi:</span>
                    <span className="text-slate-800">
                      {OBJECT_TYPE_LABELS[selectedProperty.object_type]}
                    </span>
                  </div>

                  {/* Technical Building Passport Details directly inside Map Side Panel */}
                  <div className="pt-2.5 mt-2 border-t border-slate-200 space-y-2">
                    <div className="text-[11px] font-bold text-slate-900">
                      Uy-joy pasporti va texnik ma’lumotlari
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Qurilgan yili:</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {selectedProperty.built_year
                          ? `${selectedProperty.built_year}-yil`
                          : 'Kiritilmagan'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Qavatlar va xonalar:</span>
                      <span className="font-mono text-slate-900 tabular-nums">
                        {selectedProperty.floors_count
                          ? `${selectedProperty.floors_count} qavat`
                          : '—'}
                        {' · '}
                        {selectedProperty.rooms_count
                          ? `${selectedProperty.rooms_count} xona`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Umumiy yer maydoni:</span>
                      <span className="font-mono text-slate-900 tabular-nums">
                        {selectedProperty.land_area_m2
                          ? `${(selectedProperty.land_area_m2 / 100).toFixed(2)} sotix (${selectedProperty.land_area_m2} m²)`
                          : 'Kiritilmagan'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Qurilish maydoni:</span>
                      <span className="font-mono text-slate-900 tabular-nums">
                        {selectedProperty.building_area_m2
                          ? `${selectedProperty.building_area_m2} m²`
                          : 'Kiritilmagan'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 shrink-0">Devor materiali:</span>
                      <span className="text-slate-900 text-right">
                        {selectedProperty.wall_material || 'Kiritilmagan'}
                      </span>
                    </div>
                    {selectedProperty.utilities_info && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-slate-500 shrink-0">Kommunikatsiya:</span>
                        <span className="text-slate-800 text-right">
                          {selectedProperty.utilities_info}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Ro‘yxatga olingan:</span>
                      <span className="font-mono text-slate-800 tabular-nums">
                        {selectedProperty.registration_date || 'Rasmiylashtirilmagan'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-slate-500">Koordinata:</span>
                    <span className="font-mono text-slate-800 tabular-nums">
                      {selectedProperty.latitude !== null
                        ? `${selectedProperty.latitude}, ${selectedProperty.longitude}`
                        : 'Mavjud emas'}
                    </span>
                  </div>
                  {selectedProperty.notes && (
                    <div className="pt-2 border-t border-slate-100 text-slate-600 leading-relaxed">
                      {selectedProperty.notes}
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => onOpenPropertyCard(selectedProperty.id)}
                    className="w-full py-2 px-3 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                  >
                    To‘liq obyekt kartasi va tahrirlashni ochish
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onFindInList(selectedProperty.system_uid)}
                      className="py-1.5 px-2.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <List className="w-3.5 h-3.5" />
                      <span>Ro‘yxatda topish</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCorrectionTarget(selectedProperty);
                        setInteractionMode('fix_location');
                      }}
                      className="py-1.5 px-2.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Joylashuvni tuzatish</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Unlocated (Gray) Objects Tray */}
            {interactionMode === 'browse' && showUnlocatedPanel && (
              <div className="space-y-3 pt-2 border-t border-slate-200 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900">
                    Joylashuvi aniqlanmagan (Kulrang) obyektlar
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowUnlocatedPanel(false)}
                    className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    Yopish
                  </button>
                </div>

                {unlocatedItems.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Tanlangan hududda koordinatasiz obyektlar yo‘q.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                    {unlocatedItems.map((u) => (
                      <div key={u.id} className="p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold text-slate-900">
                            {u.system_uid}
                          </span>
                          <span className="text-[11px] text-slate-500">{u.mahalla_name}</span>
                        </div>
                        <div className="text-slate-700">{u.address}</div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              const m = regions.find((r) => r.id === u.mahalla_id);
                              if (m && mapInstanceRef.current) {
                                mapInstanceRef.current.setView([m.center_lat, m.center_lng], 17);
                              }
                              setCorrectionTarget(u);
                              setInteractionMode('fix_location');
                            }}
                            className="text-blue-700 hover:underline font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <MapPin className="w-3 h-3" />
                            <span>Xaritada belgilash</span>
                          </button>
                          <span className="text-slate-300">·</span>
                          <button
                            type="button"
                            onClick={() => onOpenPropertyCard(u.id)}
                            className="text-slate-600 hover:text-slate-900 underline cursor-pointer"
                          >
                            Karta
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
