import type { VerifiedAssetSource } from "./messages";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ASSET_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_ALLOWED_ORIGINS = 16;

function validateDigest(value: string): string {
    if (!/^[0-9a-f]{64}$/.test(value)) {
        throw new Error("Asset SHA-256 must be 64 lowercase hexadecimal characters");
    }
    return value;
}

function validateAssetSize(value: number, maxBytes: number): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maxBytes) {
        throw new Error(`Asset size must be between 1 and ${maxBytes} bytes`);
    }
    return value;
}

function validateUrl(value: string, allowedOrigins: string[] = []): URL {
    if (allowedOrigins.length === 0 || allowedOrigins.length > MAX_ALLOWED_ORIGINS) {
        throw new Error(`Asset allowedOrigins must contain between 1 and ${MAX_ALLOWED_ORIGINS} origins`);
    }
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== "https:" && !localHttp) {
        throw new Error("Asset URL must use HTTPS except on loopback");
    }
    if (!allowedOrigins.includes(url.origin)) {
        throw new Error(`Asset origin is not allowed: ${url.origin}`);
    }
    return url;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<ArrayBuffer> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("Streaming response bodies are required for bounded asset downloads");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel("Asset download exceeds its declared size");
            throw new Error("Asset download exceeds its declared size");
        }
        chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result.buffer;
}

async function sha256(data: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadVerifiedAsset(
    source: VerifiedAssetSource,
    maxBytes: number,
): Promise<ArrayBuffer> {
    if (!source || typeof source !== "object") {
        throw new Error("Verified asset source must be an object");
    }
    const declaredSize = validateAssetSize(source.size, maxBytes);
    const expectedDigest = validateDigest(source.sha256);
    const hasData = source.data instanceof ArrayBuffer;
    const hasUrl = typeof source.url === "string" && source.url.length > 0;
    if (hasData === hasUrl) {
        throw new Error("Verified asset source must contain exactly one of data or url");
    }

    let data: ArrayBuffer;
    if (hasData) {
        data = source.data as ArrayBuffer;
    } else {
        const allowedOrigins = Array.isArray(source.allowedOrigins)
            && source.allowedOrigins.every((origin) => typeof origin === "string")
            ? source.allowedOrigins
            : [];
        const url = validateUrl(source.url as string, allowedOrigins);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ASSET_DOWNLOAD_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                redirect: "error",
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`Asset download failed (${response.status})`);
            }
            const contentLength = Number(response.headers.get("content-length") || 0);
            if (contentLength && contentLength !== declaredSize) {
                throw new Error(`Asset Content-Length ${contentLength} does not match declared size ${declaredSize}`);
            }
            data = await readBoundedResponse(response, declaredSize);
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(`Asset download timed out after ${ASSET_DOWNLOAD_TIMEOUT_MS} ms`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    if (data.byteLength !== declaredSize) {
        throw new Error(`Asset size ${data.byteLength} does not match declared size ${declaredSize}`);
    }
    const actualDigest = await sha256(data);
    if (actualDigest !== expectedDigest) {
        throw new Error("Asset SHA-256 verification failed");
    }
    return data;
}
