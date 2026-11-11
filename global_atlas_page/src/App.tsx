import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl, Popup } from 'maplibre-gl';
import type { MapGeoJSONFeature, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';

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
}

type PinDataset = FeatureCollection<Point, PinProperties>;
type Theme = 'dark' | 'light';

const MAP_STYLES: Record<Theme, string> = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
};

function savedTheme(): Theme {
  try {
    return localStorage.getItem('atlas-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
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

function displayDay(day: number) {
  return new Date(day * 86400000).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  });
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
  const [data, setData] = useState<PinDataset | null>(null);
  const [loadingError, setLoadingError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState('');
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const activeThemeRef = useRef(theme);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState<[number, number]>([0, 0]);
  const [projection, setProjection] = useState<'globe' | 'mercator'>('globe');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const projectionRef = useRef(projection);
  const isLoading = (mapLoading || !data) && !loadingError && !mapError;

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
    let min = Infinity, max = -Infinity;
    for (const feature of data?.features || []) {
      const p = feature.properties;
      if (!Number.isFinite(p.day)) continue;
      min = Math.min(min, p.day);
      max = Math.max(max, p.day);
      if (!daysByCategory.has(p.category)) daysByCategory.set(p.category, []);
      daysByCategory.get(p.category)!.push(p.day);
      countByCategory.set(p.category, (countByCategory.get(p.category) || 0) + 1);
    }
    for (const a of daysByCategory.values()) a.sort((x, y) => x - y);
    const tree = buildCategoryTree(countByCategory);
    return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0,
      daysByCategory, tree, roots: tree.map((c) => c.name) };
  }, [data]);

  const total = data?.features.length || 0;
  const visibleCount = useMemo(() => {
    let n = 0;
    for (const key of selected) {
      const days = index.daysByCategory.get(key);
      if (days) n += upperBound(days, dateRange[1]) - lowerBound(days, dateRange[0]);
    }
    return n;
  }, [selected, dateRange, index]);

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
        // Avoid Math.min(...days): spreading large arrays can exceed JS argument limits.
        let earliest = Infinity, latest = -Infinity;
        for (const feature of dataset.features) {
          const d = feature.properties.day;
          if (Number.isFinite(d)) {
            earliest = Math.min(earliest, d);
            latest = Math.max(latest, d);
          }
        }
        setDateRange([Number.isFinite(earliest) ? earliest : 0,
          Number.isFinite(latest) ? latest : 0]);
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
        attributionControl: {},
        maxZoom: 17,
        renderWorldCopies: false,
      });
    } catch (error) {
      setMapError(error instanceof Error ? error.message : String(error));
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-left');
    const onStyleLoad = () => {
      map.setProjection({ type: projectionRef.current });
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
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.8, 4, 5.4, 9, 7.5],
          'circle-color': initialColor,
          'circle-stroke-color': '#07131f',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.96,
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
    map.on('mouseenter', 'pins-points', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'pins-points', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'pins-points', (event) => {
      const pin = event.features?.[0];
      if (pin) {
        popupRef.current?.remove();
        popupRef.current = showPopup(map, pin);
      }
    });
    return () => {
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
    setMapReady(false);
    setMapLoading(true);
    setMapError('');
    map.setStyle(MAP_STYLES[theme], { diff: false });
  }, [theme]);

  useEffect(() => {
    projectionRef.current = projection;
    if (mapReady) mapRef.current?.setProjection({ type: projection });
  }, [projection, mapReady]);

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
  }, [mapReady, index]);

  const selectedKey = useMemo(() => [...selected].sort().join('\u001f'), [selected]);
  useEffect(() => {
    if (!mapReady || !data) return;
    const frame = requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map?.getLayer('pins-points')) return;
      const filter: Parameters<MapLibreMap['setFilter']>[1] = selected.size ? [
        'all',
        ['>=', ['get', 'day'], dateRange[0]],
        ['<=', ['get', 'day'], dateRange[1]],
        ['in', ['get', 'category'], ['literal', [...selected]]],
      ] : ['literal', false];
      map.setFilter('pins-halo', filter);
      map.setFilter('pins-points', filter);
      popupRef.current?.remove();
    });
    return () => cancelAnimationFrame(frame);
  }, [mapReady, data, dateRange, selected, selectedKey]);

  function toggleCategory(paths: string[], active: boolean) {
    setSelected((previous) => {
      const updated = new Set(previous);
      for (const p of paths) active ? updated.add(p) : updated.delete(p);
      return updated;
    });
  }

  function resetFilters() {
    setSelected(new Set(index.daysByCategory.keys()));
    setDateRange([index.min, index.max]);
  }

  const span = Math.max(1, index.max - index.min);
  const percentFrom = ((dateRange[0] - index.min) / span) * 100;
  const percentTo = ((dateRange[1] - index.min) / span) * 100;

  return (
    <div className="app-shell" data-theme={theme}>
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
            <div className="brand-symbol" aria-hidden="true">◎</div>
            <div><div className="brand-name">GLOBAL ATLAS<span className="brand-dot">.</span></div>
              <div className="brand-subtitle">An interactive timeline of places</div></div>
          </div>
          <span className="live-chip"><span /> OPEN DATA EXPLORER</span>
        </div>
        <div className="map-actions">
          <div className="projection-switch" role="group" aria-label="Map projection">
            <button type="button" className={projection === 'globe' ? 'active' : ''}
              onClick={() => setProjection('globe')}>◉ Globe</button>
            <button type="button" className={projection === 'mercator' ? 'active' : ''}
              onClick={() => setProjection('mercator')}>▤ Map</button>
          </div>
          <button type="button" className="icon-button reset-view" title="Reset map view"
            onClick={() => mapRef.current?.flyTo({ center: [12, 18], zoom: 1.65, duration: 900 })}>↗</button>
          <button type="button" className="mobile-filters" onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-expanded={sidebarOpen}>☷ Filters</button>
        </div>
        <div className="map-legend" aria-label="Map key">
          <div className="eyebrow">EXPLORE YOUR DATA</div>
          <h1>Places across<br /><em>time & space.</em></h1>
          <p>Drag the globe, select a pin, or narrow your view by date and category.</p>
          <div className="legend-items">
            {index.roots.map((root) => <div key={root} className="legend-item">
              <span className="legend-dot" style={{ background: colorForRoot(root, index.roots) }} />{root}
            </div>)}
          </div>
        </div>
        {(loadingError || mapError) && <div className="status-error" role="alert">
          <strong>Unable to load the map</strong>
          <p>{loadingError || mapError}</p>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </div>}
        <section className="timeline" aria-label="Filter pins by date range">
          <div className="timeline-head">
            <div className="timeline-heading"><span className="timeline-icon">◷</span>
              <div><div className="eyebrow">TEMPORAL FILTER</div><strong>Timeline</strong></div>
            </div>
            <div className="timeline-current">{data ? `${visibleCount.toLocaleString()} / ${total.toLocaleString()} locations` : 'Loading…'}</div>
          </div>
          <div className="timeline-range-values">
            <output>{displayDay(dateRange[0])}</output><span>TO</span><output>{displayDay(dateRange[1])}</output>
          </div>
          <div className="range-shell">
            <div className="range-track" />
            <div className="range-active" style={{ left: `${percentFrom}%`, right: `${100 - percentTo}%` }} />
            <input aria-label="Earliest date" type="range" min={index.min} max={index.max}
              value={dateRange[0]} disabled={!data || index.max === index.min}
              onChange={(event) => setDateRange(([_, end]) => [Math.min(Number(event.target.value), end), end])} />
            <input aria-label="Latest date" type="range" min={index.min} max={index.max}
              value={dateRange[1]} disabled={!data || index.max === index.min}
              onChange={(event) => setDateRange(([start]) => [start, Math.max(Number(event.target.value), start)])} />
          </div>
          <div className="timeline-foot"><span>{displayDay(index.min)}</span><span>{displayDay(index.max)}</span></div>
        </section>
        <footer className="map-footer">
          <div className="map-footnote">Powered by MapLibre & OpenFreeMap <span>·</span> Demo data — replace with your CSV</div>
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
        </footer>
      </main>

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="Category filters">
        <div className="sidebar-top">
          <div><div className="eyebrow">REFINE YOUR VIEW</div><h2>Explore categories</h2></div>
          <button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close filters">×</button>
          <p>Browse a hierarchical collection of pins. Select any group to filter the globe.</p>
        </div>
        <div className="side-summary">
          <div className="summary-icon">⌖</div>
          <div><strong>{visibleCount.toLocaleString()}</strong><span>matching locations</span></div>
          <span className="summary-total">of {total.toLocaleString()}</span>
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
          <p>Data comes from <code>data/pins.csv</code>. Commit updates to publish new pins.</p>
        </div>
      </aside>
    </div>
  );
}
