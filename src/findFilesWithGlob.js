const path = require('path');

// Get vscode module - allows for dependency injection during testing
let vscode;
try {
    vscode = require('vscode');
} catch (e) {
    // vscode not available (running tests outside VS Code)
    vscode = null;
}

/*
================================================================================
GLOB PATTERN SYNTAX
================================================================================

This module provides a fast file finder using vscode.workspace.fs.readDirectory
instead of the slower vscode.workspace.findFiles.

SUPPORTED GLOB SYNTAX:
----------------------

The glob pattern is a path string with segments separated by '/'.
Each segment can contain:

  - Literal text: matches exactly
  - '*' (asterisk): matches zero or more characters within a segment

PATTERN RULES:
--------------

  1. Path segments are separated by '/' (forward slash only)
  2. '*' can appear anywhere in a segment (start, middle, end, or multiple times)
  3. '*' does NOT match across path separators (it only matches within a segment)
  4. Patterns are matched from the workspace root
  5. Matching is case-insensitive on Windows, case-sensitive on other platforms

EXAMPLES:
---------

  Pattern                        Matches
  -----------------------------  ------------------------------------------
  src/file.js                    src/file.js (exact match)
  src/*.js                       src/app.js, src/index.js, etc.
  src/star/file.js               src/foo/file.js, src/bar/file.js
  star/test/star.spec.js         unit/test/app.spec.js, etc.
  src/star-utils/star.js         src/string-utils/parse.js, etc.
  docs/readme.star               docs/readme.md, docs/readme.txt
  src/components/Buttonstar      src/components/Button.js, ButtonGroup.js
  star/star/star.c               Any .c file 3 levels deep

  (Note: "star" in the examples above represents the asterisk wildcard character)

NOT SUPPORTED:
--------------

  - '**' (globstar / recursive matching)
  - '?' (single character wildcard)
  - '[abc]' (character classes)
  - '{a,b}' (brace expansion)
  - '!' (negation patterns)
  - Backslash path separators (use forward slashes)

================================================================================
*/

/**
 * Converts a simple glob pattern segment to a RegExp.
 * Only supports '*' as a wildcard (matches zero or more characters).
 * 
 * @param {string} segment - A single path segment (e.g., '*.js' or 'file-*-name')
 * @returns {RegExp} - A RegExp that matches the segment pattern
 */
function segmentToRegex(segment) {
    // Escape special regex characters except '*'
    const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // Replace '*' with '.*' (match zero or more characters)
    const pattern = escaped.replace(/\*/g, '.*');
    // Case sensitivity depends on platform
    const flags = process.platform === 'win32' ? 'i' : '';
    return new RegExp(`^${pattern}$`, flags);
}

/**
 * Checks if a segment pattern contains any wildcards.
 * 
 * @param {string} segment - A path segment
 * @returns {boolean} - True if the segment contains wildcards
 */
function hasWildcard(segment) {
    return segment.includes('*');
}

/**
 * Finds files matching a glob pattern using vscode.workspace.fs.readDirectory.
 * This is faster than vscode.workspace.findFiles for many use cases.
 * 
 * @param {vscode.WorkspaceFolder} workspaceFolder - The workspace folder to search in
 * @param {string} pattern - The glob pattern (see module documentation for syntax)
 * @param {number} [maxResults] - Optional maximum number of results to return
 * @param {object} [vscodeMock] - Optional vscode module for testing
 * @param {Map<string, Array>} [directoryCache] - Optional cache for readDirectory results
 * @returns {Promise<vscode.Uri[]>} - Array of URIs matching the pattern
 */
async function findFilesWithGlob(workspaceFolder, pattern, maxResults, vscodeMock, directoryCache) {
    const vs = vscodeMock || vscode;
    
    if (!workspaceFolder || !pattern) {
        return [];
    }

    // Normalize pattern: remove leading/trailing slashes, normalize to forward slashes
    const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    
    if (!normalizedPattern) {
        return [];
    }

    const segments = normalizedPattern.split('/');
    const results = [];
    const rootUri = workspaceFolder.uri;

    await searchDirectory(vs, rootUri, segments, 0, results, maxResults, directoryCache);

    return results;
}

/**
 * Recursively searches directories matching the pattern segments.
 * 
 * @param {object} vs - The vscode module (or mock)
 * @param {vscode.Uri} currentUri - The current directory URI
 * @param {string[]} segments - The pattern segments
 * @param {number} segmentIndex - Current segment index being matched
 * @param {vscode.Uri[]} results - Accumulator for matching file URIs
 * @param {number} [maxResults] - Optional maximum number of results
 * @param {Map<string, Array>} [directoryCache] - Optional cache for readDirectory results
 * @returns {Promise<boolean>} - True if max results reached
 */
async function searchDirectory(vs, currentUri, segments, segmentIndex, results, maxResults, directoryCache) {
    // Check if we've collected enough results
    if (maxResults !== undefined && results.length >= maxResults) {
        return true;
    }

    // If we've processed all segments, we shouldn't be here
    if (segmentIndex >= segments.length) {
        return false;
    }

    const segment = segments[segmentIndex];
    const isLastSegment = segmentIndex === segments.length - 1;
    const segmentHasWildcard = hasWildcard(segment);
    const segmentRegex = segmentHasWildcard ? segmentToRegex(segment) : null;

    try {
        // Use cache if available
        const cacheKey = currentUri.fsPath;
        let entries;
        if (directoryCache && directoryCache.has(cacheKey)) {
            entries = directoryCache.get(cacheKey);
        } else {
            entries = await vs.workspace.fs.readDirectory(currentUri);
            if (directoryCache) {
                directoryCache.set(cacheKey, entries);
            }
        }

        for (const [name, fileType] of entries) {
            // Check if we've collected enough results
            if (maxResults !== undefined && results.length >= maxResults) {
                return true;
            }

            // Check if the name matches the current segment
            const matches = segmentHasWildcard
                ? segmentRegex.test(name)
                : (process.platform === 'win32'
                    ? name.toLowerCase() === segment.toLowerCase()
                    : name === segment);

            if (!matches) {
                continue;
            }

            const entryUri = vs.Uri.joinPath(currentUri, name);

            if (isLastSegment) {
                // Last segment: we're looking for the final file/folder
                // FileType.File = 1, FileType.Directory = 2, FileType.SymbolicLink = 64
                if (fileType === vs.FileType.File || (fileType & vs.FileType.File)) {
                    results.push(entryUri);
                }
            } else {
                // Not the last segment: continue searching in subdirectories
                if (fileType === vs.FileType.Directory || (fileType & vs.FileType.Directory)) {
                    const maxReached = await searchDirectory(
                        vs,
                        entryUri,
                        segments,
                        segmentIndex + 1,
                        results,
                        maxResults,
                        directoryCache
                    );
                    if (maxReached) {
                        return true;
                    }
                }
            }
        }
    } catch (error) {
        // Directory doesn't exist or can't be read - silently continue
        // This can happen for permission issues or if the path doesn't exist
    }

    return false;
}

module.exports = {
    findFilesWithGlob,
    segmentToRegex,
    hasWildcard,
    // Export for testing
    _searchDirectory: searchDirectory
};
