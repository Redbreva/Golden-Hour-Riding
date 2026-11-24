# Golden Hour Riding

A standalone 3D indoor cycling simulator for **macOS** and **Windows**, built with **Electron**, **Vite**, and **Three.js**.

Inspired by [Jamie WP's Golden Hour Ride](https://golden-hour-ride.space.fast/) YouTube project — built from scratch as an open-source, offline-capable desktop application.

## Features (Stage 1 Baseline)

- **Two Courses**:
  - **Alpine Valley**: Procedurally generated undulating valley road surrounded by rolling meadows, conifer forests, distant mountain ridges, moving clouds, and golden-hour sunlight.
  - **Leckhampton Hill**: Real-world Cotswold climb built from Environment Agency terrain elevation (DEM) and OpenStreetMap data, with English broadleaf trees, sheep flocks, hay stooks, hedges, dry-stone walls, and quarry smoke.
- **Weather System**: Switch smoothly between **Golden**, **Overcast**, **Rain** (with rain streaks, wet tarmac ripples, lens raindrops, and rain audio), **Mist**, and **Starry Night** (`1`–`5` keys or UI buttons). Also includes a winter dusk theme (`?theme=christmas`) and autopilot scenery mode (`?scenery` or `?scenery=nobars`).
- **Cycling Physics & Cockpit**: First-person road bike handlebars with a live head unit, power-to-speed physics (gravity, rolling resistance, aerodynamic drag), corner lean, pedal sway, and speed-sensitive FOV.
- **Bluetooth Smart Trainer Support (BLE)**: Connects to `Cycling Power` (0x1818) and `Fitness Machine Service / FTMS` (0x1826) smart trainers to read live watts and send road gradient simulation, with adjustable hill difficulty (`0%–100%`).
- **Procedural Audio**: Web Audio API wind, tyre, and rain soundscapes scaled to speed and weather.
- **Voice Commands**: Optional voice control in Chromium/Chrome/Edge (`rain`, `mist`, `overcast`, `sunny`, `skip`, `back`, `hide`, `show`, `easier`/`gear down`, `harder`/`gear up`, `flat`, `full`).
- **Ride Log**: Persists ride distance and duration locally.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 20+

### Run as a Desktop App (macOS & Windows)

```bash
npm install
npm start
```

### Run in a Browser (Chrome / Edge for Development)

```bash
npm run dev
```

Then open `http://localhost:5173` in Chrome or Edge.

### Build Installers

```bash
# macOS (.dmg / .zip)
npm run dist:mac

# Windows (.exe installer / portable)
npm run dist:win
```

Built packages are written to `release/`.

## Controls

| Input | Action |
|---|---|
| `↑` / `↓` or Power slider | Adjust target power (watts) |
| `→` / `←` or Skip button | Jump 250 m forward / backward along the loop |
| `1` – `5` | Switch weather (Golden, Overcast, Rain, Mist, Starry) |
| `H` or Hide info | Toggle clean view (click or press `H` to restore) |
| `−` / `+` Hills | Adjust smart trainer gradient scaling (`0%–100%`) |

## Credits & Licenses

- **Inspiration**: Jamie WP's *Golden Hour Ride* YouTube project and MIT-licensed codebase.
- **Surface Textures**: Photo-scanned asphalt, grass, rock, and gravel textures from [Poly Haven](https://polyhaven.com/) under the **CC0 (Public Domain)** license.
- **Leckhampton Hill Course Data**:
  - Terrain elevation (`public/assets/leckhampton.js`) derived from Environment Agency LIDAR / Open Data under the **Open Government Licence v3.0**.
  - Woodland, hedges, walls, trees, and building data (`public/assets/leckhampton_osm.js`) derived from **OpenStreetMap** contributors under the **ODbL** license.
- **Code**: MIT License (see [LICENSE](LICENSE)).
