// Verifies synchronous reads in both eager and lazy modes.
import { zipSync } from 'fflate';
import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

function buildZip() {
    const files = {
        'stdlib/builtins.pyi': new TextEncoder().encode('def id(obj: object) -> int: ...\n'),
    };
    const z = zipSync(files, { level: 6 });
    return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
}

for (const lazy of [false, true]) {
    const fs = await resolveMountConfig({ backend: Zip, data: buildZip(), ...(lazy ? { lazy: true } : {}) });
    const path = '/stdlib/builtins.pyi';
    const stats = fs.statSync(path);

    let syncResult;
    try {
        const buffer = new Uint8Array(stats.size);
        fs.readSync(path, buffer, 0, stats.size);
        syncResult = `OK (${buffer.byteLength} bytes)`;
    } catch (error) {
        syncResult = `THREW ${error.code ?? ''} ${error.message}`.trim();
    }

    let asyncResult;
    try {
        const buffer = new Uint8Array(stats.size);
        await fs.read(path, buffer, 0, stats.size);
        asyncResult = `OK (${buffer.byteLength} bytes)`;
    } catch (error) {
        asyncResult = `THREW ${error.code ?? ''} ${error.message}`.trim();
    }

    console.log(`lazy=${String(lazy).padEnd(5)} statSync=OK  readSync=${syncResult.padEnd(45)} read=${asyncResult}`);
}
