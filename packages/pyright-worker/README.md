# @mp-codemirror/pyright-worker

Prebuilt browser Web Worker containing Pyright, its virtual filesystem,
typeshed, and bundled MicroPython stubs. The package also publishes the typed
main-thread/worker protocol.

## Install

```bash
npm install @mp-codemirror/pyright-worker
```

## Usage

Copy `node_modules/@mp-codemirror/pyright-worker/dist/pyright_worker.js` through
your bundler or static-asset pipeline, then pass its public URL to the LSP
client:

```js
import { createLSPClient } from "@mp-codemirror/lsp-client";

const runtime = await createLSPClient({
  workerUrl: "/assets/pyright_worker.js",
});
```

The bundle is a classic worker. Applications that communicate with it directly
can import the protocol declarations:

```ts
import type { WorkerMessage } from "@mp-codemirror/pyright-worker/messages";
```

See the [worker API documentation](https://github.com/Josverl/stubs_playground/blob/main/docs/api/pyright-worker.md)
for initialization, workspace files, board stubs, and runtime stub packages.

## License

MIT