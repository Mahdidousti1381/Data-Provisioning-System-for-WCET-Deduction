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
exports.CodeInjector = exports.TRACE_WINDOW_MARKERS = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** The call pair injected for each window mode. */
exports.TRACE_WINDOW_MARKERS = {
    dwt_gated: {
        open: 'StartPoint();',
        close: 'StopPoint();',
        openNote: '/* Trace Window Start */',
        closeNote: '/* Trace Window Stop */',
        label: 'StartPoint() / StopPoint()'
    },
    trace_all: {
        open: 'Enable_ETM();',
        close: 'Disable_ETM();',
        openNote: '/* Trace ON  - unconditional ViewInst */',
        closeNote: '/* Trace OFF - unconditional ViewInst */',
        label: 'Enable_ETM() / Disable_ETM()'
    }
};
class CodeInjector {
    /**
     * Ensures #include "ETMv4.h" is present in the specified file.
     */
    static async injectIncludes(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, message: `File not found: ${filePath}` };
            }
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.includes('#include "ETMv4.h"') || content.includes('#include <ETMv4.h>')) {
                return { success: true, message: `#include "ETMv4.h" is already present in ${path.basename(filePath)}` };
            }
            let newContent = '';
            // Look for CubeMX / CubeIDE standard user section: /* USER CODE BEGIN Includes */
            const userIncludesMarker = '/* USER CODE BEGIN Includes */';
            const markerIndex = content.indexOf(userIncludesMarker);
            if (markerIndex !== -1) {
                const insertPos = markerIndex + userIncludesMarker.length;
                newContent = content.slice(0, insertPos) + '\n#include "ETMv4.h"' + content.slice(insertPos);
            }
            else {
                // Otherwise find the last #include or place near top
                const lastIncludeMatch = [...content.matchAll(/#include\s+["<][^">]+[">]/g)].pop();
                if (lastIncludeMatch && lastIncludeMatch.index !== undefined) {
                    const insertPos = lastIncludeMatch.index + lastIncludeMatch[0].length;
                    newContent = content.slice(0, insertPos) + '\n#include "ETMv4.h"' + content.slice(insertPos);
                }
                else {
                    newContent = '#include "ETMv4.h"\n' + content;
                }
            }
            fs.writeFileSync(filePath, newContent, 'utf8');
            return { success: true, message: `Successfully added #include "ETMv4.h" to ${path.basename(filePath)}` };
        }
        catch (error) {
            return { success: false, message: `Failed to inject include: ${error.message}` };
        }
    }
    /**
     * Injects Parallel_Trace_configure(); at a specific line or automatically inside main().
     */
    static async injectConfigFunction(filePath, targetLine) {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, message: `File not found: ${filePath}` };
            }
            // Ensure include is there first
            // The include is added AFTER the wrap, deliberately. injectIncludes()
            // inserts a line near the top of the file, so doing it first shifts
            // every line below it and the caller's line numbers - which they read
            // off the unmodified file - would land one statement early.
            const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
            // Check if already called
            if (lines.some(l => l.includes('Parallel_Trace_configure();'))) {
                return { success: true, message: `Parallel_Trace_configure() is already present in ${path.basename(filePath)}` };
            }
            let insertLine = -1;
            let indent = '  ';
            if (targetLine !== undefined && targetLine >= 1 && targetLine <= lines.length + 1) {
                insertLine = targetLine - 1;
                const referenceLine = lines[Math.min(insertLine, lines.length - 1)] || '';
                const match = referenceLine.match(/^(\s*)/);
                indent = match ? match[1] : '  ';
            }
            else {
                // Automatic discovery: Find main() and /* USER CODE BEGIN 2 */
                let insideMain = false;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].match(/\bint\s+main\s*\(/)) {
                        insideMain = true;
                    }
                    if (insideMain) {
                        if (lines[i].includes('/* USER CODE BEGIN 2 */')) {
                            insertLine = i + 1;
                            indent = '  ';
                            break;
                        }
                        if (lines[i].includes('while (1)') || lines[i].includes('while(1)')) {
                            insertLine = i;
                            indent = '  ';
                            break;
                        }
                    }
                }
                if (insertLine === -1) {
                    // Fallback to active editor line
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor && activeEditor.document.uri.fsPath === filePath) {
                        insertLine = activeEditor.selection.active.line;
                        const match = lines[insertLine].match(/^(\s*)/);
                        indent = match ? match[1] : '  ';
                    }
                    else {
                        insertLine = lines.length;
                    }
                }
            }
            const codeToInsert = `${indent}/* CoreSight ETMv4 Hardware Trace Initialization */\n${indent}Parallel_Trace_configure();\n`;
            lines.splice(insertLine, 0, codeToInsert);
            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            return {
                success: true,
                message: `Injected Parallel_Trace_configure() into ${path.basename(filePath)} at line ${insertLine + 1}`
            };
        }
        catch (error) {
            return { success: false, message: `Failed to inject config: ${error.message}` };
        }
    }
    /**
     * Where to insert #include "ETMv4.h" in an open document, or undefined if
     * it is already there. Mirrors injectIncludes(), but works on the editor's
     * buffer instead of the file on disk.
     */
    static findIncludeInsertPosition(document) {
        const text = document.getText();
        if (text.includes('#include "ETMv4.h"') || text.includes('#include <ETMv4.h>')) {
            return undefined;
        }
        const marker = '/* USER CODE BEGIN Includes */';
        const markerIdx = text.indexOf(marker);
        if (markerIdx !== -1) {
            const pos = document.positionAt(markerIdx + marker.length);
            return { position: pos, text: '\n#include "ETMv4.h"' };
        }
        const includes = [...text.matchAll(/#include\s+["<][^">]+[">]/g)];
        const last = includes.length > 0 ? includes[includes.length - 1] : undefined;
        if (last && last.index !== undefined) {
            const pos = document.positionAt(last.index + last[0].length);
            return { position: pos, text: '\n#include "ETMv4.h"' };
        }
        return { position: new vscode.Position(0, 0), text: '#include "ETMv4.h"\n' };
    }
    /**
     * Wraps the current editor selection with the window calls for `mode`.
     */
    static async wrapSelectionWithStartStop(editor, mode = 'dwt_gated') {
        try {
            const document = editor.document;
            const selection = editor.selection;
            if (selection.isEmpty) {
                return { success: false, message: 'Please select a code block to wrap with trace Start/Stop points.' };
            }
            const startLine = selection.start.line;
            const endLine = selection.end.line;
            const firstLineText = document.lineAt(startLine).text;
            const indentMatch = firstLineText.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '  ';
            const marker = exports.TRACE_WINDOW_MARKERS[mode];
            const startPointCode = `${indent}${marker.open} ${marker.openNote}\n`;
            const stopPointCode = `\n${indent}${marker.close} ${marker.closeNote}`;
            const startPos = new vscode.Position(startLine, 0);
            const endPos = document.lineAt(endLine).range.end;
            // The include goes in through the same edit rather than through a
            // separate fs write. Writing the file underneath an open editor
            // races with the editor's own buffer - if the document is dirty the
            // write is silently lost, and if it is clean the reload shifts every
            // position this edit is about to use. All inserts in one edit() are
            // applied against the original positions, so they stay consistent.
            const includeInsert = this.findIncludeInsertPosition(document);
            const success = await editor.edit(editBuilder => {
                if (includeInsert) {
                    editBuilder.insert(includeInsert.position, includeInsert.text);
                }
                editBuilder.insert(startPos, startPointCode);
                editBuilder.insert(endPos, stopPointCode);
            });
            if (success) {
                return {
                    success: true,
                    message: `Wrapped lines ${startLine + 1} to ${endLine + 1} with ${marker.label}`
                };
            }
            else {
                return { success: false, message: 'VS Code editor edit failed.' };
            }
        }
        catch (error) {
            return { success: false, message: `Failed to wrap selection: ${error.message}` };
        }
    }
    /**
     * Wraps a line range specified by line numbers in a file.
     */
    static async wrapLinesWithStartStop(filePath, fromLine, toLine, mode = 'dwt_gated') {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, message: `File not found: ${filePath}` };
            }
            // The include is added AFTER the wrap, deliberately. injectIncludes()
            // inserts a line near the top of the file, so doing it first shifts
            // every line below it and the caller's line numbers - which they read
            // off the unmodified file - would land one statement early.
            const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
            const startIdx = Math.max(0, fromLine - 1);
            const endIdx = Math.min(lines.length - 1, toLine - 1);
            if (startIdx > endIdx) {
                return { success: false, message: 'Invalid line range: Start line must be <= End line.' };
            }
            const indentMatch = lines[startIdx].match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '  ';
            const marker = exports.TRACE_WINDOW_MARKERS[mode];
            // Insert the closing call after endIdx first so indices don't shift
            lines.splice(endIdx + 1, 0, `${indent}${marker.close} ${marker.closeNote}`);
            lines.splice(startIdx, 0, `${indent}${marker.open} ${marker.openNote}`);
            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            await this.injectIncludes(filePath);
            return {
                success: true,
                message: `Wrapped lines ${fromLine}..${toLine} with ${marker.label} in ${path.basename(filePath)}`
            };
        }
        catch (error) {
            return { success: false, message: `Failed to wrap lines: ${error.message}` };
        }
    }
    /**
     * Resolves driver file paths (ETMv4.c and ETMv4.h) within the workspace.
     */
    static findDriverFiles(workspaceRoot) {
        const candidateCDirs = [
            path.join(workspaceRoot, 'Core', 'Src'),
            path.join(workspaceRoot, 'src'),
            workspaceRoot
        ];
        const candidateHDirs = [
            path.join(workspaceRoot, 'Core', 'Inc'),
            path.join(workspaceRoot, 'inc'),
            path.join(workspaceRoot, 'include'),
            workspaceRoot
        ];
        let cPath;
        for (const d of candidateCDirs) {
            const p = path.join(d, 'ETMv4.c');
            if (fs.existsSync(p)) {
                cPath = p;
                break;
            }
        }
        let hPath;
        for (const d of candidateHDirs) {
            const p = path.join(d, 'ETMv4.h');
            if (fs.existsSync(p)) {
                hPath = p;
                break;
            }
        }
        return { cPath, hPath };
    }
    /**
     * Rewrites the ViewInst registers inside an ETM_Configure() body.
     *
     * Two shapes are supported. If the driver still carries the
     * #if ETM_BRINGUP_TRACE_ALL switch, the macro in ETMv4.h is flipped and
     * the body is left alone. Otherwise TRCVIPCSSCTLR and TRCVICTLR are
     * rewritten directly.
     *
     *   unconditional : VIPCSSCTL = 0, VICTL = 0x201
     *                   ViewInst is always active, so the window is bounded by
     *                   Enable_ETM() / Disable_ETM().
     *   DWT gated     : VIPCSSCTL = comp0 start / comp1 stop, VICTL = 0x1
     *                   ViewInst opens on StartPoint() and closes on StopPoint().
     */
    static applyViewInstToBody(body, isUnconditional, hPath) {
        if (body.includes('#if ETM_BRINGUP_TRACE_ALL')) {
            if (hPath && fs.existsSync(hPath)) {
                let hContent = fs.readFileSync(hPath, 'utf8');
                if (/#define\s+ETM_BRINGUP_TRACE_ALL\s+[01]/.test(hContent)) {
                    hContent = hContent.replace(/#define\s+ETM_BRINGUP_TRACE_ALL\s+[01]/, `#define ETM_BRINGUP_TRACE_ALL  ${isUnconditional ? '1' : '0'}`);
                    fs.writeFileSync(hPath, hContent, 'utf8');
                }
            }
            return body;
        }
        const victlVal = isUnconditional ? '0x00000201' : '0x00000001';
        const vipcssctlVal = isUnconditional ? '0x00000000' : '(1U << (16 + 1)) | (1U << 0)';
        const note = isUnconditional
            ? '    // Unconditional: ViewInst always active; gate with Enable_ETM()/Disable_ETM()'
            : '    // DWT-gated: PE comparator 0 starts, comparator 1 stops';
        let out = body;
        if (/ETM\s*->\s*VIPCSSCTL\s*=\s*[^;]+;/.test(out)) {
            out = out.replace(/(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*VIPCSSCTL\s*=\s*[^;]+;/, `${note}\n    ETM->VIPCSSCTL = ${vipcssctlVal};`);
        }
        if (/ETM\s*->\s*VICTL\s*=\s*[^;]+;/.test(out)) {
            out = out.replace(/ETM\s*->\s*VICTL\s*=\s*[^;]+;/, `ETM->VICTL     = ${victlVal};`);
        }
        return out;
    }
    /**
     * Applies only the trace window mode to ETMv4.c, leaving every other
     * setting in the driver untouched.
     *
     * This is what the mode selector in Tab 1 calls, so choosing a mode and
     * choosing a Trace ID stay independent of each other.
     */
    static async setTraceWindowMode(workspaceRoot, mode) {
        try {
            const { cPath, hPath } = this.findDriverFiles(workspaceRoot);
            if (!cPath || !fs.existsSync(cPath)) {
                return {
                    success: false,
                    message: 'ETMv4.c was not found in the project. Add the driver files first.'
                };
            }
            const cContent = fs.readFileSync(cPath, 'utf8');
            const funcRegex = /(void\s+ETM_Configure\s*\([^)]*\)\s*\{)([\s\S]*?)(\n\})/m;
            const funcMatch = cContent.match(funcRegex);
            if (!funcMatch) {
                return {
                    success: false,
                    message: `Could not locate ETM_Configure() in ${path.basename(cPath)}.`
                };
            }
            const body = this.applyViewInstToBody(funcMatch[2], mode === 'trace_all', hPath);
            fs.writeFileSync(cPath, cContent.replace(funcRegex, `${funcMatch[1]}${body}${funcMatch[3]}`), 'utf8');
            const marker = exports.TRACE_WINDOW_MARKERS[mode];
            return {
                success: true,
                message: mode === 'trace_all'
                    ? `Trace window mode: Unconditional (Trace All). ETMv4.c now sets VIPCSSCTL = 0 and VICTL = 0x201; bound your window with ${marker.label}.`
                    : `Trace window mode: DWT Start/Stop Gated. ETMv4.c now sets VIPCSSCTL = comp0/comp1 and VICTL = 0x1; bound your window with ${marker.label}.`
            };
        }
        catch (error) {
            return { success: false, message: `Failed to set trace window mode: ${error.message}` };
        }
    }
    /**
     * Reads current ETM configuration values directly from ETMv4.c and ETMv4.h.
     */
    static readEtmConfig(workspaceRoot) {
        try {
            const { cPath, hPath } = this.findDriverFiles(workspaceRoot);
            if (!cPath || !fs.existsSync(cPath)) {
                return null;
            }
            const cContent = fs.readFileSync(cPath, 'utf8');
            let traceId;
            const traceIdMatch = cContent.match(/ETM\s*->\s*TRACEID\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*;/);
            if (traceIdMatch) {
                traceId = parseInt(traceIdMatch[1], traceIdMatch[1].startsWith('0x') ? 16 : 10);
            }
            let cycleThreshold;
            const ccctlMatch = cContent.match(/ETM\s*->\s*CCCTL\s*=\s*(\d+)\s*;/);
            if (ccctlMatch) {
                cycleThreshold = parseInt(ccctlMatch[1], 10);
            }
            let syncPeriodPower;
            const syncpMatch = cContent.match(/ETM\s*->\s*SYNCP\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*;/);
            if (syncpMatch) {
                syncPeriodPower = parseInt(syncpMatch[1], syncpMatch[1].startsWith('0x') ? 16 : 10);
            }
            let enableCCI = false;
            let enableTS = false;
            const configMatch = cContent.match(/ETM\s*->\s*CONFIG\s*=\s*([^;]+);/);
            if (configMatch) {
                const expr = configMatch[1];
                if (expr.includes('1U << 4') || expr.includes('1 << 4') || expr.includes('0x10') || expr.includes('0x810') || expr.includes('0x00000810')) {
                    enableCCI = true;
                }
                if (expr.includes('1U << 11') || expr.includes('1 << 11') || expr.includes('0x800') || expr.includes('0x810') || expr.includes('0x00000810')) {
                    enableTS = true;
                }
            }
            // Which source is authoritative depends on the driver's shape, not on
            // whether the header happens to exist: a driver that has had the
            // #if compiled out keeps a stale ETM_BRINGUP_TRACE_ALL in its header
            // that no longer controls anything.
            let viewInstMode = 'dwt_gated';
            if (cContent.includes('#if ETM_BRINGUP_TRACE_ALL')) {
                if (hPath && fs.existsSync(hPath)) {
                    const hContent = fs.readFileSync(hPath, 'utf8');
                    const bringupMatch = hContent.match(/#define\s+ETM_BRINGUP_TRACE_ALL\s+([01])/);
                    if (bringupMatch && bringupMatch[1] === '1') {
                        viewInstMode = 'unconditional';
                    }
                }
            }
            else if (/ETM\s*->\s*VICTL\s*=\s*0x0*201\s*;/i.test(cContent)) {
                // Whitespace-tolerant: the driver aligns these assignments, so an
                // exact string match misses "ETM->VICTL     = 0x00000201;".
                viewInstMode = 'unconditional';
            }
            return {
                traceId,
                cycleThreshold,
                syncPeriodPower,
                viewInstMode,
                enableCCI,
                enableTS
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Updates the ETM struct fields inside ETM_Configure() in ETMv4.c (and ETMv4.h macro if present).
     */
    static async updateEtmConfig(workspaceRoot, params) {
        try {
            // 1. Validate syncPeriodPower
            if (params.syncPeriodPower !== 10) {
                return {
                    success: false,
                    message: `Cannot change Sync Period: TRCSYNCPR is Read-Only on STM32H7 / Cortex-M7. Fixed in silicon to 10 (2^10 = 1024 bytes).`
                };
            }
            const { cPath, hPath } = this.findDriverFiles(workspaceRoot);
            if (!cPath || !fs.existsSync(cPath)) {
                return {
                    success: false,
                    message: `ETMv4.c was not found in the project. Please add driver files first in Tab 1.`
                };
            }
            let cContent = fs.readFileSync(cPath, 'utf8');
            // Find ETM_Configure function
            const funcRegex = /(void\s+ETM_Configure\s*\([^)]*\)\s*\{)([\s\S]*?)(\n\})/m;
            const funcMatch = cContent.match(funcRegex);
            if (!funcMatch) {
                return {
                    success: false,
                    message: `Could not locate ETM_Configure() function in ${path.basename(cPath)}.`
                };
            }
            let body = funcMatch[2];
            // 1. Update ETM->CONFIG
            const configParts = [];
            if (params.enableCCI) {
                configParts.push('(1U << 4)');
            }
            if (params.enableTS) {
                configParts.push('(1U << 11)');
            }
            const configExpr = configParts.length > 0 ? configParts.join(' | ') : '0x00000000';
            const configComment = params.enableCCI && params.enableTS
                ? '// Enable Cycle Count Insertion (CCI, bit 4) and Timestamps (TS, bit 11)'
                : (params.enableCCI ? '// Enable Cycle Count Insertion (CCI, bit 4)' : (params.enableTS ? '// Enable Timestamps (TS, bit 11)' : '// No CCI or TS'));
            if (/ETM\s*->\s*CONFIG\s*=\s*[^;]+;/.test(body)) {
                body = body.replace(/(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*CONFIG\s*=\s*[^;]+;/, `    ${configComment}\n    ETM->CONFIG = ${configExpr};`);
            }
            // 2. Update ETM->CCCTL
            const ccctlVal = params.cycleThreshold || 64;
            if (/ETM\s*->\s*CCCTL\s*=\s*[^;]+;/.test(body)) {
                body = body.replace(/(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*CCCTL\s*=\s*[^;]+;/, `    // TRCCCCTLR: Cycle-count report threshold (${ccctlVal} cycles)\n    ETM->CCCTL = ${ccctlVal};`);
            }
            // 3. Update ETM->TRACEID
            const traceIdNum = params.traceId & 0x7F;
            const traceIdHex = traceIdNum.toString(16).toUpperCase().padStart(2, '0');
            if (/ETM\s*->\s*TRACEID\s*=\s*[^;]+;/.test(body)) {
                body = body.replace(/(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*TRACEID\s*=\s*[^;]+;/, `    // CoreSight Trace ID (ATB ID)\n    ETM->TRACEID = 0x${traceIdHex};`);
            }
            // 4. Update ETM->SYNCP (Read-only confirmation)
            if (/ETM\s*->\s*SYNCP\s*=\s*[^;]+;/.test(body)) {
                body = body.replace(/(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*SYNCP\s*=\s*[^;]+;/, `    // Synchronization frequency (2^10 = 1024 bytes) - Read-only on STM32H7\n    ETM->SYNCP = 0x0000000A;`);
            }
            // 5. Update ViewInst mode
            const isUnconditional = params.viewInstMode === 'unconditional';
            body = this.applyViewInstToBody(body, isUnconditional, hPath);
            const newContent = cContent.replace(funcRegex, `${funcMatch[1]}${body}${funcMatch[3]}`);
            fs.writeFileSync(cPath, newContent, 'utf8');
            return {
                success: true,
                message: `Successfully updated ETM configuration in ${path.basename(cPath)} (TraceID=0x${traceIdHex}, CCCTL=${ccctlVal}, CCI=${params.enableCCI}, TS=${params.enableTS}, Mode=${params.viewInstMode}).`
            };
        }
        catch (error) {
            return {
                success: false,
                message: `Failed to update ETM configuration: ${error.message}`
            };
        }
    }
}
exports.CodeInjector = CodeInjector;
//# sourceMappingURL=codeInjector.js.map