const vscode = require('vscode');
const path = require('path');
const { findFilesWithGlob } = require('./findFilesWithGlob');
let relatedSources = null;

const log = (...args) => {
    console.log('[RelatedSources] ', ...args);
}

function activate(context) {
    log('extension is now active!');

    relatedSources = new RelatedSources();

    // Register commands
    const nextCmd = vscode.commands.registerCommand('relatedsources.next', async () => {
        if (!relatedSources) {
            log('RelatedSources not initialized');
            return;
        }

        try {
            await relatedSources.next();
        } catch (err) {
            console.error('[RelatedSources] next failed', err);
            vscode.window.showErrorMessage('RelatedSources: next failed');
        }
    });

    const prevCmd = vscode.commands.registerCommand('relatedsources.prev', async () => {
        if (!relatedSources) {
            log('RelatedSources not initialized');
            return;
        }

        try {
            await relatedSources.prev();
        } catch (err) {
            console.error('[RelatedSources] prev failed', err);
            vscode.window.showErrorMessage('RelatedSources: prev failed');
        }
    });

    const showRelatedCmd = vscode.commands.registerCommand('relatedsources.showRelated', async () => {
        // Get the list of related files
        if (!relatedSources) {
            log('RelatedSources not initialized');
            return;
        }
        const info = await relatedSources.getPrevNextInfoHelper();
        // Show quick pick
        const items = info.all.list.map((relPath, idx) => {
            return {
                label: path.basename(relPath),
                description: relPath,
                index: idx
            };
        });
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a related file to open',
            canPickMany: false
        });
        if (selected) {
            const selectedUri = await findFilesWithGlob(vscode.workspace.workspaceFolders[0], selected.description, 1);
            if (selectedUri && selectedUri.length > 0) {
                await relatedSources.completePrevNextHelper(selectedUri[0]);
            }
        }
    });

    context.subscriptions.push(nextCmd);
    context.subscriptions.push(prevCmd);
    context.subscriptions.push(showRelatedCmd);
}

function deactivate() {
    if (relatedSources) {
        relatedSources.stop();
        relatedSources = null;
    }
    log('extension is now deactivated!');
}

class RelatedSources {
    constructor() {
        // Cache for compiled regexes keyed by pattern string
        this.regexCache = new Map();
    }

    stop() {
        this.regexCache.clear();
    }

    /**
     * Get a compiled regex from cache, or compile and cache it.
     * @param {string} pattern - The regex pattern string
     * @returns {RegExp|null} - The compiled regex, or null if invalid
     */
    getCompiledRegex(pattern) {
        if (this.regexCache.has(pattern)) {
            return this.regexCache.get(pattern);
        }
        try {
            const regex = new RegExp(pattern);
            this.regexCache.set(pattern, regex);
            return regex;
        } catch (e) {
            console.error('[RelatedSources] invalid regex pattern:', pattern, e);
            this.regexCache.set(pattern, null);
            return null;
        }
    }

    async getPrevNextInfoHelper() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Related Sources: No active editor');
            return;
        }

        const doc = editor.document;
        const fileUri = doc.uri;

        return this.getPrevNextInfoHelperForUri(fileUri);
    }

    async getPrevNextInfoHelperForUri(fileUri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri) || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]);
        if (!workspaceFolder) {
            vscode.window.showInformationMessage('Related Sources: No workspace folder found');
            return;
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;

        // Get related files using the helper
        const candidateUris = await this.getTransitiveRelatedFiles(fileUri);

        // include current file
        candidateUris.push(fileUri);

        function fullPathToRelative(fullPath) {
            return path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
        }

        // deduplicate by relative path
        // map maps from workspace relative paths to file URI
        const map = new Map();
        for (const candidateUri of candidateUris) {
            const fullPath = fullPathToRelative(candidateUri.fsPath);
            if (!map.has(fullPath)) {
                map.set(fullPath, candidateUri);
            }
        }

        const list = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        if (!list.length) {
            vscode.window.showInformationMessage('Related Sources: No related files found');
            return;
        }

        const currentKey = fullPathToRelative(fileUri.fsPath);
        let idx = list.indexOf(currentKey);
        if (idx === -1) {
            idx = 0;
            log(`Cant find current path (${currentKey}) in list ${JSON.stringify(list)}`)
        }
        const nextIndex = ((idx + 1) % (list.length));
        const nextUri = map.get(list[nextIndex]);

        let prevIndex = idx - 1;
        if (prevIndex < 0) {
            prevIndex = list.length - 1;
        }
        const prevUri = map.get(list[prevIndex]);

        return {
            all: {
                list,
                currentIdx: idx
            },
            next: {
                index: nextIndex,
                uri: nextUri
            },
            prev: {
                index: prevIndex,
                uri: prevUri
            }
        };
    }

    /**
     * Gets an array of related file URIs for a given file URI.
     * This applies all configured matchers to find related files.
     * 
     * @param {vscode.Uri} fileUri - The file URI to find related files for
     * @param {Map<string, Array>} [directoryCache] - Optional cache for readDirectory results
     * @returns {Promise<vscode.Uri[]>} - Array of related file URIs (may contain duplicates)
     */
    async getRelatedFiles(fileUri, directoryCache) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri) || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]);
        if (!workspaceFolder) {
            return [];
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const relPath = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');

        const config = vscode.workspace.getConfiguration('relatedsources');
        const matchers = config.matchers || [];

        let candidateUris = [];

        for (const matcher of matchers) {
            const matcherStartTime = Date.now();
            const matcherName = matcher?.name || 'unnamed';

            if (!matcher || !matcher.sourceRegexp || !matcher.targetPath) {
                continue;
            }
            let target = matcher.targetPath;
            let findFilesDuration = 0;
            try {
                const regex = this.getCompiledRegex(matcher.sourceRegexp);
                if (!regex) {
                    continue;
                }
                const m = relPath.match(regex);
                if (!m) {
                    continue;
                }

                // Replace placeholders ${name} and ${1}
                target = target.replace(/\$\{([^}]+)\}/g, (full, name) => {
                    if (/^\d+$/.test(name)) {
                        const idx = parseInt(name, 10);
                        return m[idx] || '';
                    } else {
                        return (m.groups && m.groups[name]) || '';
                    }
                });

                // Normalize target to forward slashes and remove leading slash
                target = target.replace(/\\/g, '/').replace(/^[\/]+/, '');

                const findFilesStartTime = Date.now();
                const found = await findFilesWithGlob(workspaceFolder, target, undefined, undefined, directoryCache);
                findFilesDuration = Date.now() - findFilesStartTime;
                log(`Matcher "${matcherName}": findFilesWithGlob took ${findFilesDuration}ms, found ${found.length} files`);

                for (const f of found) {
                    candidateUris.push(f);
                }
            } catch (e) {
                console.error('[RelatedSources] invalid matcher', e);
                continue;
            }

            const matcherDuration = Date.now() - matcherStartTime;
            log(`Matcher "${matcherName}": completed in ${matcherDuration}ms`);
            if (matcherDuration > 1000) {
                vscode.window.showWarningMessage(
                    `Related Sources: Matcher "${matcherName}" took ${(matcherDuration / 1000).toFixed(1)}s ` +
                    `and findFiles duration ${(findFilesDuration / 1000).toFixed(1)}s. ` +
                    `Consider optimizing: sourceRegexp="${matcher.sourceRegexp}", targetPath="${matcher.targetPath}", target="${target}"`
                );
            }
        }

        return candidateUris;
    }

    /**
     * Gets an array of all transitively related file URIs for a given file URI.
     * This finds all files related to the input file, then finds files related to those,
     * and continues until no new files are discovered.
     * 
     * @param {vscode.Uri} fileUri - The file URI to find transitively related files for
     * @returns {Promise<vscode.Uri[]>} - Array of unique related file URIs (deduplicated by fsPath)
     */
    async getTransitiveRelatedFiles(fileUri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri) || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]);
        if (!workspaceFolder) {
            return [];
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        
        // Cache for readDirectory calls to avoid repeated filesystem access
        const directoryCache = new Map();
        
        // Track processed files by their relative path to avoid duplicates and cycles
        const processedPaths = new Set();
        // Map from relative path to URI for the final result
        const resultMap = new Map();
        // Queue of URIs to process
        const queue = [fileUri];

        while (queue.length > 0) {
            const currentUri = queue.shift();
            const currentRelPath = path.relative(workspaceRoot, currentUri.fsPath).replace(/\\/g, '/');

            // Skip if already processed
            if (processedPaths.has(currentRelPath)) {
                continue;
            }
            processedPaths.add(currentRelPath);
            resultMap.set(currentRelPath, currentUri);

            // Get directly related files, passing the cache
            const relatedUris = await this.getRelatedFiles(currentUri, directoryCache);

            for (const relatedUri of relatedUris) {
                const relatedRelPath = path.relative(workspaceRoot, relatedUri.fsPath).replace(/\\/g, '/');
                // Add to queue if not already processed
                if (!processedPaths.has(relatedRelPath)) {
                    queue.push(relatedUri);
                }
            }
        }

        // Return all unique URIs (excluding the original file if desired, but including it for consistency)
        return Array.from(resultMap.values());
    }

    async completePrevNextHelper(uri) {
        const maxColumn = vscode.window.visibleTextEditors.reduce((max, editor) => Math.max(max, editor.viewColumn), 1);
        const currentColumn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : 1;
        const openColumnSetting = vscode.workspace.getConfiguration('relatedsources').get('openColumn', 'beside');

        let newColumn = currentColumn;
        switch (openColumnSetting) {
        case 'current':
            newColumn = -1;
            break;

        case 'beside':
            newColumn = -2;
            break;

        default:
        case 'besideNoNewColumn':
            if (currentColumn < maxColumn) {
                newColumn = currentColumn + 1;
            } else if (currentColumn > 1) {
                newColumn = currentColumn - 1;
            }
            break;
        }

        try {
            const docToOpen = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(docToOpen, { 
                preview: false,
                viewColumn: newColumn
            });
        } catch (e) {
            console.error('[RelatedSources] failed to open file', e);
            vscode.window.showErrorMessage('Related Sources: Failed to open related file');
        }
    }

    async next() {
        const info = await this.getPrevNextInfoHelper();

        if (!info.next.uri) {
            vscode.window.showInformationMessage('Related Sources: Next file not found');
            return;
        }

        await this.completePrevNextHelper(info.next.uri);
    }

    async prev() {
        const info = await this.getPrevNextInfoHelper();

        if (!info.prev.uri) {
            vscode.window.showInformationMessage('Related Sources: Previous file not found');
            return;
        }

        await this.completePrevNextHelper(info.prev.uri);
    }
}

module.exports = {
    activate,
    deactivate
};