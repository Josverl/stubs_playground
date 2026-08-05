"""
Tests for OPFS Project Storage (Stage 1)

Verifies the browser-side OPFS storage API via Playwright console evaluation.
These tests use the page's JS context to exercise OPFSProject directly.
"""

import pytest
import time

pytestmark = pytest.mark.editor

from timing import LSP_TIMEOUT, UI_TIMEOUT, OPFS_SETTLE

counter = 0
start = time.time()
previous = time.time()

def logmessage(message = "Step", restart=False):
    pass
    # global counter, start, previous
    # if restart:
    #     counter = 0
    # if counter == 0:
    #     start = time.time()
    # counter += 10
    # elapsed_ms = (time.time() - start) * 1000
    # lapse_ms = (time.time() - previous) * 1000
    # previous = time.time()
    # print(f"[{counter}] {elapsed_ms:6.1f} ms (+{lapse_ms:6.1f} ms) {message}")

def _load_editor(page, live_server):
    logmessage("Loading editor")
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    _wait_for_editor_ready(page)


def _wait_for_editor_ready(page):
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=LSP_TIMEOUT,
    )
    logmessage("Waiting for editor to be ready")
    page.wait_for_selector(".cm-editor", timeout=UI_TIMEOUT)
    time.sleep(OPFS_SETTLE)  # let async init settle
    logmessage("Editor loaded and ready")


def _import_opfs(page):
    """Import OPFSProject into page context for testing."""
    return page.evaluate("""
        async () => {
            if (!window._opfsReady) {
                const mod = await import('./storage/opfs-project.js');
                window.OPFSProject = mod.OPFSProject;
                window._opfsReady = true;
            }
            return true;
        }
    """)


def _reset_opfs_state(page):
    """Delete project files, reset last-active state, and reseed main.py."""
    logmessage("Resetting OPFS state")
    page.evaluate("""
        async () => {
            const entries = await window.OPFSProject.listFiles();
            const sorted = [...entries].sort(
                (left, right) => right.path.split('/').length - left.path.split('/').length
            );

            for (const entry of sorted) {
                try {
                    await window.OPFSProject.deleteFile(entry.path);
                } catch (error) {
                    const message = String(error && error.message ? error.message : error);
                    const name = error && error.name ? error.name : '';
                    if (name !== 'NotFoundError' && !message.includes('not found')) {
                        throw error;
                    }
                }
            }

            localStorage.removeItem('mp_last_active_file');
            await window.OPFSProject.init();
            window._opfsReady = true;
        }
    """)


@pytest.fixture(scope="module")
def opfs_page(shared_page, live_server):
    logmessage("Initializing shared OPFS page", restart=True)
    _load_editor(shared_page, live_server)
    logmessage("importing OPFS")
    _import_opfs(shared_page)
    return shared_page


@pytest.fixture(autouse=True)
def reset_opfs_between_tests(opfs_page):
    _import_opfs(opfs_page)
    _reset_opfs_state(opfs_page)
    return opfs_page


class TestOPFSStorage:
    def test_opfs_init_seeds_main_py(self, opfs_page):
        """After init, main.py should exist in OPFS."""
        logmessage("Testing OPFS init seeds main.py")
        logmessage("Checking ....") 
        exists = opfs_page.evaluate("""
            async () => {
                return window.OPFSProject.exists('main.py');
            }
        """)
        logmessage("Checked for main.py existence")
        assert exists, "main.py should be seeded on first init"

    def test_write_and_read_file(self, opfs_page):
        """writeFile then readFile returns the same content."""
        content = opfs_page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('test_rw.py', '# hello');
                return window.OPFSProject.readFile('test_rw.py');
            }
        """)
        assert content == "# hello", f"Unexpected content: {content!r}"

    def test_list_files_includes_written_file(self, opfs_page):
        """listFiles returns an entry for a file we wrote."""
        entries = opfs_page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('list_test.py', '');
                const files = await window.OPFSProject.listFiles();
                return files.map(e => e.path);
            }
        """)
        assert any('list_test.py' in p for p in entries), f"list_test.py not in {entries}"

    def test_delete_file(self, opfs_page):
        """deleteFile removes the file."""
        exists_after = opfs_page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('to_delete.py', '# temp');
                await window.OPFSProject.deleteFile('to_delete.py');
                return window.OPFSProject.exists('to_delete.py');
            }
        """)
        assert not exists_after, "File should be gone after deleteFile"

    def test_rename_file(self, opfs_page):
        """renameFile moves content and removes old path."""
        result = opfs_page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('old_name.py', '# renamed');
                await window.OPFSProject.renameFile('old_name.py', 'new_name.py');
                const newExists = await window.OPFSProject.exists('new_name.py');
                const oldExists = await window.OPFSProject.exists('old_name.py');
                const content = await window.OPFSProject.readFile('new_name.py');
                return { newExists, oldExists, content };
            }
        """)
        assert result['newExists'], "new_name.py should exist"
        assert not result['oldExists'], "old_name.py should be gone"
        assert result['content'] == '# renamed'

    def test_rename_rollback_preserves_existing_destination(self, opfs_page):
        """If old-path delete fails during rename, pre-existing destination content is restored."""
        result = opfs_page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('rollback_old.py', '# old-content');
                await window.OPFSProject.writeFile('rollback_new.py', '# existing-destination');

                let simulated = false;
                const fallbackKey = 'opfs_fallback:rollback_old.py';
                const usingFallback = localStorage.getItem(fallbackKey) !== null;
                let restoreDelete;

                if (usingFallback) {
                    const storagePrototype = Object.getPrototypeOf(localStorage);
                    const originalRemoveItem = storagePrototype.removeItem;
                    storagePrototype.removeItem = function(key) {
                        if (!simulated && key === fallbackKey) {
                            simulated = true;
                            throw new DOMException(
                                'simulated failure',
                                'NoModificationAllowedError'
                            );
                        }
                        return originalRemoveItem.call(this, key);
                    };
                    restoreDelete = () => {
                        storagePrototype.removeItem = originalRemoveItem;
                    };
                } else {
                    const root = await navigator.storage.getDirectory();
                    const projectDir = await root.getDirectoryHandle('mp_project');
                    const directoryPrototype = Object.getPrototypeOf(projectDir);
                    const originalRemoveEntry = directoryPrototype.removeEntry;
                    directoryPrototype.removeEntry = async function(name, options) {
                        if (!simulated && name === 'rollback_old.py') {
                            simulated = true;
                            throw new DOMException(
                                'simulated failure',
                                'NoModificationAllowedError'
                            );
                        }
                        return originalRemoveEntry.call(this, name, options);
                    };
                    restoreDelete = () => {
                        directoryPrototype.removeEntry = originalRemoveEntry;
                    };
                }

                let renameError = null;
                try {
                    await window.OPFSProject.renameFile('rollback_old.py', 'rollback_new.py');
                } catch (err) {
                    renameError = err && err.name ? err.name : String(err);
                } finally {
                    restoreDelete();
                }

                const oldExists = await window.OPFSProject.exists('rollback_old.py');
                const newExists = await window.OPFSProject.exists('rollback_new.py');
                const newContent = newExists ? await window.OPFSProject.readFile('rollback_new.py') : null;

                return {
                    backend: usingFallback ? 'localStorage' : 'opfs',
                    simulated,
                    renameError,
                    oldExists,
                    newExists,
                    newContent,
                };
            }
        """)

        assert result['simulated'], f"delete failure injection did not run: {result}"
        assert result['renameError'], "rename should fail when delete old is forced to fail"
        assert result['oldExists'], "old file should still exist after failed rename"
        assert result['newExists'], "destination should still exist after rollback"
        assert result['newContent'] == '# existing-destination', "destination content should be restored"

    def test_last_active_file_persists(self, opfs_page):
        """setLastActiveFile persists across calls within same session."""
        result = opfs_page.evaluate("""
            () => {
                window.OPFSProject.setLastActiveFile('helpers.py');
                return window.OPFSProject.getLastActiveFile();
            }
        """)
        assert result == 'helpers.py'

    def test_file_persists_after_reload(self, opfs_page):
        """A file written in one page load is readable after reload."""
        opfs_page.evaluate("""
            async () => {
                await window.OPFSProject.writeFile('persist_test.py', '# persisted');
            }
        """)

        # Reload the page
        opfs_page.reload(wait_until="domcontentloaded")
        _wait_for_editor_ready(opfs_page)
        _import_opfs(opfs_page)

        content = opfs_page.evaluate("""
            async () => {
                return window.OPFSProject.readFile('persist_test.py');
            }
        """)
        assert content == '# persisted', f"Expected persisted content, got {content!r}"
