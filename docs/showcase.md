# MicroPython Editor — Showcase

A CodeMirror 6 editor with Pyright-powered LSP running entirely in the browser. Board-specific MicroPython type stubs. No server required. Deploys to GitHub Pages as static files.

**Live demo:** [https://josverl.github.io/mp_codemirror/src/](https://josverl.github.io/mp_codemirror/src/)

---

## 1. Demo Walkthrough

1. **Open the editor** — Navigate to the GitHub Pages URL (or `http://localhost:8888/src/` locally). The page loads CodeMirror 6 from esm.sh CDN and boots a Pyright Web Worker. No install, no server.

2. **Select a board** — Use the "Board" dropdown in the header. Choose between ESP32 (Generic), Raspberry Pi Pico (RP2040), or STM32. Switching boards destroys and recreates the Pyright worker with the correct stubs — completions and diagnostics change immediately. A loading indicator appears during the switch.

3. **Load an example** — Pick a file from the "Select Example..." dropdown (e.g., `blink_led.py`, `temperature_sensor.py`, `espnow.py`, `rp2_pio.py`) and click "Load". The editor content is replaced and Pyright re-analyzes the new code.

4. **See real-time diagnostics** — Type invalid code (e.g., `machine.foo()`). After ~300ms of no typing, red squiggly underlines appear under errors. Pyright catches undefined attributes, import errors, and type mismatches — before your code ever reaches hardware.

5. **Try autocompletion** — Type `machine.` and pause. A completion menu appears with MicroPython-specific items: `Pin`, `I2C`, `SPI`, `PWM`, `ADC`, `Timer`, etc. Type `import ` and see available modules. Press Ctrl+Space to trigger completions manually.

6. **Hover for documentation** — Hover over `Pin` to see the full class signature, constructor parameters, and a link to docs.micropython.org. Hover over `machine` to see the module docstring. Tooltips render Markdown with code blocks.

7. **Toggle the theme** — Click "Toggle Theme" to switch between light and dark mode. Both the editor and hover tooltips adapt.

8. **Type Check on demand** — Click "Type Check" to run a full Pyright analysis pass and view all diagnostics at once.

---

## 2. Demo Video Script

Target length: 2-3 minutes.

| Time | Action | Narration |
|------|--------|-----------|
| 0:00 | Open the editor in a browser | "This is a MicroPython editor running entirely in the browser. There's no backend — Pyright runs in a Web Worker." |
| 0:15 | Point to the board selector, select ESP32 | "You pick your target board here. Each board loads different type stubs, so completions and type checking match the actual firmware API." |
| 0:30 | Load `blink_led.py` from the example dropdown | "Let's load the blink LED example. This imports `machine.Pin` and `time.sleep` — standard MicroPython." |
| 0:45 | Hover over `Pin` | "Hovering over Pin shows the full class docs — constructor signature, parameters, links to the official MicroPython docs. This comes from micropython-stubs." |
| 1:00 | Delete `Pin` and type `machine.` to show completions | "Autocompletion knows every attribute of the `machine` module for this specific board — Pin, I2C, SPI, PWM, ADC, Timer, and more." |
| 1:15 | Type `machine.foo()` — show error squiggle | "Type something invalid and Pyright flags it instantly. 300 milliseconds after you stop typing, diagnostics update." |
| 1:30 | Switch board to RP2040, load `rp2_pio.py` | "Switch to the RP2040 and load a PIO example. Now completions include `rp2.PIO` and `rp2.asm_pio` — APIs that only exist on this board." |
| 1:50 | Type `import espnow` — show error on RP2040 | "`import espnow` is valid on ESP32 but errors here — the RP2040 doesn't have ESP-NOW. Board-specific stubs catch this." |
| 2:10 | Toggle dark/light theme | "Light and dark themes are built in." |
| 2:20 | Close | "Everything you just saw runs as static files on GitHub Pages. No servers. Clone, build, deploy." |

---

## 3. Why MicroPython Stubs Matter

### Without stubs

CodeMirror gives you Python syntax highlighting — keywords are colored, strings are quoted, indentation works. But the editor has zero understanding of MicroPython. `import machine` is flagged as an unknown module. There are no completions for `Pin`, `I2C`, `SPI`, or any hardware API. You're writing code blind.

### With micropython-stubs

[micropython-stubs](https://github.com/Josverl/micropython-stubs) provides over 3,000 stub files that describe MicroPython's type surface. When loaded into Pyright, the editor understands MicroPython as a first-class language:

- **Real type checking** — `machine.Pin(2, machine.Pin.OUT)` is valid. `machine.Pin(2, "output")` is a type error. Pyright catches it.
- **Accurate completions** — Type `machine.` and see the actual API: `Pin`, `I2C`, `SPI`, `PWM`, `ADC`, `Timer`, `UART`, `WDT`, `Signal`, etc. Each with correct signatures.
- **Docstrings and signatures** — Hover over any symbol to see parameter types, return types, and descriptions extracted from MicroPython documentation.
- **Import validation** — `import espnow` works on ESP32, errors on RP2040. `import rp2` works on RP2040, errors on ESP32.

### Board-specific stubs

Different boards expose different modules and even different parameters for the same class. ESP32's `machine.Pin` supports `Pin.WAKE_LOW` and `Pin.WAKE_HIGH` for deep sleep wakeup — RP2040's doesn't. The RP2040 has `rp2.PIO` for programmable I/O — ESP32 doesn't. STM32 has `pyb` — the others don't.

micropython-stubs captures these differences per board and per firmware version. This project ships stubs for:

| Board | Key modules | Stub source |
|-------|-------------|-------------|
| ESP32 (Generic) | `machine`, `esp32`, `espnow`, `network`, `bluetooth` | `micropython-esp32-stubs` |
| RP2040 (Pico) | `machine`, `rp2`, `rp2.PIO`, `network` | `micropython-rp2-stubs` |
| STM32 (Generic) | `machine`, `pyb`, `network` | `micropython-stm32-stubs` |

### Generated from real firmware

Stubs are not hand-written. The [micropython-stubber](https://github.com/Josverl/micropython-stubber) tool extracts type information directly from running MicroPython firmware or from the MicroPython source code. When a new firmware version ships, stubs are regenerated automatically. This means the editor tracks firmware updates without manual work.

### Ecosystem adoption

The micropython-stubs project (290+ stars, 3,000+ stub files) is used by:
- **VS Code** — via the MicroPico extension and Pylance
- **PyCharm** — via the MicroPython plugin
- **Thonny IDE** — for MicroPython type hints
- Published as **PyPI packages** (`micropython-esp32-stubs`, `micropython-rp2-stubs`, etc.) for easy installation

---

## 4. Architecture Overview

For a detailed architecture diagram, see `docs/architecture.md`.

```
Browser (static HTML page served from GitHub Pages)
├── CodeMirror 6 Editor
│   ├── Loaded via CDN (esm.sh) with import map for version pinning
│   ├── Python language support (@codemirror/lang-python)
│   ├── Lint extension for diagnostic display
│   └── Autocomplete + hover tooltip extensions
│
├── LSP Client (src/lsp/)
│   ├── simple-client.js — JSON-RPC 2.0 protocol (transport-agnostic)
│   ├── worker-transport.js — Web Worker transport
│   ├── transport-factory.js — Creates the worker transport
│   ├── diagnostics.js — Maps LSP diagnostics → CodeMirror lint markers
│   ├── completion.js — Maps LSP completions → CodeMirror autocomplete
│   └── hover.js — Maps LSP hover → CodeMirror tooltips
│
├── Pyright Web Worker (dist/pyright_worker.js, ~8MB)
│   ├── Pyright language server (bundled via webpack)
│   ├── ZenFS virtual filesystem (in-memory)
│   ├── Typeshed (Python stdlib types, packed as zip at build time)
│   └── MicroPython stubs (per-board zip, loaded on board switch)
│
├── Board Selector UI
│   ├── Dropdown: ESP32, RP2040, STM32
│   ├── On switch: destroys worker, creates new one with selected stubs
│   └── Selection persisted in localStorage
│
└── Stubs Manifest (assets/stubs-manifest.json)
    └── Lists available boards, stub zip files, sizes, descriptions
```

### Key architectural decisions

- **Everything runs in the browser.** No backend server needed for any LSP feature. The page can be served from any static file host (GitHub Pages, S3, a local `python -m http.server`).
- **Pyright is bundled via webpack** into a single Web Worker JS file (`dist/pyright_worker.js`). The webpack config stubs out Node-only dependencies (`fs` → ZenFS, `@yarnpkg/fslib` → stub) and polyfills (`assert`, `crypto`, `stream`, `url`, `zlib`).
- **Typeshed and stubs are packed as zip files** at build time (`scripts/pack-typeshed.mjs`, `scripts/pack-stubs.mjs`). The worker unpacks them into a ZenFS virtual filesystem on startup.
- **Board switching destroys and recreates the worker.** This ensures a clean Pyright state — no stale type caches from the previous board. The trade-off is a multi-second reload. The LSP client rebinds CodeMirror extensions after the new worker initializes.
- **CDN dependencies are pinned via import map.** esm.sh's `?deps=` parameter forces all CodeMirror packages to share the same `@codemirror/state` and `@codemirror/view` versions, avoiding the duplicate-instance bug that breaks `instanceof` checks.
- **Diagnostics are debounced at 300ms.** After the user stops typing, a `textDocument/didChange` notification is sent to Pyright. This balances responsiveness with performance.
- **Transport-agnostic LSP client.** The client speaks JSON-RPC 2.0 and doesn't know whether it's talking to a Web Worker or a WebSocket. This made it possible to start with a WebSocket bridge for development and migrate to a Web Worker for production without rewriting the protocol layer.

---

## 5. Implementation Path

### Step 1: Static Editor

Built a CodeMirror 6 editor loaded entirely via a CDN (I selected esm.sh). This provides basic Python syntax highlighting, line numbers, bracket matching, code folding, auto-indentation, search, theme toggle.
This is table stakes, code mirror does the heavy lifting.

**Key challenge:** MicroPython is not CPython - Your editor will show many errors, in good code, and also wont notice some errors in  invalid MicroPython code.

### Step 2: LSP Integration

Add Pyright as a language server. 
Started with a WebSocket bridge prototype, then migrated to a Web Worker (`src/worker/pyright-worker.ts`) — Pyright runs entirely in the browser.
Implemented three LSP features: 
 - real-time diagnostics (errors/warnings as you type),
 - autocompletion (context-aware suggestions with type-based icons),
 - hover tooltips (signatures, docstrings, documentation links).

**Key challenge:** Bundling Pyright for the browser via webpack. 
Pyright depends on Node APIs (`fs`, `path`, `child_process`) that don't exist in a Web Worker. 
Solved by aliasing `fs` to ZenFS, stubbing `@yarnpkg/fslib` and `tmp`, and adding polyfills for `assert`, `crypto`, `stream`, `url`, `zlib`.

**Enabled:** Full type checking in the browser with no server. T
he transport-agnostic client design meant the migration from WebSocket to Web Worker required zero changes to the LSP protocol code.

### Phase 3: MicroPython Stubs

Added board-specific MicroPython type stubs including a simple port/board selector UI (ESP32, RP2040, STM32). 
Created packing scripts (`scripts/pack-stubs.mjs`) that zip per-board stubs from the installed `micropython-*-stubs` packages. 
The worker loads these stubs into a ZenFS virtual filesystem alongside typeshed.

**Key challenge:** Stub loading and board switching. 
Stubs must be available in the worker's virtual filesystem before Pyright can use them. 
Board switching requires a clean Pyright state — the simplest approach was destroying and recreating the worker.

**Enabled:** Board-specific completions, diagnostics, and hover docs. 
- `import espnow` works on ESP32 but errors on RP2040.
- `rp2.PIO` completes on RP2040 but not ESP32.

### Phase 4: Testing and CI

Added a Pytest + Playwright test suite with four tiers: 
 - unit tests, editor UI tests, Web Worker transport tests, and LSP feature tests.
 - GitHub Actions CI runs tests on push and PR. Deployment workflow pushes to GitHub Pages.

**Key challenge:** Testing async Web Worker communication from Python. Playwright's page evaluation and network interception were used to verify LSP message flows.

---

# Integration Guide — Adding MicroPython LSP to Your Tool

If you already have a CodeMirror 6 editor and want to add MicroPython type checking, here's what to integrate. Each step builds on the previous one. Steps 1-5 give you a working editor with diagnostics; steps 6-7 are optional enhancements.

### Step 1: Add CodeMirror Lint and Autocomplete Extensions

Your editor likely already has `basicSetup` and `@codemirror/lang-python`. Add these if not already present:

- `@codemirror/lint` — provides `setDiagnostics()` and the lint gutter for error markers
- `@codemirror/autocomplete` — provides the completion popup (included in `basicSetup`)
- A `Compartment` for LSP extensions — allows reconfiguring LSP bindings at runtime (needed for board switching)

```js
import { Compartment } from '@codemirror/state';
const lspCompartment = new Compartment();
// Add lspCompartment.of([]) to your extensions array
```

### Step 2: Add the LSP Client

You need a JSON-RPC 2.0 client that speaks LSP over `postMessage` to a Web Worker. This project's client is in `src/lsp/`:

| File | Purpose |
|------|---------|
| `simple-client.js` | JSON-RPC 2.0 protocol (request/response/notification) |
| `worker-transport.js` | Sends JSON-RPC messages via `postMessage` to a Web Worker |
| `transport-factory.js` | Selects transport based on config (worker vs. websocket) |

The client is transport-agnostic — if you already have a WebSocket or other transport, you only need `simple-client.js` and can write your own transport adapter.

### Step 3: Build the Pyright Web Worker

Pyright doesn't run in a browser out of the box. It needs to be bundled with webpack, with Node API polyfills:

- **Webpack target:** `webworker`
- **Key polyfills:** `fs` → `@zenfs/core`, `path` → `path-browserify`, `crypto`/`stream`/`url`/`zlib` → browser equivalents
- **Stub out:** `child_process`, `worker_threads`, `@yarnpkg/fslib`, `tmp`
- **Typeshed:** Pack the `typeshed-fallback/` directory (bundled with Pyright) as a zip, inline it via `arraybuffer-loader`

See `webpack.config.cjs` and `src/worker/pyright-worker.ts` for the full configuration. The output is a single `~8MB` JS file.

### Step 4: Wire CodeMirror to the LSP Client

Connect the LSP client's outputs to CodeMirror extensions:

| LSP Feature | CodeMirror Integration | File |
|-------------|----------------------|------|
| `textDocument/publishDiagnostics` | `setDiagnostics()` from `@codemirror/lint` | `diagnostics.js` |
| `textDocument/completion` | Custom `CompletionSource` for `@codemirror/autocomplete` | `completion.js` |
| `textDocument/hover` | `hoverTooltip()` from `@codemirror/view` | `hover.js` |

Add an `EditorView.updateListener` that debounces `textDocument/didChange` notifications (300ms works well). This triggers Pyright to re-analyze on every edit.

### Step 5: Pack and Load MicroPython Stubs

Without stubs, Pyright only knows CPython. To add MicroPython awareness:

1. **Install stubs** from PyPI: `pip install micropython-esp32-stubs --target ./tmp-stubs`
2. **Zip them:** Create a zip of the `.pyi` files for each board
3. **Load into the worker:** The worker mounts stubs into ZenFS at `/typings/` where Pyright reads them

See `scripts/pack-stubs.mjs` for the packing logic. You can also fetch stub zips at runtime from a CDN or your own server instead of bundling them.

**Minimal approach:** Bundle one board's stubs into the worker (inlined via `arraybuffer-loader`). This gives you MicroPython support with zero additional fetches.

**Flexible approach:** Host stub zips as static files and fetch them on demand. Use a manifest file (`stubs-manifest.json`) to list available boards.

### Step 6: Add Configuration (Optional)

Pyright reads configuration from `pyproject.toml` (`[tool.pyright]`) in the virtual filesystem. This is automatically generated based on the options selected to control:

- `typeCheckingMode` — `"off"`, `"basic"`, `"standard"`, or `"strict"` (recommended `"standard"` ) 
- `pythonVersion` — e.g., `"3.4"` (MicroPython roughly targets Python 3.4)
- `pythonPlatform` — e.g., `"Linux"`
- `typingsPath` — where to find stubs (default: `./typings`)
- `typeshedPath` — required to override stdlib stubs such as `time.sleep_ms()` (default: `./typings`)

You can view (not edit) the generated `pyproject.toml` in the editor as a read-only document.

### Step 7: Add Board / Port / Version Switching (Optional)

If your users work with multiple MicroPython ports or boards, or versions:

1. Create a UI selector (dropdown, tabs, etc.)
2. Maintain a manifest mapping board IDs to stub zip URLs
3. On switch: fetch the new stubs → terminate the old worker → create a new worker with the new stubs → re-initialize LSP → re-open the document
4. Cache downloaded stubs in memory (`Map<string, ArrayBuffer>`) to avoid re-fetching

The worker teardown/recreate approach is the simplest way to get a clean Pyright state. A more advanced approach could clear and remount the ZenFS filesystem without recreating the worker.

---

## PoC Limitations

- **Three boards only** — ESP32, RP2040, STM32, all at firmware version 1.28.0. No other boards or firmware versions.
- **No go-to-definition or find-references** — Only diagnostics, completions, and hover are implemented.
- **No rename symbol or signature help** — These LSP capabilities are not wired up.
- **Worker is ~8MB** — Pyright + typeshed + stubs. Initial page load takes several seconds to boot the worker, especially on slower connections.
- **Board switch recreates the worker** — No incremental stub update. Switching boards takes 2-5 seconds while the new worker initializes.
- **Single file only** — No multi-file project support. You edit one file at a time in a virtual `file:///workspace/document.py`.
- **Theme toggle is CSS-only** — Swaps a class on `<body>`. Doesn't reconfigure CodeMirror's theme extensions.
- **No serial monitor or device connection** — The editor has no way to talk to actual hardware.
- **No custom stubs at runtime** — Stubs are packed at build time. Users can't add their own `.pyi` files.
- **No offline support** — CDN dependencies require an internet connection.

---

## Future Improvements

- **More boards and firmware versions** — Pack stubs for ESP32-S3, ESP32-C3, ESP8266, and more. Add a version selector alongside the board selector.
- **Size optimization** — Tree-shake Pyright to remove unused analysis features. Lazy-load board stubs (fetch only when selected). Apply compression to the worker bundle.
- **Faster board switching** — Reuse the worker and clear/replace the ZenFS virtual filesystem instead of destroying and recreating the worker. Warm cache for recently used boards.
- **More LSP features** — Go-to-definition, find-references, rename symbol, signature help, code actions.
- **Multi-file support** — Virtual project with multiple files (e.g., `main.py` + `lib/` modules). Tab UI for switching between files.
- **Custom stubs** — Allow users to drag-and-drop or upload their own `.pyi` stub files for custom MicroPython libraries.
- **Pyright configuration** — Expose generated `pyproject.toml` (`[tool.pyright]`) settings in the UI: type checking level (off/basic/standard/strict), python version, python platform.
- **Offline support** — Service worker to cache CDN dependencies and the Pyright worker for offline use.
- **Device integration** — Web Serial API for connecting to a MicroPython board. Upload files, run code, view serial output.
- **Collaborative editing** — WebRTC or similar for real-time multi-user editing sessions.
