"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const panel_1 = require("./webview/panel");
const templateManager_1 = require("./templateManager");
const codeInjector_1 = require("./codeInjector");
const traceMode_1 = require("./traceMode");
/** Wraps the active selection, reporting through the usual notifications. */
async function wrapActiveSelection(mode) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showWarningMessage('Please select the code block you wish to trace.');
        return;
    }
    if (activeEditor.selection.isEmpty) {
        vscode.window.showWarningMessage(`Select the code to bound with ${codeInjector_1.TRACE_WINDOW_MARKERS[mode].label} first.`);
        return;
    }
    const res = await codeInjector_1.CodeInjector.wrapSelectionWithStartStop(activeEditor, mode);
    if (res.success) {
        vscode.window.showInformationMessage(res.message);
    }
    else {
        vscode.window.showErrorMessage(res.message);
    }
}
function activate(context) {
    console.log('CoreSight Trace Studio extension is now active.');
    const templateManager = new templateManager_1.TemplateManager(context);
    // 1. Open Main Studio Dashboard
    const openStudioCmd = vscode.commands.registerCommand('coresight.openStudio', () => {
        panel_1.CoreSightPanel.createOrShow(context);
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
        }
        else {
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
        const res = await codeInjector_1.CodeInjector.injectConfigFunction(activeEditor.document.uri.fsPath);
        if (res.success) {
            vscode.window.showInformationMessage(res.message);
        }
        else {
            vscode.window.showErrorMessage(res.message);
        }
    });
    // 4. Wrap Selection - uses whichever mode is configured in Tab 1 / Settings
    const wrapSelectionCmd = vscode.commands.registerCommand('coresight.wrapSelection', async () => {
        await wrapActiveSelection((0, traceMode_1.getTraceMode)());
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
        const current = (0, traceMode_1.getTraceMode)();
        const picked = await vscode.window.showQuickPick([
            {
                label: 'DWT Start/Stop Gated',
                description: current === 'dwt_gated' ? '(current)' : '',
                detail: 'ViewInst gated by the DWT comparators. Bound windows with StartPoint() / StopPoint().',
                mode: 'dwt_gated'
            },
            {
                label: 'Unconditional (Trace All)',
                description: current === 'trace_all' ? '(current)' : '',
                detail: 'ViewInst always active. Bound windows with Enable_ETM() / Disable_ETM().',
                mode: 'trace_all'
            }
        ], { placeHolder: 'Trace window mode' });
        if (!picked) {
            return;
        }
        await (0, traceMode_1.setTraceMode)(picked.mode);
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const res = await codeInjector_1.CodeInjector.setTraceWindowMode(folders[0].uri.fsPath, picked.mode);
            if (res.success) {
                vscode.window.showInformationMessage(res.message);
            }
            else {
                vscode.window.showWarningMessage(`Mode set to ${picked.label}, but ETMv4.c was not updated: ${res.message}`);
            }
        }
        else {
            vscode.window.showInformationMessage(`Trace window mode set to ${picked.label}.`);
        }
    });
    // 5. Status Bar Item for Quick Access
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'coresight.openStudio';
    statusBarItem.text = '$(pulse) CoreSight Studio';
    statusBarItem.tooltip = 'Open ARM CoreSight & ETMv4 Trace Studio';
    statusBarItem.show();
    context.subscriptions.push(openStudioCmd, addDriversCmd, injectConfigCmd, wrapSelectionCmd, wrapStartStopCmd, wrapEnableDisableCmd, setTraceModeCmd, statusBarItem);
}
function deactivate() {
    // Clean up resources if needed
}
//# sourceMappingURL=extension.js.map