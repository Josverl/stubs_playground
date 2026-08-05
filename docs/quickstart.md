# Quick Start Guide

## Get Started in 3 Steps

### Step 1: Clone and Setup

```bash
git clone <repository-url>
cd mp_codemirror
just setup
```

This installs the Python and npm workspace dependencies and builds the Pyright Web
Worker (`packages/pyright-worker/dist/pyright_worker.js`).

### Step 2: Start the HTTP Server

```bash
just serve
```

No LSP bridge server is needed — Pyright runs in the browser.

### Step 3: Open in Browser

`just serve` opens `http://localhost:8888/apps/playground/?components=local`.

To prove the same application works with the published components, run:

```bash
just serve cdn
```

You get full LSP features (diagnostics, completions, hover, board switching) with no server-side components.

---

## VSCode Tasks

### Available Tasks

- **Start HTTP Server** — Starts the Python HTTP server (port 8888)

---

## Testing

```bash
# Run independently owned unit suites
npm run test:app:unit
npm run test:components:unit
uv run pytest packages/pyright-worker/tests -m unit -v

# Run application or component browser tests
uv run pytest apps/playground/tests -v --browser chromium
uv run pytest packages/lsp-client/tests -v --browser chromium

# Run all Pytest suites with the browser visible
uv run pytest --headed
```

### Git Commands

```bash
# Create new feature
git checkout -b feature/my-feature

# Add and commit changes
git add .
git commit -m "feat: add my feature"

# Push to GitHub
git push origin feature/my-feature
```

---

## ⌨️ Editor Keyboard Shortcuts

### Windows/Linux

| Action | Shortcut |
|--------|----------|
| Find | `Ctrl+F` |
| Replace | `Ctrl+H` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` |
| Comment | `Ctrl+/` |
| Indent | `Tab` |
| Dedent | `Shift+Tab` |
| Fold Code | `Ctrl+Shift+[` |
| Unfold Code | `Ctrl+Shift+]` |
| Select All | `Ctrl+A` |
| Go to Line | `Ctrl+G` |

### macOS

| Action | Shortcut |
|--------|----------|
| Find | `Cmd+F` |
| Replace | `Cmd+Alt+F` |
| Undo | `Cmd+Z` |
| Redo | `Cmd+Shift+Z` |
| Comment | `Cmd+/` |
| Indent | `Tab` |
| Dedent | `Shift+Tab` |
| Fold Code | `Cmd+Alt+[` |
| Unfold Code | `Cmd+Alt+]` |
| Select All | `Cmd+A` |
| Go to Line | `Cmd+G` |

---

## 🎨 Customization

### Change Editor Font

Edit `app.js`:

```javascript
const darkTheme = EditorView.theme({
    ".cm-content": {
        fontFamily: "'Your Font', monospace",  // Change this
        fontSize: "16px"  // Change size
    }
});
```

### Change Theme Colors

Edit the theme objects in `app.js`:

```javascript
const darkTheme = EditorView.theme({
    "&": {
        backgroundColor: "#your-color",
        color: "#your-text-color"
    }
});
```

### Add More Python Code Samples

Edit `app.js`, modify the `sampleCode` constant:

```javascript
const sampleCode = `# Your custom sample here
print("Hello, World!")
`;
```

---

## 🐛 Common Issues

### Editor doesn't load

**Problem:** "Failed to fetch" errors

**Solution:** Make sure you're using a web server, not opening `file://` directly

```bash
# Start a server first!
python -m http.server 8000
```

### Import map not working

**Problem:** Module resolution errors

**Solution:** 
1. Check browser version (need Chrome 89+, Firefox 89+, Safari 15+)
2. Clear browser cache
3. Try incognito/private mode

### Syntax highlighting not working

**Problem:** Code shows as plain text

**Solution:**
1. Wait a moment for CDN to load
2. Check browser console for errors
3. Verify internet connection (CDN required)

---

## 📦 Deployment to GitHub Pages

### Automatic Deployment (Recommended)

1. Push to `main` branch
2. GitHub Actions will automatically deploy
3. Wait ~2 minutes
4. Visit `https://YOUR_USERNAME.github.io/REPO_NAME/`

### Manual Deployment

1. Go to repository Settings
2. Navigate to Pages section
3. Deploy the site prepared by `.github/workflows/deploy.yml`
4. Click Save
5. Wait for deployment
6. Visit the provided URL

---

## 🧪 Testing Checklist

Before committing changes:

- [ ] LSP bridge starts without errors
- [ ] HTTP server serves files
- [ ] Editor loads at http://localhost:8888/apps/playground/
- [ ] Real-time diagnostics working
- [ ] Syntax highlighting works
- [ ] All buttons functional
- [ ] Theme toggle works
- [ ] Console has no errors
- [ ] Application and component tests pass: `npm run test:unit && uv run pytest -v`
- [ ] Mobile view works

---

## 📚 Resources

### CodeMirror Documentation
- [Main Docs](https://codemirror.net/6/)
- [Examples](https://codemirror.net/examples/)
- [API Reference](https://codemirror.net/docs/ref/)

### Development
- [ES Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Import Maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)

### Python
- [MicroPython](https://micropython.org/)
- [Python Docs](https://docs.python.org/3/)

---

## 💡 Tips

### Performance

- Editor handles large files (tested up to 10,000 lines)
- Syntax highlighting is lazy-loaded
- CDN modules are cached by browser

### Accessibility

- All buttons have ARIA labels
- Keyboard navigation supported
- Screen reader compatible

### Browser DevTools

```javascript
// Access editor in console (for debugging)
import('/app.js').then(module => {
    console.log(module.view.state.doc.toString());
});
```

---

## 🤝 Get Help

- Open an [Issue](../../issues)
- Check [Discussions](../../discussions)
- Read [Contributing Guide](CONTRIBUTING.md)

---

**Happy Coding! 🐍✨**
