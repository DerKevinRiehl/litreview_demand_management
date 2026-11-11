import React from 'react';
import ReactDOM from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import App from './App';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import './appearance.css';

// MapLibre 6 needs Vite to bundle its worker separately, including shared imports.
setWorkerUrl(mapWorkerUrl);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
