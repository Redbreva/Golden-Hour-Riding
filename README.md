# Golden Hour Riding

A standalone 3D indoor cycling desktop application for **macOS** and **Windows**, built with **Electron**, **Vite**, and **Three.js**.

Inspired by [Jamie WP's Golden Hour Ride](https://golden-hour-ride.space.fast/) YouTube project — built as a standalone, offline-capable desktop app.

## Features

- **Course Selector**:
  - **Alpine Valley**: Procedurally generated mountain valley loop with pine forests, rolling meadows, moving clouds, and golden-hour sunlight.
  - **Alpine Valley — Christmas**: Snowy dusk edition with glowing timber chalets, fairy-lit pines, and falling snow.
  - **Leckhampton Hill**: Real-world Cotswold climb built from Environment Agency terrain elevation (DEM) and OpenStreetMap data, with broadleaf trees, sheep flocks, hay stooks, hedges, dry-stone walls, and quarry smoke.
- **Weather System**: Smooth transitions between **Golden**, **Deep Sunset**, **Overcast**, **Rain** (rain streaks, wet tarmac ripples, lens raindrops, rain audio), **Mist**, **Starry Night**, and **Snow** (`1`–`6` keys or **Weather ▾** dropdown).
- **Cycling Physics & Cockpit**: First-person road bike handlebars with live head unit (`KM/H` & `WATTS`), toggleable bike headlight (`L` key or **Light** button), power-to-speed physics (gravity, rolling resistance, aerodynamic drag), corner lean, pedal sway, and speed-sensitive FOV.
- **Bluetooth Smart Trainer Support (BLE)**: In-app Bluetooth trainer picker connecting to `Cycling Power` (0x1818) and `Fitness Machine Service / FTMS` (0x1826) trainers for live watts and gradient simulation, with `0%–100%` hill scaling.
- **Native Offline Voice Control**: Uses macOS on-device `SFSpeechRecognizer` and Windows built-in `.NET System.Speech` — zero cloud API keys (`golden`, `sunset`/`dusk`, `overcast`, `rain`, `mist`, `starry`, `snow`, `light on`/`light off`/`headlight`, `mute`/`unmute`, `skip`, `back`, `hide`, `show`, `easier`/`gear down`, `harder`/`gear up`, `flat`, `full`).
- **Procedural Audio & Ride Log**: Web Audio wind/tyre/rain soundscape and local ride history.

## Launching the App

### Quick Launch (Double-Click)
- **macOS**: Double-click **`Launch Golden Hour Riding.command`** in Finder (auto-builds if source files changed and opens the desktop app).
- **Windows**: Double-click **`Launch Golden Hour Riding.bat`** in File Explorer.

### From Terminal (Optional)
```bash
npm install
npm start
```

### Build Standalone Desktop App / Installers
```bash
# macOS standalone .app bundle (in release/mac-arm64/)
npm run pack:mac

# macOS distributable (.dmg / .zip)
npm run dist:mac

# Windows installer & portable .exe
npm run dist:win
```

## Controls

| Input | Action |
|---|---|
| `↑` / `↓` or Power slider | Adjust target power (watts) |
| `→` / `←` or Skip button | Jump 250 m forward / backward |
| `1` – `6` | Switch weather (Golden, Deep Sunset, Overcast, Rain, Mist, Starry) |
| `L` or Light button | Toggle bike headlight |
| `Q` or Res button | Cycle render resolution (`0.75×`, `1×`, and `Retina` on HiDPI displays) |
| `M` or Sound button | Mute / unmute audio |
| `F` | Toggle FPS & frame-time overlay |
| `H` or Hide info | Toggle clean view (click or press `H` to restore) |
| **Course ▾** / **Weather ▾** | Open course or weather selector panels |
| `−` / `+` Hills | Adjust smart trainer gradient scaling (`0%–100%`) |

## Adding New Courses

Courses are defined in `src/courses.js`. Add a new entry to `COURSES` (and drop its terrain/OSM data files into `public/assets/` for `type: 'real'`), then rebuild.

## Credits & Licences

- **Inspiration**: Jamie WP's *Golden Hour Ride* YouTube project and MIT-licensed codebase.
- **Surface Textures**: Photo-scanned asphalt, grass, rock, and gravel textures from [Poly Haven](https://polyhaven.com/) under the **CC0 (Public Domain)** licence.
- **Leckhampton Hill Course Data**:
  - Terrain elevation (`public/assets/leckhampton.js`) derived from Environment Agency LIDAR / Open Data under the **Open Government Licence v3.0**.
  - Woodland, hedges, walls, trees, and building data (`public/assets/leckhampton_osm.js`) derived from **OpenStreetMap** contributors under the **ODbL** licence.
- **Code**: MIT Licence (see [LICENSE](LICENSE)).
