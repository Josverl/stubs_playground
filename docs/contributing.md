# Contributing to CodeMirror Python Editor

Thank you for your interest in contributing to this project! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- A modern web browser (Chrome 89+, Firefox 89+, Safari 15+)
- Python 3.x and [uv](https://docs.astral.sh/uv/) for environment management
- Node.js (for building the Pyright Web Worker)
- Git for version control
- A code editor (VS Code recommended)

### Setting Up Development Environment

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/mp_codemirror.git
   cd mp_codemirror
   ```

2. **Run the setup recipe** (installs dependencies, builds the worker):
   ```bash
   just setup
   ```

3. **Start the playground with workspace components:**
   ```bash
   just serve
   ```

4. **Open in browser:**
   `just serve` opens `http://localhost:8888/apps/playground/?components=local`.
   Use `just serve cdn` to run the same application with published components.

## Development Workflow

### Branch Strategy

- `main` - Stable, production-ready code
- `feature/feature-name` - Feature branches
- `fix/bug-name` - Bug fix branches

### Making Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Edit application files in `apps/playground/`
   - Edit reusable components in `packages/lsp-client/` or `packages/pyright-worker/`
   - Test your changes thoroughly
   - Check browser console for errors

3. **Test your changes:**
   - Open `index.html` and verify functionality
   - Run automated tests: `npm run test:unit && uv run pytest -v`
   - Test in multiple browsers if possible
   - Test responsive design (mobile viewport)

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: Add your feature description."
   ```

5. **Push to your fork:**
   ```bash
   git push origin feature/your-feature-name
   ```
6. **Create a Pull Request:**
   - Go to the original repository
   - Click "New Pull Request"
   - Select your feature branch
   - Describe your changes clearly

## Code Style Guidelines

### JavaScript

- Use ES6+ syntax
- Use `const` and `let`, avoid `var`
- Prefer arrow functions for callbacks
- Use template literals for string interpolation
- Add JSDoc comments for public functions
- Keep functions small and focused (< 50 lines ideally)
- Use meaningful variable and function names

**Example:**
```javascript
/**
 * Creates a new editor instance with Python support
 * @param {HTMLElement} container - The container element
 * @param {string} initialCode - Initial code content
 * @returns {EditorView} The editor view instance
 */
function createPythonEditor(container, initialCode) {
    return new EditorView({
        state: createEditorState(initialCode),
        parent: container
    });
}
```

### HTML

- Use semantic HTML5 elements
- Include proper ARIA labels for accessibility
- Keep structure clean and well-indented
- Use lowercase for element names and attributes

### CSS

- Use meaningful class names
- Follow BEM naming convention when appropriate
- Group related styles together
- Add comments for complex styles
- Use CSS custom properties for theming

## Testing Guidelines

### Manual Testing Checklist

Before submitting a PR, verify:

- [ ] Editor loads without console errors
- [ ] Python syntax highlighting works
- [ ] Line numbers display correctly
- [ ] All buttons work as expected
- [ ] Theme toggle works
- [ ] Code can be typed and edited
- [ ] Keyboard shortcuts work
- [ ] LSP diagnostics appear for code errors
- [ ] Autocompletion works (type `sys.` and check)
- [ ] Hover tooltips show type info
- [ ] Board selector switches stubs
- [ ] Works in Chrome, Firefox, and Safari
- [ ] Responsive design works on mobile viewport
- [ ] No accessibility issues

### Automated Tests

Run tests by code owner:

```bash
# Playground-owned tests
npm run test:app:unit
uv run pytest apps/playground/tests -v

# Published component tests (no playground imports)
npm run test:components:unit
uv run pytest packages/lsp-client/tests -v
uv run pytest packages/pyright-worker/tests -v

# All Pytest suites with the browser visible
uv run pytest --headed
```
## Documentation

When adding features, update:

- `README.md` - User-facing documentation
- `.github/copilot-instructions.md` - Development guidelines
- `CONTRIBUTING.md` - Contribution guidelines (this file)
- Code comments - Explain complex logic

## Reporting Bugs

### Before Reporting

1. Check if bug already reported in Issues
2. Verify it's reproducible
3. Test in multiple browsers
4. Check browser console for errors


## Project Structure

```
mp_codemirror/
├── .github/
│   ├── workflows/
│   │   └── deploy.yml              # GitHub Actions deployment
│   └── copilot-instructions.md     # Agent instructions
├── apps/
│   └── playground/                 # Main browser application
├── packages/
│   ├── lsp-client/                 # Reusable CodeMirror LSP bridge
│   └── pyright-worker/             # Worker source, bundle, and board assets
├── tests/
│   ├── conftest.py                 # Pytest configuration
│   ├── test_editor.py              # Playwright tests
│   └── README.md                   # Testing documentation
├── .gitignore                      # Git ignore rules
├── CONTRIBUTING.md                 # This file
└── README.md                       # Project documentation
```
