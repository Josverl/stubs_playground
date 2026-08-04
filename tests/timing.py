"""Shared timing constants for the test suite.

Millisecond values are Playwright ``timeout=`` parameters.
Second values are ``time.sleep()`` durations.

Keep DEBOUNCE_MS in sync with CHANGE_DEBOUNCE_MS in apps/playground/app.js.
"""

# ---------------------------------------------------------------------------
# Playwright timeout= values (milliseconds)
# ---------------------------------------------------------------------------

CDN_TIMEOUT = 15_000     # CodeMirror modules to load from esm.sh CDN
UI_TIMEOUT = 5_000       # fast DOM state changes (theme toggle, clear, etc.)
LSP_TIMEOUT = CDN_TIMEOUT + UI_TIMEOUT     # Pyright worker to respond with diagnostics
OPFS_TIMEOUT = 5_000     # OPFS file-system operation

# ---------------------------------------------------------------------------
# App timing — must stay in sync with apps/playground/app.js
# ---------------------------------------------------------------------------

DEBOUNCE_MS = 300        # CHANGE_DEBOUNCE_MS in app.js

# ---------------------------------------------------------------------------
# time.sleep() durations (seconds)
# ---------------------------------------------------------------------------

OPFS_SETTLE = 1.5        # OPFS async init to settle after page load/reload
DEBOUNCE_SETTLE = 0.4    # let the 300 ms debounce fire before continuing
LSP_ROUND_TRIP = 2.5     # debounce flush + Pyright processing margin
SHORT_SETTLE = 0.5       # generic short UI settle after interactions
POLL_INTERVAL = 0.3      # polling interval in deadline-loop waits
HOVER_WAIT = 1.5         # hover tooltip to appear
