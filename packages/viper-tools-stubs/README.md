# viper-tools-stubs

Type stubs for the five top-level MicroPython modules distributed by
[ViperIDE](https://github.com/vshymanskyy/ViperIDE/tree/main/packages/viper-tools):

- `ble_nus`
- `ble_repl`
- `web_repl`
- `ws_client`
- `wss_repl`

This is a stub-only Python distribution. It does not contain or install the
ViperIDE runtime modules.

PEP 561 does not support type information for standalone module files. The
wheel therefore represents each upstream module as a typed package facade,
for example `ble_nus/__init__.pyi`. This preserves `import ble_nus` while
allowing type checkers to discover the installed stubs.

The package version `0.1.2.0` targets `viper-tools` 0.1.2. The final component
is reserved for revisions to the stubs that do not correspond to an upstream
runtime release.

## Regenerating

The generator downloads the source files from the pinned ViperIDE commit,
verifies their Git blob hashes, and invokes `mypy.stubgen` without importing
the MicroPython modules:

```bash
uv run scripts/generate_stubs.py
uv run scripts/generate_stubs.py --check
```

Generated stubs are drafts. Review their annotations before publishing a
release.

## Building and testing

```bash
uv build
uv run --extra dev pytest
```

Runtime integration with ViperIDE or the CodeMirror Pyright worker is
intentionally outside this package's current scope.
