/**
 * Application event bus — thin wrapper around document CustomEvent dispatch.
 *
 * Components dispatch lifecycle events here; any component can subscribe
 * via `document.addEventListener(Events.FILE_OPENED, handler)`.
 *
 * Follows the same pattern as ViperIDE's app-level events.
 */

export const Events = Object.freeze({
    FILE_OPENED:    'mp:fileOpened',
    FILE_CLOSED:    'mp:fileClosed',
    FILE_SAVED:     'mp:fileSaved',
    FILE_CREATED:   'mp:fileCreated',
    FILE_RENAMED:   'mp:fileRenamed',
    FILE_DELETED:   'mp:fileDeleted',
    ACTIVE_CHANGED: 'mp:activeFileChanged',
    DIR_DELETED:    'mp:dirDeleted',
});

/**
 * Dispatch a lifecycle event on `document`.
 * @param {string} name — one of the Events constants
 * @param {object} [detail] — payload accessible via `event.detail`
 */
export function dispatch(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
}
