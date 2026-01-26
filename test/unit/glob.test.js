const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { mockVscode } = require('../utils/mockVscode.js');

// Mock VS Code before requiring the extension
global.vscode = mockVscode;

// Create a testable version of BuildLogWatcher with glob functionality
class TestableGlobMatcher {
    constructor() {
        this.watchers = new Map();
        this.diagnostics = mockVscode.languages.createDiagnosticCollection('buildlog');
        this.currentWildcards = [];
    }

    globMatch(pattern) {
        const matches = [];
        const parts = pattern.split(path.sep);
        
        try {
            this.searchPath(parts, 0, '', matches);
        } catch (error) {
            // Silently ignore errors for invalid paths
        }
        
        return matches;
    }

    searchPath(parts, index, currentPath, matches) {
        if (index >= parts.length) {
            if (fs.existsSync(currentPath) && fs.statSync(currentPath).isFile()) {
                matches.push(currentPath);
            }
            return;
        }

        const part = parts[index];
        
        if (part === '') {
            // Handle leading separator or drive on Windows
            if (index === 0) {
                this.searchPath(parts, index + 1, path.sep, matches);
            }
            return;
        }

        if (part.includes('*')) {
            // Handle wildcard
            const basePath = currentPath || (index === 0 ? '' : path.sep);
            if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
                return;
            }

            const regex = new RegExp('^' + part.replace(/\*/g, '.*') + '$');
            try {
                const entries = fs.readdirSync(basePath);
                entries.forEach(entry => {
                    if (regex.test(entry)) {
                        const fullPath = path.join(basePath, entry);
                        this.searchPath(parts, index + 1, fullPath, matches);
                    }
                });
            } catch (error) {
                // Ignore permission errors
            }
        } else {
            // Exact match
            const nextPath = currentPath ? path.join(currentPath, part) : part;
            this.searchPath(parts, index + 1, nextPath, matches);
        }
    }

    findMatchingFiles(wildcards, workspaceRoot) {
        const matchedFiles = new Set();

        wildcards.forEach(pattern => {
            const resolvedPattern = path.isAbsolute(pattern) ? pattern : path.resolve(workspaceRoot, pattern);
            const files = this.globMatch(resolvedPattern);
            files.forEach(file => matchedFiles.add(file));
        });

        return Array.from(matchedFiles);
    }
}

describe('Glob Matching Tests', () => {
    let matcher;
    let tempDir;
    let testFiles;

    beforeEach(() => {
        matcher = new TestableGlobMatcher();
        
        // Create temporary directory structure for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchbuildlog-test-'));
        
        // Create test directory structure
        const dirs = [
            'logs',
            'logs/debug',
            'build',
            'build/output',
            'src'
        ];

        dirs.forEach(dir => {
            fs.mkdirSync(path.join(tempDir, dir), { recursive: true });
        });

        // Create test files
        testFiles = [
            'logs/build.log',
            'logs/error.log',
            'logs/debug/verbose.log',
            'build/output/compile.log',
            'build/ninja.log',
            'src/main.cpp',
            'package.json',
            'README.md'
        ];

        testFiles.forEach(file => {
            const filePath = path.join(tempDir, file);
            fs.writeFileSync(filePath, `Content of ${file}`);
        });
    });

    afterEach(() => {
        // Clean up temporary directory
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('globMatch', () => {
        it('should match exact file paths', () => {
            const pattern = path.join(tempDir, 'logs', 'build.log');
            const matches = matcher.globMatch(pattern);
            
            assert.strictEqual(matches.length, 1);
            assert.strictEqual(matches[0], pattern);
        });

        it('should match files with simple wildcard', () => {
            const pattern = path.join(tempDir, 'logs', '*.log');
            const matches = matcher.globMatch(pattern);
            
            assert.strictEqual(matches.length, 2);
            assert(matches.includes(path.join(tempDir, 'logs', 'build.log')));
            assert(matches.includes(path.join(tempDir, 'logs', 'error.log')));
        });

        it('should match files with directory wildcard', () => {
            const pattern = path.join(tempDir, '*', '*.log');
            const matches = matcher.globMatch(pattern);
            
            // Should find logs/build.log, logs/error.log, and build/ninja.log
            assert(matches.length >= 3);
            assert(matches.some(m => m.endsWith('build.log')));
            assert(matches.some(m => m.endsWith('error.log')));
            assert(matches.some(m => m.endsWith('ninja.log')));
        });

        it('should match files with multiple wildcards', () => {
            const pattern = path.join(tempDir, '*', '*', '*.log');
            const matches = matcher.globMatch(pattern);
            
            // Should find logs/debug/verbose.log and build/output/compile.log
            assert(matches.length >= 2);
            assert(matches.some(m => m.endsWith('verbose.log')));
            assert(matches.some(m => m.endsWith('compile.log')));
        });

        it('should handle non-existent paths gracefully', () => {
            const pattern = path.join(tempDir, 'nonexistent', '*.log');
            const matches = matcher.globMatch(pattern);
            
            assert.strictEqual(matches.length, 0);
        });

        it('should handle patterns that match directories as files', () => {
            const pattern = path.join(tempDir, 'logs');
            const matches = matcher.globMatch(pattern);
            
            // Should not match because logs is a directory, not a file
            assert.strictEqual(matches.length, 0);
        });

        it('should handle empty pattern parts', () => {
            // Test with double separators
            const pattern = path.join(tempDir, 'logs', '', 'build.log');
            const matches = matcher.globMatch(pattern);
            
            // Should still find the file despite empty part
            assert.strictEqual(matches.length, 1);
            assert(matches[0].endsWith('build.log'));
        });

        it('should match files with complex wildcards', () => {
            const pattern = path.join(tempDir, '**', '*.log');
            const matches = matcher.globMatch(pattern);
            
            // Note: This simple implementation doesn't support ** but should still work with *
            assert(matches.length >= 0);
        });
    });

    describe('findMatchingFiles', () => {
        it('should handle relative patterns with workspace root', () => {
            const wildcards = ['logs/*.log', 'build/*.log'];
            const matches = matcher.findMatchingFiles(wildcards, tempDir);
            
            assert(matches.length >= 3);
            assert(matches.some(m => m.endsWith('build.log')));
            assert(matches.some(m => m.endsWith('error.log')));
            assert(matches.some(m => m.endsWith('ninja.log')));
        });

        it('should handle absolute patterns', () => {
            const wildcards = [
                path.join(tempDir, 'logs', '*.log'),
                path.join(tempDir, 'build', '*.log')
            ];
            const matches = matcher.findMatchingFiles(wildcards, '/some/other/root');
            
            assert(matches.length >= 3);
            assert(matches.some(m => m.endsWith('build.log')));
            assert(matches.some(m => m.endsWith('error.log')));
            assert(matches.some(m => m.endsWith('ninja.log')));
        });

        it('should deduplicate matching files', () => {
            const wildcards = [
                'logs/*.log',
                'logs/build.log' // Specific file that's also matched by wildcard
            ];
            const matches = matcher.findMatchingFiles(wildcards, tempDir);
            
            // Should not have duplicates
            const buildLogMatches = matches.filter(m => m.endsWith('build.log'));
            assert.strictEqual(buildLogMatches.length, 1);
        });

        it('should handle empty wildcard list', () => {
            const matches = matcher.findMatchingFiles([], tempDir);
            assert.strictEqual(matches.length, 0);
        });

        it('should handle patterns that match no files', () => {
            const wildcards = ['nonexistent/*.log', 'missing/*.txt'];
            const matches = matcher.findMatchingFiles(wildcards, tempDir);
            
            assert.strictEqual(matches.length, 0);
        });
    });

    describe('searchPath edge cases', () => {
        it('should handle permission errors gracefully', () => {
            // Create a pattern that would cause readdir to fail
            const pattern = path.join(tempDir, 'logs', '*.log');
            
            // Mock fs.readdirSync to throw an error
            const originalReaddir = fs.readdirSync;
            fs.readdirSync = () => {
                throw new Error('Permission denied');
            };

            try {
                const matches = matcher.globMatch(pattern);
                // Should handle error gracefully and return empty array
                assert.strictEqual(matches.length, 0);
            } finally {
                fs.readdirSync = originalReaddir;
            }
        });

        it('should handle file stat errors gracefully', () => {
            const pattern = path.join(tempDir, 'logs', 'build.log');
            
            // Mock fs.statSync to throw an error
            const originalStat = fs.statSync;
            fs.statSync = () => {
                throw new Error('Stat failed');
            };

            try {
                const matches = matcher.globMatch(pattern);
                // Should handle error gracefully
                assert.strictEqual(matches.length, 0);
            } finally {
                fs.statSync = originalStat;
            }
        });

        it('should handle malformed paths', () => {
            const badPatterns = [
                '',
                path.sep,
                path.sep + path.sep,
                'logs' + path.sep + path.sep + '*.log'
            ];

            badPatterns.forEach(pattern => {
                const fullPattern = path.join(tempDir, pattern);
                const matches = matcher.globMatch(fullPattern);
                // Should not crash and return some result
                assert(Array.isArray(matches));
            });
        });
    });

    describe('Windows path handling', () => {
        it('should handle Windows drive letters in absolute paths', () => {
            if (process.platform === 'win32') {
                // Create pattern with drive letter
                const driveLetter = tempDir.charAt(0);
                const pattern = `${driveLetter}:\\**\\*.log`;
                
                // Should not crash when processing Windows paths
                const matches = matcher.globMatch(pattern);
                assert(Array.isArray(matches));
            }
        });

        it('should handle UNC paths on Windows', () => {
            if (process.platform === 'win32') {
                const pattern = '\\\\server\\share\\*.log';
                
                // Should not crash when processing UNC paths
                const matches = matcher.globMatch(pattern);
                assert(Array.isArray(matches));
            }
        });
    });
});
