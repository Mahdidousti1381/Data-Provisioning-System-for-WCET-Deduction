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
exports.getTraceMode = getTraceMode;
exports.setTraceMode = setTraceMode;
const vscode = __importStar(require("vscode"));
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
function getTraceMode() {
    const v = vscode.workspace.getConfiguration(SECTION).get(KEY, 'dwt_gated');
    return v === 'trace_all' ? 'trace_all' : 'dwt_gated';
}
async function setTraceMode(mode) {
    const hasWorkspace = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
    await vscode.workspace.getConfiguration(SECTION).update(KEY, mode, hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
}
//# sourceMappingURL=traceMode.js.map