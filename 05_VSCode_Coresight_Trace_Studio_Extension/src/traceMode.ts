import * as vscode from 'vscode';
import { TraceWindowMode } from './codeInjector';

/**
 * The trace window mode, shared by the Studio panel and the editor context
 * menu. It lives in workspace settings rather than in the panel so the
 * right-click actions work with the dashboard closed.
 *
 * Kept in its own module: extension.ts already imports the panel, so putting
 * these here avoids a circular require between the two.
 */
const SECTION = 'coresightTraceStudio';
const KEY = 'traceMode';

export function getTraceMode(): TraceWindowMode {
    const v = vscode.workspace.getConfiguration(SECTION).get<string>(KEY, 'dwt_gated');
    return v === 'trace_all' ? 'trace_all' : 'dwt_gated';
}

export async function setTraceMode(mode: TraceWindowMode): Promise<void> {
    const hasWorkspace = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
    await vscode.workspace.getConfiguration(SECTION).update(
        KEY,
        mode,
        hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    );
}
