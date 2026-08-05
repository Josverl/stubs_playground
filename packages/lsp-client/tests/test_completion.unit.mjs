import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CompletionItemKind,
    computeCompletionFrom,
    convertCompletionItem,
    dedupeAndSortCompletionOptions,
    isDunderLabel,
    kindToType,
} from '../src/completion-core.mjs';

test('kindToType maps function-like and fallback kinds', () => {
    assert.equal(kindToType(CompletionItemKind.Function), 'function');
    assert.equal(kindToType(CompletionItemKind.Property), 'property');
    assert.equal(kindToType(CompletionItemKind.Variable), 'variable');
    assert.equal(kindToType(CompletionItemKind.Class), 'class');
    assert.equal(kindToType(CompletionItemKind.Module), 'namespace');
    assert.equal(kindToType(CompletionItemKind.Keyword), 'keyword');
    assert.equal(kindToType(999), 'text');
});

test('computeCompletionFrom starts after last dot', () => {
    assert.equal(computeCompletionFrom({ text: 'sys.arg', from: 10 }), 14);
    assert.equal(computeCompletionFrom({ text: 'sleep', from: 3 }), 3);
    assert.equal(computeCompletionFrom({ text: 't.sleep', from: 20 }), 22);
});

test('convertCompletionItem gives LSP boost and dunder penalty', () => {
    const normal = convertCompletionItem({
        label: 'sleep',
        kind: CompletionItemKind.Function,
        detail: '(seconds: float) -> None',
        documentation: { value: 'Delay execution' },
    });

    const dunder = convertCompletionItem({
        label: '__class__',
        kind: CompletionItemKind.Property,
        documentation: 'builtins.type',
    });

    const preselected = convertCompletionItem({
        label: 'argv',
        kind: CompletionItemKind.Variable,
        preselect: true,
    });

    assert.equal(normal.type, 'function');
    assert.equal(normal.info, 'Delay execution');
    assert.ok(normal.boost > 0);

    assert.equal(isDunderLabel(dunder.label), true);
    assert.ok(dunder.boost < normal.boost);

    assert.ok(preselected.boost > normal.boost);
});

test('dedupe keeps the strongest duplicate and sorts by relevance', () => {
    const options = [
        {
            label: 'sleep',
            apply: 'sleep',
            detail: '',
            info: '',
            boost: 99,
            type: 'function',
        },
        {
            label: 'sleep',
            apply: 'sleep',
            detail: '(seconds: float) -> None',
            info: 'Delay execution in seconds',
            boost: 109,
            type: 'function',
        },
        {
            label: '__doc__',
            apply: '__doc__',
            detail: '',
            info: '',
            boost: -21,
            type: 'property',
        },
        {
            label: 'ticks_ms',
            apply: 'ticks_ms',
            detail: '() -> int',
            info: 'Monotonic milliseconds',
            boost: 99,
            type: 'function',
        },
    ];

    const ranked = dedupeAndSortCompletionOptions(options);

    assert.equal(ranked.filter((o) => o.label === 'sleep').length, 1);
    assert.equal(ranked[0].label, 'sleep');
    assert.equal(ranked[ranked.length - 1].label, '__doc__');
});

test('alias-style completion payload keeps expected apply label', () => {
    const sleepItem = convertCompletionItem({
        label: 'sleep',
        insertText: 'sleep',
        kind: CompletionItemKind.Function,
        detail: '(seconds: float) -> None',
    });

    assert.equal(sleepItem.label, 'sleep');
    assert.equal(sleepItem.apply, 'sleep');
});
