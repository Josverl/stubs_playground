const STORAGE_KEY = 'mp_extraStubs_v1';

export function normalizeExtraFolderName(packageName) {
    return String(packageName || '')
        .trim()
        .toLowerCase()
        .replace(/[-_.]+/g, '-');
}

function safeParse(jsonValue) {
    try {
        return JSON.parse(jsonValue);
    } catch {
        return null;
    }
}

function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const packageName = normalizeExtraFolderName(entry.packageName || entry.normalizedName || '');
    if (!packageName) return null;
    if (!entry.files || typeof entry.files !== 'object') return null;

    const files = {};
    for (const [path, content] of Object.entries(entry.files)) {
        if (!path || typeof content !== 'string') continue;
        if (path.startsWith('/')) continue;
        files[path] = content;
    }
    if (Object.keys(files).length === 0) return null;

    return {
        packageName,
        version: String(entry.version || ''),
        wheelUrl: String(entry.wheelUrl || ''),
        wheelFilename: String(entry.wheelFilename || ''),
        installedAt: Number(entry.installedAt || Date.now()),
        files,
    };
}

export function loadExtraStubsRegistry() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = safeParse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
        .map(normalizeEntry)
        .filter(Boolean);
}

export function saveExtraStubsRegistry(entries) {
    const safeEntries = (entries || [])
        .map(normalizeEntry)
        .filter(Boolean);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeEntries));
    return safeEntries;
}

export function upsertExtraStubEntry(entries, nextEntry) {
    const normalizedNext = normalizeEntry(nextEntry);
    if (!normalizedNext) {
        throw new Error('Invalid extra stub entry');
    }

    const current = (entries || []).map(normalizeEntry).filter(Boolean);
    const existingIndex = current.findIndex((entry) => entry.packageName === normalizedNext.packageName);

    if (existingIndex >= 0) {
        current[existingIndex] = normalizedNext;
        return current;
    }

    current.push(normalizedNext);
    current.sort((a, b) => a.packageName.localeCompare(b.packageName));
    return current;
}

export function clearExtraStubsRegistry() {
    localStorage.removeItem(STORAGE_KEY);
}

export function buildWorkerExtraStubPayload(entries) {
    return (entries || [])
        .map(normalizeEntry)
        .filter(Boolean)
        .map((entry) => ({
            packageName: entry.packageName,
            files: entry.files,
        }));
}

export function buildAbsoluteExtraPaths(entries) {
    return (entries || [])
        .map(normalizeEntry)
        .filter(Boolean)
        .map((entry) => `/extra/${entry.packageName}`);
}
