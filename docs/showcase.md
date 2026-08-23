# Stubs Playground integration

The [MicroPython-Stubs Playground](https://josverl.github.io/stubs_playground/)
demonstrates Pyright-powered type checking for MicroPython and CircuitPython
entirely in the browser. It is intended both as a useful stub-testing tool and
as a reference for browser IDE authors.

This page focuses on what to try in the live application. For implementation
details, use the [architecture guide](architecture.md). To integrate the
components elsewhere, use the [API documentation](index.md).

## What the playground demonstrates

- MicroPython-aware diagnostics, completion, and hover documentation.
- Different APIs for ESP32, RP2, STM32, SAMD, WebAssembly, and CircuitPython.
- CPython and MicroPython standard-library comparisons.
- A multi-file Python workspace with diagnostics for unopened files.
- Runtime discovery and installation of compatible type-stub wheels from PyPI.
- Persistent downloaded stubs reused across browser sessions.
- Shareable workspaces and pre-filled MicroPython stub issue reports.
- A static deployment: Pyright runs in a Web Worker, not on an application server.

## Suggested walkthrough

### 1. Follow the built-in tour

Open the live playground. It starts with `playground_tour.py`, which introduces
the editor and its main controls.

Use the **Options** panel to change:

- **Stubs**: target runtime or board package.
- **Check**: Pyright mode (`Off`, `Basic`, `Standard`, or `Strict`).
- **stdlib**: MicroPython or CPython standard-library definitions.
- **Python**: language version used by Pyright.
- **Verbose**: detailed language-server logging.
- **Config**: the generated, read-only `pyproject.toml`.

### 2. Compare board-specific APIs

Select **ESP32**, load `espnow_sample.py`, and inspect the `espnow` import.
Completion and hover information should be available.

Then select **RP2**. The same ESP-NOW import should no longer be valid. Load
`rp2_pio.py` to inspect RP2-only PIO APIs instead.

Other selectable targets are populated from the worker's current stub manifest,
so the page does not maintain a separate hard-coded board list.

### 3. Trigger diagnostics and completion

In a MicroPython target, try:

```python
import machine

machine.not_a_real_api()
```

Pyright should report the unknown member. Replace the last line with
`machine.` and press **Ctrl+Space** to inspect available members for the selected
target. Hover over a known symbol such as `machine.Pin` to view its signature
and documentation.

Use **F8** and **Shift+F8** to navigate diagnostics. The keyboard-help button in
the Options panel lists the current shortcuts.

### 4. Exercise the multi-file workspace

Create a helper module in the file tree and import it from `main.py`. Errors in
unopened Python files contribute to the workspace diagnostics summary, not only
errors in the active editor tab.

The browser persists the workspace locally. Reloading the page should restore
its files and open tabs.

### 5. Install additional stubs from PyPI

In **Install extra stubs from PyPI**, enter a compatible type-only package such
as:

```text
types-requests
```

The worker discovers releases from PyPI, validates a universal type-stub wheel,
and persists it in IndexedDB. Pyright restarts so the installed package becomes
available. Reload the page to confirm that the cached package is reused.

Catalog suggestions cover known MicroPython packages, but versions are obtained
from PyPI at runtime rather than pinned to the worker release. The detailed
package rules and security limits are documented in the
[Pyright worker API](api/pyright-worker.md#runtime-stub-packages).

### 6. Share or report

Use **Share** to copy a link for the current file or the whole workspace. Large
workspaces may omit source text from the URL while preserving the selected
settings and diagnostic context.

Use **Report** to open a pre-filled issue for
[micropython-stubs](https://github.com/Josverl/micropython-stubs). Review the
payload first and never include credentials or other secrets in a public issue.

## What this project proves

MicroPython type checking does not require a server-side IDE service. A static
web application can:

1. run Pyright inside a browser worker;
2. supply target-specific type information;
3. synchronize open and unopened project files through LSP and a virtual
   filesystem; and
4. update persisted stub packages independently of the worker release.

ViperIDE uses the same published LSP client and worker components in a
device-connected IDE. See the
[ViperIDE integration API](api/viperide.md) for that lifecycle pattern.

## Related documentation

- [Quick start](quickstart.md): run and test the repository locally.
- [Architecture](architecture.md): worker, LSP, filesystem, and build design.
- [LSP client API](api/lsp-client.md): CodeMirror and transport contracts.
- [Pyright worker API](api/pyright-worker.md): protocol and stub package behavior.
- [Integration examples](api/examples.md): startup, synchronization, restart,
  and teardown code.
