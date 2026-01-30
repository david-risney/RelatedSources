const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Test suite for findFilesWithGlob module.
 * 
 * These tests use a mock VS Code API since the module depends on vscode.workspace.fs
 */

// ============================================================================
// Mock VS Code API
// ============================================================================

class MockUri {
    constructor(fsPath) {
        this._fsPath = fsPath;
        this._path = fsPath.replace(/\\/g, '/');
    }

    get fsPath() {
        return this._fsPath;
    }

    get path() {
        return this._path;
    }

    toString() {
        return `file://${this._path}`;
    }

    static file(filePath) {
        return new MockUri(filePath);
    }

    static joinPath(base, ...segments) {
        const joined = path.join(base.fsPath, ...segments);
        return new MockUri(joined);
    }
}

const MockFileType = {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64
};

function createMockVscode(rootDir) {
    return {
        Uri: MockUri,
        FileType: MockFileType,
        workspace: {
            fs: {
                readDirectory: async (uri) => {
                    const dirPath = uri.fsPath;
                    if (!fs.existsSync(dirPath)) {
                        const error = new Error(`ENOENT: no such file or directory: ${dirPath}`);
                        error.code = 'FileNotFound';
                        throw error;
                    }
                    const stat = fs.statSync(dirPath);
                    if (!stat.isDirectory()) {
                        const error = new Error(`ENOTDIR: not a directory: ${dirPath}`);
                        error.code = 'FileNotADirectory';
                        throw error;
                    }
                    const entries = fs.readdirSync(dirPath);
                    return entries.map(name => {
                        const fullPath = path.join(dirPath, name);
                        const entryStat = fs.statSync(fullPath);
                        let fileType = MockFileType.Unknown;
                        if (entryStat.isFile()) {
                            fileType = MockFileType.File;
                        } else if (entryStat.isDirectory()) {
                            fileType = MockFileType.Directory;
                        } else if (entryStat.isSymbolicLink()) {
                            fileType = MockFileType.SymbolicLink;
                        }
                        return [name, fileType];
                    });
                }
            }
        }
    };
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a directory structure from a specification.
 * @param {string} baseDir - The base directory
 * @param {string[]} files - Array of file paths to create (relative to baseDir)
 */
function createTestFiles(baseDir, files) {
    for (const file of files) {
        const fullPath = path.join(baseDir, file);
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, `// ${file}\n`);
    }
}

/**
 * Recursively removes a directory and all contents.
 */
function removeDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ============================================================================
// Tests for segmentToRegex
// ============================================================================

describe('segmentToRegex', () => {
    let segmentToRegex;

    beforeEach(() => {
        const module = require('../../src/findFilesWithGlob.js');
        segmentToRegex = module.segmentToRegex;
    });

    it('should match exact string without wildcards', () => {
        const regex = segmentToRegex('file.js');
        assert.strictEqual(regex.test('file.js'), true);
        assert.strictEqual(regex.test('file.ts'), false);
        assert.strictEqual(regex.test('otherfile.js'), false);
    });

    it('should match wildcard at end', () => {
        const regex = segmentToRegex('file.*');
        assert.strictEqual(regex.test('file.js'), true);
        assert.strictEqual(regex.test('file.ts'), true);
        assert.strictEqual(regex.test('file.spec.js'), true);
        assert.strictEqual(regex.test('file.'), true); // '*' matches zero characters (after the dot)
        assert.strictEqual(regex.test('file'), false); // No dot, so no match
        assert.strictEqual(regex.test('otherfile.js'), false);
    });

    it('should match wildcard at start', () => {
        const regex = segmentToRegex('*.js');
        assert.strictEqual(regex.test('file.js'), true);
        assert.strictEqual(regex.test('app.js'), true);
        assert.strictEqual(regex.test('.js'), true); // '*' matches zero characters
        assert.strictEqual(regex.test('file.ts'), false);
    });

    it('should match wildcard in middle', () => {
        const regex = segmentToRegex('file-*-name');
        assert.strictEqual(regex.test('file-test-name'), true);
        assert.strictEqual(regex.test('file-123-name'), true);
        assert.strictEqual(regex.test('file--name'), true); // '*' matches zero characters
        assert.strictEqual(regex.test('file-name'), false);
    });

    it('should match multiple wildcards', () => {
        const regex = segmentToRegex('*-*-*');
        assert.strictEqual(regex.test('a-b-c'), true);
        assert.strictEqual(regex.test('foo-bar-baz'), true);
        assert.strictEqual(regex.test('--'), true);
        assert.strictEqual(regex.test('a-b'), false);
    });

    it('should escape regex special characters', () => {
        const regex = segmentToRegex('file.spec.js');
        assert.strictEqual(regex.test('file.spec.js'), true);
        assert.strictEqual(regex.test('filexspecxjs'), false);
    });

    it('should handle pattern with only wildcard', () => {
        const regex = segmentToRegex('*');
        assert.strictEqual(regex.test('anything'), true);
        assert.strictEqual(regex.test(''), true);
        assert.strictEqual(regex.test('file.js'), true);
    });
});

// ============================================================================
// Tests for hasWildcard
// ============================================================================

describe('hasWildcard', () => {
    let hasWildcard;

    beforeEach(() => {
        const module = require('../../src/findFilesWithGlob.js');
        hasWildcard = module.hasWildcard;
    });

    it('should return true for segments with wildcards', () => {
        assert.strictEqual(hasWildcard('*.js'), true);
        assert.strictEqual(hasWildcard('file.*'), true);
        assert.strictEqual(hasWildcard('*'), true);
        assert.strictEqual(hasWildcard('file-*-name'), true);
    });

    it('should return false for segments without wildcards', () => {
        assert.strictEqual(hasWildcard('file.js'), false);
        assert.strictEqual(hasWildcard('src'), false);
        assert.strictEqual(hasWildcard(''), false);
    });
});

// ============================================================================
// Tests for findFilesWithGlob
// ============================================================================

describe('findFilesWithGlob', () => {
    let tempDir;
    let findFilesWithGlob;
    let mockVscode;

    beforeEach(() => {
        // Create temp directory
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'findfiles-test-'));

        // Create test file structure
        createTestFiles(tempDir, [
            'src/app.js',
            'src/index.js',
            'src/utils/helper.js',
            'src/utils/parser.js',
            'src/components/Button.js',
            'src/components/ButtonGroup.js',
            'src/components/Input.js',
            'test/app.test.js',
            'test/unit/helper.test.js',
            'test/unit/parser.test.js',
            'docs/readme.md',
            'docs/readme.txt',
            'docs/api.md',
            'config.json',
            'package.json',
        ]);

        // Set up mock vscode
        mockVscode = createMockVscode(tempDir);

        // Load module
        const module = require('../../src/findFilesWithGlob.js');
        findFilesWithGlob = module.findFilesWithGlob;
    });

    afterEach(() => {
        removeDir(tempDir);
    });

    /**
     * Helper to get relative paths from results for easier assertion
     */
    function getRelativePaths(results) {
        return results
            .map(uri => path.relative(tempDir, uri.fsPath).replace(/\\/g, '/'))
            .sort();
    }

    it('should return empty array for null workspaceFolder', async () => {
        const results = await findFilesWithGlob(null, 'src/*.js', undefined, mockVscode);
        assert.deepStrictEqual(results, []);
    });

    it('should return empty array for empty pattern', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, '', undefined, mockVscode);
        assert.deepStrictEqual(results, []);
    });

    it('should find exact file match', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'src/app.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['src/app.js']);
    });

    it('should find files with wildcard extension', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'docs/readme.*', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['docs/readme.md', 'docs/readme.txt']);
    });

    it('should find files with wildcard filename', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'src/*.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['src/app.js', 'src/index.js']);
    });

    it('should find files with wildcard directory', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'src/*/helper.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['src/utils/helper.js']);
    });

    it('should find files with wildcard prefix in filename', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'src/components/Button*.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['src/components/Button.js', 'src/components/ButtonGroup.js']);
    });

    it('should find files with multiple wildcards in pattern', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, '*/*.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['src/app.js', 'src/index.js', 'test/app.test.js']);
    });

    it('should find files at root level with wildcard', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, '*.json', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['config.json', 'package.json']);
    });

    it('should find files with wildcard-only segment', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'test/*/*.test.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['test/unit/helper.test.js', 'test/unit/parser.test.js']);
    });

    it('should return empty array for non-matching pattern', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'nonexistent/*.xyz', undefined, mockVscode);
        assert.deepStrictEqual(results, []);
    });

    it('should handle pattern with leading slash', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, '/src/app.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['src/app.js']);
    });

    it('should handle pattern with trailing slash', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        // Trailing slash should be stripped, looking for files named 'src' (none exist)
        const results = await findFilesWithGlob(workspaceFolder, 'src/', undefined, mockVscode);
        assert.deepStrictEqual(results, []);
    });

    it('should handle backslash path separators (normalize to forward)', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'src\\app.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['src/app.js']);
    });

    it('should respect maxResults parameter', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'src/components/*.js', 2, mockVscode);
        assert.strictEqual(results.length, 2);
    });

    it('should handle deeply nested files', async () => {
        // Create additional deep structure
        createTestFiles(tempDir, [
            'a/b/c/d/deep.js'
        ]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'a/b/c/d/deep.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['a/b/c/d/deep.js']);
    });

    it('should handle wildcards at multiple levels', async () => {
        // Create additional structure
        createTestFiles(tempDir, [
            'lib/core/util.js',
            'lib/extra/util.js',
        ]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'lib/*/util.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['lib/core/util.js', 'lib/extra/util.js']);
    });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('findFilesWithGlob edge cases', () => {
    let tempDir;
    let findFilesWithGlob;
    let mockVscode;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'findfiles-edge-'));
        mockVscode = createMockVscode(tempDir);
        const module = require('../../src/findFilesWithGlob.js');
        findFilesWithGlob = module.findFilesWithGlob;
    });

    afterEach(() => {
        removeDir(tempDir);
    });

    function getRelativePaths(results) {
        return results
            .map(uri => path.relative(tempDir, uri.fsPath).replace(/\\/g, '/'))
            .sort();
    }

    it('should handle empty directory', async () => {
        fs.mkdirSync(path.join(tempDir, 'empty'), { recursive: true });
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'empty/*', undefined, mockVscode);
        assert.deepStrictEqual(results, []);
    });

    it('should not match directories as files', async () => {
        fs.mkdirSync(path.join(tempDir, 'src', 'utils'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'file.js'), '');
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'src/*', undefined, mockVscode);
        const paths = getRelativePaths(results);
        // Should only match file.js, not utils directory
        assert.deepStrictEqual(paths, ['src/file.js']);
    });

    it('should handle filenames with special regex characters', async () => {
        createTestFiles(tempDir, [
            'src/file[1].js',
            'src/file(test).js',
            'src/file+plus.js',
        ]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        
        // Exact match with special chars
        const results1 = await findFilesWithGlob(workspaceFolder, 'src/file[1].js', undefined, mockVscode);
        assert.strictEqual(getRelativePaths(results1).length, 1);
        
        // Wildcard with special chars
        const results2 = await findFilesWithGlob(workspaceFolder, 'src/file*.js', undefined, mockVscode);
        assert.strictEqual(getRelativePaths(results2).length, 3);
    });

    it('should handle files with dots in directory names', async () => {
        createTestFiles(tempDir, [
            'node.modules/package/index.js',
            '.hidden/secret.js',
        ]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        
        const results = await findFilesWithGlob(workspaceFolder, '*/*/index.js', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['node.modules/package/index.js']);
    });

    it('should handle hidden files (starting with dot)', async () => {
        createTestFiles(tempDir, [
            '.gitignore',
            '.eslintrc.js',
        ]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        
        const results = await findFilesWithGlob(workspaceFolder, '.*', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.ok(paths.includes('.eslintrc.js'));
        assert.ok(paths.includes('.gitignore'));
    });

    it('should handle pattern with no wildcards for non-existent file', async () => {
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'does/not/exist.js', undefined, mockVscode);
        assert.deepStrictEqual(results, []);
    });

    it('should handle very long paths', async () => {
        const deepPath = 'a/b/c/d/e/f/g/h/i/j/file.js';
        createTestFiles(tempDir, [deepPath]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, deepPath, undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, [deepPath]);
    });

    it('should handle unicode filenames', async () => {
        createTestFiles(tempDir, [
            'i18n/日本語.js',
            'i18n/中文.js',
            'i18n/emoji🎉.js',
        ]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'i18n/*.js', undefined, mockVscode);
        assert.strictEqual(results.length, 3);
    });

    it('should handle spaces in filenames', async () => {
        createTestFiles(tempDir, [
            'my files/my document.txt',
        ]);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };
        const results = await findFilesWithGlob(workspaceFolder, 'my files/*.txt', undefined, mockVscode);
        const paths = getRelativePaths(results);
        assert.deepStrictEqual(paths, ['my files/my document.txt']);
    });
});

// ============================================================================
// Directory Cache Tests
// ============================================================================

describe('findFilesWithGlob directory cache', () => {
    let tempDir;
    let findFilesWithGlob;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'findfiles-cache-'));
        const module = require('../../src/findFilesWithGlob.js');
        findFilesWithGlob = module.findFilesWithGlob;
    });

    afterEach(() => {
        removeDir(tempDir);
    });

    it('should use cache for repeated directory reads', async () => {
        // Create test files
        createTestFiles(tempDir, [
            'src/file1.js',
            'src/file2.js',
            'src/file3.js',
        ]);

        let readDirectoryCallCount = 0;

        // Create mock vscode that counts readDirectory calls
        const countingMockVscode = {
            Uri: MockUri,
            FileType: MockFileType,
            workspace: {
                fs: {
                    readDirectory: async (uri) => {
                        readDirectoryCallCount++;
                        const dirPath = uri.fsPath;
                        if (!fs.existsSync(dirPath)) {
                            throw new Error(`ENOENT: ${dirPath}`);
                        }
                        const entries = fs.readdirSync(dirPath);
                        return entries.map(name => {
                            const fullPath = path.join(dirPath, name);
                            const stat = fs.statSync(fullPath);
                            return [name, stat.isFile() ? MockFileType.File : MockFileType.Directory];
                        });
                    }
                }
            }
        };

        const workspaceFolder = { uri: MockUri.file(tempDir) };
        const cache = new Map();

        // First call - should populate cache
        readDirectoryCallCount = 0;
        await findFilesWithGlob(workspaceFolder, 'src/*.js', undefined, countingMockVscode, cache);
        const firstCallCount = readDirectoryCallCount;

        // Second call with same cache - should use cached results
        readDirectoryCallCount = 0;
        await findFilesWithGlob(workspaceFolder, 'src/*.js', undefined, countingMockVscode, cache);
        const secondCallCount = readDirectoryCallCount;

        // First call should have made readDirectory calls
        assert.ok(firstCallCount > 0, 'First call should make readDirectory calls');
        // Second call should not make any readDirectory calls (all cached)
        assert.strictEqual(secondCallCount, 0, 'Second call should use cache and make no readDirectory calls');
    });

    it('should work without cache (backward compatible)', async () => {
        createTestFiles(tempDir, [
            'src/app.js',
        ]);

        const mockVscode = createMockVscode(tempDir);
        const workspaceFolder = { uri: mockVscode.Uri.file(tempDir) };

        // Call without cache parameter
        const results = await findFilesWithGlob(workspaceFolder, 'src/*.js', undefined, mockVscode);
        assert.strictEqual(results.length, 1);
    });

    it('should share cache across multiple pattern searches', async () => {
        createTestFiles(tempDir, [
            'src/app.js',
            'src/app.ts',
            'src/index.js',
        ]);

        let readDirectoryCallCount = 0;

        const countingMockVscode = {
            Uri: MockUri,
            FileType: MockFileType,
            workspace: {
                fs: {
                    readDirectory: async (uri) => {
                        readDirectoryCallCount++;
                        const dirPath = uri.fsPath;
                        if (!fs.existsSync(dirPath)) {
                            throw new Error(`ENOENT: ${dirPath}`);
                        }
                        const entries = fs.readdirSync(dirPath);
                        return entries.map(name => {
                            const fullPath = path.join(dirPath, name);
                            const stat = fs.statSync(fullPath);
                            return [name, stat.isFile() ? MockFileType.File : MockFileType.Directory];
                        });
                    }
                }
            }
        };

        const workspaceFolder = { uri: MockUri.file(tempDir) };
        const cache = new Map();

        // Search for .js files
        await findFilesWithGlob(workspaceFolder, 'src/*.js', undefined, countingMockVscode, cache);
        const callsAfterFirst = readDirectoryCallCount;

        // Search for .ts files - should reuse cached src directory listing
        await findFilesWithGlob(workspaceFolder, 'src/*.ts', undefined, countingMockVscode, cache);
        const callsAfterSecond = readDirectoryCallCount;

        // The second search should not add more readDirectory calls for src/
        assert.strictEqual(callsAfterSecond, callsAfterFirst, 'Second pattern search should reuse cached directory');
    });
});
