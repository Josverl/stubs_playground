"""
Multi-file document management tests (Stage 3)

Verifies that:
- Opening a file makes it active in the editor and tab bar
- Editing file A, switching to B, switching back preserves A's content
- Tab bar dirty indicator appears when content is changed
"""

import pytest
import time

from tests.timing import CDN_TIMEOUT, UI_TIMEOUT, OPFS_TIMEOUT, OPFS_SETTLE, SHORT_SETTLE, POLL_INTERVAL, DEBOUNCE_SETTLE

pytestmark = pytest.mark.editor


_editor_loaded = False


def _load_editor(page, live_server):
    global _editor_loaded
    if _editor_loaded and page.locator(".cm-editor").count() > 0:
        return
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    time.sleep(OPFS_SETTLE)  # let OPFS init settle
    _editor_loaded = True


def _import_opfs(page):
    page.evaluate("""
        async () => {
            if (!window._opfsReady) {
                const mod = await import('./storage/opfs-project.js');
                window.OPFSProject = mod.OPFSProject;
                window._opfsReady = true;
            }
        }
    """)


def _reset_workspace_state(page):
    """Reset workspace and tabs through UI so app state stays consistent."""
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
def _shared_editor_page(shared_page, live_server):
    _load_editor(shared_page, live_server)
    _import_opfs(shared_page)
    return shared_page


@pytest.fixture(scope="function")
def page(_shared_editor_page):
    _import_opfs(_shared_editor_page)
    _reset_workspace_state(_shared_editor_page)
    return _shared_editor_page


class TestMultiFileDocumentManagement:
    def test_on_active_change_unsubscribe(self, page, live_server):
        """onActiveChange returns an unsubscribe function that detaches listeners."""
        _load_editor(page, live_server)

        result = page.evaluate("""
            async () => {
                const { DocumentManager } = await import('./editor/document-manager.js');
                const { OPFSProject } = await import('./storage/opfs-project.js');

                await OPFSProject.writeFile('listener_a.py', '# a');
                await OPFSProject.writeFile('listener_b.py', '# b');

                const host = document.createElement('div');
                document.body.appendChild(host);

                const createView = (_path, content) => ({
                    state: { doc: { toString: () => content } },
                    focus() {},
                    destroy() {},
                    dispatch() {},
                });

                const dm = new DocumentManager(host, createView);
                let calls = 0;
                const unsubscribe = dm.onActiveChange(() => { calls += 1; });

                await dm.openFile('listener_a.py');
                unsubscribe();
                await dm.openFile('listener_b.py');

                host.remove();
                return { calls };
            }
        """)

        assert result["calls"] == 1, f"Listener should only fire before unsubscribe: {result}"

    def test_initial_file_is_active_in_tab_bar(self, page, live_server):
        """The initially active file is shown as an active tab."""
        _load_editor(page, live_server)
        page.wait_for_function(
            "() => document.querySelector('.tab-bar__tab--active') !== null",
            timeout=OPFS_TIMEOUT,
        )
        active_tab = page.locator(".tab-bar__tab--active")
        assert active_tab.count() >= 1, "Active tab should be shown"
        label = active_tab.first.locator(".tab-bar__label").inner_text()
        # Active tab should show a Python file
        assert ".py" in label, f"Expected .py file tab, got: {label!r}"

    def test_open_second_file_switches_tab(self, page, live_server):
        """Opening a second file via the tree switches the active tab."""
        _load_editor(page, live_server)
        _import_opfs(page)

        # Create a second file
        page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('second.py', '# second file');
            }
        """)
        time.sleep(POLL_INTERVAL)

        # Click the file in the tree — wait for it to appear first
        page.wait_for_function(
            "() => document.querySelector('.file-tree__list') !== null",
            timeout=UI_TIMEOUT,
        )
        # Reload tree by navigating to the page again (tree will show the new file)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
        time.sleep(OPFS_SETTLE)

        # Find second.py in the tree and click it
        tree_items = page.locator(".file-tree__file")
        found = False
        for i in range(tree_items.count()):
            item = tree_items.nth(i)
            if "second.py" in item.inner_text():
                item.locator(".file-tree__row").click()
                found = True
                break

        assert found, "second.py should be in the file tree"
        time.sleep(SHORT_SETTLE)

        # The active tab should now show second.py
        page.wait_for_function(
            "() => { const t = document.querySelector('.tab-bar__tab--active .tab-bar__label'); return t && t.textContent.includes('second.py'); }",
            timeout=UI_TIMEOUT,
        )
        active_label = page.locator(".tab-bar__tab--active .tab-bar__label").inner_text()
        assert "second.py" in active_label, f"Active tab should be second.py, got: {active_label!r}"

    def test_edit_preserves_content_on_switch(self, page, live_server):
        """Edit file A, switch to B, switch back — A's content is preserved."""
        _load_editor(page, live_server)
        _import_opfs(page)

        # Create file B
        page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('file_b.py', '# file B');
            }
        """)
        time.sleep(POLL_INTERVAL)

        # Reload to pick up the new file in the tree
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
        time.sleep(OPFS_SETTLE)

        # Edit file A (main.py) — clear and type unique content
        page.locator(".editor-pane--active .cm-content").click()
        page.keyboard.press("Control+a")
        page.keyboard.press("Delete")
        page.wait_for_function(
            "() => document.querySelector('.editor-pane--active .cm-content')?.innerText.trim() === ''",
            timeout=UI_TIMEOUT,
        )
        page.locator(".editor-pane--active .cm-content").click()
        page.keyboard.type("# unique content in file A")
        time.sleep(POLL_INTERVAL)

        # Switch to file B via tree
        tree_items = page.locator(".file-tree__file")
        for i in range(tree_items.count()):
            item = tree_items.nth(i)
            if "file_b.py" in item.inner_text():
                item.locator(".file-tree__row").click()
                break

        time.sleep(SHORT_SETTLE)

        # Switch back to main.py (first tab)
        tabs = page.locator(".tab-bar__tab")
        for i in range(tabs.count()):
            tab = tabs.nth(i)
            if "main.py" in tab.inner_text():
                tab.click()
                break

        time.sleep(SHORT_SETTLE)

        # Content should be preserved
        content = page.locator(".editor-pane--active .cm-content").inner_text()
        assert "unique content in file A" in content, \
            f"File A's content should be preserved after switching, got: {content[:200]!r}"

    def test_close_tab_removes_it(self, page, live_server):
        """Clicking × on a tab removes it from the tab bar."""
        _load_editor(page, live_server)
        _import_opfs(page)

        # Create an extra file so we always have one to close
        page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('closeable.py', '# close me');
            }
        """)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
        time.sleep(OPFS_SETTLE)

        # Open closeable.py
        tree_items = page.locator(".file-tree__file")
        for i in range(tree_items.count()):
            item = tree_items.nth(i)
            if "closeable.py" in item.inner_text():
                item.locator(".file-tree__row").click()
                break
        time.sleep(SHORT_SETTLE)

        # Count tabs before close
        tab_count_before = page.locator(".tab-bar__tab").count()
        assert tab_count_before >= 2, "Should have at least 2 tabs open before closing"

        # Close the closeable.py tab
        tabs = page.locator(".tab-bar__tab")
        for i in range(tabs.count()):
            tab = tabs.nth(i)
            if "closeable.py" in tab.inner_text():
                tab.locator(".tab-bar__close").click()
                break

        time.sleep(POLL_INTERVAL)
        tab_count_after = page.locator(".tab-bar__tab").count()
        assert tab_count_after < tab_count_before, \
            f"Tab count should decrease after close: {tab_count_before} → {tab_count_after}"

    def test_closing_last_tab_shows_untitled_placeholder(self, page, live_server):
        """Closing the last real tab should leave a visible Untitled placeholder tab."""
        _load_editor(page, live_server)

        # Close all tabs that have close buttons.
        while page.locator(".tab-bar__close").count() > 0:
            page.locator(".tab-bar__close").first.click()
            time.sleep(0.2)

        placeholder = page.locator(".tab-bar__tab--placeholder .tab-bar__label")
        assert placeholder.count() == 1, "Untitled placeholder tab should be shown"
        assert placeholder.inner_text().strip() == "Untitled"

    def test_dirty_close_cancel_and_discard(self, page, live_server):
        """Dirty close prompt supports cancel (stay open) and discard (close without save)."""
        _load_editor(page, live_server)
        _import_opfs(page)

        page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('dirty_close.py', '# baseline');
            }
        """)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
        time.sleep(1.2)

        # Open dirty_close.py
        tree_items = page.locator(".file-tree__file")
        for i in range(tree_items.count()):
            item = tree_items.nth(i)
            if "dirty_close.py" in item.inner_text():
                item.locator(".file-tree__row").click()
                break
        time.sleep(DEBOUNCE_SETTLE)

        # Make unsaved edit
        page.locator(".editor-pane--active .cm-content").click()
        page.keyboard.type("\n# unsaved")
        time.sleep(0.2)

        # First close attempt: cancel
        page.once("dialog", lambda d: d.dismiss())
        tabs = page.locator(".tab-bar__tab")
        for i in range(tabs.count()):
            tab = tabs.nth(i)
            if "dirty_close.py" in tab.inner_text():
                tab.locator(".tab-bar__close").click()
                break
        time.sleep(DEBOUNCE_SETTLE)

        # Tab should still be open after cancel
        labels_after_cancel = [
            page.locator(".tab-bar__tab .tab-bar__label").nth(i).inner_text()
            for i in range(page.locator(".tab-bar__tab .tab-bar__label").count())
        ]
        assert any("dirty_close.py" in lbl for lbl in labels_after_cancel), "Tab should remain after cancel"

        # Second close attempt: discard/confirm
        page.once("dialog", lambda d: d.accept())
        tabs = page.locator(".tab-bar__tab")
        for i in range(tabs.count()):
            tab = tabs.nth(i)
            if "dirty_close.py" in tab.inner_text():
                tab.locator(".tab-bar__close").click()
                break
        time.sleep(SHORT_SETTLE)

        # Reopen file and verify unsaved change was not persisted.
        tree_items = page.locator(".file-tree__file")
        for i in range(tree_items.count()):
            item = tree_items.nth(i)
            if "dirty_close.py" in item.inner_text():
                item.locator(".file-tree__row").click()
                break
        time.sleep(DEBOUNCE_SETTLE)
        content = page.locator(".editor-pane--active .cm-content").inner_text()
        assert "unsaved" not in content, "Discard close should not persist unsaved edits"

    def test_directory_delete_cascades_open_tabs(self, page, live_server):
        """Deleting a directory closes any open tabs inside that directory."""
        _load_editor(page, live_server)
        _import_opfs(page)

        page.evaluate("""
            async () => {
                await window.OPFSProject.createDirectory('lib_cascade');
                await window.OPFSProject.writeFile('lib_cascade/file_a.py', '# cascade');
            }
        """)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
        time.sleep(1.2)

        # Expand lib_cascade directory if collapsed.
        page.evaluate("""
            () => {
                const dirNode = [...document.querySelectorAll('.file-tree__dir')]
                    .find((n) => n.dataset.path === 'lib_cascade');
                if (dirNode && !dirNode.classList.contains('file-tree__dir--expanded')) {
                    dirNode.querySelector('.file-tree__row').click();
                }
            }
        """)
        time.sleep(POLL_INTERVAL)

        # Open nested file tab first.
        opened = page.evaluate("""
            () => {
                const fileNode = [...document.querySelectorAll('.file-tree__file')]
                    .find((n) => n.dataset.path === 'lib_cascade/file_a.py');
                if (!fileNode) return false;
                fileNode.querySelector('.file-tree__row').click();
                return true;
            }
        """)
        assert opened, "file_a.py should be present in file tree"
        time.sleep(DEBOUNCE_SETTLE)

        # Delete the directory via file-tree actions and confirm inline dialog.
        deleted = page.evaluate("""
            () => {
                const dirNode = [...document.querySelectorAll('.file-tree__dir')]
                    .find((n) => n.dataset.path === 'lib_cascade');
                if (!dirNode) return false;
                const delBtn = dirNode.querySelector('button[title="Delete"]');
                if (!delBtn) return false;
                delBtn.click();
                const confirmBtn = document.querySelector('.file-tree__inline-confirm button[title="Confirm delete"]');
                if (!confirmBtn) return false;
                confirmBtn.click();
                return true;
            }
        """)
        assert deleted is True, "Directory delete flow should be triggerable"
        time.sleep(0.7)

        tab_labels = [
            page.locator(".tab-bar__tab .tab-bar__label").nth(i).inner_text()
            for i in range(page.locator(".tab-bar__tab .tab-bar__label").count())
        ]
        assert all("file_a.py" not in lbl for lbl in tab_labels), "Nested file tab should be closed on dir delete"
