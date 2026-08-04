# Agent Instructions: CodeMirror Python Editor for GitHub Pages

You should not be overly optimistic, use icons sparingly.

## Project Overview

Build a simple, static HTML5 page hosting a CodeMirror 6 editor configured for Python syntax highlighting. 
It is preferable that the page can be deployed to GitHub Pages and serve as a foundation for future LSP integration with Pylance and MicroPython type stubs.
if it is needed to change the hosting infrastructure so that it cannot be run on github pages , that is acceptable 

the .ai_history folder contains previous documentation about this project, refer to them to avoid repeating work already done, or to get ideas on how to proceed.


## TESTING GUIDELINES
you MUST test your code thoroughly
tests should reside in the tests/ folder
Exploratory testing of web pages must be done using the Playwright MCP Server
Unit and integration testing should be based on Pytest + Playwright - but only start creating these after exploratory testing of a feature is complete


## Development servers
The development servers are defined in the .vscode/tasks.json file
- "Start HTTP Server" - port 8888 - starts a simple HTTP server to serve the project

Pyright runs in a Web Worker in the browser — no server needed.

## Python Environment Setup

### GitHub Copilot Agent Setup
The repository includes automated setup workflow in `.github/workflows/`:
- `copilot-setup-steps.yml` - Copilot agent environment setup

These workflows automatically:
1. Install `uv` package manager using astral-sh/setup-uv
2. Install Python and project dependencies
3. Install MicroPython stubs to `typings/` directory
4. Cache environment for faster subsequent runs

### Local Development
use `uv` for environment management
use `uv pip` for package management
use `pytest` as the test runner

**Setup commands:**
```bash
# Install uv (if not already installed)
# Windows: irm https://astral.sh/uv/install.ps1 | iex
# Unix: curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies
uv sync

# Install MicroPython stubs
uv pip install micropython-esp32-stubs --target typings
```

## Project Structure

```
mp_codemirror/
├── .github/
│   ├── copilot-instructions.md  # This file - Agent instructions
│   └── workflows/
│       ├── test.yml             # CI test workflow
│       └── deploy.yml           # GitHub Pages deployment
├── apps/
│   └── playground/     # Main browser application and examples
├── packages/
│   ├── lsp-client/
│   │   └── src/        # Public CodeMirror LSP bridge
│   └── pyright-worker/
│       ├── src/        # Pyright worker and protocol declarations
│       ├── dist/       # Built worker bundle
│       └── assets/     # Typeshed and board stub archives
├── scripts/
│   ├── pack-typeshed.mjs    # Pack typeshed for browser
│   └── pack-stubs.mjs       # Pack stubs per board
├── tests/
│   ├── conftest.py          # Pytest configuration and fixtures
│   ├── test_editor.py       # Editor UI tests
│   ├── test_worker_transport.py  # Worker transport tests
│   ├── test_lsp_features.py     # LSP feature tests
│   └── README.md            # Testing documentation
├── typings/             # MicroPython type stubs
├── justfile             # Build and dev task runner
├── webpack.config.cjs   # Webpack config for worker build
└── README.md            # Project documentation
```

## Basic CodeMirror Setup 

- Static HTML5 page with CodeMirror 6 loaded via CDN (esm.sh),
- Python syntax highlighting, line numbers, dark/light theme toggle, bracket matching, code folding, auto-indentation.
- Deploys to GitHub Pages as static files.
- **Web Worker transport** (`packages/lsp-client/src/worker-transport.js`) — runs Pyright in-browser
- **Transport factory** (`packages/lsp-client/src/transport-factory.js`) — creates the worker transport
- **LSP client** (`packages/lsp-client/src/simple-client.js`) — JSON-RPC 2.0, transport-agnostic
- **Real-time diagnostics** — errors/warnings as you type (300ms debounce)
- **Autocompletion** — context-aware completions from Pyright
- **Hover tooltips** — type info, docstrings, MicroPython docs
- **Board selector dropdown** — ESP32, RP2040, STM32
- **Per-board stub packing** (`scripts/pack-stubs.mjs`) — stubs bundled as zip files
- **Dynamic stub loading** — worker loads/unloads stubs on board switch
- **ZenFS virtual filesystem** — in-worker filesystem for typeshed + stubs
- Type stubs sourced from `micropython-esp32-stubs`, `micropython-rp2-stubs`

## Phase 4: Testing, CI, and Code Quality (Current Phase)

### Test tiers:
```bash
pytest tests/ -m unit -v          # Unit tests
pytest tests/ -m editor -v        # Editor/UI tests (Playwright)
pytest tests/ -m worker -v        # Web Worker tests
pytest tests/ -m lsp -v           # LSP feature tests
pytest tests/ -v                  # All tests
```

### CI:
- `.github/workflows/test.yml` — runs tests on push/PR
- `.github/workflows/deploy.yml` — deploys to GitHub Pages

### Testing Strategy

- Test completion for MicroPython-specific modules (machine, micropython, etc.)
- Verify CPython-only modules are not suggested
- Test device-specific APIs (ESP32 vs RP2040)
- Run test tiers independently: `pytest -m unit`, `pytest -m editor`, `pytest -m worker`, `pytest -m lsp`

## Development Guidelines

### Code Style

- Use modern ES6+ JavaScript (ES modules)
- Prefer async/await over callbacks
- Keep functions small and focused
- Add comments for complex logic

### Git Workflow

- Main branch: stable, deployable code
- Feature branches for new functionality
- Clear commit messages following conventional commits

### GitHub Pages Deployment

1. Enable GitHub Pages in repository settings
2. Deploy from main branch, root directory or /docs folder
3. Test with `https://<username>.github.io/<repo-name>/`

### Performance Considerations

- Lazy-load LSP features
- Debounce expensive operations (diagnostics, completions)
- Use Web Workers for background processing
- Minimize bundle size (use CDN for CodeMirror)

## Resources

### Documentation
- CodeMirror 6: https://codemirror.net/6/
- Pylance: https://github.com/microsoft/pylance-release
- Pyright: https://github.com/microsoft/pyright
- LSP Specification: https://microsoft.github.io/language-server-protocol/

### Existing Projects
- Monaco Editor (reference for LSP integration)
- JupyterLab CodeMirror (Python editor example)

## Notes for AI Agent

- Use CDN links to avoid build complexity
- Prioritize GitHub Pages compatibility
- Document all design decisions
- Keep code modular for future LSP integration
- Test in multiple browsers (Chrome, Firefox, Safari)
