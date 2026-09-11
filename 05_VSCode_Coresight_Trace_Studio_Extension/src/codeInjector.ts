import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class CodeInjector {

    /**
     * Ensures #include "ETMv4.h" is present in the specified file.
     */
    public static async injectIncludes(filePath: string): Promise<{ success: boolean; message: string }> {
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
            } else {
                // Otherwise find the last #include or place near top
                const lastIncludeMatch = [...content.matchAll(/#include\s+["<][^">]+[">]/g)].pop();
                if (lastIncludeMatch && lastIncludeMatch.index !== undefined) {
                    const insertPos = lastIncludeMatch.index + lastIncludeMatch[0].length;
                    newContent = content.slice(0, insertPos) + '\n#include "ETMv4.h"' + content.slice(insertPos);
                } else {
                    newContent = '#include "ETMv4.h"\n' + content;
                }
            }

            fs.writeFileSync(filePath, newContent, 'utf8');
            return { success: true, message: `Successfully added #include "ETMv4.h" to ${path.basename(filePath)}` };
        } catch (error: any) {
            return { success: false, message: `Failed to inject include: ${error.message}` };
        }
    }

    /**
     * Injects Parallel_Trace_configure(); at a specific line or automatically inside main().
     */
    public static async injectConfigFunction(filePath: string, targetLine?: number): Promise<{ success: boolean; message: string }> {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, message: `File not found: ${filePath}` };
            }

            // Ensure include is there first
            await this.injectIncludes(filePath);

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
            } else {
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
                    } else {
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
        } catch (error: any) {
            return { success: false, message: `Failed to inject config: ${error.message}` };
        }
    }

    /**
     * Wraps the current editor selection with StartPoint(); and StopPoint();
     */
    public static async wrapSelectionWithStartStop(editor: vscode.TextEditor): Promise<{ success: boolean; message: string }> {
        try {
            const document = editor.document;
            const selection = editor.selection;

            if (selection.isEmpty) {
                return { success: false, message: 'Please select a code block to wrap with trace Start/Stop points.' };
            }

            // Ensure includes
            await this.injectIncludes(document.uri.fsPath);

            const startLine = selection.start.line;
            const endLine = selection.end.line;

            const firstLineText = document.lineAt(startLine).text;
            const indentMatch = firstLineText.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '  ';

            const startPointCode = `${indent}StartPoint(); /* Trace Window Start */\n`;
            const stopPointCode = `\n${indent}StopPoint();  /* Trace Window Stop */`;

            const startPos = new vscode.Position(startLine, 0);
            const endPos = document.lineAt(endLine).range.end;

            const success = await editor.edit(editBuilder => {
                editBuilder.insert(startPos, startPointCode);
                editBuilder.insert(endPos, stopPointCode);
            });

            if (success) {
                return { success: true, message: `Wrapped lines ${startLine + 1} to ${endLine + 1} with StartPoint() and StopPoint()` };
            } else {
                return { success: false, message: 'VS Code editor edit failed.' };
            }
        } catch (error: any) {
            return { success: false, message: `Failed to wrap selection: ${error.message}` };
        }
    }

    /**
     * Wraps a line range specified by line numbers in a file.
     */
    public static async wrapLinesWithStartStop(filePath: string, fromLine: number, toLine: number): Promise<{ success: boolean; message: string }> {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, message: `File not found: ${filePath}` };
            }

            await this.injectIncludes(filePath);

            const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
            const startIdx = Math.max(0, fromLine - 1);
            const endIdx = Math.min(lines.length - 1, toLine - 1);

            if (startIdx > endIdx) {
                return { success: false, message: 'Invalid line range: Start line must be <= End line.' };
            }

            const indentMatch = lines[startIdx].match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '  ';

            // Insert StopPoint after endIdx first so indices don't shift
            lines.splice(endIdx + 1, 0, `${indent}StopPoint();  /* Trace Window Stop */`);
            // Insert StartPoint before startIdx
            lines.splice(startIdx, 0, `${indent}StartPoint(); /* Trace Window Start */`);

            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            return {
                success: true,
                message: `Wrapped lines ${fromLine}..${toLine} with StartPoint() & StopPoint() in ${path.basename(filePath)}`
            };
        } catch (error: any) {
            return { success: false, message: `Failed to wrap lines: ${error.message}` };
        }
    }

    /**
     * Resolves driver file paths (ETMv4.c and ETMv4.h) within the workspace.
     */
    public static findDriverFiles(workspaceRoot: string): { cPath?: string; hPath?: string } {
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

        let cPath: string | undefined;
        for (const d of candidateCDirs) {
            const p = path.join(d, 'ETMv4.c');
            if (fs.existsSync(p)) {
                cPath = p;
                break;
            }
        }

        let hPath: string | undefined;
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
     * Reads current ETM configuration values directly from ETMv4.c and ETMv4.h.
     */
    public static readEtmConfig(workspaceRoot: string): {
        traceId?: number;
        cycleThreshold?: number;
        syncPeriodPower?: number;
        viewInstMode?: 'dwt_gated' | 'unconditional';
        enableCCI?: boolean;
        enableTS?: boolean;
    } | null {
        try {
            const { cPath, hPath } = this.findDriverFiles(workspaceRoot);
            if (!cPath || !fs.existsSync(cPath)) {
                return null;
            }

            const cContent = fs.readFileSync(cPath, 'utf8');

            let traceId: number | undefined;
            const traceIdMatch = cContent.match(/ETM\s*->\s*TRACEID\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*;/);
            if (traceIdMatch) {
                traceId = parseInt(traceIdMatch[1], traceIdMatch[1].startsWith('0x') ? 16 : 10);
            }

            let cycleThreshold: number | undefined;
            const ccctlMatch = cContent.match(/ETM\s*->\s*CCCTL\s*=\s*(\d+)\s*;/);
            if (ccctlMatch) {
                cycleThreshold = parseInt(ccctlMatch[1], 10);
            }

            let syncPeriodPower: number | undefined;
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

            let viewInstMode: 'dwt_gated' | 'unconditional' = 'dwt_gated';
            if (hPath && fs.existsSync(hPath)) {
                const hContent = fs.readFileSync(hPath, 'utf8');
                const bringupMatch = hContent.match(/#define\s+ETM_BRINGUP_TRACE_ALL\s+([01])/);
                if (bringupMatch && bringupMatch[1] === '1') {
                    viewInstMode = 'unconditional';
                }
            } else {
                if (cContent.includes('ETM->VICTL = 0x00000201;') && !cContent.includes('#if ETM_BRINGUP_TRACE_ALL')) {
                    viewInstMode = 'unconditional';
                }
            }

            return {
                traceId,
                cycleThreshold,
                syncPeriodPower,
                viewInstMode,
                enableCCI,
                enableTS
            };
        } catch {
            return null;
        }
    }

    /**
     * Updates the ETM struct fields inside ETM_Configure() in ETMv4.c (and ETMv4.h macro if present).
     */
    public static async updateEtmConfig(
        workspaceRoot: string,
        params: {
            traceId: number;
            cycleThreshold: number;
            syncPeriodPower: number;
            viewInstMode: 'dwt_gated' | 'unconditional';
            enableCCI: boolean;
            enableTS: boolean;
        }
    ): Promise<{ success: boolean; message: string }> {
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
            const configParts: string[] = [];
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
                body = body.replace(
                    /(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*CONFIG\s*=\s*[^;]+;/,
                    `    ${configComment}\n    ETM->CONFIG = ${configExpr};`
                );
            }

            // 2. Update ETM->CCCTL
            const ccctlVal = params.cycleThreshold || 64;
            if (/ETM\s*->\s*CCCTL\s*=\s*[^;]+;/.test(body)) {
                body = body.replace(
                    /(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*CCCTL\s*=\s*[^;]+;/,
                    `    // TRCCCCTLR: Cycle-count report threshold (${ccctlVal} cycles)\n    ETM->CCCTL = ${ccctlVal};`
                );
            }

            // 3. Update ETM->TRACEID
            const traceIdNum = params.traceId & 0x7F;
            const traceIdHex = traceIdNum.toString(16).toUpperCase().padStart(2, '0');
            if (/ETM\s*->\s*TRACEID\s*=\s*[^;]+;/.test(body)) {
                body = body.replace(
                    /(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*TRACEID\s*=\s*[^;]+;/,
                    `    // CoreSight Trace ID (ATB ID)\n    ETM->TRACEID = 0x${traceIdHex};`
                );
            }

            // 4. Update ETM->SYNCP (Read-only confirmation)
            if (/ETM\s*->\s*SYNCP\s*=\s*[^;]+;/.test(body)) {
                body = body.replace(
                    /(?:[ \t]*\/\/[^\r\n]*\r?\n)?[ \t]*ETM\s*->\s*SYNCP\s*=\s*[^;]+;/,
                    `    // Synchronization frequency (2^10 = 1024 bytes) - Read-only on STM32H7\n    ETM->SYNCP = 0x0000000A;`
                );
            }

            // 5. Update ViewInst mode
            const isUnconditional = params.viewInstMode === 'unconditional';
            if (body.includes('#if ETM_BRINGUP_TRACE_ALL')) {
                // Update macro in ETMv4.h if exists
                if (hPath && fs.existsSync(hPath)) {
                    let hContent = fs.readFileSync(hPath, 'utf8');
                    if (/#define\s+ETM_BRINGUP_TRACE_ALL\s+[01]/.test(hContent)) {
                        hContent = hContent.replace(
                            /#define\s+ETM_BRINGUP_TRACE_ALL\s+[01]/,
                            `#define ETM_BRINGUP_TRACE_ALL  ${isUnconditional ? '1' : '0'}`
                        );
                        fs.writeFileSync(hPath, hContent, 'utf8');
                    }
                }
            } else {
                // Directly update VIPCSSCTL and VICTL inside function
                const victlVal = isUnconditional ? '0x00000201' : '0x00000001';
                const vipcssctlVal = isUnconditional ? '0x00000000' : '(1U << (16 + 1)) | (1U << 0)';
                if (/ETM\s*->\s*VIPCSSCTL\s*=\s*[^;]+;/.test(body)) {
                    body = body.replace(/ETM\s*->\s*VIPCSSCTL\s*=\s*[^;]+;/, `ETM->VIPCSSCTL = ${vipcssctlVal};`);
                }
                if (/ETM\s*->\s*VICTL\s*=\s*[^;]+;/.test(body)) {
                    body = body.replace(/ETM\s*->\s*VICTL\s*=\s*[^;]+;/, `ETM->VICTL = ${victlVal};`);
                }
            }

            const newContent = cContent.replace(funcRegex, `${funcMatch[1]}${body}${funcMatch[3]}`);
            fs.writeFileSync(cPath, newContent, 'utf8');

            return {
                success: true,
                message: `Successfully updated ETM configuration in ${path.basename(cPath)} (TraceID=0x${traceIdHex}, CCCTL=${ccctlVal}, CCI=${params.enableCCI}, TS=${params.enableTS}, Mode=${params.viewInstMode}).`
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to update ETM configuration: ${error.message}`
            };
        }
    }
}

