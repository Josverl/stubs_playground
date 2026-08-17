export const DEFAULT_STUB_FILTERS = Object.freeze({
    family: 'micropython',
    version: '',
    port: '',
    board: '',
});

function stableVersionParts(version) {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(version || '').trim());
    return match ? match.slice(1).map(part => Number.parseInt(part || '0', 10)) : null;
}

export function availableRuntimeVersionOptions(catalogDocument, limit = 3) {
    const versions = Array.isArray(catalogDocument?.availableRuntimeVersions)
        ? catalogDocument.availableRuntimeVersions
        : [];
    return [...new Set(versions)]
        .filter(version => stableVersionParts(version))
        .sort((left, right) => {
            const leftParts = stableVersionParts(left);
            const rightParts = stableVersionParts(right);
            for (let index = 0; index < 3; index += 1) {
                if (leftParts[index] !== rightParts[index]) {
                    return rightParts[index] - leftParts[index];
                }
            }
            return 0;
        })
        .slice(0, limit);
}

export function detectedDefaultRuntimeVersion(catalogDocument) {
    return availableRuntimeVersionOptions(catalogDocument, Number.POSITIVE_INFINITY)[0] || '';
}

function majorMinor(version) {
    const match = /^(\d+)\.(\d+)/.exec(String(version || '').trim());
    return match ? `${match[1]}.${match[2]}` : '';
}

function sameValue(left, right) {
    return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

export function filterStubPackages(packages, filters = {}) {
    const selected = { ...DEFAULT_STUB_FILTERS, ...filters };
    const selectedVersion = majorMinor(selected.version);

    return (packages || []).filter((entry) => {
        if (entry.kind !== 'runtime' || !sameValue(entry.family, selected.family)) return false;
        if (selectedVersion && !entry.runtimeVersions?.some(
            version => majorMinor(version) === selectedVersion,
        )) return false;
        if (selected.port && !sameValue(entry.port, selected.port)) return false;
        if (selected.board && !sameValue(entry.board, selected.board)) return false;
        return true;
    });
}

export function availableStubFilterValues(packages, filters, field) {
    const narrowedFilters = { ...filters, [field]: '' };
    return [...new Set(
        filterStubPackages(packages, narrowedFilters)
            .map(entry => entry[field])
            .filter(Boolean),
    )].sort((left, right) => {
        if (left === 'GENERIC') return -1;
        if (right === 'GENERIC') return 1;
        return left.localeCompare(right);
    });
}