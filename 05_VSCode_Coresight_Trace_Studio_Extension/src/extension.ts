import * as vscode from 'vscode';
import { CoreSightPanel } from './webview/panel';
import { TemplateManager } from './templateManager';
import { CodeInjector, TraceWindowMode, TRACE_WINDOW_MARKERS } from './codeInjector';
import { getTraceMode, setTraceMode } from './traceMode';

/** Wraps the active selection, reporting through the usual notifications. */
async function wrapActiveSelection(mode: TraceWindowMode) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showWarningMessage('Please select the code block you wish to trace.');
        return;
    }
    if (activeEditor.selection.isEmpty) {
        vscode.window.showWarningMessage(
            `Select the code to bound with ${TRACE_WINDOW_MARKERS[mode].label} first.`
        );
        return;
    }

    const res = await CodeInjector.wrapSelectionWithStartStop(activeEditor, mode);
    if (res.success) {
        vscode.window.showInformationMessage(res.message);
    } else {
        vscode.window.showErrorMessage(res.message);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('CoreSight Trace Studio extension is now active.');

    const templateManager = new TemplateManager(context);

    // 1. Open Main Studio Dashboard
    const openStudioCmd = vscode.commands.registerCommand('coresight.openStudio', () => {
        CoreSightPanel.createOrShow(context);
    });

    // 2. Add Driver Files Command
    const addDriversCmd = vscode.commands.registerCommand('coresight.addDriverFiles', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        const res = await templateManager.addDriverFiles(workspaceFolders[0].uri.fsPath);
        if (res.success) {
            vscode.window.showInformationMessage(res.message);
        } else {
            vscode.window.showErrorMessage(res.message);
        }
    });

    // 3. Inject Config Function
    const injectConfigCmd = vscode.commands.registerCommand('coresight.injectConfig', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('Please open a C source file first (e.g. main.c).');
            return;
        }

        const res = await CodeInjector.injectConfigFunction(activeEditor.document.uri.fsPath);
        if (res.success) {
            vscode.window.showInformationMessage(res.message);
        } else {
            vscode.window.showErrorMessage(res.message);
        }
    });

    // 4. Wrap Selection - uses whichever mode is configured in Tab 1 / Settings
    const wrapSelectionCmd = vscode.commands.registerCommand('coresight.wrapSelection', async () => {
        await wrapActiveSelection(getTraceMode());
    });

    // 4a/4b. Same, but forcing a mode - so the editor context menu can offer
    // both without the user having to go and change a setting first.
    const wrapStartStopCmd = vscode.commands.registerCommand('coresight.wrapSelectionStartStop', async () => {
        await wrapActiveSelection('dwt_gated');
    });

    const wrapEnableDisableCmd = vscode.commands.registerCommand('coresight.wrapSelectionEnableDisable', async () => {
        await wrapActiveSelection('trace_all');
    });

    // 4c. Pick the mode, and offer to write it into ETMv4.c straight away -
    // the two have to agree or the window will not behave as the code reads.
    const setTraceModeCmd = vscode.commands.registerCommand('coresight.setTraceMode', async () => {
        const current = getTraceMode();
        const picked = await vscode.window.showQuickPick(
            [
                {
                    label: 'DWT Start/Stop Gated',
                    description: current === 'dwt_gated' ? '(current)' : '',
                    detail: 'ViewInst gated by the DWT comparators. Bound windows with StartPoint() / StopPoint().',
                    mode: 'dwt_gated' as TraceWindowMode
                },
                {
                    label: 'Unconditional (Trace All)',
                    description: current === 'trace_all' ? '(current)' : '',
                    detail: 'ViewInst always active. Bound windows with Enable_ETM() / Disable_ETM().',
                    mode: 'trace_all' as TraceWindowMode
                }
            ],
            { placeHolder: 'Trace window mode' }
        );
        if (!picked) {
            return;
        }

        await setTraceMode(picked.mode);

        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const res = await CodeInjector.setTraceWindowMode(folders[0].uri.fsPath, picked.mode);
            if (res.success) {
                vscode.window.showInformationMessage(res.message);
            } else {
                vscode.window.showWarningMessage(
                    `Mode set to ${picked.label}, but ETMv4.c was not updated: ${res.message}`
                );
            }
        } else {
            vscode.window.showInformationMessage(`Trace window mode set to ${picked.label}.`);
        }
    });

    // 5. Status Bar Item for Quick Access
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'coresight.openStudio';
    statusBarItem.text = '$(pulse) CoreSight Studio';
    statusBarItem.tooltip = 'Open ARM CoreSight & ETMv4 Trace Studio';
    statusBarItem.show();

    context.subscriptions.push(
        openStudioCmd,
        addDriversCmd,
        injectConfigCmd,
        wrapSelectionCmd,
        wrapStartStopCmd,
        wrapEnableDisableCmd,
        setTraceModeCmd,
        statusBarItem
    );
}

export function deactivate() {
    // Clean up resources if needed
}
