import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Map as MapLibreMap, Popup } from 'maplibre-gl';
import type { MapGeoJSONFeature, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { TimelineDateEditor } from './TimelineDateEditor';
import { displayDay, playbackEndDay, selectTimelineMonth, TIMELINE_START, TIMELINE_END } from './timeline';
import type { DateEndpoint, DateRange } from './timeline';

interface PinProperties {
  id: string;
  title: string;
  category: string;
  root: string;
  date: string;
  day: number;
  location: string;
  description: string;
  url: string;
  source_type?: 'news' | 'science' | '';
}

type PinDataset = FeatureCollection<Point, PinProperties>;
type Theme = 'dark' | 'light';
type SourceType = 'news' | 'science';
type SourceFilter = 'all' | SourceType;
const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'news', label: 'News' },
  { value: 'science', label: 'Science' },
];
const PIN_LAYERS = ['pins-points', 'pins-news'];

function newsDiamondImage() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = (11 - Math.abs(x - 15.5) - Math.abs(y - 15.5)) / Math.SQRT2;
      // MapLibre's SDF shader places the shape edge at alpha 0.75, with an 8px distance range.
      const alpha = Math.max(0, Math.min(255, Math.round(255 * (.75 + distance / 8))));
      data.set([255, 255, 255, alpha], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

const MAP_STYLES: Record<Theme, string> = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
};

function savedTheme(): Theme {
  try {
    return localStorage.getItem('atlas-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function updateMapVisibility(map: MapLibreMap, visible: boolean, defaults: Map<string, 'visible' | 'none'>) {
  for (const [id, visibility] of defaults) {
    // A theme swap can replace the style before React runs a visibility effect.
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? visibility : 'none');
  }
}

function sidebarLimits(viewportWidth: number) {
  const max = Math.max(0, Math.min(640, viewportWidth - (viewportWidth <= 760 ? 40 : 320)));
  return { min: Math.min(260, max), max };
}

type CategoryNode = {
  name: string;
  path: string;
  count: number;
  paths: string[];
  children: CategoryNode[];
};

const DATA_URL = `${import.meta.env.BASE_URL}data/pins.geojson`;
const COLORS: Record<string, string> = {
  Research: '#73c4ff',
  Industry: '#f6bd65',
  Community: '#b3a1ff',
};
const COLOR_PALETTE = ['#73c4ff', '#f6bd65', '#b3a1ff', '#70e2be', '#f48f9c', '#e1b8eb'];

function colorForRoot(root: string, roots: string[]) {
  return COLORS[root] || COLOR_PALETTE[roots.indexOf(root) % COLOR_PALETTE.length] || '#73c4ff';
}

function lowerBound(a: number[], x: number): number {
  let low = 0, high = a.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (a[mid] < x) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(a: number[], x: number): number {
  let low = 0, high = a.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (a[mid] <= x) low = mid + 1;
    else high = mid;
  }
  return low;
}

function buildCategoryTree(categoryCounts: Map<string, number>): CategoryNode[] {
  const root: CategoryNode = { name: '', path: '', count: 0, paths: [], children: [] };
  for (const [fullPath, count] of categoryCounts) {
    let current = root;
    let path = '';
    for (const part of fullPath.split(' / ')) {
      path = path ? `${path} / ${part}` : part;
      let child = current.children.find((n) => n.name === part);
      if (!child) {
        child = { name: part, path, count: 0, paths: [], children: [] };
        current.children.push(child);
      }
      child.count += count;
      current = child;
    }
  }
  function fillPaths(node: CategoryNode): string[] {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    const paths = categoryCounts.has(node.path) ? [node.path] : [];
    for (const child of node.children) paths.push(...fillPaths(child));
    node.paths = paths;
    return paths;
  }
  root.children.sort((a, b) => a.name.localeCompare(b.name));
  root.children.forEach(fillPaths);
  return root.children;
}

function safeLink(value: unknown) {
  try {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function appendText(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, text: string, className: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function showPopup(map: MapLibreMap, feature: MapGeoJSONFeature) {
  if (feature.geometry.type !== 'Point') return null;
  const p = feature.properties as Partial<PinProperties>;
  const content = document.createElement('div');
  content.className = 'pin-popup';
  appendText(content, 'div', String(p.category || 'Uncategorized'), 'pin-popup-category');
  appendText(content, 'h3', String(p.title || 'Untitled'), 'pin-popup-title');
  const meta = [p.location, p.date].filter(Boolean).join(' · ');
  if (meta) appendText(content, 'p', meta, 'pin-popup-meta');
  if (p.description) appendText(content, 'p', String(p.description), 'pin-popup-description');
  const url = safeLink(p.url);
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    link.className = 'pin-popup-link';
    link.textContent = 'Explore link ↗';
    content.appendChild(link);
  }
  return new Popup({ closeButton: true, closeOnClick: true, offset: 15, maxWidth: '320px' })
    .setLngLat(feature.geometry.coordinates as [number, number])
    .setDOMContent(content)
    .addTo(map);
}

function CategoryItem({ node, selected, onToggle, depth = 0, roots }: {
  node: CategoryNode;
  selected: Set<string>;
  onToggle: (paths: string[], active: boolean) => void;
  depth?: number;
  roots: string[];
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const activeCount = node.paths.filter((p) => selected.has(p)).length;
  const checked = activeCount === node.paths.length && activeCount > 0;
  const partial = activeCount > 0 && !checked;
  const isRoot = depth === 0;
  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = partial;
  }, [partial]);
  return (
    <div className={`category-node ${isRoot ? 'category-root' : ''}`}>
      <label className="category-option" style={{ paddingLeft: `${depth * 16}px` }}>
        <input ref={checkboxRef} type="checkbox" checked={checked}
          onChange={(e) => onToggle(node.paths, e.target.checked)} />
        {isRoot && <span className="category-swatch" style={{ background: colorForRoot(node.name, roots) }} />}
        <span className="category-label" title={node.path}>{node.name}</span>
        <span className="category-count">{node.count}</span>
      </label>
      {node.children.map((child) => (
        <CategoryItem key={child.path} node={child} selected={selected}
          onToggle={onToggle} depth={depth + 1} roots={roots} />
      ))}
    </div>
  );
}

export default function App() {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<PinDataset | null>(null);
  const [loadingError, setLoadingError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState('');
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const activeThemeRef = useRef(theme);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [dateRange, setDateRange] = useState<DateRange>([TIMELINE_START, TIMELINE_END]);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const timelinePlaybackRef = useRef<number | null>(null);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [projection, setProjection] = useState<'globe' | 'mercator'>('globe');
  const [autoRotate, setAutoRotate] = useState(true);
  const pinHoveredRef = useRef(false);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const labelsVisibleRef = useRef(labelsVisible);
  const labelLayerDefaultsRef = useRef(new Map<string, 'visible' | 'none'>());
  const [bordersVisible, setBordersVisible] = useState(true);
  const bordersVisibleRef = useRef(bordersVisible);
  const borderLayerDefaultsRef = useRef(new Map<string, 'visible' | 'none'>());
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 761px)').matches);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(() => window.innerWidth <= 760
    ? Math.min(342, Math.round(window.innerWidth * .88))
    : window.innerWidth <= 1050 ? 288 : 324);
  const [isResizing, setIsResizing] = useState(false);
  const resizePointerRef = useRef<{ id: number; startX: number; startWidth: number } | null>(null);
  const sidebarBounds = sidebarLimits(viewportWidth);
  const effectiveSidebarWidth = Math.max(sidebarBounds.min, Math.min(sidebarBounds.max, sidebarWidth));
  const projectionRef = useRef(projection);
  const isLoading = (mapLoading || !data) && !loadingError && !mapError;

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizePointerRef.current = { id: event.pointerId, startX: event.clientX, startWidth: effectiveSidebarWidth };
    setIsResizing(true);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = resizePointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const width = Math.round(pointer.startWidth + pointer.startX - event.clientX);
    setSidebarWidth(Math.max(sidebarBounds.min, Math.min(sidebarBounds.max, width)));
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (resizePointerRef.current?.id !== event.pointerId) return;
    resizePointerRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    try {
      localStorage.setItem('atlas-theme', theme);
    } catch {
      // The theme still works when browser privacy settings disable storage.
    }
  }, [theme]);

  const index = useMemo(() => {
    const daysByCategory = new Map<string, number[]>();
    const countByCategory = new Map<string, number>();
    const daysBySource = new Map<SourceType, Map<string, number[]>>([
      ['news', new Map()], ['science', new Map()],
    ]);
    for (const feature of data?.features || []) {
      const p = feature.properties;
      if (!Number.isFinite(p.day)) continue;
      if (!daysByCategory.has(p.category)) daysByCategory.set(p.category, []);
      daysByCategory.get(p.category)!.push(p.day);
      if (p.source_type === 'news' || p.source_type === 'science') {
        const categories = daysBySource.get(p.source_type)!;
        if (!categories.has(p.category)) categories.set(p.category, []);
        categories.get(p.category)!.push(p.day);
      }
      countByCategory.set(p.category, (countByCategory.get(p.category) || 0) + 1);
    }
    for (const a of daysByCategory.values()) a.sort((x, y) => x - y);
    for (const categories of daysBySource.values()) {
      for (const days of categories.values()) days.sort((x, y) => x - y);
    }
    const tree = buildCategoryTree(countByCategory);
    return { daysByCategory, daysBySource, tree, roots: tree.map((c) => c.name) };
  }, [data]);

  const total = data?.features.length || 0;
  const sourceCounts = useMemo(() => {
    const counts = { all: 0, news: 0, science: 0 };
    const countDays = (days: number[] | undefined) => days
      ? upperBound(days, dateRange[1]) - lowerBound(days, dateRange[0]) : 0;
    for (const key of selected) {
      counts.all += countDays(index.daysByCategory.get(key));
      counts.news += countDays(index.daysBySource.get('news')?.get(key));
      counts.science += countDays(index.daysBySource.get('science')?.get(key));
    }
    return counts;
  }, [selected, dateRange, index]);
  const visibleCount = sourceCounts[sourceFilter];

  useEffect(() => {
    const controller = new AbortController();
    fetch(DATA_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw Error(`Couldn't load ${DATA_URL} (HTTP ${response.status}).`);
        return response.json() as Promise<PinDataset>;
      })
      .then((dataset) => {
        if (dataset.type !== 'FeatureCollection' || !Array.isArray(dataset.features)) {
          throw Error('Data is not a GeoJSON FeatureCollection.');
        }
        setData(dataset);
        setSelected(new Set(dataset.features.map((f) => f.properties.category)));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadingError(String(error));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!elementRef.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: elementRef.current,
        style: MAP_STYLES[activeThemeRef.current],
        center: [12, 18], zoom: 1.65,
        attributionControl: {
          customAttribution: 'Powered by <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a> &amp; <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>',
        },
        maxZoom: 17,
        renderWorldCopies: false,
      });
    } catch (error) {
      setMapError(error instanceof Error ? error.message : String(error));
      return;
    }
    mapRef.current = map;
    // Expanding or collapsing the pane changes the map's available width.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(elementRef.current);
    const onStyleLoad = () => {
      map.setProjection({ type: projectionRef.current });
      const labelDefaults = new Map<string, 'visible' | 'none'>();
      const borderDefaults = new Map<string, 'visible' | 'none'>();
      for (const layer of map.getStyle().layers) {
        if (layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined) {
          labelDefaults.set(layer.id, layer.layout.visibility === 'none' ? 'none' : 'visible');
        }
        if (layer.type === 'line' && layer['source-layer'] === 'boundary') {
          borderDefaults.set(layer.id, layer.layout?.visibility === 'none' ? 'none' : 'visible');
        }
      }
      labelLayerDefaultsRef.current = labelDefaults;
      borderLayerDefaultsRef.current = borderDefaults;
      updateMapVisibility(map, labelsVisibleRef.current, labelDefaults);
      updateMapVisibility(map, bordersVisibleRef.current, borderDefaults);
      map.addSource('pins', {
        type: 'geojson', data: DATA_URL, generateId: true, maxzoom: 12,
      });
      // Category-driven colors are assigned after the CSV metadata is loaded.
      const initialColor = '#73c4ff';
      map.addLayer({
        id: 'pins-halo', type: 'circle', source: 'pins',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 4, 12, 9, 17],
          'circle-color': initialColor,
          'circle-opacity': 0.16,
          'circle-blur': 0.75,
        },
      });
      map.addLayer({
        id: 'pins-points', type: 'circle', source: 'pins',
        filter: ['!=', ['get', 'source_type'], 'news'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.8, 4, 5.4, 9, 7.5],
          'circle-color': initialColor,
          'circle-stroke-color': '#07131f',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.96,
        },
      });
      map.addImage('news-diamond', newsDiamondImage(), { sdf: true, pixelRatio: 2 });
      map.addLayer({
        id: 'pins-news', type: 'symbol', source: 'pins',
        filter: ['==', ['get', 'source_type'], 'news'],
        layout: {
          'icon-image': 'news-diamond',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 0, .9, 4, 1.3, 9, 1.8],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
        },
        paint: {
          'icon-color': initialColor,
          'icon-halo-color': '#07131f',
          'icon-halo-width': 1.3,
          'icon-opacity': .96,
        },
      });
      setMapReady(true);
    };
    // Styles replace custom sources/layers, so restore the pins after each swap.
    map.on('style.load', onStyleLoad);
    map.on('idle', () => {
      setMapLoading(false);
      setMapError('');
    });
    map.on('error', (event) => setMapError(event.error.message));
    for (const layer of PIN_LAYERS) {
      map.on('mouseenter', layer, () => {
        pinHoveredRef.current = true;
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        pinHoveredRef.current = false;
        map.getCanvas().style.cursor = '';
      });
      map.on('click', layer, (event) => {
        const pin = event.features?.[0];
        if (pin) {
          popupRef.current?.remove();
          popupRef.current = showPopup(map, pin);
        }
      });
    }
    return () => {
      resizeObserver.disconnect();
      popupRef.current?.remove();
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || activeThemeRef.current === theme) return;
    activeThemeRef.current = theme;
    popupRef.current?.remove();
    pinHoveredRef.current = false;
    setMapReady(false);
    setMapLoading(true);
    setMapError('');
    map.setStyle(MAP_STYLES[theme], { diff: false });
  }, [theme]);

  useEffect(() => {
    projectionRef.current = projection;
    if (mapReady) mapRef.current?.setProjection({ type: projection });
  }, [projection, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mapLoading || !autoRotate || projection !== 'globe') return;
    let frame = 0;
    let previous = 0;
    const rotate = (now: number) => {
      const seconds = previous ? Math.min(now - previous, 64) / 1000 : 0;
      previous = now;
      if (document.visibilityState === 'visible' && !map.isMoving() && !resizePointerRef.current
        && !pinHoveredRef.current && !popupRef.current?.isOpen()) {
        const center = map.getCenter();
        const speed = 2 / 2 ** Math.max(0, map.getZoom() - 1.65);
        map.setCenter([((center.lng + speed * seconds + 540) % 360) - 180, center.lat]);
      }
      frame = requestAnimationFrame(rotate);
    };
    frame = requestAnimationFrame(rotate);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate, projection, mapReady, mapLoading]);

  useEffect(() => {
    if (!timelinePlaying) return;
    const startingEnd = timelinePlaybackRef.current ?? TIMELINE_START;
    let previous = performance.now();
    let elapsed = 0;
    const resetClock = () => { previous = performance.now(); };
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.max(0, Math.min(now - previous, 500));
      previous = now;
      if (document.hidden) return;
      elapsed += delta;
      const end = playbackEndDay(startingEnd, elapsed);
      timelinePlaybackRef.current = end;
      setDateRange([TIMELINE_START, end]);
      if (end === TIMELINE_END) {
        timelinePlaybackRef.current = null;
        setTimelinePlaying(false);
      }
    }, 100);
    document.addEventListener('visibilitychange', resetClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resetClock);
    };
  }, [timelinePlaying]);

  function pauseTimeline() {
    setTimelinePlaying(false);
  }

  function toggleTimelinePlayback() {
    if (timelinePlaying) {
      pauseTimeline();
      return;
    }
    const end = timelinePlaybackRef.current ?? TIMELINE_START;
    timelinePlaybackRef.current = end;
    setDateRange([TIMELINE_START, end]);
    setTimelinePlaying(true);
  }

  function editTimelineMonth(endpoint: DateEndpoint, year: number, month: number) {
    pauseTimeline();
    timelinePlaybackRef.current = null;
    setDateRange((range) => selectTimelineMonth(range, endpoint, year, month));
  }

  function editTimelineDay(endpoint: DateEndpoint, day: number) {
    pauseTimeline();
    timelinePlaybackRef.current = null;
    setDateRange(([start, end]) => endpoint === 'from' ? [Math.min(day, end), end] : [start, Math.max(day, start)]);
  }

  useEffect(() => {
    labelsVisibleRef.current = labelsVisible;
    const map = mapRef.current;
    if (mapReady && map) updateMapVisibility(map, labelsVisible, labelLayerDefaultsRef.current);
  }, [labelsVisible, mapReady]);

  useEffect(() => {
    bordersVisibleRef.current = bordersVisible;
    const map = mapRef.current;
    if (mapReady && map) updateMapVisibility(map, bordersVisible, borderLayerDefaultsRef.current);
  }, [bordersVisible, mapReady]);

  // Build map/legend colors from *any* top-level categories in the input CSV.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer('pins-points') || !index.roots.length) return;
    const expression: unknown[] = ['match', ['get', 'root']];
    for (const root of index.roots) expression.push(root, colorForRoot(root, index.roots));
    expression.push('#73c4ff');
    for (const layer of ['pins-points', 'pins-halo']) {
      map.setPaintProperty(layer, 'circle-color', expression as ExpressionSpecification);
    }
    map.setPaintProperty('pins-news', 'icon-color', expression as ExpressionSpecification);
  }, [mapReady, index]);

  const selectedKey = useMemo(() => [...selected].sort().join('\u001f'), [selected]);
  useEffect(() => {
    if (!mapReady || !data) return;
    const frame = requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map?.getLayer('pins-points')) return;
      const filter: ExpressionSpecification = selected.size ? [
        'all',
        ['>=', ['get', 'day'], dateRange[0]],
        ['<=', ['get', 'day'], dateRange[1]],
        ['in', ['get', 'category'], ['literal', [...selected]]],
        sourceFilter === 'all' ? ['literal', true] : ['==', ['get', 'source_type'], sourceFilter],
      ] : ['literal', false];
      map.setFilter('pins-halo', filter);
      map.setFilter('pins-points', ['all', filter, ['!=', ['get', 'source_type'], 'news']]);
      map.setFilter('pins-news', ['all', filter, ['==', ['get', 'source_type'], 'news']]);
      popupRef.current?.remove();
    });
    return () => cancelAnimationFrame(frame);
  }, [mapReady, data, dateRange, selected, selectedKey, sourceFilter]);

  function toggleCategory(paths: string[], active: boolean) {
    setSelected((previous) => {
      const updated = new Set(previous);
      for (const p of paths) active ? updated.add(p) : updated.delete(p);
      return updated;
    });
  }

  function resetFilters() {
    pauseTimeline();
    timelinePlaybackRef.current = null;
    setSelected(new Set(index.daysByCategory.keys()));
    setDateRange([TIMELINE_START, TIMELINE_END]);
    setSourceFilter('all');
  }

  const span = TIMELINE_END - TIMELINE_START;
  const percentFrom = ((dateRange[0] - TIMELINE_START) / span) * 100;
  const percentTo = ((dateRange[1] - TIMELINE_START) / span) * 100;

  return (
    <div className={`app-shell ${sidebarOpen ? 'filters-open' : 'filters-closed'} ${isResizing ? 'is-resizing' : ''}`}
      data-theme={theme} style={{ '--sidebar-width': `${effectiveSidebarWidth}px` } as CSSProperties}>
      <main className="map-stage">
        <div className="map-canvas" ref={elementRef} aria-label="Interactive map with location pins" aria-busy={isLoading} />
        <div className="map-vignette" aria-hidden="true" />
        {isLoading && <div className="map-loading" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <strong>Loading…</strong>
          <span>Preparing your map and locations</span>
        </div>}
        <div className="map-header">
          <div className="brand-lockup">
            <div className="brand-symbol" aria-hidden="true">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width="41" height="41" />
            </div>
            <div><div className="brand-name">Demand Management Atlas</div>
              <div className="brand-subtitle">Global Evidence Map for Transport Demand Management</div>
              <div className="legend-columns">
                <div className="legend-items source-legend" role="list" aria-label="Source shapes">
                  <div className="legend-item" role="listitem"><span className="legend-shape science-shape" aria-hidden="true" /><span>Science</span></div>
                  <div className="legend-item" role="listitem"><span className="legend-shape news-shape" aria-hidden="true" /><span>News</span></div>
                </div>
                <div className="legend-items category-legend" role="list" aria-label="Category colors">
                  {index.roots.map((root) => <div key={root} className="legend-item" role="listitem">
                    <span className="legend-dot" style={{ background: colorForRoot(root, index.roots) }} />
                    <span>{root}</span>
                  </div>)}
                </div>
              </div>
            </div>
          </div>
        </div>
        {(loadingError || mapError) && <div className="status-error" role="alert">
          <strong>Unable to load the map</strong>
          <p>{loadingError || mapError}</p>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </div>}
        <section className={`timeline ${timelineCollapsed ? 'is-collapsed' : ''}`} aria-label="Filter pins by date range">
          <div className="timeline-head">
            <button type="button" className="timeline-heading timeline-toggle" onClick={() => {
              pauseTimeline();
              setTimelineCollapsed((collapsed) => !collapsed);
            }}
              aria-expanded={!timelineCollapsed} aria-controls="timeline-details"
              aria-label={timelineCollapsed ? 'Expand timeline filter' : 'Collapse timeline filter'}
              title={timelineCollapsed ? 'Expand timeline filter' : 'Collapse timeline filter'}>
              <span className="timeline-icon" aria-hidden="true">◷</span>
              <strong>Timeline Filter</strong>
            </button>
            {!timelineCollapsed && <div className="timeline-current">{data ? `${visibleCount.toLocaleString()} / ${total.toLocaleString()} locations` : 'Loading…'}</div>}
          </div>
          <div className="timeline-details" id="timeline-details" hidden={timelineCollapsed}>
            <div className="timeline-range-values">
              <TimelineDateEditor endpoint="from" day={dateRange[0]} disabled={!data} onBeginEdit={pauseTimeline}
                onChange={(year, month) => editTimelineMonth('from', year, month)} />
              <span>TO</span>
              <TimelineDateEditor endpoint="to" day={dateRange[1]} disabled={!data} onBeginEdit={pauseTimeline}
                onChange={(year, month) => editTimelineMonth('to', year, month)} />
            </div>
            <div className="timeline-slider-row">
              <div className="range-shell">
                <div className="range-track" />
                <div className="range-active" style={{ left: `${percentFrom}%`, right: `${100 - percentTo}%` }} />
                <input aria-label="Earliest date" type="range" min={TIMELINE_START} max={TIMELINE_END}
                  value={dateRange[0]} disabled={!data} onPointerDown={pauseTimeline}
                  onChange={(event) => editTimelineDay('from', Number(event.target.value))} />
                <input aria-label="Latest date" type="range" min={TIMELINE_START} max={TIMELINE_END}
                  value={dateRange[1]} disabled={!data} onPointerDown={pauseTimeline}
                  onChange={(event) => editTimelineDay('to', Number(event.target.value))} />
              </div>
              <button type="button" className="timeline-play-toggle" aria-label="Animate timeline" aria-pressed={timelinePlaying}
                title={timelinePlaying ? 'Pause timeline animation' : 'Animate timeline from 1960 to 2025'}
                disabled={!data} onClick={toggleTimelinePlayback}>A</button>
            </div>
            <div className="timeline-foot"><span>{displayDay(TIMELINE_START)}</span><span>{displayDay(TIMELINE_END)}</span></div>
          </div>
        </section>
        <footer className="map-footer" aria-label="Map controls">
          <span className="map-control-spacer" aria-hidden="true" />
          <button type="button" className="map-control zoom-in" title="Zoom in" aria-label="Zoom in" disabled={!mapReady}
            onClick={() => mapRef.current?.zoomIn({ duration: 250 })}>+</button>
          <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              {theme === 'dark' ? <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
              </> : <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />}
            </svg>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="map-control rotation-toggle" aria-label="Automatic globe rotation" aria-pressed={autoRotate}
            data-active={autoRotate && projection === 'globe'} title={autoRotate ? 'Pause globe rotation' : 'Start globe rotation'}
            onClick={() => setAutoRotate((rotate) => !rotate)}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7h14M5 17h14" />
            </svg>
            <span className="rotation-letter" aria-hidden="true">R</span>
          </button>
          <button type="button" className="map-control zoom-out" title="Zoom out" aria-label="Zoom out" disabled={!mapReady}
            onClick={() => mapRef.current?.zoomOut({ duration: 250 })}>−</button>
          <div className="map-visibility-controls" role="group" aria-label="Map details">
            <button type="button" className="map-control visibility-toggle labels-toggle" aria-label="Map labels" aria-pressed={labelsVisible}
              onClick={() => setLabelsVisible((visible) => !visible)}>
              Labels <span className="visibility-state" aria-hidden="true">{labelsVisible ? 'On' : 'Off'}</span>
            </button>
            <button type="button" className="map-control visibility-toggle borders-toggle" aria-label="Map borders" aria-pressed={bordersVisible}
              onClick={() => setBordersVisible((visible) => !visible)}>
              Borders <span className="visibility-state" aria-hidden="true">{bordersVisible ? 'On' : 'Off'}</span>
            </button>
          </div>
          <span className="map-control-spacer" aria-hidden="true" />
          <button type="button" className="icon-button reset-view" title="Reset map view" aria-label="Reset map view"
            disabled={!mapReady}
            onClick={() => mapRef.current?.flyTo({ center: [12, 18], zoom: 1.65, duration: 900 })}>
            <span aria-hidden="true">↺</span>
          </button>
          <div className="projection-switch" role="group" aria-label="Map projection">
            <button type="button" className={projection === 'globe' ? 'active' : ''} aria-pressed={projection === 'globe'}
              onClick={() => setProjection('globe')}>◉ Globe</button>
            <button type="button" className={projection === 'mercator' ? 'active' : ''} aria-pressed={projection === 'mercator'}
              onClick={() => setProjection('mercator')}>▤ Map</button>
          </div>
        </footer>
      </main>

      {sidebarOpen && <div className="sidebar-divider" role="separator" tabIndex={0}
        aria-label="Resize category filters" aria-controls="category-filters" aria-orientation="vertical"
        aria-valuemin={sidebarBounds.min} aria-valuemax={sidebarBounds.max} aria-valuenow={effectiveSidebarWidth}
        aria-valuetext={`${effectiveSidebarWidth} pixels`} title="Drag to resize filters"
        onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={finishResize}
        onPointerCancel={finishResize} onLostPointerCapture={finishResize}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 48 : 24;
          const widths: Record<string, number> = {
            ArrowLeft: effectiveSidebarWidth + step,
            ArrowRight: effectiveSidebarWidth - step,
            Home: sidebarBounds.min,
            End: sidebarBounds.max,
          };
          if (event.key in widths) {
            event.preventDefault();
            setSidebarWidth(Math.max(sidebarBounds.min, Math.min(sidebarBounds.max, widths[event.key])));
          }
        }} />}
      <button type="button" className="filters-toggle" ref={filterToggleRef}
        onClick={() => setSidebarOpen((open) => !open)} aria-expanded={sidebarOpen} aria-controls="category-filters"
        aria-label={sidebarOpen ? 'Collapse filters' : 'Expand filters'} title={sidebarOpen ? 'Collapse filters' : 'Expand filters'}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d={sidebarOpen ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
        </svg>
      </button>
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} id="category-filters" aria-label="Category filters"
        aria-hidden={!sidebarOpen} inert={!sidebarOpen} onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setSidebarOpen(false);
            filterToggleRef.current?.focus();
          }
        }}>
        <div className="sidebar-top">
          <h2>Category Filter</h2>
          <p>Browse global evidence by category and source.</p>
          <div className="side-summary">
            <div className="summary-icon">⌖</div>
            <div><strong>{visibleCount.toLocaleString()}</strong><span>matching locations</span></div>
            <span className="summary-total">of {total.toLocaleString()}</span>
          </div>
          <div className="source-type-filter" role="group" aria-label="Source Type">
            <div className="source-type-heading">Source Type</div>
            <div className="source-type-options">
              {SOURCE_FILTERS.map(({ value, label }) => <button key={value} type="button"
                data-source={value} aria-pressed={sourceFilter === value} disabled={!data}
                onClick={() => setSourceFilter(value)}>
                {label}<span>{sourceCounts[value].toLocaleString()}</span>
              </button>)}
            </div>
          </div>
        </div>
        <div className="sidebar-label-row"><span>ALL CATEGORIES</span><span>{selected.size} SELECTED</span></div>
        <div className="category-scroll">
          {index.tree.map((node) => <CategoryItem key={node.path} node={node} selected={selected}
            onToggle={toggleCategory} roots={index.roots} />)}
          {!data && <div className="loading-categories">Loading categories…</div>}
        </div>
        <div className="sidebar-bottom">
          <button type="button" className="reset-filters" onClick={resetFilters} disabled={!data}>
            <span>↺</span> Reset all filters
          </button>
        </div>
      </aside>
    </div>
  );
}
