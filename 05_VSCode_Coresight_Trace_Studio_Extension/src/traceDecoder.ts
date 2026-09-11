import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface DecoderRunParams {
    snapshotPath: string; // Directory or snapshot.ini
    elfPath?: string;
    decoderType: 'trc_pkt_lister' | 'python_decoder' | 'wsl_trc_pkt_lister';
    customBinaryPath?: string;
    wslDistro?: string;
    pythonPath?: string;
    decodeInstructions: boolean;
    decodeOnly: boolean;
    stats: boolean;
    coreFreqMhz: number; // e.g. 480 MHz for STM32H7
}

export interface TraceSummaryStats {
    totalInstructions: number;
    totalCycles: number;
    totalAtoms: number;
    totalPackets: number;
    exceptionsCount: number;
    estimatedTimeUs: number;
}

export interface DecoderRunResult {
    success: boolean;
    message: string;
    exportFilePath?: string;
    exportFileName?: string;
    totalLines?: number;
    stats?: TraceSummaryStats;
    previewHeader?: string[];
    previewTail?: string[];
    executionTimeMs?: number;
}

export class TraceDecoder {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    public runDecoder(
        params: DecoderRunParams,
        onLog: (line: string, type?: 'raw' | 'elem' | 'info' | 'error') => void,
        onStatsUpdate: (stats: TraceSummaryStats) => void
    ): Promise<DecoderRunResult> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            let snapDir = params.snapshotPath;
            if (fs.existsSync(snapDir) && fs.statSync(snapDir).isFile()) {
                snapDir = path.dirname(snapDir);
            }

            if (!fs.existsSync(snapDir)) {
                return resolve({ success: false, message: `Snapshot folder not found: ${snapDir}` });
            }

            // Determine snapshot base name and sequential output file name
            const snapshotName = path.basename(snapDir);
            let nextIndex = 1;
            while (
                fs.existsSync(path.join(snapDir, `${snapshotName}_decoded_${nextIndex}.ppl`)) ||
                fs.existsSync(path.join(this.workspaceRoot, `${snapshotName}_decoded_${nextIndex}.ppl`))
            ) {
                nextIndex++;
            }

            const exportFileName = `${snapshotName}_decoded_${nextIndex}.ppl`;
            const exportFilePath = path.join(snapDir, exportFileName);
            let exportStream: fs.WriteStream | null = null;
            try {
                exportStream = fs.createWriteStream(exportFilePath, { flags: 'w', encoding: 'utf8' });
            } catch (err: any) {
                return resolve({ success: false, message: `Could not create export file: ${err.message}` });
            }

            const stats: TraceSummaryStats = {
                totalInstructions: 0,
                totalCycles: 0,
                totalAtoms: 0,
                totalPackets: 0,
                exceptionsCount: 0,
                estimatedTimeUs: 0
            };

            let command = '';
            let args: string[] = [];

            if (params.decoderType === 'python_decoder') {
                command = params.pythonPath || 'python';
                const decoderScript = path.join(this.workspaceRoot, 'TempDecoder_V0.2.py');
                const scriptToUse = fs.existsSync(decoderScript)
                    ? decoderScript
                    : path.join(this.workspaceRoot, 'TraceStreamProcessor.py');

                args = [scriptToUse, snapDir];
                if (params.elfPath) {
                    args.push(params.elfPath);
                }
            } else if (params.decoderType === 'wsl_trc_pkt_lister') {
                command = 'wsl';
                const tplBin = params.customBinaryPath || 'trc_pkt_lister';
                const wslSnapDir = snapDir.replace(/^([a-zA-Z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replace(/\\/g, '/');

                args = [];
                if (params.wslDistro) {
                    args.push('-d', params.wslDistro);
                }
                args.push(tplBin, '-ss_dir', wslSnapDir, '-logstdout');

                if (params.decodeOnly) {
                    args.push('-decode_only');
                } else if (params.decodeInstructions) {
                    args.push('-decode');
                }
                if (params.stats) {
                    args.push('-stats');
                }
            } else {
                command = params.customBinaryPath || 'trc_pkt_lister';
                args = ['-ss_dir', snapDir, '-logstdout'];
                if (params.decodeOnly) {
                    args.push('-decode_only');
                } else if (params.decodeInstructions) {
                    args.push('-decode');
                }
                if (params.stats) {
                    args.push('-stats');
                }
            }

            onLog(`[START] High-speed decoder started: ${command} ${args.join(' ')}\n`, 'info');
            onLog(`[EXPORT] Streaming full disassembly to: ${exportFileName}\n`, 'info');

            let proc: any;
            try {
                proc = spawn(command, args, { cwd: this.workspaceRoot });
            } catch (err: any) {
                exportStream.end();
                return resolve({ success: false, message: `Failed to spawn decoder: ${err.message}` });
            }

            let lineRemainder = '';
            let totalLines = 0;
            const previewHeader: string[] = [];
            const maxHeaderLines = 30;
            const previewTail: string[] = [];
            const maxTailLines = 40;
            let lastThrottledLogTime = Date.now();
            let stderrAccum = '';

            proc.stdout.on('data', (chunk: any) => {
                if (exportStream) {
                    exportStream.write(chunk);
                }

                const str = lineRemainder + chunk.toString('utf8');
                const lines = str.split(/\r?\n/);
                lineRemainder = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    totalLines++;

                    if (previewHeader.length < maxHeaderLines) {
                        previewHeader.push(line);
                    } else {
                        if (previewTail.length >= maxTailLines) {
                            previewTail.shift();
                        }
                        previewTail.push(line);
                    }

                    // Parse instruction execution ranges
                    const numIMatch = line.match(/num_i\((\d+)\)/);
                    if (numIMatch) {
                        stats.totalInstructions += parseInt(numIMatch[1], 10);
                    }

                    // Parse cycle counts strictly from canonical OCSD_GEN_TRC_ELEM_CYCLE_COUNT elements
                    // (prevents 2x double-counting with raw I_CCNT packets emitted concurrently in -decode mode)
                    if (line.includes('OCSD_GEN_TRC_ELEM_CYCLE_COUNT(')) {
                        const ccMatch = line.match(/\[CC=(\d+)\]/);
                        if (ccMatch) {
                            stats.totalCycles += parseInt(ccMatch[1], 10);
                        }
                    } else if (params.decodeOnly && line.includes('ID:0;') && line.includes('I_CCNT_')) {
                        const cntMatch = line.match(/Count=0x([0-9a-fA-F]+)/);
                        if (cntMatch) {
                            stats.totalCycles += parseInt(cntMatch[1], 16);
                        }
                    }

                    // Parse branch atoms
                    if (line.includes('I_ATOM_') || line.includes('ATOM_')) {
                        stats.totalAtoms++;
                    }

                    // Parse raw packet indices
                    if (line.startsWith('Idx:')) {
                        stats.totalPackets++;
                    }

                    // Parse exceptions
                    if (line.includes('EXCEPTION')) {
                        stats.exceptionsCount++;
                    }
                }

                // Periodic throttled status heartbeat (max once every 1200ms) without flooding IPC
                const now = Date.now();
                if (now - lastThrottledLogTime > 1200) {
                    lastThrottledLogTime = now;
                    onLog(`[PROGRESS] Decoded ${totalLines.toLocaleString()} lines (~${stats.totalInstructions.toLocaleString()} instructions, ${stats.totalCycles.toLocaleString()} cycles)...`, 'info');
                }
            });

            proc.stderr.on('data', (data: any) => {
                const str = data.toString();
                stderrAccum += str;
                onLog(`[STDERR] ${str}`, 'error');
            });

            proc.on('close', (code: number) => {
                if (lineRemainder.trim()) {
                    totalLines++;
                    if (previewTail.length >= maxTailLines) {
                        previewTail.shift();
                    }
                    previewTail.push(lineRemainder.trim());
                }

                if (exportStream) {
                    exportStream.end();
                }

                const executionTimeMs = Date.now() - startTime;

                // Calculate estimated WCET in microseconds
                if (params.coreFreqMhz > 0 && stats.totalCycles > 0) {
                    stats.estimatedTimeUs = parseFloat((stats.totalCycles / params.coreFreqMhz).toFixed(3));
                }

                // Copy to workspace root if snapshot directory is elsewhere
                try {
                    if (path.resolve(snapDir) !== path.resolve(this.workspaceRoot)) {
                        const workspaceCopyPath = path.join(this.workspaceRoot, exportFileName);
                        fs.copyFileSync(exportFilePath, workspaceCopyPath);
                    }
                } catch (copyErr) {
                    // non-critical
                }

                // Report all metrics at once to the webview
                onStatsUpdate(stats);

                if (code === 0) {
                    onLog(`\n[SUCCESS] High-speed decoding finished cleanly in ${(executionTimeMs / 1000).toFixed(2)}s.`, 'info');
                    onLog(`[OUTPUT] Total lines: ${totalLines.toLocaleString()} | Exported file: ${exportFileName}\n`, 'info');
                    resolve({
                        success: true,
                        message: `Decoding complete! Exported to ${exportFileName}`,
                        exportFilePath,
                        exportFileName,
                        totalLines,
                        stats,
                        previewHeader,
                        previewTail,
                        executionTimeMs
                    });
                } else {
                    onLog(`\n[EXIT] Decoder exited with code ${code}: ${stderrAccum}\n`, 'error');
                    resolve({
                        success: false,
                        message: `Decoder exited with code ${code}`,
                        exportFilePath,
                        exportFileName,
                        totalLines,
                        stats,
                        previewHeader,
                        previewTail,
                        executionTimeMs
                    });
                }
            });

            proc.on('error', (err: any) => {
                if (exportStream) {
                    exportStream.end();
                }
                onLog(`[PROCESS ERROR] ${err.message}`, 'error');
                resolve({
                    success: false,
                    message: `Error running decoder: ${err.message}`
                });
            });
        });
    }
}

