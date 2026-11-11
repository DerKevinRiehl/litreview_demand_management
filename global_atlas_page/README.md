# Demand Management Atlas

A client-side, GitHub Pages-ready interactive **3D globe / 2D map** with clickable pins, popups, a two-handle date-range slider and hierarchical checkbox filters. Pin data lives in **CSV or Excel**, not in the application code.

**Stack:** MapLibre GL JS 6, React 19, TypeScript, Vite, OpenFreeMap, Python data converter. MIT-licensed starter; no commercial API key, user account, or runtime backend required.

A centered spinner stays visible until the map and location data finish loading.
Use the **Light mode / Dark mode** button along the bottom of the map to change
both the interface and basemap. Your browser remembers the selected theme;
switching themes preserves the map view, projection, and filters.

Pin **color** identifies its category, while **shape** identifies its source:
Science uses circles and News uses diamonds. Both support the same filters and
clickable popups. The shape key appears beside the category-color legend.

The rotation button starts enabled and slowly turns the globe. It pauses while
you navigate, hover over a pin, inspect a popup, or switch to the flat map.
Click the rotation button to stop or restart it.

Hover over a timeline date to edit its month and year. You can also focus the
date with the keyboard or tap it on a touch screen. From selects the first day
of a month; To selects its last day. The dropdowns and slider stay synchronized.
The **A** button plays the timeline from January 1960 to December 2025 in about
66 seconds, keeping the left handle at the minimum. Click it again to pause or
resume. Editing dates, dragging a handle, or minimizing the timeline pauses
playback; Reset all filters stops playback and restores the full range.

## Quick start

### Windows: automatic portable setup

If Python 3.10+ is already installed, double-click `start_atlas.cmd` in the
repository root (one folder above this README). Alternatively, from the root:

```powershell
.\start_atlas.cmd
```

The launcher downloads the official Windows Node.js 22.23.5 ZIP, verifies its
SHA-256 checksum, installs the page's packages, prepares the CSV data, and opens
the page in your browser. Leave its window open while using the page; press
**Ctrl+C** to stop. Later launches reuse the installation.

Node.js, downloaded archives, and npm's cache stay in the repository's ignored
`_installations/` folder. Project packages stay in the ignored
`global_atlas_page/node_modules/` folder. The generated `package-lock.json` should
be committed so installations use the same dependency versions.

No administrator access, permanent PATH changes, or PowerShell policy changes
are required. Python uses only its standard library for this setup. University
restrictions may still block downloads or portable executables; IT would need
to allow those. The launcher does not change those restrictions.

For setup without opening the browser, use `.\start_atlas.cmd --install-only`.
To verify the production build, use `.\start_atlas.cmd --build`.

### Manual setup

Requirements: Node.js 22.12+, npm, Python 3.10+.

```bash
npm install
python scripts/prepare_data.py data/pins.csv
npm run dev
```

Open the local URL shown by Vite (normally `http://localhost:5173/`). The starter already includes synthetic **example** pins with real city coordinates; the examples are not real event assertions.

## Your data

Edit `data/pins.csv` in Excel/LibreOffice or replace it with your CSV file. The exact headers are:

| Field | Required | Example | Meaning |
| --- | --- | --- | --- |
| `id` | Yes | `item-001` | Unique identifier |
| `title` | Yes | `My location` | Popup heading |
| `latitude` | Yes | `47.3769` | Numeric latitude |
| `longitude` | Yes | `8.5417` | Numeric longitude |
| `date` | Yes | `2026-11-11` | Date in ISO `YYYY-MM-DD` |
| `category` | Yes | `Research / Medicine / Diagnostics` | Slash-delimited category hierarchy |
| `location` | No | `Zürich, Switzerland` | Popup subtitle |
| `description` | No | `A short description` | Popup text |
| `url` | No | `https://example.org` | Optional popup link (http/https only) |
| `source_type` | No | `Science` | `News` or `Science` (case-insensitive); blank entries appear under All |

Example CSV row:

```csv
id,title,latitude,longitude,date,category,location,description,url,source_type
item-001,My example project,47.3769,8.5417,2026-11-11,Research / Medicine / Diagnostics,"Zürich, Switzerland",Details about this project,https://example.org,Science
```

Quoted CSV fields may contain commas. A hierarchy is created automatically from category paths, so adding `Research / Medicine / Cardiology` creates a nested **Cardiology** checkbox. Parent checkboxes select/deselect all descendants. The two-handle timeline spans **1 January 1960 through 31 December 2025**, including both endpoints. It starts with this full range selected, and **Reset all filters** restores it. Pins outside this period remain in the data but are excluded by the date filter.

The **Source Type** control selects **All**, **News**, or **Science**, together
with the date and category filters. Its counts reflect the selected dates and
categories. **Reset all filters** also restores **All** evidence types.
The 48 example rows have a reproducible random split of 24 News and 24 Science
entries; these are illustrative assignments. Use your actual classification
when replacing the example data. CSV and Excel both support `source_type`.

Regenerate GeoJSON after any edit:

```bash
npm run data:csv
```

### Excel (.xlsx) instead of CSV

Save an `.xlsx` workbook as `data/pins.xlsx`, with the same headers in the first sheet. Then run:

```bash
python -m pip install openpyxl
npm run data:xlsx
```

To deploy Excel data through GitHub Actions, update `.github/workflows/deploy.yml` at the repository root: install `openpyxl` and change the data-conversion command to `python scripts/prepare_data.py data/pins.xlsx`. Data is converted **at build time**; visitors do not download or parse Excel.

## GitHub Pages deployment

The workflow is already prepared at **`.github/workflows/deploy.yml` in the
repository root**, alongside `global_atlas_page/`. It installs Node.js and Python
on GitHub's runner, prepares the CSV, builds this subfolder, and publishes only
`global_atlas_page/dist/`. The local `_installations/` folder is not needed on
GitHub.

1. In your GitHub repository, open **Settings → Pages → Build and deployment →
   Source** and choose **GitHub Actions**. Skip the suggested workflow templates;
   this repository already contains the workflow.
2. If Actions are disabled, enable them under **Settings → Actions → General**.
   The workflow uses official GitHub actions. It declares its own required Pages
   permissions, so no personal access token or repository secret is needed.
3. Commit the root `.github/workflows/deploy.yml`, the website source under
   `global_atlas_page/` (including `package-lock.json`), and the ignore files.
   Push to **`main`**. Do not commit `_installations/`, `node_modules/`, or `dist/`;
   they are already ignored.
4. Open **Actions → Deploy evidence atlas to GitHub Pages** to watch the build
   and deployment. The successful deployment and **Settings → Pages** show the
   live URL. If you enabled Pages after pushing, use **Run workflow** in Actions.

With the current repository name, the address is:

`https://derkevinriehl.github.io/litreview_demand_management/`

The repository name stays **`litreview_demand_management`**. The browser title is
**Demand Management Atlas**; the title is independent of the
repository's URL. `vite.config.ts` automatically uses the repository name for
asset, data, and map-worker URLs. The `global_atlas_page/` source folder does not
appear in the published URL.

Future edits to this website or `data/pins.csv` publish automatically when pushed
to `main`. GitHub Pages is available for public repositories on GitHub Free;
private repositories require a plan that supports Pages.

Reference: [GitHub Pages settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Performance design

- **One** GeoJSON source, circle layers for Science and halos, and a symbol layer for News diamonds, **no DOM marker per pin**.
- `map.setFilter()` composes a numeric day interval with the selected leaf categories and source type. Data stays loaded; the source is **not** rebuilt on slider movement.
- Date-count display uses sorted day arrays and binary searches per category, rather than scanning all points every time.
- Filters are synchronized through `requestAnimationFrame` to avoid redundant draw updates during slider dragging.
- **No clustering by default:** clustering the *unfiltered* point source and then hiding layers would show misleading cluster totals after filtering. This starter prioritizes correct filtered pins.
- For **~100k+** points or large GeoJSON downloads, consider pre-generated vector tiles or PMTiles (on static hosting), with the same MapLibre filtering approach. Actual performance varies by GPU, mobile device, point distribution and map style. Profile with your real dataset.

## Constraints and safety

- GitHub Pages and public-repository CSV data are **public**. Do not use sensitive private location or clinical data.
- Basemap tiles come from OpenFreeMap's public service at runtime. Hosting the website on GitHub Pages does not self-host the entire planet. Required attribution is shown by MapLibre.
- An external basemap provider can have downtime or change terms; for guaranteed availability, operate your own tiles.
- The site is static; editing published data requires a Git commit and deployment (unless you extend it with a user-facing importer).
- Popup text is inserted using safe DOM `.textContent`; links are restricted to HTTP(S).

## Official documentation

- https://maplibre.org/maplibre-gl-js/docs/
- https://maplibre.org/maplibre-gl-js/docs/guides/large-data/
- https://openfreemap.org/quick_start/
- https://vite.dev/guide/static-deploy
