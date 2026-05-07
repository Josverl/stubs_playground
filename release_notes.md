# Release Notes

## v1.0.0 - First public release

This is the first public release of the MicroPython stubs Playground.

The project packages a browser-based CodeMirror editor, an in-browser Pyright worker, and board-specific stub sets into a static tool that can run from GitHub Pages or any simple HTTP server. The main goal of this release is to make MicroPython type checking easy to try, easy to share, and useful without requiring local IDE setup.

## Getting started

Just Open `https://josverl.github.io/stubs_playground/` in a browser.
You can start typing MicroPython code right away, and see diagnostics and hover information based on the selected board's stubs. You can also create multiple files, switch between different board targets, and share your code snippets with generated links.

## Highlights

- Runs entirely in the browser. No backend service or LSP bridge server is required for normal use.
- Uses Pyright inside a Web Worker, so diagnostics, completions, and hover information stay local to the browser session.
- Supports MicroPython-aware type checking with board and runtime switching.
- Persists multiple files and folders in browser storage.
- Lets you share code snippets and editor settings with a generated link.
- Supports import and export of single files and zipped folders.

## Included in this release

### Editor experience

- CodeMirror 6 editor with Python syntax support
- Real-time diagnostics with debounced updates while typing
- Hover tooltips with signatures, type information, and available documentation
- LSP-backed autocompletion
- Multiple documents and folder-based workspace editing
- Responsive browser UI suitable for local and hosted use

### Stub and board support

This release includes support for switching between several stub environments:

- ESP32, RP2040,STM32, SAMD,  CircuitPython, or no-stubs mode
- MicroPython or CPython stdlib-only mode

### Deployment model

- Static-site friendly
- Works with GitHub Pages
- Works with a simple local HTTP server during development

## Why this release matters

This release is the proof that MicroPython type checking can be delivered as a lightweight browser tool instead of a full desktop IDE setup. It is intended for:

- catching mistakes before code reaches hardware
- comparing code across MicroPython ports
- sharing small reproducible examples
- reporting stub issues with less setup friction
- serving as a reference implementation for other browser-based Python or MicroPython editors

## Known limitations

- This is not a device runner, REPL, or board flashing tool.
- The project focuses on static analysis and editing, not live execution on hardware.
- Non-default stub bundles are fetched when selected, so the first switch to another target may take longer than the default ESP32 path.
- As a first release, UI polish and workflow ergonomics are still expected to improve over time.

## Acknowledgements

This project builds on CodeMirror 6, Pyright, and the MicroPython stubs ecosystem. The type information used here comes from the MicroPython stub packages and the Micropython Community that maintains the documentation that feeds them.

When (not if) you find a bug in the stubs, please report it. That is now just a matter of clicking the "Report issue" button in the UI, and it will pre-fill a bug report with the relevant code snippet and diagnostics. 
That is a huge help to keep improving the stubs for everyone.
