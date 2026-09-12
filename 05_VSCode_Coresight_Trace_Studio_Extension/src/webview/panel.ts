import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TemplateManager } from '../templateManager';
import { CodeInjector, TraceWindowMode } from '../codeInjector';
import { getTraceMode, setTraceMode } from '../traceMode';
import { SnapshotGenerator, TraceConfigParams } from '../snapshotGenerator';
import { TraceDecoder, DecoderRunParams } from '../traceDecoder';
import { ReportGenerator } from '../reportGenerator';

export class CoreSightPanel {
    public static currentPanel: CoreSightPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _templateManager: TemplateManager;
    private _snapshotGenerator: SnapshotGenerator;
    private _traceDecoder: TraceDecoder;
    private _workspaceRoot: string;

    public static createOrShow(context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CoreSightPanel.currentPanel) {
            CoreSightPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'coresightTraceStudio',
            'CoreSight Trace Studio',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'media'),
                    vscode.Uri.file(context.extensionPath)
                ]
            }
        );

        CoreSightPanel.currentPanel = new CoreSightPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;

        this._workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : process.cwd();

        this._templateManager = new TemplateManager(context);
        this._snapshotGenerator = new SnapshotGenerator(this._workspaceRoot);
        this._traceDecoder = new TraceDecoder(this._workspaceRoot);

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleMessage(message);
            },
            null,
            this._disposables
        );
    }

    private async _handleMessage(message: any) {
        switch (message.command) {
            case 'init': {
                const status = this._templateManager.checkDriverStatus(this._workspaceRoot);
                const dirs = this._templateManager.getProjectDirectories(this._workspaceRoot);
                const etmConfig = CodeInjector.readEtmConfig(this._workspaceRoot);
                this._panel.webview.postMessage({
                    type: 'initStatus',
                    status,
                    dirs,
                    etmConfig,
                    traceMode: getTraceMode(),
                    workspaceRoot: this._workspaceRoot
                });
                break;
            }

            case 'addDriverFiles': {
                const res = await this._templateManager.addDriverFiles(this._workspaceRoot);
                const status = this._templateManager.checkDriverStatus(this._workspaceRoot);
                this._panel.webview.postMessage({
                    type: 'driverAdded',
                    result: res,
                    status
                });
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showErrorMessage(res.message);
                }
                break;
            }

            case 'injectConfig': {
                const targetFile = message.filePath;
                const targetLine = message.line ? parseInt(message.line, 10) : undefined;
                const res = await CodeInjector.injectConfigFunction(targetFile, targetLine);
                this._panel.webview.postMessage({
                    type: 'configInjected',
                    result: res
                });
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showErrorMessage(res.message);
                }
                break;
            }

            case 'wrapSelection': {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('Please open a source file and select code to wrap.');
                    return;
                }
                const mode: TraceWindowMode = message.mode === 'trace_all' ? 'trace_all' : getTraceMode();
                const res = await CodeInjector.wrapSelectionWithStartStop(activeEditor, mode);
                this._panel.webview.postMessage({
                    type: 'selectionWrapped',
                    result: res
                });
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showErrorMessage(res.message);
                }
                break;
            }

            case 'wrapLines': {
                const lineMode: TraceWindowMode = message.mode === 'trace_all' ? 'trace_all' : getTraceMode();
                const res = await CodeInjector.wrapLinesWithStartStop(
                    message.filePath, message.fromLine, message.toLine, lineMode
                );
                this._panel.webview.postMessage({
                    type: 'linesWrapped',
                    result: res
                });
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showErrorMessage(res.message);
                }
                break;
            }

            case 'setTraceMode': {
                const mode: TraceWindowMode = message.mode === 'trace_all' ? 'trace_all' : 'dwt_gated';
                await setTraceMode(mode);

                // Keep the driver and the injected calls in agreement. Choosing
                // "Trace All" but leaving ETMv4.c DWT-gated would produce a
                // window that never opens, so the two are always written together.
                const res = await CodeInjector.setTraceWindowMode(this._workspaceRoot, mode);
                const etmConfig = CodeInjector.readEtmConfig(this._workspaceRoot);
                this._panel.webview.postMessage({
                    type: 'traceModeSet',
                    mode,
                    result: res,
                    etmConfig
                });
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showWarningMessage(res.message);
                }
                break;
            }

            case 'browseFile': {
                const fileUris = await vscode.window.showOpenDialog({
                    canSelectFiles: message.canSelectFiles !== false,
                    canSelectFolders: message.canSelectFolders === true,
                    canSelectMany: false,
                    openLabel: message.title || 'Select',
                    filters: message.filters || undefined
                });

                if (fileUris && fileUris.length > 0) {
                    this._panel.webview.postMessage({
                        type: 'fileSelected',
                        targetId: message.targetId,
                        path: fileUris[0].fsPath
                    });
                }
                break;
            }

            case 'updateEtmConfig': {
                const params = message.params;
                if (params.syncPeriodPower !== 10) {
                    vscode.window.showErrorMessage('Error: TRCSYNCPR (Sync Period) is read-only on STM32H7 / Cortex-M7 and cannot be changed from 10 (1024 bytes).');
                    this._panel.webview.postMessage({
                        type: 'syncPeriodError',
                        message: 'TRCSYNCPR is read-only on STM32H7 and cannot be changed from 10.'
                    });
                    params.syncPeriodPower = 10;
                }
                const res = await CodeInjector.updateEtmConfig(this._workspaceRoot, params);
                this._panel.webview.postMessage({
                    type: 'etmConfigUpdated',
                    result: res
                });
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showErrorMessage(res.message);
                }
                break;
            }

            case 'syncPeriodError': {
                vscode.window.showErrorMessage(message.message || 'Error: TRCSYNCPR (Sync Period) is read-only on STM32H7 / Cortex-M7 (fixed at 10 / 1024 bytes).');
                break;
            }

            case 'generateSnapshot': {
                const params: TraceConfigParams = message.params;
                if (params.syncPeriodPower !== 10) {
                    vscode.window.showErrorMessage('Error: TRCSYNCPR (Sync Period) is read-only on STM32H7 / Cortex-M7 and cannot be changed from 10 (1024 bytes). Value has been reverted to 10.');
                    params.syncPeriodPower = 10;
                }

                // Ensure ETMv4.c driver values are synchronized
                const etmUpdate = await CodeInjector.updateEtmConfig(this._workspaceRoot, params);
                if (etmUpdate.success) {
                    this._panel.webview.postMessage({
                        type: 'snapshotLog',
                        text: `[CONFIG] ${etmUpdate.message}\n`
                    });
                } else {
                    this._panel.webview.postMessage({
                        type: 'snapshotLog',
                        text: `[WARN] Could not update ETMv4.c: ${etmUpdate.message}\n`
                    });
                }

                this._panel.webview.postMessage({ type: 'snapshotStarted' });

                const res = await this._snapshotGenerator.runSnapshotGeneration(params, (logText) => {
                    this._panel.webview.postMessage({
                        type: 'snapshotLog',
                        text: logText
                    });
                });

                this._panel.webview.postMessage({
                    type: 'snapshotFinished',
                    result: res
                });

                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showErrorMessage(res.message);
                }
                break;
            }

            case 'runDecoder': {
                const params: DecoderRunParams = message.params;
                if (!params.customBinaryPath) {
                    // Fall back to the workspace/user setting when the field is blank.
                    const configured = vscode.workspace
                        .getConfiguration('coresightTraceStudio')
                        .get<string>('decoderPath');
                    if (configured && configured.trim()) {
                        params.customBinaryPath = configured.trim();
                    }
                }
                this._panel.webview.postMessage({ type: 'decoderStarted' });

                const res = await this._traceDecoder.runDecoder(
                    params,
                    (line, lineType) => {
                        this._panel.webview.postMessage({
                            type: 'decoderLog',
                            text: line,
                            lineType: lineType || 'info'
                        });
                    },
                    (stats) => {
                        this._panel.webview.postMessage({
                            type: 'decoderStats',
                            stats
                        });
                    }
                );

                this._panel.webview.postMessage({
                    type: 'decoderFinished',
                    result: res
                });

                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showErrorMessage(res.message);
                }
                break;
            }

            case 'openFile': {
                if (message.filePath && fs.existsSync(message.filePath)) {
                    try {
                        const doc = await vscode.workspace.openTextDocument(message.filePath);
                        await vscode.window.showTextDocument(doc, { preview: false });
                    } catch (openErr: any) {
                        vscode.window.showErrorMessage(`Failed to open file: ${openErr.message}`);
                    }
                } else {
                    vscode.window.showErrorMessage(`File not found: ${message.filePath}`);
                }
                break;
            }

            case 'exportReport': {
                const params = message.params || {};
                const snapDir = params.snapshotPath && fs.existsSync(params.snapshotPath) && fs.statSync(params.snapshotPath).isFile()
                    ? path.dirname(params.snapshotPath)
                    : (params.snapshotPath || this._workspaceRoot);
                const snapshotName = path.basename(snapDir);
                const coreFreqMhz = params.coreFreqMhz || 1;
                const tsFreqMhz = params.tsFreqMhz || 1;

                // Locate target .ppl disassembly file
                let targetPpl: string | null = null;
                if (params.exportFileName && fs.existsSync(params.exportFileName)) {
                    targetPpl = params.exportFileName;
                } else if (params.exportFileName && fs.existsSync(path.join(this._workspaceRoot, params.exportFileName))) {
                    targetPpl = path.join(this._workspaceRoot, params.exportFileName);
                } else if (params.exportFileName && fs.existsSync(path.join(snapDir, params.exportFileName))) {
                    targetPpl = path.join(snapDir, params.exportFileName);
                }

                if (!targetPpl) {
                    // Search workspace and snapDir for latest decoded .ppl file
                    const candidateDirs = [this._workspaceRoot];
                    if (fs.existsSync(snapDir) && path.resolve(snapDir) !== path.resolve(this._workspaceRoot)) {
                        candidateDirs.push(snapDir);
                    }
                    const pplCandidates: { path: string; mtime: number }[] = [];
                    for (const dir of candidateDirs) {
                        try {
                            const files = fs.readdirSync(dir);
                            for (const f of files) {
                                if (f.endsWith('.ppl')) {
                                    const full = path.join(dir, f);
                                    const stat = fs.statSync(full);
                                    pplCandidates.push({ path: full, mtime: stat.mtimeMs });
                                }
                            }
                        } catch (e) {}
                    }
                    if (pplCandidates.length > 0) {
                        pplCandidates.sort((a, b) => b.mtime - a.mtime);
                        targetPpl = pplCandidates[0].path;
                    }
                }

                let htmlPath = '';
                let mdPath = '';
                let reportBaseName = `${snapshotName}_trace_report`;

                if (targetPpl && fs.existsSync(targetPpl)) {
                    vscode.window.showInformationMessage(`Generating trace report from ${path.basename(targetPpl)}...`);
                    const repResult = await ReportGenerator.generateReportFromPpl(
                        targetPpl,
                        snapDir,
                        this._workspaceRoot,
                        coreFreqMhz,
                        tsFreqMhz
                    );
                    htmlPath = repResult.htmlPath;
                    mdPath = repResult.mdPath;
                    reportBaseName = path.basename(htmlPath, '.html');
                } else {
                    // Fallback basic report if no .ppl found
                    mdPath = path.join(this._workspaceRoot, `${reportBaseName}.md`);
                    htmlPath = path.join(this._workspaceRoot, `${reportBaseName}.html`);
                    fs.writeFileSync(mdPath, `# Trace Report\n\nNo decoded .ppl file found in workspace. Run decoder first.`, 'utf8');
                    fs.writeFileSync(htmlPath, `<html><body><h3>No decoded .ppl file found</h3></body></html>`, 'utf8');
                }

                this._panel.webview.postMessage({
                    type: 'reportExported',
                    htmlPath,
                    mdPath,
                    reportBaseName
                });

                const choice = await vscode.window.showInformationMessage(
                    `Trace report generated: ${reportBaseName}.html & .md`,
                    'Open HTML in Browser',
                    'Open Markdown in VS Code'
                );

                if (choice === 'Open HTML in Browser' && fs.existsSync(htmlPath)) {
                    vscode.env.openExternal(vscode.Uri.file(htmlPath));
                } else if (choice === 'Open Markdown in VS Code' && fs.existsSync(mdPath)) {
                    const doc = await vscode.workspace.openTextDocument(mdPath);
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
                break;
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'CoreSight Trace Studio';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const mediaPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'media');
        const htmlPath = path.join(mediaPath, 'studio.html');
        const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, 'studio.css')));
        const jsUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, 'studio.js')));
        const logoUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, 'logo.png')));

        let html = '';
        if (fs.existsSync(htmlPath)) {
            html = fs.readFileSync(htmlPath, 'utf8');
            html = html.replace('{{styleUri}}', cssUri.toString());
            html = html.replace('{{scriptUri}}', jsUri.toString());
            html = html.replace('{{logoUri}}', logoUri.toString());
        } else {
            html = `<!DOCTYPE html><html><body><h3>Studio HTML loading...</h3></body></html>`;
        }

        return html;
    }

    public dispose() {
        CoreSightPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
