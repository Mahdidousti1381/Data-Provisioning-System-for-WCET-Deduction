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
exports.TraceDecoder = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const decoderLocator_1 = require("./decoderLocator");
class TraceDecoder {
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    runDecoder(params, onLog, onStatsUpdate) {
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
            while (fs.existsSync(path.join(snapDir, `${snapshotName}_decoded_${nextIndex}.ppl`)) ||
                fs.existsSync(path.join(this.workspaceRoot, `${snapshotName}_decoded_${nextIndex}.ppl`))) {
                nextIndex++;
            }
            const exportFileName = `${snapshotName}_decoded_${nextIndex}.ppl`;
            const exportFilePath = path.join(snapDir, exportFileName);
            let exportStream = null;
            try {
                exportStream = fs.createWriteStream(exportFilePath, { flags: 'w', encoding: 'utf8' });
            }
            catch (err) {
                return resolve({ success: false, message: `Could not create export file: ${err.message}` });
            }
            const stats = {
                totalInstructions: 0,
                totalCycles: 0,
                totalAtoms: 0,
                totalPackets: 0,
                exceptionsCount: 0,
                estimatedTimeUs: 0
            };
            let command = '';
            let args = [];
            let spawnEnv = process.env;
            if (params.decoderType === 'wsl_trc_pkt_lister') {
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
                }
                else if (params.decodeInstructions) {
                    args.push('-decode');
                }
                if (params.stats) {
                    args.push('-stats');
                }
            }
            else {
                // OpenCSD is built, not installed: resolve the executable and the
                // directories holding libopencsd.so rather than trusting PATH.
                const located = (0, decoderLocator_1.locateDecoder)({
                    explicitPath: params.customBinaryPath,
                    workspaceRoot: this.workspaceRoot
                });
                if (!located.found) {
                    exportStream.end();
                    try {
                        fs.unlinkSync(exportFilePath);
                    }
                    catch { /* best effort */ }
                    const msg = (0, decoderLocator_1.formatLocateFailure)(located, params.customBinaryPath);
                    onLog(msg, 'error');
                    return resolve({ success: false, message: `Decoder executable not found: ${located.binaryName}` });
                }
                command = located.command;
                spawnEnv = (0, decoderLocator_1.decoderEnv)(located.libDirs);
                onLog(`[DECODER] Using ${command}\n          resolved via ${located.source}`, 'info');
                if (located.libDirs.length > 0) {
                    onLog(`[DECODER] Library path: ${located.libDirs.join(path.delimiter)}`, 'info');
                }
                else {
                    onLog(`[DECODER] No libopencsd shared libraries found near the executable; if it aborts with "libopencsd.so.1: cannot open shared object file", set LD_LIBRARY_PATH to your OpenCSD decoder/lib directory.`, 'error');
                }
                args = ['-ss_dir', snapDir, '-logstdout'];
                if (params.decodeOnly) {
                    args.push('-decode_only');
                }
                else if (params.decodeInstructions) {
                    args.push('-decode');
                }
                if (params.stats) {
                    args.push('-stats');
                }
            }
            onLog(`[START] High-speed decoder started: ${command} ${args.join(' ')}\n`, 'info');
            onLog(`[EXPORT] Streaming full disassembly to: ${exportFileName}\n`, 'info');
            let proc;
            try {
                proc = (0, child_process_1.spawn)(command, args, { cwd: this.workspaceRoot, env: spawnEnv });
            }
            catch (err) {
                exportStream.end();
                return resolve({ success: false, message: `Failed to spawn decoder: ${err.message}` });
            }
            let lineRemainder = '';
            let totalLines = 0;
            const previewHeader = [];
            const maxHeaderLines = 30;
            const previewTail = [];
            const maxTailLines = 40;
            let lastThrottledLogTime = Date.now();
            let stderrAccum = '';
            proc.stdout.on('data', (chunk) => {
                if (exportStream) {
                    exportStream.write(chunk);
                }
                const str = lineRemainder + chunk.toString('utf8');
                const lines = str.split(/\r?\n/);
                lineRemainder = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    totalLines++;
                    if (previewHeader.length < maxHeaderLines) {
                        previewHeader.push(line);
                    }
                    else {
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
                    }
                    else if (params.decodeOnly && line.includes('ID:0;') && line.includes('I_CCNT_')) {
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
            proc.stderr.on('data', (data) => {
                const str = data.toString();
                stderrAccum += str;
                onLog(`[STDERR] ${str}`, 'error');
            });
            proc.on('close', (code) => {
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
                }
                catch (copyErr) {
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
                }
                else {
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
            proc.on('error', (err) => {
                if (exportStream) {
                    exportStream.end();
                }
                if (err && err.code === 'ENOENT') {
                    onLog(`[PROCESS ERROR] "${command}" could not be executed (ENOENT). `
                        + `The file is missing, is not executable, or its interpreter is absent.`, 'error');
                }
                else {
                    onLog(`[PROCESS ERROR] ${err.message}`, 'error');
                }
                resolve({
                    success: false,
                    message: `Error running decoder: ${err.message}`
                });
            });
        });
    }
}
exports.TraceDecoder = TraceDecoder;
//# sourceMappingURL=traceDecoder.js.map