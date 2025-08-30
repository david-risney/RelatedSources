const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
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

    context.subscriptions.push(nextCmd);

    // Watch for configuration changes
    const configChangeWatcher = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('relatedsources')) {
            relatedSources.onConfigurationChanged();
        }
    });

    context.subscriptions.push(configChangeWatcher);
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
    }

    onConfigurationChanged() {
    }

    stop() {
    }

    async next() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Related Sources: No active editor');
            return;
        }

        const doc = editor.document;
        const fileUri = doc.uri;

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri) || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]);
        if (!workspaceFolder) {
            vscode.window.showInformationMessage('Related Sources: No workspace folder found');
            return;
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const relPath = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');

        const config = vscode.workspace.getConfiguration('relatedsources');
        const matchers = config.matchers || [];

        let candidateUris = [];

        for (const matcher of matchers) {
            if (!matcher || !matcher.sourceRegexp || !matcher.targetPath) {
                continue;
            }
            try {
                const regex = new RegExp(matcher.sourceRegexp);
                const m = relPath.match(regex);
                if (!m) {
                    continue;
                }

                let target = matcher.targetPath;
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

                const found = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, target));
                for (const f of found) {
                    candidateUris.push(f);
                }
            } catch (e) {
                console.error('[RelatedSources] invalid matcher', e);
                continue;
            }
        }

        // include current file
        candidateUris.push(fileUri);

        // deduplicate by relative path
        const map = new Map();
        for (const u of candidateUris) {
            const p = path.relative(workspaceRoot, u.fsPath).replace(/\\/g, '/');
            if (!map.has(p)) {
                map.set(p, u);
            }
        }

        const list = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        if (!list.length) {
            vscode.window.showInformationMessage('Related Sources: No related files found');
            return;
        }

        const currentKey = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');
        let idx = list.indexOf(currentKey);
        if (idx === -1) {
            idx = 0;
        }
        const nextIndex = (idx + 1) % list.length;
        const nextUri = map.get(list[nextIndex]);
        if (!nextUri) {
            vscode.window.showInformationMessage('Related Sources: Next file not found');
            return;
        }

        try {
            const docToOpen = await vscode.workspace.openTextDocument(nextUri);
            await vscode.window.showTextDocument(docToOpen, { preview: false });
        } catch (e) {
            console.error('[RelatedSources] failed to open file', e);
            vscode.window.showErrorMessage('Related Sources: Failed to open related file');
        }
    }
}

module.exports = {
    activate,
    deactivate
};
