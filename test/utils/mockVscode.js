// Test utilities for mocking VS Code API
class MockDiagnosticCollection {
    constructor() {
        this.diagnostics = new Map();
    }

    set(uri, diagnostics) {
        this.diagnostics.set(uri.toString(), diagnostics);
    }

    delete(uri) {
        this.diagnostics.delete(uri.toString());
    }

    clear() {
        this.diagnostics.clear();
    }

    get(uri) {
        return this.diagnostics.get(uri.toString()) || [];
    }

    get size() {
        return this.diagnostics.size;
    }
}

class MockDiagnostic {
    constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
        this.source = '';
        this.code = '';
    }
}

class MockRange {
    constructor(startLine, startChar, endLine, endChar) {
        this.start = { line: startLine, character: startChar };
        this.end = { line: endLine, character: endChar };
    }
}

class MockUri {
    constructor(path) {
        this.fsPath = path;
        this.path = path;
    }

    toString() {
        return this.fsPath;
    }

    static file(path) {
        return new MockUri(path);
    }
}

// Mock VS Code API
const mockVscode = {
    languages: {
        createDiagnosticCollection: (name) => new MockDiagnosticCollection()
    },
    workspace: {
        getConfiguration: () => ({
            get: () => [],
            has: () => false
        })
    },
    window: {
        showErrorMessage: () => {},
        showWarningMessage: () => {},
        showInformationMessage: () => {}
    },
    Diagnostic: MockDiagnostic,
    Range: MockRange,
    Uri: MockUri,
    DiagnosticSeverity: {
        Error: 0,
        Warning: 1,
        Information: 2,
        Hint: 3
    }
};

module.exports = {
    mockVscode,
    MockDiagnosticCollection,
    MockDiagnostic,
    MockRange,
    MockUri
};
