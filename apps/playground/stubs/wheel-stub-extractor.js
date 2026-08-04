const textDecoder = new TextDecoder('utf-8');

function decodeText(data) {
    return textDecoder.decode(data);
}

function isDistInfoPath(path) {
    return path.includes('.dist-info/');
}

function isDataPath(path) {
    return path.includes('.data/');
}

function getMetadataText(entries) {
    for (const [entryPath, data] of Object.entries(entries)) {
        if (!entryPath.endsWith('.dist-info/METADATA')) continue;
        return decodeText(data);
    }
    return '';
}

function hasStubOnlyClassifier(metadataText) {
    return /Classifier:\s*Typing\s*::\s*Stubs\s*Only/i.test(metadataText);
}

export async function extractTypeStubFilesFromWheel(arrayBuffer) {
    const { unzipSync } = await import('https://esm.sh/fflate@0.8.2');
    const entries = unzipSync(new Uint8Array(arrayBuffer));
    const metadataText = getMetadataText(entries);
    const stubOnly = hasStubOnlyClassifier(metadataText);

    const extractedFiles = {};
    let pyiCount = 0;
    let containsRuntimePython = false;

    for (const [entryPath, data] of Object.entries(entries)) {
        if (!entryPath || entryPath.endsWith('/')) continue;

        // Keep dist-info/data out of the mounted stub tree.
        if (isDistInfoPath(entryPath) || isDataPath(entryPath)) {
            continue;
        }

        if (entryPath.endsWith('.py')) {
            containsRuntimePython = true;
            continue;
        }

        if (entryPath.endsWith('.pyi') || entryPath.endsWith('/py.typed') || entryPath === 'py.typed') {
            extractedFiles[entryPath] = decodeText(data);
            if (entryPath.endsWith('.pyi')) {
                pyiCount += 1;
            }
        }
    }

    if (!stubOnly) {
        throw new Error('Wheel is not classified as Typing :: Stubs Only');
    }

    if (containsRuntimePython) {
        throw new Error('Wheel contains runtime .py files and is not type-only');
    }

    if (pyiCount === 0) {
        throw new Error('Wheel does not contain any .pyi files');
    }

    return {
        files: extractedFiles,
        metadataText,
        pyiCount,
    };
}
