import { unzipSync } from "fflate";

import stubPackageCatalog from "../assets/stub-package-catalog.json";
import type {
    ExtraStubPackage,
    InstalledStubPackage,
    StubPackageCatalogEntry,
    StubPackageCatalogResultEntry,
    StubPackageRelease,
    StubPackageSelection,
} from "./messages";

const PYPI_JSON_BASE = "https://pypi.org/pypi";
const DATABASE_NAME = "mp-codemirror-stub-packages";
const DATABASE_VERSION = 1;
const PACKAGE_STORE = "packages";
const MAX_WHEEL_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 30 * 1024 * 1024;
const MAX_STUB_FILES = 10_000;
const PYPI_REQUEST_TIMEOUT_MS = 15_000;
const INSTALL_DEADLINE_MS = 55_000;
const STDLIB_SUPPORT_FILES = new Set([
    "_mpy_shed/mp_implementation.py",
    "_mpy_shed/mp_mem.py",
]);

interface PyPIFile {
    filename?: string;
    packagetype?: string;
    url?: string;
    size?: number;
    upload_time_iso_8601?: string;
    yanked?: boolean;
}

interface PyPIIndex {
    info?: {
        version?: string;
        requires_dist?: string[] | null;
    };
    releases?: Record<string, PyPIFile[]>;
    urls?: PyPIFile[];
}

interface ExtractionBudget {
    bytes: number;
    files: number;
}

interface ResolvedStubPackage {
    packageName: string;
    version: string;
    wheel: PyPIFile;
    files: Record<string, string>;
}

interface CachedStubPackage extends ExtraStubPackage {
    key: string;
    version: string;
    wheelFilename: string;
    wheelUrl: string;
    installedAt: number;
    active: boolean;
}

function packageCatalog(): StubPackageCatalogEntry[] {
    const packages = (stubPackageCatalog as { packages?: unknown }).packages;
    if (!Array.isArray(packages)) {
        throw new Error("Stub package catalog must contain a packages array");
    }

    return packages.map((entry, index) => {
        if (!entry || typeof entry !== "object") {
            throw new Error(`Stub package catalog entry ${index} must be an object`);
        }
        const candidate = entry as Record<string, unknown>;
        const kind = candidate.kind;
        if (
            typeof candidate.id !== "string"
            || typeof candidate.packageName !== "string"
            || typeof candidate.label !== "string"
            || (kind !== "stdlib" && kind !== "board")
        ) {
            throw new Error(`Stub package catalog entry ${index} is invalid`);
        }
        return {
            id: candidate.id,
            packageName: normalizePackageName(candidate.packageName),
            label: candidate.label,
            kind,
        };
    });
}

function normalizePackageName(name: string): string {
    const normalized = String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[-_.]+/g, "-");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
        throw new Error("Package name is invalid");
    }
    return normalized;
}

function catalogEntry(packageName: string): StubPackageCatalogEntry | undefined {
    const normalizedName = normalizePackageName(packageName);
    return packageCatalog().find(
        (catalogEntry) => catalogEntry.packageName === normalizedName,
    );
}

function requireCatalogEntry(packageName: string): StubPackageCatalogEntry {
    const normalizedName = normalizePackageName(packageName);
    const entry = catalogEntry(normalizedName);
    if (!entry) {
        throw new Error(`Stub package is not supported: ${normalizedName}`);
    }
    return entry;
}

function isReservedBoardPackageName(packageName: string): boolean {
    const normalizedName = normalizePackageName(packageName);
    return normalizedName === "circuitpython-stubs"
        || (/^micropython-.+-stubs$/.test(normalizedName)
            && normalizedName !== "micropython-stdlib-stubs");
}

function tokenizeVersion(value: string): Array<string | number> {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9.+-]/g, "")
        .split(/([0-9]+|[a-z]+)/)
        .filter(Boolean)
        .map((token) => (/^[0-9]+$/.test(token) ? Number.parseInt(token, 10) : token));
}

function compareVersions(a: string, b: string): number {
    const left = tokenizeVersion(a);
    const right = tokenizeVersion(b);
    const length = Math.max(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
        const leftToken = left[index];
        const rightToken = right[index];
        if (leftToken === undefined) return rightToken === undefined ? 0 : -1;
        if (rightToken === undefined) return 1;
        if (leftToken === rightToken) continue;
        if (typeof leftToken === "number" && typeof rightToken === "number") {
            return leftToken > rightToken ? 1 : -1;
        }
        if (typeof leftToken === "number") return 1;
        if (typeof rightToken === "number") return -1;
        return leftToken > rightToken ? 1 : -1;
    }

    return 0;
}

function isPrereleaseVersion(version: string): boolean {
    return /(?:^|[._-])(?:a|b|rc|dev)\d*/i.test(version)
        || /\d(?:a|b|rc|dev)\d*/i.test(version);
}

function parseVersionSpecifier(specifier = ""): Array<{ op: string; version: string }> {
    const raw = String(specifier || "").trim();
    if (!raw) return [];

    return raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const match = /^(==|!=|~=|>=|<=|>|<)?\s*([A-Za-z0-9][A-Za-z0-9_.+*-]*)$/.exec(part);
            if (!match) {
                throw new Error(`Invalid version specifier: ${part}`);
            }
            return {
                op: match[1] || "==",
                version: match[2],
            };
        });
}

function matchesWildcardVersion(version: string, pattern: string): boolean {
    const normalizedPattern = pattern.toLowerCase();
    if (!normalizedPattern.includes("*")) {
        return version.toLowerCase() === normalizedPattern;
    }
    if (normalizedPattern.split("*").length > 2) {
        throw new Error(`Invalid wildcard version pattern: ${pattern}`);
    }

    if (normalizedPattern.endsWith(".*")) {
        const prefix = normalizedPattern.slice(0, -2);
        const candidate = version.toLowerCase();
        return candidate === prefix || candidate.startsWith(`${prefix}.`);
    }

    const [prefix, suffix] = normalizedPattern.split("*");
    const candidate = version.toLowerCase();
    return candidate.startsWith(prefix) && candidate.endsWith(suffix);
}

function satisfiesVersion(
    version: string,
    constraints: Array<{ op: string; version: string }>,
): boolean {
    return constraints.every(({ op, version: target }) => {
        if (target.includes("*")) {
            if (op !== "==" && op !== "!=") {
                throw new Error(`Wildcard versions require == or !=, not ${op}`);
            }
            const matches = matchesWildcardVersion(version, target);
            return op === "==" ? matches : !matches;
        }

        const comparison = compareVersions(version, target);
        if (op === "~=") {
            const release = target.match(/^\d+(?:\.\d+)+/)?.[0].split(".").map(Number);
            if (!release || release.length < 2) {
                throw new Error(`Compatible release requires at least two version segments: ${target}`);
            }
            release.pop();
            release[release.length - 1] += 1;
            return comparison >= 0 && compareVersions(version, release.join(".")) < 0;
        }
        if (op === "==") return comparison === 0;
        if (op === "!=") return comparison !== 0;
        if (op === ">=") return comparison >= 0;
        if (op === "<=") return comparison <= 0;
        if (op === ">") return comparison > 0;
        if (op === "<") return comparison < 0;
        return false;
    });
}

function isUniversalWheel(file: PyPIFile): boolean {
    return file.packagetype === "bdist_wheel"
        && typeof file.filename === "string"
        && /-(?:py2\.py3|py3|py\d+)-none-any\.whl$/i.test(file.filename)
        && typeof file.url === "string"
        && file.yanked !== true;
}

function selectWheel(files: PyPIFile[]): PyPIFile | undefined {
    return files
        .filter(isUniversalWheel)
        .sort((left, right) => {
            const leftTime = Date.parse(left.upload_time_iso_8601 || "") || 0;
            const rightTime = Date.parse(right.upload_time_iso_8601 || "") || 0;
            return rightTime - leftTime;
        })[0];
}

function releaseFrom(version: string, wheel: PyPIFile): StubPackageRelease {
    return {
        version,
        filename: wheel.filename || "",
        size: Number(wheel.size || 0),
        uploadTime: wheel.upload_time_iso_8601 || "",
    };
}

async function fetchPyPIIndex(
    packageName: string,
    version?: string,
    deadlineAt = Date.now() + PYPI_REQUEST_TIMEOUT_MS,
): Promise<PyPIIndex> {
    const packagePath = encodeURIComponent(normalizePackageName(packageName));
    const versionPath = version ? `/${encodeURIComponent(version)}` : "";
    const controller = new AbortController();
    const timeoutMs = Math.max(
        1,
        Math.min(PYPI_REQUEST_TIMEOUT_MS, deadlineAt - Date.now()),
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
        response = await fetch(
            `${PYPI_JSON_BASE}/${packagePath}${versionPath}/json`,
            { signal: controller.signal },
        );
        if (!response.ok) {
            throw new Error(`PyPI query failed for ${packageName}${versionPath} (${response.status})`);
        }
        return await response.json() as PyPIIndex;
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`PyPI query timed out for ${packageName}${versionPath}`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function installableReleases(index: PyPIIndex): StubPackageRelease[] {
    return Object.entries(index.releases || {})
        .map(([version, files]) => {
            const wheel = selectWheel(files || []);
            return wheel ? releaseFrom(version, wheel) : null;
        })
        .filter((release): release is StubPackageRelease => release !== null)
        .sort((left, right) => compareVersions(right.version, left.version));
}

function selectRelease(
    index: PyPIIndex,
    versionSpecifier = "",
): { version: string; wheel: PyPIFile } {
    const constraints = parseVersionSpecifier(versionSpecifier);
    const allowPrereleases = constraints.some(({ version }) => isPrereleaseVersion(version));
    const versions = Object.keys(index.releases || {})
        .filter((version) => satisfiesVersion(version, constraints))
        .filter((version) => allowPrereleases || !isPrereleaseVersion(version))
        .sort((left, right) => compareVersions(right, left));

    for (const version of versions) {
        const wheel = selectWheel(index.releases?.[version] || []);
        if (wheel) return { version, wheel };
    }
    throw new Error(`No matching universal wheel found for ${versionSpecifier || "latest release"}`);
}

function parseCatalogDependency(requirement: string): {
    packageName: string;
    versionSpecifier: string;
} | undefined {
    const requirementWithoutMarker = requirement.split(";", 1)[0].trim();
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*(?:\(([^)]+)\)|(.+)))?$/.exec(
        requirementWithoutMarker,
    );
    if (!match) {
        throw new Error(`Unsupported stub package dependency: ${requirement}`);
    }

    const entry = catalogEntry(match[1]);
    if (!entry) return undefined;
    if (entry.kind === "board") {
        throw new Error(`Board stub package cannot be installed as a dependency: ${entry.packageName}`);
    }
    return {
        packageName: entry.packageName,
        versionSpecifier: (match[2] || match[3] || "").replace(/\s+/g, ""),
    };
}

function validateWheelUrl(value: string): URL {
    const url = new URL(value);
    const trustedHost = url.hostname === "files.pythonhosted.org"
        || url.hostname.endsWith(".files.pythonhosted.org");
    if (url.protocol !== "https:" || !trustedHost) {
        throw new Error(`PyPI returned an untrusted wheel URL: ${url.origin}`);
    }
    return url;
}

async function readLimitedResponse(
    response: Response,
    maxBytes: number,
    limitMessage: string,
): Promise<ArrayBuffer> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("Streaming response bodies are required for bounded stub downloads");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel(limitMessage);
            throw new Error(limitMessage);
        }
        chunks.push(value);
    }

    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return data.buffer;
}

async function downloadWheel(wheel: PyPIFile, deadlineAt: number): Promise<ArrayBuffer> {
    const url = validateWheelUrl(wheel.url || "");
    const declaredSize = Number(wheel.size || 0);
    const limitMessage = `Wheel exceeds the ${MAX_WHEEL_BYTES / 1024 / 1024} MB limit`;
    if (declaredSize > MAX_WHEEL_BYTES) {
        throw new Error(limitMessage);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        Math.max(1, deadlineAt - Date.now()),
    );
    let response: Response;
    try {
        response = await fetch(url, { signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`Wheel download timed out for ${wheel.filename || url.pathname}`);
        }
        throw error;
    }
    if (!response.ok) {
        clearTimeout(timeout);
        throw new Error(`Wheel download failed (${response.status})`);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_WHEEL_BYTES) {
        clearTimeout(timeout);
        throw new Error(limitMessage);
    }
    try {
        return await readLimitedResponse(response, MAX_WHEEL_BYTES, limitMessage);
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`Wheel download timed out for ${wheel.filename || url.pathname}`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function isSafeArchivePath(value: string): boolean {
    if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
        return false;
    }
    const segments = value.split("/");
    return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function extractStubFiles(
    data: ArrayBuffer,
    packageName: string,
    budget: ExtractionBudget,
    deadlineAt: number,
): Record<string, string> {
    if (Date.now() >= deadlineAt) throw new Error("Stub package installation timed out");
    let containsUnexpectedRuntimePython = false;

    const entries = unzipSync(new Uint8Array(data), {
        filter(entry) {
            if (Date.now() >= deadlineAt) throw new Error("Stub package installation timed out");
            if (!isSafeArchivePath(entry.name)) {
                throw new Error(`Wheel contains an unsafe archive path: ${entry.name}`);
            }
            if (entry.name.endsWith("/")) return false;
            const trustedStdlibSupport = packageName === "micropython-stdlib-stubs"
                && STDLIB_SUPPORT_FILES.has(entry.name);
            if (entry.name.endsWith(".py") && !trustedStdlibSupport) {
                containsUnexpectedRuntimePython = true;
                return false;
            }
            const keep = entry.name.endsWith(".pyi")
                || entry.name.endsWith("/py.typed")
                || entry.name === "py.typed"
                || trustedStdlibSupport;
            if (!keep) return false;

            budget.bytes += entry.originalSize;
            budget.files += 1;
            if (budget.bytes > MAX_EXTRACTED_BYTES) {
                throw new Error(`Extracted stubs exceed the ${MAX_EXTRACTED_BYTES / 1024 / 1024} MB limit`);
            }
            if (budget.files > MAX_STUB_FILES) {
                throw new Error(`Wheel contains more than ${MAX_STUB_FILES} relevant files`);
            }
            return true;
        },
    });

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const files: Record<string, string> = {};
    for (const [entryPath, content] of Object.entries(entries)) {
        if (Date.now() >= deadlineAt) throw new Error("Stub package installation timed out");
        files[entryPath] = decoder.decode(content);
    }

    if (containsUnexpectedRuntimePython) {
        throw new Error("Wheel contains runtime .py files and is not type-only");
    }
    if (!Object.keys(files).some((entryPath) => entryPath.endsWith(".pyi"))) {
        throw new Error("Wheel does not contain any .pyi files");
    }
    return files;
}

async function resolveStubPackage(
    packageName: string,
    versionSpecifier: string,
    budget: ExtractionBudget,
    resolving = new Set<string>(),
    deadlineAt = Date.now() + INSTALL_DEADLINE_MS,
): Promise<ResolvedStubPackage> {
    const normalizedName = normalizePackageName(packageName);
    const entry = catalogEntry(normalizedName);
    if (!entry && isReservedBoardPackageName(normalizedName)) {
        throw new Error(`Stub package is not supported: ${normalizedName}`);
    }
    const resolvedName = entry?.packageName || normalizedName;
    if (resolving.has(resolvedName)) {
        throw new Error(`Circular stub package dependency: ${resolvedName}`);
    }
    resolving.add(resolvedName);

    try {
        const index = await fetchPyPIIndex(resolvedName, undefined, deadlineAt);
        const selected = selectRelease(index, versionSpecifier);
        const releaseIndex = await fetchPyPIIndex(resolvedName, selected.version, deadlineAt);
        let files: Record<string, string> = {};

        for (const requirement of releaseIndex.info?.requires_dist || []) {
            const dependency = parseCatalogDependency(requirement);
            if (!dependency) continue;
            const resolved = await resolveStubPackage(
                dependency.packageName,
                dependency.versionSpecifier,
                budget,
                resolving,
                deadlineAt,
            );
            files = { ...files, ...resolved.files };
        }

        const data = await downloadWheel(selected.wheel, deadlineAt);
        const ownFiles = extractStubFiles(data, resolvedName, budget, deadlineAt);
        return {
            packageName: resolvedName,
            version: selected.version,
            wheel: selected.wheel,
            files: { ...files, ...ownFiles },
        };
    } finally {
        resolving.delete(resolvedName);
    }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
}

async function openDatabase(deadlineAt?: number): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB is unavailable; stub packages cannot be persisted");
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PACKAGE_STORE)) {
            database.createObjectStore(PACKAGE_STORE, { keyPath: "key" });
        }
    };
    if (deadlineAt === undefined) return requestResult(request);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error("Stub package installation timed out")),
            Math.max(1, deadlineAt - Date.now()),
        );
        request.onsuccess = () => {
            clearTimeout(timeout);
            if (Date.now() >= deadlineAt) {
                request.result.close();
                reject(new Error("Stub package installation timed out"));
                return;
            }
            resolve(request.result);
        };
        request.onerror = () => {
            clearTimeout(timeout);
            reject(request.error || new Error("IndexedDB request failed"));
        };
    });
}

async function cachedPackages(): Promise<CachedStubPackage[]> {
    const database = await openDatabase();
    try {
        const transaction = database.transaction(PACKAGE_STORE, "readonly");
        return await requestResult(
            transaction.objectStore(PACKAGE_STORE).getAll() as IDBRequest<CachedStubPackage[]>,
        );
    } finally {
        database.close();
    }
}

async function saveCachedPackage(record: CachedStubPackage, deadlineAt: number): Promise<void> {
    const database = await openDatabase(deadlineAt);
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(PACKAGE_STORE, "readwrite");
            const timeout = setTimeout(
                () => transaction.abort(),
                Math.max(1, deadlineAt - Date.now()),
            );
            const store = transaction.objectStore(PACKAGE_STORE);
            const request = store.getAll() as IDBRequest<CachedStubPackage[]>;

            request.onsuccess = () => {
                for (const cached of request.result) {
                    if (cached.packageName === record.packageName) {
                        store.delete(cached.key);
                    }
                }
                store.put(record);
            };
            request.onerror = () => reject(
                request.error || new Error("Unable to read the stub package cache"),
            );
            transaction.oncomplete = () => {
                clearTimeout(timeout);
                resolve();
            };
            transaction.onerror = () => {
                clearTimeout(timeout);
                reject(transaction.error || new Error("Unable to update the stub package cache"));
            };
            transaction.onabort = () => {
                clearTimeout(timeout);
                reject(Date.now() >= deadlineAt
                    ? new Error("Stub package installation timed out")
                    : transaction.error || new Error("Stub package cache update was aborted"));
            };
        });
    } finally {
        database.close();
    }
}

export function isBoardStubPackage(packageName: string): boolean {
    const normalizedName = normalizePackageName(packageName);
    return isReservedBoardPackageName(normalizedName) || packageCatalog().some((entry) => (
        entry.kind === "board" && entry.packageName === normalizedName
    ));
}

function publicInstalledPackage(record: CachedStubPackage): InstalledStubPackage {
    return {
        packageName: record.packageName,
        version: record.version,
        wheelFilename: record.wheelFilename,
        wheelUrl: record.wheelUrl,
        installedAt: record.installedAt,
        fileCount: Object.keys(record.files).length,
        active: record.active,
    };
}

export async function listAvailableStubPackages(): Promise<StubPackageCatalogResultEntry[]> {
    const installed = await cachedPackages();
    const activeVersions = new Map(
        installed
            .filter((entry) => entry.active)
            .map((entry) => [entry.packageName, entry.version]),
    );

    return Promise.all(packageCatalog().map(async (catalogEntry) => {
        try {
            const index = await fetchPyPIIndex(catalogEntry.packageName);
            const versions = installableReleases(index);
            const advertisedLatest = index.info?.version || "";
            const latestVersion = versions.some((release) => release.version === advertisedLatest)
                ? advertisedLatest
                : (versions[0]?.version || "");
            return {
                ...catalogEntry,
                latestVersion,
                versions,
                installedVersion: activeVersions.get(catalogEntry.packageName),
            };
        } catch (error) {
            return {
                ...catalogEntry,
                latestVersion: "",
                versions: [],
                installedVersion: activeVersions.get(catalogEntry.packageName),
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }));
}

export async function installStubPackage(
    packageName: string,
    versionSpecifier = "",
): Promise<InstalledStubPackage> {
    const deadlineAt = Date.now() + INSTALL_DEADLINE_MS;
    const resolved = await resolveStubPackage(
        packageName,
        versionSpecifier,
        { bytes: 0, files: 0 },
        new Set<string>(),
        deadlineAt,
    );
    const record: CachedStubPackage = {
        key: `${resolved.packageName}@${resolved.version}`,
        packageName: resolved.packageName,
        version: resolved.version,
        wheelFilename: resolved.wheel.filename || "",
        wheelUrl: resolved.wheel.url || "",
        installedAt: Date.now(),
        active: true,
        files: resolved.files,
    };
    if (Date.now() >= deadlineAt) throw new Error("Stub package installation timed out");
    await saveCachedPackage(record, deadlineAt);
    return publicInstalledPackage(record);
}

export async function listInstalledStubPackages(): Promise<InstalledStubPackage[]> {
    const records = await cachedPackages();
    return records
        .map(publicInstalledPackage)
        .sort((left, right) => {
            const byName = left.packageName.localeCompare(right.packageName);
            return byName || compareVersions(right.version, left.version);
        });
}

export async function clearStubPackages(
    packageName?: string,
    version?: string,
): Promise<number> {
    const normalizedName = packageName ? normalizePackageName(packageName) : undefined;
    const records = await cachedPackages();
    const matches = records.filter((record) => {
        if (normalizedName && record.packageName !== normalizedName) return false;
        return !version || record.version === version;
    });
    if (matches.length === 0) return 0;

    const database = await openDatabase();
    try {
        const transaction = database.transaction(PACKAGE_STORE, "readwrite");
        const completed = transactionDone(transaction);
        const store = transaction.objectStore(PACKAGE_STORE);
        for (const record of matches) {
            store.delete(record.key);
        }
        await completed;
    } finally {
        database.close();
    }
    return matches.length;
}

export async function activeCachedStubPackages(): Promise<CachedStubPackage[]> {
    return (await cachedPackages()).filter((entry) => entry.active);
}

export function selectCachedBoardPackage(
    packages: CachedStubPackage[],
    selection?: StubPackageSelection,
): CachedStubPackage | undefined {
    if (!selection) return undefined;
    const packageName = normalizePackageName(selection.packageName);
    return packages.find((entry) => (
        entry.packageName === packageName
        && entry.active
        && (!selection.version || entry.version === selection.version)
    ));
}
