"""
Tests for File Tree UI (Stage 2)

Verifies that the file tree sidebar renders, that files can be created
and appear in the tree, and that clicking a file opens it in the editor.
"""

import pytest
import time

from timing import CDN_TIMEOUT, UI_TIMEOUT, OPFS_TIMEOUT, SHORT_SETTLE, OPFS_SETTLE

pytestmark = pytest.mark.editor


def _load_editor(page, live_server):
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    time.sleep(OPFS_SETTLE)


def _reset_tree_state(page):
    """Reset UI/OPFS state through app controls without reloading the app."""
    # Delete all project files through the built-in action so editor + tree stay in sync.
    clear_all = page.locator(".file-tree__clear-all-btn")
    if clear_all.count() > 0:
        page.once("dialog", lambda dialog: dialog.accept())
        clear_all.click()
        page.wait_for_function(
            """() => {
                const clearButton = document.querySelector('.file-tree__clear-all-btn');
                const hasEntries = document.querySelector(
                    '.file-tree__file, .file-tree__dir'
                );
                return clearButton && !clearButton.disabled && !hasEntries;
            }""",
            timeout=OPFS_TIMEOUT,
        )

    # Recreate main.py from the tree UI.
    new_file_btn = page.locator(".file-tree__header .file-tree__icon-btn").first
    new_file_btn.click()
    page.wait_for_selector(".file-tree__inline-input", timeout=UI_TIMEOUT)
    page.locator(".file-tree__inline-input").fill("main.py")
    page.keyboard.press("Enter")

    page.wait_for_function(
        """() => [...document.querySelectorAll('.file-tree__file .file-tree__name')]
            .some((node) => node.textContent.trim() === 'main.py')""",
        timeout=UI_TIMEOUT,
    )

    # Make sure main.py is active so tab-based tests start from a known state.
    page.evaluate("""() => {
        const rows = [...document.querySelectorAll('.file-tree__file')];
        const main = rows.find((node) => node.dataset.path === 'main.py');
        if (main) {
            const row = main.querySelector('.file-tree__row');
            if (row) row.click();
        }
    }""")
    time.sleep(SHORT_SETTLE)


@pytest.fixture(scope="module")
def tree_page(shared_page, live_server):
    _load_editor(shared_page, live_server)
    return shared_page


@pytest.fixture(autouse=True)
def reset_tree_between_tests(tree_page):
    _reset_tree_state(tree_page)
    return tree_page


class TestFileTreeUI:
    def test_file_tree_panel_visible(self, tree_page):
        """#file-tree-panel is rendered and visible."""
        panel = tree_page.locator("#file-tree-panel")
        assert panel.count() > 0, "#file-tree-panel should exist in DOM"

    def test_file_tree_shows_main_py(self, tree_page):
        """main.py appears in the file tree after init."""
        # Wait for tree to render
        tree_page.wait_for_function(
            "() => document.querySelector('.file-tree__list') !== null",
            timeout=5000,
        )
        time.sleep(0.5)
        tree_text = tree_page.locator(".file-tree__list").inner_text()
        assert "main.py" in tree_text, f"main.py not found in file tree: {tree_text!r}"

    def test_tab_bar_rendered(self, tree_page):
        """#tab-bar is rendered."""
        assert tree_page.locator("#tab-bar").count() > 0, "#tab-bar should exist"

    def test_tab_bar_shows_active_file(self, tree_page):
        """Tab bar shows at least one tab after editor init."""
        tree_page.wait_for_function(
            "() => document.querySelector('.tab-bar__tab') !== null",
            timeout=OPFS_TIMEOUT,
        )
        tabs = tree_page.locator(".tab-bar__tab")
        assert tabs.count() >= 1, "At least one tab should be open"

    def test_sidebar_resize_handle_exists(self, tree_page):
        """Resize handle between sidebar and editor is present."""
        handle = tree_page.locator("#sidebar-resize-handle")
        assert handle.count() > 0, "#sidebar-resize-handle should be in DOM"

    def test_new_file_via_tree_header_button(self, tree_page):
        """Clicking the + button in the tree header opens inline input; Enter creates the file."""
        tree_page.wait_for_function(
            "() => document.querySelector('.file-tree__header') !== null",
            timeout=5000,
        )

        tree_page.locator(".file-tree__header .file-tree__icon-btn").first.click()
        tree_page.wait_for_selector(".file-tree__inline-input", timeout=3000)
        tree_page.locator(".file-tree__inline-input").fill("tree_created.py")
        tree_page.keyboard.press("Enter")
        time.sleep(0.5)

        # The file should now appear in the tree
        tree_text = tree_page.locator(".file-tree__list").inner_text()
        assert "tree_created.py" in tree_text, \
            f"tree_created.py should appear in tree after creation: {tree_text!r}"

    def test_rename_handles_selector_special_chars(self, tree_page, live_server):
        """Rename flow works for file paths containing selector-significant characters."""
        result = tree_page.evaluate("""
            async () => {
                const mod = await import('./storage/opfs-project.js');
                await mod.OPFSProject.writeFile('a"b].py', '# special');
                location.reload();
                return true;
            }
        """)
        assert result is True

        tree_page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
        tree_page.wait_for_selector(".file-tree__list", timeout=UI_TIMEOUT)
        time.sleep(SHORT_SETTLE)

        rename_result = tree_page.evaluate("""
            () => {
                const items = [...document.querySelectorAll('.file-tree__file')];
                const row = items.find((node) => node.dataset.path === 'a"b].py');
                if (!row) return { ok: false, reason: 'row-not-found' };
                const btn = row.querySelector('button[title="Rename"]');
                if (!btn) return { ok: false, reason: 'rename-button-not-found' };
                btn.click();
                const input = document.querySelector('.file-tree__inline-input');
                return { ok: !!input };
            }
        """)
        assert rename_result["ok"], f"rename input should open for special-char path: {rename_result}"

    def test_export_button_exists(self, tree_page):
        """Export button is present in the header."""
        btn = tree_page.locator("#exportBtn")
        assert btn.count() > 0, "#exportBtn should exist"

    def test_import_input_exists(self, tree_page):
        """Import file input is present."""
        inp = tree_page.locator("#importFile")
        assert inp.count() > 0, "#importFile should exist"
