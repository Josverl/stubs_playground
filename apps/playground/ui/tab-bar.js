/**
 * Tab Bar UI
 *
 * Renders a row of tabs above the editor — one per open file.
 * Features:
 *  - Close button on each tab
 *  - Dirty indicator (•) when file has unsaved changes
 *  - Active tab highlight
 */

export class TabBar {
    /**
     * @param {HTMLElement} container  The element to render tabs into.
     * @param {object} callbacks
     * @param {(path: string) => void}  callbacks.onSelect   Called when user clicks a tab.
     * @param {(path: string) => void}  callbacks.onClose    Called when user clicks ×.
     */
    constructor(container, { onSelect, onClose }) {
        this._container = container;
        this._onSelect = onSelect;
        this._onClose = onClose;
        this._tabs = []; // [{path, dirty}]
        this._active = null;
        container.classList.add('tab-bar');
    }

    /** Sync the rendered tabs to match the supplied open-file list. */
    update({ openFiles, activeFile, isDirty }) {
        this._tabs = openFiles.map(p => ({ path: p, dirty: isDirty(p) }));
        this._active = activeFile;
        this._render();
    }

    _render() {
        this._container.innerHTML = '';

        if (this._tabs.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'tab-bar__tab tab-bar__tab--placeholder tab-bar__tab--active';
            placeholder.title = 'No file open';

            const label = document.createElement('span');
            label.className = 'tab-bar__label';
            label.textContent = 'Untitled';

            placeholder.appendChild(label);
            this._container.appendChild(placeholder);
            return;
        }

        for (const { path, dirty } of this._tabs) {
            const tab = document.createElement('div');
            tab.className = 'tab-bar__tab' + (path === this._active ? ' tab-bar__tab--active' : '');
            tab.dataset.path = path;
            tab.title = path;

            const label = document.createElement('span');
            label.className = 'tab-bar__label';
            const filename = path.split('/').pop();
            label.textContent = (dirty ? '• ' : '') + filename;

            const close = document.createElement('button');
            close.className = 'tab-bar__close';
            close.textContent = '×';
            close.title = 'Close';
            close.setAttribute('aria-label', `Close ${filename}`);
            close.addEventListener('click', (e) => {
                e.stopPropagation();
                this._onClose(path);
            });

            tab.appendChild(label);
            tab.appendChild(close);
            tab.addEventListener('click', () => this._onSelect(path));

            this._container.appendChild(tab);
        }
    }
}
