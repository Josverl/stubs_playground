// Steady-state mount benchmark: one config per process.
// Warmup iterations absorb module-load/JIT cost; forced GC between measured runs
// prevents heap growth from eager decompression skewing later iterations.
// Run with: node --expose-gc bench-steady.mjs <zip> <warmup> <measured> [--lazy]
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

const file = process.argv[2];
const warmup = Number(process.argv[3] || 3);
const measured = Number(process.argv[4] || 11);
const lazy = process.argv.includes('--lazy');

const buf = readFileSync(file);
const freshCopy = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

async function once() {
    const data = freshCopy();
    const t0 = performance.now();
    let fs = await resolveMountConfig({ backend: Zip, data, ...(lazy ? { lazy: true } : {}) });
    const ms = performance.now() - t0;
    fs = null; // allow reclamation before the next iteration
    return ms;
}

for (let i = 0; i < warmup; i++) await once();

const times = [];
for (let i = 0; i < measured; i++) {
    global.gc();
    times.push(await once());
}

console.log(JSON.stringify(times));
