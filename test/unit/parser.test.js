const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { mockVscode } = require('../utils/mockVscode.js');

// Mock VS Code before requiring the extension
global.vscode = mockVscode;

// Create a testable version of BuildLogWatcher
class TestableBuildLogWatcher {
    constructor() {
        this.watchers = new Map();
        this.diagnostics = mockVscode.languages.createDiagnosticCollection('buildlog');
        this.currentWildcards = [];
    }

    parseErrorLine(line, problemPatterns) {
        for (const pattern of problemPatterns) {
            try {
                const regex = new RegExp(pattern.regexp, 'i');
                const match = line.match(regex);
                
                if (match) {
                    const errorInfo = {
                        message: pattern.message ? match[pattern.message] : line.trim()
                    };

                    if (pattern.file && match[pattern.file]) {
                        errorInfo.file = match[pattern.file].trim();
                    }
                    
                    if (pattern.line && match[pattern.line]) {
                        errorInfo.line = parseInt(match[pattern.line]);
                    }
                    
                    if (pattern.column && match[pattern.column]) {
                        errorInfo.column = parseInt(match[pattern.column]);
                    }
                    
                    if (pattern.severity && match[pattern.severity]) {
                        errorInfo.severity = match[pattern.severity].toLowerCase();
                    }
                    
                    if (pattern.code && match[pattern.code]) {
                        errorInfo.code = match[pattern.code];
                    }

                    return errorInfo;
                }
            } catch (error) {
                console.warn(`Invalid regex pattern: ${pattern.regexp}`, error);
            }
        }

        return null;
    }

    mapSeverity(severityString) {
        if (!severityString) {
            return mockVscode.DiagnosticSeverity.Error;
        }

        switch (severityString.toLowerCase()) {
            case 'error':
            case 'fatal':
            case 'fatal error':
                return mockVscode.DiagnosticSeverity.Error;
            case 'warning':
            case 'warn':
                return mockVscode.DiagnosticSeverity.Warning;
            case 'info':
            case 'information':
                return mockVscode.DiagnosticSeverity.Information;
            case 'hint':
                return mockVscode.DiagnosticSeverity.Hint;
            default:
                return mockVscode.DiagnosticSeverity.Error;
        }
    }
}

describe('Error Parsing Tests', () => {
    let watcher;

    beforeEach(() => {
        watcher = new TestableBuildLogWatcher();
    });

    describe('parseErrorLine', () => {
        it('should parse GCC/Clang error format', () => {
            const line = 'main.cpp:42:10: error: undefined variable "test"';
            const patterns = [{
                regexp: '^(.+?):(\\d+):(\\d+):\\s*(error|warning|info):\\s*(.+)$',
                file: 1,
                line: 2,
                column: 3,
                severity: 4,
                message: 5
            }];

            const result = watcher.parseErrorLine(line, patterns);
            
            assert.strictEqual(result.file, 'main.cpp');
            assert.strictEqual(result.line, 42);
            assert.strictEqual(result.column, 10);
            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.message, 'undefined variable "test"');
        });

        it('should parse MSVC error format', () => {
            const line = 'main.cpp(15,8): error C2065: undeclared identifier';
            const patterns = [{
                regexp: '^(.+?)\\((\\d+),(\\d+)\\):\\s*(error|warning)\\s+(C\\d+):\\s*(.+)$',
                file: 1,
                line: 2,
                column: 3,
                severity: 4,
                code: 5,
                message: 6
            }];

            const result = watcher.parseErrorLine(line, patterns);
            
            assert.strictEqual(result.file, 'main.cpp');
            assert.strictEqual(result.line, 15);
            assert.strictEqual(result.column, 8);
            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.code, 'C2065');
            assert.strictEqual(result.message, 'undeclared identifier');
        });

        it('should parse simple error format without file info', () => {
            const line = 'error: Build failed with 3 errors';
            const patterns = [{
                regexp: '(error|warning|info):\\s*(.+)$',
                severity: 1,
                message: 2
            }];

            const result = watcher.parseErrorLine(line, patterns);
            
            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.message, 'Build failed with 3 errors');
            assert.strictEqual(result.file, undefined);
            assert.strictEqual(result.line, undefined);
        });

        it('should handle multiple patterns and use first match', () => {
            const line = 'src/utils.js:25:12: warning: unused variable';
            const patterns = [
                {
                    regexp: '^(.+?)\\((\\d+)\\):\\s*(error|warning):\\s*(.+)$',
                    file: 1,
                    line: 2,
                    severity: 3,
                    message: 4
                },
                {
                    regexp: '^(.+?):(\\d+):(\\d+):\\s*(error|warning|info):\\s*(.+)$',
                    file: 1,
                    line: 2,
                    column: 3,
                    severity: 4,
                    message: 5
                }
            ];

            const result = watcher.parseErrorLine(line, patterns);
            
            // Should match the second pattern
            assert.strictEqual(result.file, 'src/utils.js');
            assert.strictEqual(result.line, 25);
            assert.strictEqual(result.column, 12);
            assert.strictEqual(result.severity, 'warning');
            assert.strictEqual(result.message, 'unused variable');
        });

        it('should return null for non-matching lines', () => {
            const line = 'This is just a regular log line';
            const patterns = [{
                regexp: '^(.+?):(\\d+):(\\d+):\\s*(error|warning):\\s*(.+)$',
                file: 1,
                line: 2,
                column: 3,
                severity: 4,
                message: 5
            }];

            const result = watcher.parseErrorLine(line, patterns);
            assert.strictEqual(result, null);
        });

        it('should handle invalid regex patterns gracefully', () => {
            const line = 'main.cpp:10:5: error: test error';
            const patterns = [
                { regexp: '[invalid(regex', message: 1 },
                {
                    regexp: '^(.+?):(\\d+):(\\d+):\\s*(error|warning):\\s*(.+)$',
                    file: 1,
                    line: 2,
                    column: 3,
                    severity: 4,
                    message: 5
                }
            ];

            const result = watcher.parseErrorLine(line, patterns);
            
            // Should skip invalid regex and use valid one
            assert.strictEqual(result.file, 'main.cpp');
            assert.strictEqual(result.message, 'test error');
        });

        it('should handle missing capture groups gracefully', () => {
            const line = 'error: simple message';
            const patterns = [{
                regexp: '(error|warning):\\s*(.+)$',
                file: 5, // Non-existent capture group
                line: 6, // Non-existent capture group
                severity: 1,
                message: 2
            }];

            const result = watcher.parseErrorLine(line, patterns);
            
            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.message, 'simple message');
            assert.strictEqual(result.file, undefined);
            assert.strictEqual(result.line, undefined);
        });
    });

    describe('mapSeverity', () => {
        it('should map error severities correctly', () => {
            assert.strictEqual(watcher.mapSeverity('error'), mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(watcher.mapSeverity('Error'), mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(watcher.mapSeverity('ERROR'), mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(watcher.mapSeverity('fatal'), mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(watcher.mapSeverity('fatal error'), mockVscode.DiagnosticSeverity.Error);
        });

        it('should map warning severities correctly', () => {
            assert.strictEqual(watcher.mapSeverity('warning'), mockVscode.DiagnosticSeverity.Warning);
            assert.strictEqual(watcher.mapSeverity('Warning'), mockVscode.DiagnosticSeverity.Warning);
            assert.strictEqual(watcher.mapSeverity('warn'), mockVscode.DiagnosticSeverity.Warning);
        });

        it('should map info severities correctly', () => {
            assert.strictEqual(watcher.mapSeverity('info'), mockVscode.DiagnosticSeverity.Information);
            assert.strictEqual(watcher.mapSeverity('Info'), mockVscode.DiagnosticSeverity.Information);
            assert.strictEqual(watcher.mapSeverity('information'), mockVscode.DiagnosticSeverity.Information);
        });

        it('should map hint severities correctly', () => {
            assert.strictEqual(watcher.mapSeverity('hint'), mockVscode.DiagnosticSeverity.Hint);
            assert.strictEqual(watcher.mapSeverity('Hint'), mockVscode.DiagnosticSeverity.Hint);
        });

        it('should default to error for unknown severities', () => {
            assert.strictEqual(watcher.mapSeverity('unknown'), mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(watcher.mapSeverity('debug'), mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(watcher.mapSeverity(''), mockVscode.DiagnosticSeverity.Error);
        });

        it('should handle null/undefined input', () => {
            assert.strictEqual(watcher.mapSeverity(null), mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(watcher.mapSeverity(undefined), mockVscode.DiagnosticSeverity.Error);
        });
    });
});
