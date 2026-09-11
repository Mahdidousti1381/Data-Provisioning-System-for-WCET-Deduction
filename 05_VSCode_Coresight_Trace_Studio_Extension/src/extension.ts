import * as vscode from 'vscode';
import { CoreSightPanel } from './webview/panel';
import { TemplateManager } from './templateManager';
import { CodeInjector } from './codeInjector';

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

    // 4. Wrap Selection with Start/Stop
    const wrapSelectionCmd = vscode.commands.registerCommand('coresight.wrapSelection', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('Please select the code block you wish to trace.');
            return;
        }

        const res = await CodeInjector.wrapSelectionWithStartStop(activeEditor);
        if (res.success) {
            vscode.window.showInformationMessage(res.message);
        } else {
            vscode.window.showErrorMessage(res.message);
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
        statusBarItem
    );
}

export function deactivate() {
    // Clean up resources if needed
}
