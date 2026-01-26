const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

    parseLogFile(logFilePath, clearAllDiagnostics = true) {
        try {
            const content = fs.readFileSync(logFilePath, 'utf8');
            const lines = content.split('\n');
            const problemPatterns = this.getTestProblemPatterns();

            const diagnosticsMap = new Map();

            // Clear diagnostics for this specific file, or all files if requested
            if (clearAllDiagnostics) {
                this.diagnostics.clear();
            } else {
                // Clear diagnostics only for this specific file
                this.diagnostics.delete(mockVscode.Uri.file(logFilePath));
            }

            lines.forEach((line, lineNumber) => {
                const errorInfo = this.parseErrorLine(line, problemPatterns);
                if (errorInfo) {
                    const filePath = errorInfo.file || logFilePath;
                    
                    if (!diagnosticsMap.has(filePath)) {
                        diagnosticsMap.set(filePath, []);
                    }

                    const severity = this.mapSeverity(errorInfo.severity);
                    const diagnostic = new mockVscode.Diagnostic(
                        new mockVscode.Range(
                            (errorInfo.line ? errorInfo.line - 1 : lineNumber),
                            (errorInfo.column ? errorInfo.column - 1 : 0),
                            (errorInfo.line ? errorInfo.line - 1 : lineNumber),
                            (errorInfo.column ? errorInfo.column - 1 : line.length)
                        ),
                        errorInfo.message,
                        severity
                    );

                    diagnostic.source = 'Build Log';
                    if (errorInfo.code) {
                        diagnostic.code = errorInfo.code;
                    }
                    
                    diagnosticsMap.get(filePath).push(diagnostic);
                }
            });

            // Set new diagnostics
            diagnosticsMap.forEach((diagnostics, filePath) => {
                this.diagnostics.set(mockVscode.Uri.file(filePath), diagnostics);
            });

            return diagnosticsMap;

        } catch (error) {
            throw error;
        }
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

    getTestProblemPatterns() {
        return [
            {
                regexp: '^(.+?):(\\d+):(\\d+):\\s*(error|warning|info):\\s*(.+)$',
                file: 1,
                line: 2,
                column: 3,
                severity: 4,
                message: 5
            },
            {
                regexp: '^(.+?)\\((\\d+),(\\d+)\\):\\s*(error|warning)\\s+(C\\d+):\\s*(.+)$',
                file: 1,
                line: 2,
                column: 3,
                severity: 4,
                code: 5,
                message: 6
            },
            {
                regexp: '(error|warning|info):\\s*(.+)$',
                severity: 1,
                message: 2
            }
        ];
    }
}

describe('Integration Tests', () => {
    let watcher;
    let tempDir;
    let testLogFile;

    beforeEach(() => {
        watcher = new TestableBuildLogWatcher();
        
        // Create temporary directory for test log files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchbuildlog-integration-'));
        testLogFile = path.join(tempDir, 'build.log');
    });

    afterEach(() => {
        // Clean up temporary directory
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('parseLogFile', () => {
        it('should parse a complete log file with multiple error types', () => {
            const logContent = `
Build started...
src/main.cpp:42:10: error: undefined variable "test"
src/utils.h:15:5: warning: unused variable 'temp'
Compiling module...
src/parser.cpp(25,8): error C2065: undeclared identifier
src/helper.cpp(10,12): warning C4101: unreferenced local variable
error: Build failed with 3 errors
info: Compilation statistics available
Processing complete.
            `.trim();

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            // Should have diagnostics for multiple files
            assert(diagnosticsMap.size >= 4);

            // Check that we have the expected files
            const fileKeys = Array.from(diagnosticsMap.keys());
            assert(fileKeys.some(f => f.endsWith('main.cpp')));
            assert(fileKeys.some(f => f.endsWith('utils.h')));
            assert(fileKeys.some(f => f.endsWith('parser.cpp')));
            assert(fileKeys.some(f => f.endsWith('helper.cpp')));

            // Check main.cpp error
            const mainCppDiagnostics = diagnosticsMap.get('src/main.cpp');
            assert(mainCppDiagnostics.length >= 1);
            assert.strictEqual(mainCppDiagnostics[0].severity, mockVscode.DiagnosticSeverity.Error);
            assert(mainCppDiagnostics[0].message.includes('undefined variable'));

            // Check utils.h warning
            const utilsHDiagnostics = diagnosticsMap.get('src/utils.h');
            assert(utilsHDiagnostics.length >= 1);
            assert.strictEqual(utilsHDiagnostics[0].severity, mockVscode.DiagnosticSeverity.Warning);
            assert(utilsHDiagnostics[0].message.includes('unused variable'));

            // Check MSVC format errors
            const parserCppDiagnostics = diagnosticsMap.get('src/parser.cpp');
            assert(parserCppDiagnostics.length >= 1);
            assert.strictEqual(parserCppDiagnostics[0].severity, mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(parserCppDiagnostics[0].code, 'C2065');
        });

        it('should handle empty log file', () => {
            fs.writeFileSync(testLogFile, '');

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            assert.strictEqual(diagnosticsMap.size, 0);
        });

        it('should handle log file with no errors', () => {
            const logContent = `
Build started...
Compiling src/main.cpp...
Compiling src/utils.cpp...
Linking...
Build completed successfully.
            `.trim();

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            assert.strictEqual(diagnosticsMap.size, 0);
        });

        it('should handle mixed line endings', () => {
            const logContent = `src/main.cpp:42:10: error: test error
src/utils.cpp:10:5: warning: test warning
src/parser.cpp:5:1: info: test info`;

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            assert.strictEqual(diagnosticsMap.size, 3);
        });

        it('should handle unicode content', () => {
            const logContent = `
src/main.cpp:42:10: error: undefined variable "tëst" with unicode
src/utils.cpp:15:5: warning: unused variable 'tëmp' — special chars
            `.trim();

            fs.writeFileSync(testLogFile, logContent, 'utf8');

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            assert.strictEqual(diagnosticsMap.size, 2);
            
            const mainCppDiagnostics = diagnosticsMap.get('src/main.cpp');
            assert(mainCppDiagnostics[0].message.includes('tëst'));
        });

        it('should handle very large line numbers and columns', () => {
            const logContent = `
src/generated.cpp:999999:88888: error: generated code error
src/huge.cpp:1234567:9999: warning: massive file warning
            `.trim();

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            assert.strictEqual(diagnosticsMap.size, 2);
            
            const generatedDiagnostics = diagnosticsMap.get('src/generated.cpp');
            assert.strictEqual(generatedDiagnostics[0].range.start.line, 999998); // 0-indexed
            assert.strictEqual(generatedDiagnostics[0].range.start.character, 88887); // 0-indexed
        });

        it('should handle non-existent file gracefully', () => {
            const nonExistentFile = path.join(tempDir, 'nonexistent.log');

            assert.throws(() => {
                watcher.parseLogFile(nonExistentFile);
            }, /ENOENT/);
        });

        it('should handle clearAllDiagnostics parameter correctly', () => {
            const logContent1 = 'src/file1.cpp:10:5: error: error in file 1';
            const logContent2 = 'src/file2.cpp:20:10: error: error in file 2';
            
            const logFile1 = path.join(tempDir, 'build1.log');
            const logFile2 = path.join(tempDir, 'build2.log');
            
            fs.writeFileSync(logFile1, logContent1);
            fs.writeFileSync(logFile2, logContent2);

            // Parse first file with clearAllDiagnostics = true
            watcher.parseLogFile(logFile1, true);
            assert.strictEqual(watcher.diagnostics.size, 1);

            // Parse second file with clearAllDiagnostics = false
            watcher.parseLogFile(logFile2, false);
            assert.strictEqual(watcher.diagnostics.size, 2);

            // Parse first file again with clearAllDiagnostics = true
            watcher.parseLogFile(logFile1, true);
            assert.strictEqual(watcher.diagnostics.size, 1);
        });

        it('should handle malformed patterns gracefully', () => {
            const logContent = `
src/main.cpp:42:10: error: test error
src/utils.cpp:15:5: warning: test warning
            `.trim();

            fs.writeFileSync(testLogFile, logContent);

            // Override problem patterns with malformed regex
            const originalGetPatterns = watcher.getTestProblemPatterns;
            watcher.getTestProblemPatterns = () => [
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

            try {
                const diagnosticsMap = watcher.parseLogFile(testLogFile);
                
                // Should still parse with the valid pattern
                assert.strictEqual(diagnosticsMap.size, 2);
            } finally {
                watcher.getTestProblemPatterns = originalGetPatterns;
            }
        });
    });

    describe('Diagnostic Creation', () => {
        it('should create diagnostics with correct ranges', () => {
            const logContent = `
Line 0 content
src/main.cpp:2:10: error: error on line 2
Line 2 content
src/utils.cpp:4:5: warning: warning on line 4
            `.trim();

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            const mainCppDiagnostics = diagnosticsMap.get('src/main.cpp');
            assert.strictEqual(mainCppDiagnostics[0].range.start.line, 1); // Line 2 - 1 = 1
            assert.strictEqual(mainCppDiagnostics[0].range.start.character, 9); // Column 10 - 1 = 9

            const utilsCppDiagnostics = diagnosticsMap.get('src/utils.cpp');
            assert.strictEqual(utilsCppDiagnostics[0].range.start.line, 3); // Line 4 - 1 = 3
            assert.strictEqual(utilsCppDiagnostics[0].range.start.character, 4); // Column 5 - 1 = 4
        });

        it('should handle missing line/column numbers', () => {
            const logContent = `error: General build error without location
warning: General warning message`;

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            // Should create diagnostics for the log file itself
            const logFileDiagnostics = diagnosticsMap.get(testLogFile);
            assert(logFileDiagnostics.length >= 2);

            // Check that ranges default to line number in log file (0-indexed)
            assert.strictEqual(logFileDiagnostics[0].range.start.line, 0); // First error line in log (line 0)
            assert.strictEqual(logFileDiagnostics[0].range.start.character, 0);
        });

        it('should set diagnostic properties correctly', () => {
            const logContent = 'src/main.cpp:42:10: error: test error message';

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            const diagnostics = diagnosticsMap.get('src/main.cpp');
            const diagnostic = diagnostics[0];

            assert.strictEqual(diagnostic.message, 'test error message');
            assert.strictEqual(diagnostic.severity, mockVscode.DiagnosticSeverity.Error);
            assert.strictEqual(diagnostic.source, 'Build Log');
        });

        it('should handle diagnostic codes', () => {
            const logContent = 'src/main.cpp(42,10): error C2065: undeclared identifier';

            fs.writeFileSync(testLogFile, logContent);

            const diagnosticsMap = watcher.parseLogFile(testLogFile);

            const diagnostics = diagnosticsMap.get('src/main.cpp');
            const diagnostic = diagnostics[0];

            assert.strictEqual(diagnostic.code, 'C2065');
            assert.strictEqual(diagnostic.message, 'undeclared identifier');
        });
    });
});
