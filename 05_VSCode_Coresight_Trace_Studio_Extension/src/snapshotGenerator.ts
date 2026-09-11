import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface TraceConfigParams {
    // Core parameters (device1.ini)
    coreName: string;
    coreType: string;
    initialPC: string; // e.g. "0x08000000"

    // ETM parameters (device2.ini)
    etmName: string;
    etmType: string;
    traceId: number; // ATB ID, e.g. 0x3E (62)
    cycleThreshold: number; // TRCCCCTLR, e.g. 64 (0x40)
    enableCCI: boolean; // Cycle Count Insertion (TRCCONFIGR bit 4)
    enableTS: boolean;  // Timestamp packets (TRCCONFIGR bit 11)
    syncPeriodPower: number; // TRCSYNCPR, e.g. 10 (0x0A -> 1024 bytes)
    viewInstMode: 'dwt_gated' | 'unconditional'; // Start/Stop gating vs all trace

    // File inputs
    captureFile: string;
    elfFile?: string;
    pythonPath?: string;
}

export class SnapshotGenerator {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Default read-only silicon ID registers and invariant CoreSight registers for ARM Cortex-M7 ETMv4
     */
    private static readonly FIXED_ETM_REGS: { [key: string]: { id: number; val: number } } = {
        "TRCSTALLCTLR":  { id: 0x00B, val: 0x00000000 },
        "TRCEVENTCTL0R": { id: 0x008, val: 0x00000000 },
        "TRCEVENTCTL1R": { id: 0x009, val: 0x00000000 },
        "TRCTSCTLR":     { id: 0x00C, val: 0x00000000 },
        "TRCVIIECTLR":   { id: 0x021, val: 0x00000000 },
        "TRCVISSCTLR":   { id: 0x022, val: 0x00000000 },
        "TRCIDR0":       { id: 0x078, val: 0x080006E1 },
        "TRCIDR1":       { id: 0x079, val: 0x4100F401 },
        "TRCIDR2":       { id: 0x07A, val: 0x00000004 },
        "TRCIDR3":       { id: 0x07B, val: 0x07090004 },
        "TRCIDR4":       { id: 0x07C, val: 0x00114000 },
        "TRCIDR5":       { id: 0x07D, val: 0x90C70002 },
        "TRCIDR8":       { id: 0x060, val: 0x00000001 },
        "TRCIDR9":       { id: 0x061, val: 0x00000000 },
        "TRCIDR10":      { id: 0x062, val: 0x00000000 },
        "TRCIDR11":      { id: 0x063, val: 0x00000000 },
        "TRCIDR12":      { id: 0x064, val: 0x00000001 },
        "TRCIDR13":      { id: 0x065, val: 0x00000000 },
        "TRCAUTHSTATUS": { id: 0x3EE, val: 0x000000C0 },
    };

    /**
     * Computes TRCCONFIGR from CCI, TS, and base bit0 flags.
     */
    private computeConfigRegister(enableCCI: boolean, enableTS: boolean): number {
        let val = 0x00000001; // bit0 unexplained base readback / RAO
        if (enableCCI) {
            val |= (1 << 4);
        }
        if (enableTS) {
            val |= (1 << 11);
        }
        return val;
    }

    /**
     * Runs TraceStreamProcessor.py and customizes device1.ini and device2.ini in the generated snapshot.
     */
    public runSnapshotGeneration(
        params: TraceConfigParams,
        onLog: (line: string) => void
    ): Promise<{ success: boolean; snapshotDir?: string; message: string }> {
        return new Promise((resolve) => {
            const pythonExe = params.pythonPath || 'python';
            const processorScript = path.join(this.workspaceRoot, 'TraceStreamProcessor.py');

            if (!fs.existsSync(processorScript)) {
                return resolve({
                    success: false,
                    message: `TraceStreamProcessor.py not found in workspace: ${processorScript}`
                });
            }

            if (!fs.existsSync(params.captureFile)) {
                return resolve({
                    success: false,
                    message: `Capture file does not exist: ${params.captureFile}`
                });
            }

            const args = [processorScript, params.captureFile];
            if (params.elfFile && fs.existsSync(params.elfFile)) {
                args.push(params.elfFile);
            }

            onLog(`[RUN] Executing: ${pythonExe} "${args.join('" "')}"\n`);

            const proc = spawn(pythonExe, args, { cwd: this.workspaceRoot });

            let stdoutAccum = '';
            let stderrAccum = '';

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                stdoutAccum += str;
                onLog(str);
            });

            proc.stderr.on('data', (data) => {
                const str = data.toString();
                stderrAccum += str;
                onLog(`[STDERR] ${str}`);
            });

            proc.on('close', (code) => {
                if (code !== 0) {
                    return resolve({
                        success: false,
                        message: `TraceStreamProcessor exited with error code ${code}: ${stderrAccum}`
                    });
                }

                // Determine snapshot directory
                const baseName = path.parse(params.captureFile).name;
                const captureDir = path.dirname(params.captureFile);
                const snapDir = path.join(captureDir, `${baseName}_snapshot`);

                if (!fs.existsSync(snapDir)) {
                    return resolve({
                        success: false,
                        message: `Expected snapshot directory was not created: ${snapDir}`
                    });
                }

                // Update device1.ini and device2.ini with user-configured parameters
                try {
                    this.applyCustomDeviceConfigs(snapDir, params, onLog);
                    return resolve({
                        success: true,
                        snapshotDir: snapDir,
                        message: `Successfully generated OpenCSD snapshot in: ${snapDir}`
                    });
                } catch (err: any) {
                    return resolve({
                        success: false,
                        message: `Snapshot generated, but failed to update device INI files: ${err.message}`
                    });
                }
            });

            proc.on('error', (err) => {
                return resolve({
                    success: false,
                    message: `Failed to spawn Python process (${pythonExe}): ${err.message}`
                });
            });
        });
    }

    /**
     * Applies the user parameters to device1.ini and device2.ini
     */
    private applyCustomDeviceConfigs(snapDir: string, params: TraceConfigParams, onLog: (msg: string) => void): void {
        const dev1Path = path.join(snapDir, 'device1.ini');
        const dev2Path = path.join(snapDir, 'device2.ini');

        // 1. Update device1.ini (Preserve memory dumps generated from ELF)
        const coreName = params.coreName || 'Cortex-M7_0';
        // OpenCSD 1.4.1 does not recognize "Cortex-M7" in its core architecture profile map.
        // Cortex-M7 is an ARMv7E-M architecture core and must be specified as "ARMv7-M" for OpenCSD.
        let coreType = params.coreType || 'ARMv7-M';
        if (coreType === 'Cortex-M7' || coreType.toLowerCase().includes('m7')) {
            coreType = 'ARMv7-M';
        }

        if (fs.existsSync(dev1Path)) {
            let dev1Content = fs.readFileSync(dev1Path, 'utf8');
            // Extract dumps if any
            const dumpRegex = /(\[dump\d+\][\s\S]*?)(?=\[dump\d+\]|$)/g;
            const dumps = dev1Content.match(dumpRegex) || [];

            let newDev1 = `[device]\nname=${coreName}\nclass=core\ntype=${coreType}\n\n`;
            newDev1 += `[regs]\nPC=${params.initialPC || '0x08000000'}\nxPSR=0x01000000\n`;
            if (dumps.length > 0) {
                newDev1 += '\n' + dumps.join('\n');
            }
            fs.writeFileSync(dev1Path, newDev1, 'utf8');
            onLog(`[CONFIG] Updated device1.ini with Core=${coreName}, Type=${coreType}, PC=${params.initialPC || '0x08000000'}\n`);
        }

        // 2. Build device2.ini with custom + fixed ETM registers
        if (params.syncPeriodPower !== 10) {
            onLog(`[WARN] TRCSYNCPR is Read-Only on STM32H7 / Cortex-M7 (silicon fixed to 10 / 1024 bytes). Reverting ${params.syncPeriodPower} -> 10.\n`);
            params.syncPeriodPower = 10;
        }

        const configRegVal = this.computeConfigRegister(params.enableCCI, params.enableTS);
        const traceIdVal = params.traceId & 0x7F;
        const ccctlVal = params.cycleThreshold;
        const syncpVal = 10; // TRCSYNCPR read-only fixed at 10

        const victlVal = params.viewInstMode === 'unconditional' ? 0x00000201 : 0x00000001;
        const vipcssctlVal = params.viewInstMode === 'unconditional' ? 0x00000000 : ((1 << (16 + 1)) | (1 << 0));

        const regs: { [key: string]: { id: number; val: number } } = {
            "TRCCONFIGR":    { id: 0x004, val: configRegVal },
            "TRCSYNCPR":     { id: 0x00D, val: syncpVal },
            "TRCTRACEIDR":   { id: 0x010, val: traceIdVal },
            "TRCCCCTLR":     { id: 0x00E, val: ccctlVal },
            "TRCVICTLR":     { id: 0x020, val: victlVal },
            "TRCVIPCSSCTLR": { id: 0x023, val: vipcssctlVal },
            ...SnapshotGenerator.FIXED_ETM_REGS
        };

        const etmName = params.etmName || 'CSETM_0';
        const etmType = params.etmType || 'ETM4.0';

        let newDev2 = `[device]\nname=${etmName}\nclass=trace_source\ntype=${etmType}\n\n[regs]\n`;
        for (const [name, info] of Object.entries(regs)) {
            newDev2 += `${name}(0x${info.id.toString(16).toUpperCase()})=0x${info.val.toString(16).padStart(8, '0').toUpperCase()}\n`;
        }

        fs.writeFileSync(dev2Path, newDev2, 'utf8');
        onLog(`[CONFIG] Updated device2.ini with Name=${etmName}, Type=${etmType}, TRCCONFIGR=0x${configRegVal.toString(16)}, TRCCCCTLR=${ccctlVal}, TRCTRACEIDR=0x${traceIdVal.toString(16)}\n`);

        // 3. Ensure trace.ini has consistent core and source bindings
        const tracePath = path.join(snapDir, 'trace.ini');
        if (fs.existsSync(tracePath)) {
            let traceContent = fs.readFileSync(tracePath, 'utf8');
            traceContent = traceContent.replace(/(\[core_trace_sources\]\s*\r?\n)[^\r\n=]+=[^\r\n]+/, `$1${coreName}=${etmName}`);
            traceContent = traceContent.replace(/(\[source_buffers\]\s*\r?\n)[^\r\n=]+=/, `$1${etmName}=`);
            fs.writeFileSync(tracePath, traceContent, 'utf8');
        }
    }
}
