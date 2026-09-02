# Generated type declarations

These `.d.ts` / `.d.mts` files are **generated** from the JSDoc in
`packages/lsp-client/src/`. Do not edit them by hand; edit the JSDoc instead.

They are committed so that TypeScript consumers get typings from both the npm
package and the tagged CDN tree.

Refresh them after changing any JSDoc in `src/`:

```bash
npm run build:types --workspace @mp-typing/lsp-client
```

CI fails if the committed output is stale, via
`scripts/check-lsp-client-types.mjs`.
