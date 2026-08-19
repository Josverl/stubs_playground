# Follow-up on zen-fs/archives#19: v1.4.2 results against real-world archives

Thanks for the fast turnaround on v1.4.2 — the quadratic central-directory scan is
definitively gone, and I can reproduce your improvement on the **synthetic** benchmark shape.

However, when I measured against the real archives that motivated the original
issue (Python typeshed stubs), the picture is more nuanced, and I hit one blocker that
I think matters more than the performance numbers:

> **`lazy: true` produces a filesystem that cannot be read synchronously.**
> `readSync()` throws `EAGAIN` unconditionally on the first access to any entry.


## 1. Blocker: `lazy: true` breaks synchronous reads

The fast path introduced in 1.4.x is unusable for any
consumer (such as the PyRight type checker) that reads synchronously.

`ZipFS.readSync()` (`dist/zip/fs.js:182`):

```js
readSync(path, buffer, offset, end) {
    const folded = _caseFold(this, path);
    if (this.directories.has(folded)) throw withErrno('EISDIR');
    const file = this.files.get(folded) ?? _throw(withErrno('ENOENT'));
    if (!file.contents) {
        void file.loadContents();   // fire-and-forget
        throw withErrno('EAGAIN');
    }
    buffer.set(file.contents.subarray(offset, end));
}
```

With `lazy: true`, `file.contents` is never populated at mount time
(`dist/zip/fs.js:82`: `if (!this.options.lazy) await cd.loadContents();`), so the
**first** `readSync()` of every entry throws, making it unusable for synchronous consumers.

### Minimal reproduction

```js
import { zipSync } from 'fflate';
import { Zip } from '@zenfs/archives';
import { resolveMountConfig } from '@zenfs/core';

const z = zipSync({ 'stdlib/builtins.pyi': new TextEncoder().encode('def id(o: object) -> int: ...\n') });
const data = () => z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);

for (const lazy of [false, true]) {
    const fs = await resolveMountConfig({ backend: Zip, data: data(), ...(lazy ? { lazy: true } : {}) });
    const path = '/stdlib/builtins.pyi';
    const size = fs.statSync(path).size;
    try {
        fs.readSync(path, new Uint8Array(size), 0, size);
        console.log(`lazy=${lazy} readSync=OK`);
    } catch (e) {
        console.log(`lazy=${lazy} readSync=THREW ${e.code}`);
    }
}
```

Output on `@zenfs/archives@1.4.2` + `@zenfs/core@2.6.3`:

```
lazy=false readSync=OK
lazy=true  readSync=THREW EAGAIN
```

`statSync()` succeeds in both modes and the **async** `read()` succeeds in both modes —
only `readSync()` is affected.

### Why this blocks us

We run Pyright (the Python type checker) inside a Web Worker, with typeshed stubs mounted
from a zip. Pyright's file access layer is synchronous (`readFileSync`), so every stub
load fails. There is no retry loop we can insert — and even if there were, the
fire-and-forget `void file.loadContents()` makes it a race rather than a guarantee.

Practically this means the 10x mount win from `lazy: true` is not available to
us.

### Suggested resolutions (in order of usefulness to us)

1. **Support synchronous decompress-on-demand.** This looks achievable: when the backing
   store is already in memory, `loadContents()` is only `async` because `getDynamic()` and
   `this._source.get()` are async — the actual `decompress()` call is already synchronous
   (fflate's sync inflate). A `loadContentsSync()` used by `readSync()` when the source
   supports sync access would make lazy mode work for sync consumers, and would be the
   best of both worlds: fast mount *and* no eager decompression.
2. **At minimum, document it prominently** — `lazy` currently reads like a pure
   optimisation flag, and the failure mode (`EAGAIN` from a plain file read) is
   surprising and easy to misattribute.
3. Optionally, throw `ENOTSUP` with an explanatory message instead of `EAGAIN`, so the
   cause is obvious.

---

## 2. Performance: real archives vs the synthetic benchmark

### Your synthetic benchmark reproduces beautifully

Flat-ish paths, ~30-byte files, `stdlib/pkg{i%40}/module_{i}.pyi`:

| entries | 1.0.5 eager | 1.4.2 eager | 1.4.2 lazy |
|--------:|------------:|------------:|-----------:|
| 250     | 30 ms       | 77 ms       | 16 ms      |
| 500     | 47 ms       | 64 ms       | 15 ms      |
| 1000    | 68 ms       | 143 ms      | 30 ms      |
| 2000    | 183 ms      | 200 ms      | 31 ms      |
| 4000    | 961 ms      | 343 ms      | 35 ms      |
| 8000    | **11006 ms**| **721 ms**  | **65 ms**  |

At 8000 entries that is(seems) **15.3x faster eager** and **169x faster lazy**. The quadratic
blowup (1.0.5 goes from 0.119 to 1.376 ms/entry) is completely flattened in 1.4.2
(steady ~0.09 ms/entry). This part is a clear, large win.

### However... real archives regress in eager mode
As explained above we do need to use eager to avoid EAGAIN errors with a sync client.

[Python typeshed archives](https://github.com/Josverl/stubs_playground/blob/feat/stub_selection/packages/pyright-worker/assets/typeshed-fallback.zip), steady-state medians :

| archive | entries | uncompressed | 1.0.5 eager | 1.4.2 eager | 1.4.2 lazy |
|---|--:|--:|--:|--:|--:|
| typeshed **full** | 4627 | 9.12 MB | **565 ms** | **952 ms** | **52 ms** |
| typeshed **stdlib-only** | 584 | 2.24 MB | **33.6 ms** | **132.5 ms** | **7.0 ms** |

Relative to the 1.0.5 eager baseline:

| archive | 1.4.2 eager | 1.4.2 lazy |
|---|---|---|
| full (4627 entries) | **1.69x slower** | 10.8x faster |
| stdlib (584 entries) | **3.94x slower** | 4.8x faster |

So in eager mode, the only mode we can actually use, **1.4.2 is 1.7-3.9x slower than 1.0.5** on our
real workloads, despite being dramatically faster on the synthetic one.

### Possible cause: the cost moved from per-entry to per-byte

Your synthetic files are ~30 bytes each; real stub files average ~2 KB. Holding entry
count fixed at 1000 and varying payload size isolates it:

| bytes/entry | total | 1.0.5 eager | 1.4.2 eager | 1.4.2 lazy |
|---:|---:|---:|---:|---:|
| 32     | 0.03 MB  | 80 ms | 93 ms  | 12 ms |
| 256    | 0.24 MB  | 52 ms | 180 ms | 8 ms  |
| 1024   | 0.98 MB  | 51 ms | 205 ms | 7 ms  |
| 4096   | 3.91 MB  | 53 ms | 224 ms | 9 ms  |
| 16384  | 15.63 MB | 48 ms | 267 ms | 5 ms  |

The reading:

- **1.0.5 eager is flat in payload size** (~50 ms at 1000 entries whether the archive
  holds 0.03 MB or 15.6 MB). Its cost was essentially *all* per-entry central-directory
  scanning — which is exactly the quadratic term you fixed.
- **1.4.2 eager scales with bytes** (93 -> 267 ms over the same range), because
  `ready()` now calls `await cd.loadContents()` for every entry, decompressing the entire
  archive at mount.
- **1.4.2 lazy is flat and tiny**, because it decompresses nothing.

So for archives that are *entry-heavy but byte-light* (your benchmark) 1.4.2 wins by a
lot. For archives that are *byte-heavy* (real stub sets: 4627 entries but 9.12 MB) the
new eager decompression costs more than the old quadratic scan saved. Our full typeshed
sits on the losing side of that crossover.

This also explains why the regression is proportionally worse for the smaller
stdlib archive (3.94x) than the full one (1.69x): fewer entries means less benefit from
the central-directory fix, while the per-byte decompression cost remains.


Eager mode now appears to do work that many consumers never need (assumption/opinion, not a fact)
In our case a type checker touches only a small fraction of the stubs in a session. Making lazy mode usable synchronously (1.1) would resolve both the blocker and the regression at once, which is why I'd rank it first.

## 3. Test and measurements

Measurements are steady-state, and I want to flag that **naive measurement here is very
misleading** — my first two attempts produced contradictory results:

- Mounting repeatedly *in one process* inflates later iterations, because each eager mount
  retains ~9 MB of decompressed data and creates GC pressure.
- Mounting *once per fresh process* inflates the small-archive numbers, because
  module-load/JIT cost is included — and it is not equal between stacks, since 1.4.2
  pulls in `memium`/`kerium`/`utilium`. This alone reversed the apparent winner.

Used test protocol, per configuration:

- one process per configuration; 3 warmup mounts to absorb module-load and JIT;
- 15 measured mounts with `global.gc()` (`node --expose-gc`) before each;
- pooled over 3 independent processes -> **n = 45**; median reported;
- a fresh `ArrayBuffer` copy per mount (no reuse of a consumed buffer);
- observed stdev: 4.8-52 ms, i.e. small relative to the differences reported.

**Sanity checks** Both stacks were verified to expose an identical filesystem
before comparing timings — full recursive walk, reading every file:

```
archives 1.0.5 + core 1.11.4 -> files=4627 bytes=9558934 sha256=d34a947ad2cf301f
archives 1.4.2 + core 2.6.3  -> files=4627 bytes=9558934 sha256=d34a947ad2cf301f
```

Same file count, same bytes, same hash — the eager comparison is like-for-like.
(Note that this walk cannot be performed (by a sync client) under `lazy: true`, per §1.)

**Environment**

- Node v24.18.1, Linux x86_64 (WSL2), 6 cores
- Baseline: `@zenfs/archives@1.0.5` + `@zenfs/core@1.11.4`
- Candidate: `@zenfs/archives@1.4.2` + `@zenfs/core@2.6.3` (+ `memium@1.0.1`,
  `kerium@1.4.2`, `utilium@3.5.1`)
- Archives: Python typeshed stubs — full (4627 entries / 2.97 MB zip / 9.12 MB
  uncompressed / 661 dirs / max depth 7) and stdlib-only (584 / 0.57 MB / 2.24 MB /
  48 dirs / max depth 4)

Happy to share the benchmark scripts, or to test a patch against the real archives if
you'd like a second data point — the harness is reusable.


## Conclusion

Given the above we are staying on `@zenfs/archives@1.0.5` for now, and as mentioned before   have worked around
the mount cost by shipping a smaller (stdlib-only) archive. A synchronous lazy read path
would let us adopt 1.4.x and drop that workaround.
