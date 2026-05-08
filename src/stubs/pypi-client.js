const PYPI_JSON_BASE = 'https://pypi.org/pypi';

function tokenizeVersion(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9.+-]/g, '')
        .split(/([0-9]+|[a-z]+)/)
        .filter(Boolean)
        .map((token) => (/^[0-9]+$/.test(token) ? Number.parseInt(token, 10) : token));
}

function compareVersions(a, b) {
    const left = tokenizeVersion(a);
    const right = tokenizeVersion(b);
    const len = Math.max(left.length, right.length);

    for (let i = 0; i < len; i += 1) {
        const l = left[i];
        const r = right[i];

        if (l === undefined && r === undefined) return 0;
        if (l === undefined) return -1;
        if (r === undefined) return 1;

        if (typeof l === 'number' && typeof r === 'number') {
            if (l !== r) return l > r ? 1 : -1;
            continue;
        }

        if (typeof l === 'number') return 1;
        if (typeof r === 'number') return -1;

        if (l !== r) return l > r ? 1 : -1;
    }

    return 0;
}

function parseVersionSpecifier(specifier) {
    const raw = String(specifier || '').trim();
    if (!raw) return [];

    return raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const m = /^(==|!=|>=|<=|>|<)?\s*([A-Za-z0-9][A-Za-z0-9_.+*-]*)$/.exec(part);
            if (!m) {
                throw new Error(`Invalid version specifier: ${part}`);
            }
            return {
                op: m[1] || '==',
                version: m[2],
            };
        });
}

function matchesWildcardVersion(version, pattern) {
    const rawPattern = String(pattern || '').toLowerCase();
    if (!rawPattern.includes('*')) {
        return String(version || '').toLowerCase() === rawPattern;
    }

    if (/\*/g.test(rawPattern) && rawPattern.split('*').length > 2) {
        throw new Error(`Invalid wildcard version pattern: ${pattern}`);
    }

    if (rawPattern.endsWith('.*')) {
        const prefix = rawPattern.slice(0, -2);
        const candidate = String(version || '').toLowerCase();
        const candidatePrefixes = [prefix];

        // MicroPython stubs often publish as X.Y.0.postN while users may request
        // X.Y.1.* based on firmware versioning. Allow this one-step patch fallback.
        const numeric = /^(\d+)\.(\d+)\.(\d+)$/.exec(prefix);
        if (numeric) {
            const patch = Number.parseInt(numeric[3], 10);
            if (Number.isFinite(patch) && patch === 1) {
                candidatePrefixes.push(`${numeric[1]}.${numeric[2]}.0`);
            }
        }

        return candidatePrefixes.some((candidatePrefix) => (
            candidate === candidatePrefix || candidate.startsWith(`${candidatePrefix}.`)
        ));
    }

    const [prefix, suffix] = rawPattern.split('*');
    const candidate = String(version || '').toLowerCase();
    if (!candidate.startsWith(prefix)) return false;
    if (!suffix) return true;
    return candidate.slice(prefix.length).endsWith(suffix);
}

function satisfiesVersion(version, constraints) {
    if (!constraints || constraints.length === 0) return true;

    return constraints.every(({ op, version: target }) => {
        if (target.includes('*')) {
            if (op !== '==' && op !== '!=') {
                throw new Error(`Wildcard versions are only supported with == or != (got ${op}${target})`);
            }
            const matches = matchesWildcardVersion(version, target);
            return op === '==' ? matches : !matches;
        }

        const cmp = compareVersions(version, target);
        if (op === '==') return cmp === 0;
        if (op === '!=') return cmp !== 0;
        if (op === '>=') return cmp >= 0;
        if (op === '<=') return cmp <= 0;
        if (op === '>') return cmp > 0;
        if (op === '<') return cmp < 0;
        return false;
    });
}

function isUniversalWheel(fileName) {
    return /-(?:py2\.py3|py3|py\d+)-none-any\.whl$/i.test(fileName);
}

export function normalizePackageName(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[-_.]+/g, '-');
}

export function parsePackageSpecifier(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return {
            packageName: '',
            versionSpecifier: '',
        };
    }

    const packageMatch = /^([A-Za-z0-9][A-Za-z0-9._-]*)(.*)$/.exec(raw);
    if (!packageMatch) {
        throw new Error('Invalid package specifier');
    }

    const packageName = packageMatch[1];
    const remainder = packageMatch[2].trim();
    if (!remainder) {
        return {
            packageName,
            versionSpecifier: '',
        };
    }

    if (!/^(==|!=|>=|<=|>|<)/.test(remainder)) {
        throw new Error('Version constraints must start with one of: ==, !=, >=, <=, >, <');
    }

    return {
        packageName,
        versionSpecifier: remainder,
    };
}

export async function fetchPackageIndex(packageName) {
    const normalized = normalizePackageName(packageName);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
        throw new Error('Package name is invalid');
    }

    const resp = await fetch(`${PYPI_JSON_BASE}/${encodeURIComponent(normalized)}/json`);
    if (!resp.ok) {
        throw new Error(`Failed to query PyPI (${resp.status})`);
    }

    return {
        normalizedName: normalized,
        data: await resp.json(),
    };
}

export function selectStubWheelRelease(indexData, versionSpecifier = '') {
    const constraints = parseVersionSpecifier(versionSpecifier);
    const releases = indexData?.releases || {};
    const versions = Object.keys(releases)
        .filter((v) => satisfiesVersion(v, constraints))
        .sort((a, b) => compareVersions(b, a));

    for (const version of versions) {
        const candidates = (releases[version] || []).filter((f) => {
            if (f.packagetype !== 'bdist_wheel') return false;
            if (!isUniversalWheel(f.filename || '')) return false;
            return true;
        });

        if (candidates.length === 0) continue;

        candidates.sort((a, b) => {
            const timeA = Date.parse(a.upload_time_iso_8601 || '') || 0;
            const timeB = Date.parse(b.upload_time_iso_8601 || '') || 0;
            return timeB - timeA;
        });

        return {
            version,
            wheel: candidates[0],
        };
    }

    throw new Error('No matching universal wheel found for this package/specifier');
}

export async function downloadWheelFile(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`Failed to download wheel (${resp.status})`);
    }
    return resp.arrayBuffer();
}
