# MicroPython browser type-checking APIs

## Python and MicroPython stubs

Pyright checks Python code using the selected
[`micropython-stubs`](https://github.com/Josverl/micropython-stubs) package.
Current examples cover
[ESP32](../apps/playground/examples/espnow_sample.py),
[RP2](../apps/playground/examples/rp2_pio.py), and
[CircuitPython](../apps/playground/examples/cp_essentials.py).

## Components and stub package handling

The browser language server is Pyright running in a Web Worker. Pylance is not
part of this project. Stub discovery, installation, and persistence are
documented in the Pyright worker API.

```{toctree}
:maxdepth: 2
:caption: Components and API

architecture
api/overview
api/lsp-client
api/pyright-worker
api/examples
```

## Integration examples

The playground is part of this repository. ViperIDE is a separate open-source
project that uses the same components.

```{toctree}
:maxdepth: 1
:caption: Integrations

showcase
api/viperide
```

## Other topics

```{toctree}
:maxdepth: 1
:caption: Other topics

quickstart
cdn-consumption
technical
contributing
```
