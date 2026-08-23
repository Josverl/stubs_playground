# @mp-codemirror/lsp-client

Reusable Language Server Protocol integration for CodeMirror 6, including
diagnostics, completion, hover, document lifecycle helpers, and Web Worker
transport.

## Install

```bash
npm install @mp-codemirror/lsp-client \
  @codemirror/autocomplete @codemirror/lint \
  @codemirror/state @codemirror/view
```

## Usage

```js
import {
  createLSPClient,
  createLSPPlugin,
} from "@mp-codemirror/lsp-client";

const runtime = await createLSPClient({ workerUrl });
const extensions = createLSPPlugin(runtime.client, editorView, {
  fileUri: "file:///workspace/main.py",
  initialContent: editorView.state.doc.toString(),
});
```

Install `extensions` in a CodeMirror compartment or editor configuration. The
worker URL is supplied by the host application; use
`@mp-codemirror/pyright-worker` for the packaged Pyright worker.

## TypeScript

The package is JavaScript with JSDoc types and ships generated declarations, so
TypeScript consumers need no extra setup:

```ts
import {
  createLSPClient,
  type LSPClientConfig,
  type LSPClientResult,
} from "@mp-codemirror/lsp-client";

const config: LSPClientConfig = { workerUrl, diagnosticMode: "workspace" };
const runtime: LSPClientResult = await createLSPClient(config);
```

Use `moduleResolution` `bundler`, `node16`, or `nodenext`.

See the [API documentation](https://github.com/Josverl/stubs_playground/tree/main/docs/api)
for lifecycle, diagnostics, workspace synchronization, and stub configuration.

## License

MIT