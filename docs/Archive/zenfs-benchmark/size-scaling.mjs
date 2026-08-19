// Hold entry COUNT constant, vary bytes per entry.
// Separates per-entry (central directory) cost from per-byte (decompression) cost.
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

const LAZY = process.argv.includes('--lazy');
const ENTRIES = 1000;
const pkgVersion = (name) =>
    JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;

// Realistic, compressible stub-like text so decompression work resembles typeshed.
function body(bytes, seed) {
    let text = '';
    let i = 0;
    while (text.length < bytes) {
        text += `def function_${seed}_${i}(argument: int = ${i}) -> str:\n    """Docstring ${i}."""\n    ...\n`;
        i++;
    }
    return new TextEncoder().encode(text.slice(0, bytes));
}

function buildZip(bytesPerEntry) {
    const files = {};
    for (let i = 0; i < ENTRIES; i++) {
        files[`stdlib/pkg${i % 40}/module_${i}.pyi`] = body(bytesPerEntry, i);
    }
    const z = zipSync(files, { level: 6 });
    return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
}

console.log(`archives=${pkgVersion('@zenfs/archives')} core=${pkgVersion('@zenfs/core')} lazy=${LAZY} entries=${ENTRIES}`);
console.log('bytes/entry  total_MB  mount_ms');
for (const size of [32, 256, 1024, 4096, 16384]) {
    const data = buildZip(size);
    const runs = [];
    for (let r = 0; r < 5; r++) {
        const copy = data.slice(0);
        const t0 = performance.now();
        await resolveMountConfig({ backend: Zip, data: copy, ...(LAZY ? { lazy: true } : {}) });
        runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    console.log(
        `${String(size).padStart(11)}  ${((ENTRIES * size) / 1048576).toFixed(2).padStart(8)}  ${runs[2].toFixed(0).padStart(8)}`,
    );
}
