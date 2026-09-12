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
exports.ReportGenerator = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
function getExceptionName(excepNumHex) {
    const num = parseInt(excepNumHex, 16);
    switch (num) {
        case 1: return 'Reset';
        case 2: return 'NMI';
        case 3: return 'HardFault';
        case 4: return 'MemManage';
        case 5: return 'BusFault';
        case 6: return 'UsageFault';
        case 11: return 'SVCall';
        case 12: return 'DebugMonitor';
        case 14: return 'PendSV';
        case 15: return 'SysTick';
        default:
            if (num >= 16) {
                return `IRQ_${num - 16}`;
            }
            return `Exception`;
    }
}
class ReportGenerator {
    static async generateReportFromPpl(pplFilePath, snapshotPath, workspaceRoot, coreFreqMhz = 1, tsFreqMhz = 1) {
        const snapDir = fs.existsSync(snapshotPath) && fs.statSync(snapshotPath).isFile()
            ? path.dirname(snapshotPath)
            : snapshotPath;
        const snapshotName = path.basename(snapDir);
        const pplFileName = path.basename(pplFilePath);
        if (!(coreFreqMhz > 0))
            coreFreqMhz = 1;
        if (!(tsFreqMhz > 0))
            tsFreqMhz = 1;
        let totalInstructions = 0;
        let totalCycles = 0;
        let totalAtoms = 0;
        let totalPackets = 0;
        let firstTs = null;
        let lastTs = null;
        let lastThreadTs = null;
        // Stream synchronisation accounting.
        let notSyncElementCount = 0;
        let lastNotSyncEndIdx = 0;
        let firstSyncByteIdx = null;
        let lastSyncByteIdx = null;
        let syncPacketCount = 0;
        let syncPeriodSum = 0;
        let syncPeriodCount = 0;
        // Exception accounting.
        let exceptionElementCount = 0;
        let exceptionRetElementCount = 0;
        let unmatchedRets = 0;
        let maxNestingDepth = 0;
        const allExceptions = [];
        /** Active handlers, innermost last. */
        const stack = [];
        /** Frames that have returned and are waiting for their exit TIMESTAMP. */
        let awaitingExitTs = [];
        const hotspotsMap = {};
        /** Per-vector entry timestamps, for inter-arrival. */
        const entryTsByVector = {};
        const ticksToUs = (ticks) => ticks / tsFreqMhz;
        /** Commit a returned frame once its exit TS is known (or known missing). */
        const finalize = (f) => {
            const durationTicks = (f.entryTs !== null && f.exitTs !== null)
                ? Number(f.exitTs - f.entryTs)
                : null;
            const isrDurationUs = durationTicks !== null ? ticksToUs(durationTicks) : null;
            const cycles = isrDurationUs !== null ? isrDurationUs * coreFreqMhz : null;
            const threadTimeBeforeUs = (f.preTs !== null && f.entryTs !== null)
                ? ticksToUs(Number(f.entryTs - f.preTs))
                : null;
            allExceptions.push({
                index: f.index,
                excepNum: f.excepNum,
                type: f.type,
                depth: f.depth,
                preTs: f.preTs,
                entryTs: f.entryTs,
                exitTs: f.exitTs,
                durationTicks,
                isrDurationUs,
                cycles,
                ccBlockCycles: f.ccBlockCycles,
                instructions: f.instructions,
                instructionsInclusive: f.instructionsInclusive,
                estEntryOverheadCycles: null, // filled once averageCpi is known
                threadTimeBeforeUs,
                tsComplete: f.entryTs !== null && f.exitTs !== null
            });
        };
        /** No timestamp arrived before the stream moved on - commit without one. */
        const flushAwaiting = () => {
            if (awaitingExitTs.length === 0)
                return;
            for (const f of awaitingExitTs)
                finalize(f);
            awaitingExitTs = [];
        };
        const rl = readline.createInterface({
            input: fs.createReadStream(pplFilePath),
            crlfDelay: Infinity
        });
        for await (const line of rl) {
            if (line.startsWith('Idx:'))
                totalPackets++;
            // ---- raw protocol packets (ID:0) -------------------------------
            if (line.includes('I_NOT_SYNC')) {
                notSyncElementCount++;
                const im = line.match(/^Idx:(\d+)/);
                const bytes = (line.match(/0x[0-9a-fA-F]{2}/g) || []).length;
                if (im)
                    lastNotSyncEndIdx = parseInt(im[1], 10) + bytes;
                continue;
            }
            if (line.includes('I_ASYNC')) {
                const im = line.match(/^Idx:(\d+)/);
                if (im) {
                    const idx = parseInt(im[1], 10);
                    if (firstSyncByteIdx === null)
                        firstSyncByteIdx = idx;
                    if (lastSyncByteIdx !== null) {
                        syncPeriodSum += idx - lastSyncByteIdx;
                        syncPeriodCount++;
                    }
                    lastSyncByteIdx = idx;
                }
                syncPacketCount++;
                continue;
            }
            if (line.includes('I_ATOM_')) {
                totalAtoms++;
                continue;
            }
            // ---- decoded generic elements (ID:3e) --------------------------
            // Order matters: EXCEPTION_RET is checked before EXCEPTION so that a
            // tail-chained pair on adjacent lines is handled in stream order.
            if (line.includes('OCSD_GEN_TRC_ELEM_TIMESTAMP(')) {
                const tsM = line.match(/TS=0x([0-9a-fA-F]+)/);
                if (!tsM)
                    continue;
                const ts = BigInt('0x' + tsM[1]);
                if (firstTs === null)
                    firstTs = ts;
                lastTs = ts;
                if (awaitingExitTs.length > 0) {
                    // Closest pending return claims this timestamp.
                    const f = awaitingExitTs.shift();
                    f.exitTs = ts;
                    finalize(f);
                    if (stack.length === 0)
                        lastThreadTs = ts;
                }
                else if (stack.length > 0) {
                    const top = stack[stack.length - 1];
                    if (top.entryTs === null) {
                        top.entryTs = ts;
                        (entryTsByVector[top.excepNum] ||= []).push(ts);
                    }
                }
                else {
                    lastThreadTs = ts;
                }
                continue;
            }
            if (line.includes('OCSD_GEN_TRC_ELEM_CYCLE_COUNT(')) {
                const ccM = line.match(/\[CC=(\d+)\]/);
                if (ccM) {
                    const cc = parseInt(ccM[1], 10);
                    totalCycles += cc;
                    // Diagnostic only - see ExceptionRecord.ccBlockCycles.
                    if (stack.length > 0)
                        stack[stack.length - 1].ccBlockCycles += cc;
                }
                continue;
            }
            if (line.includes('OCSD_GEN_TRC_ELEM_EXCEPTION_RET()')) {
                exceptionRetElementCount++;
                const f = stack.pop();
                if (!f) {
                    // Return with no matching entry: trace started mid-handler.
                    unmatchedRets++;
                    continue;
                }
                // No roll-up needed: every num_i already credited each frame on
                // the stack, so ancestors have this handler's instructions.
                awaitingExitTs.push(f);
                continue;
            }
            if (line.includes('OCSD_GEN_TRC_ELEM_EXCEPTION(')) {
                exceptionElementCount++;
                // A pending return that never got its timestamp ends here.
                flushAwaiting();
                const exMatch = line.match(/excep num \((0x[0-9a-fA-F]+)\)/);
                const exNum = exMatch ? exMatch[1].toLowerCase() : '0x00';
                const hexFormatted = '0x' + parseInt(exNum, 16).toString(16).toUpperCase().padStart(2, '0');
                const frame = {
                    index: exceptionElementCount,
                    excepNum: hexFormatted,
                    type: `${getExceptionName(exNum)} (${hexFormatted})`,
                    depth: stack.length,
                    preTs: stack.length === 0 ? lastThreadTs : null,
                    entryTs: null,
                    exitTs: null,
                    ccBlockCycles: 0,
                    instructions: 0,
                    instructionsInclusive: 0
                };
                stack.push(frame);
                if (stack.length > maxNestingDepth)
                    maxNestingDepth = stack.length;
                continue;
            }
            const numM = line.match(/num_i\((\d+)\)/);
            if (numM) {
                // Execution has resumed, so any pending return is settled.
                flushAwaiting();
                const n = parseInt(numM[1], 10);
                totalInstructions += n;
                if (stack.length > 0) {
                    stack[stack.length - 1].instructions += n;
                    for (const f of stack)
                        f.instructionsInclusive += n;
                }
                const rMatch = line.match(/exec range=(0x[0-9a-fA-F]+):\[(0x[0-9a-fA-F]+)\]/);
                if (rMatch) {
                    const addr = rMatch[1].toLowerCase();
                    hotspotsMap[addr] = (hotspotsMap[addr] || 0) + n;
                }
            }
        }
        // End of stream: settle anything still pending.
        flushAwaiting();
        const unclosedAtEof = stack.length;
        while (stack.length > 0)
            finalize(stack.pop());
        allExceptions.sort((a, b) => a.index - b.index);
        // ---- derived global figures ----------------------------------------
        const windowDurationTicks = (lastTs !== null && firstTs !== null) ? Number(lastTs - firstTs) : 0;
        const windowDurationUs = ticksToUs(windowDurationTicks);
        const windowDurationMs = parseFloat((windowDurationUs / 1000).toFixed(3));
        const averageCpi = totalInstructions > 0 ? parseFloat((totalCycles / totalInstructions).toFixed(2)) : 0;
        for (const e of allExceptions) {
            if (e.cycles !== null) {
                e.estEntryOverheadCycles = parseFloat((e.cycles - e.instructions * averageCpi).toFixed(1));
            }
        }
        const tsPerCycleRatio = totalCycles > 0 && windowDurationTicks > 0
            ? parseFloat((windowDurationTicks / totalCycles).toFixed(6))
            : null;
        // The trace itself fixes the ratio tsFreq/coreFreq. Check the supplied
        // pair against it - that is the only calibration the data can provide.
        const expectedRatio = tsFreqMhz / coreFreqMhz;
        const ratioError = tsPerCycleRatio !== null
            ? Math.abs(tsPerCycleRatio - expectedRatio) / expectedRatio
            : null;
        const clocksConsistent = ratioError !== null && ratioError <= 0.01;
        const impliedTsFreqMhz = tsPerCycleRatio !== null
            ? parseFloat((coreFreqMhz * tsPerCycleRatio).toFixed(4)) : null;
        let tsClockVerdict;
        if (tsPerCycleRatio === null) {
            tsClockVerdict = 'Not determinable: this trace carries no cycle-count or timestamp packets.';
        }
        else if (clocksConsistent) {
            tsClockVerdict = `Consistent. The trace gives ${tsPerCycleRatio} ticks per core cycle, matching the `
                + `${tsFreqMhz} MHz / ${coreFreqMhz} MHz pair you supplied (expected ${parseFloat(expectedRatio.toFixed(6))}). `
                + `1 tick = ${(1 / tsFreqMhz).toFixed(4)} µs.`
                + (Math.abs(tsPerCycleRatio - 1) <= 0.01
                    ? ' The TSG advances once per core cycle on this board, so timestamp resolution tracks the core clock.'
                    : '');
        }
        else {
            tsClockVerdict = `INCONSISTENT. The trace gives ${tsPerCycleRatio} ticks per core cycle, but the supplied `
                + `${tsFreqMhz} MHz TSG / ${coreFreqMhz} MHz core pair implies ${parseFloat(expectedRatio.toFixed(6))}. `
                + `Against a ${coreFreqMhz} MHz core the TSG is actually running at about ${impliedTsFreqMhz} MHz; `
                + `against a ${tsFreqMhz} MHz TSG the core is actually about ${parseFloat((tsFreqMhz / tsPerCycleRatio).toFixed(4))} MHz. `
                + `Every µs and cycle figure below is wrong until one of the two fields is corrected.`;
        }
        // ---- warnings / self-check ------------------------------------------
        const warnings = [];
        const recordsWithMissingTs = allExceptions.filter(e => !e.tsComplete).length;
        if (exceptionElementCount !== allExceptions.length) {
            warnings.push(`${exceptionElementCount} EXCEPTION elements were seen but ${allExceptions.length} records were produced - ${exceptionElementCount - allExceptions.length} were lost.`);
        }
        if (recordsWithMissingTs > 0) {
            warnings.push(`${recordsWithMissingTs} of ${allExceptions.length} exceptions are missing an entry or exit timestamp; their duration is reported as N/A and they are excluded from timing statistics.`);
        }
        if (unmatchedRets > 0) {
            warnings.push(`${unmatchedRets} EXCEPTION_RET elements had no matching EXCEPTION (the capture began inside a handler).`);
        }
        if (unclosedAtEof > 0) {
            warnings.push(`${unclosedAtEof} handlers were still active when the trace ended.`);
        }
        if (maxNestingDepth > 1) {
            warnings.push(`Nested / preempting interrupts detected (max depth ${maxNestingDepth}). "Instructions" is exclusive of nested handlers; "Instrs (incl.)" is inclusive.`);
        }
        if (tsPerCycleRatio !== null && !clocksConsistent) {
            warnings.push(`Clock calibration failed: the trace shows ${tsPerCycleRatio} timestamp ticks per core cycle, but Core = ${coreFreqMhz} MHz with TSG = ${tsFreqMhz} MHz implies ${parseFloat(expectedRatio.toFixed(6))} (off by ${(ratioError * 100).toFixed(1)}%). Correct the Core Clock or Timestamp Clock field - all µs and cycle figures are unreliable until you do.`);
        }
        if (firstSyncByteIdx !== null && firstSyncByteIdx > 0) {
            warnings.push(`${firstSyncByteIdx} bytes at the head of the capture were discarded before the first A-Sync packet. This is normal: the ETM only emits a sync pattern every TRCSYNCPR bytes, so a capture started at an arbitrary instant always loses up to one sync period. It does not mean the logic analyser missed data.`);
        }
        // ---- ISR aggregates --------------------------------------------------
        const timed = allExceptions.filter(e => e.cycles !== null);
        let totalIsrCycles = 0;
        let totalIsrDurationUs = 0;
        let totalIsrInstructions = 0;
        allExceptions.forEach(e => {
            if (e.cycles !== null)
                totalIsrCycles += e.cycles;
            if (e.isrDurationUs !== null)
                totalIsrDurationUs += e.isrDurationUs;
            totalIsrInstructions += e.instructions;
        });
        const avgIsrCycles = timed.length > 0 ? parseFloat((totalIsrCycles / timed.length).toFixed(1)) : 0;
        const avgIsrInstructions = allExceptions.length > 0
            ? parseFloat((totalIsrInstructions / allExceptions.length).toFixed(1)) : 0;
        const isrCyclePercentage = totalCycles > 0
            ? parseFloat(((totalIsrCycles / totalCycles) * 100).toFixed(2)) : 0;
        /** Mean of consecutive differences, in ticks. */
        const meanPeriodUs = (stamps) => {
            if (stamps.length < 2)
                return null;
            let sum = 0;
            for (let i = 1; i < stamps.length; i++)
                sum += Number(stamps[i] - stamps[i - 1]);
            return ticksToUs(sum / (stamps.length - 1));
        };
        const isrTypeMap = {};
        allExceptions.forEach(e => {
            const g = (isrTypeMap[e.type] ||= {
                typeName: e.type,
                excepNum: e.excepNum,
                count: 0,
                totalCycles: 0,
                totalInstructions: 0,
                totalDurationUs: 0,
                timedCount: 0,
                minDurationUs: null,
                maxDurationUs: null,
                maxCycles: null,
                maxInstructions: 0
            });
            g.count++;
            g.totalInstructions += e.instructions;
            if (e.instructions > g.maxInstructions)
                g.maxInstructions = e.instructions;
            if (e.isrDurationUs !== null && e.cycles !== null) {
                g.timedCount++;
                g.totalCycles += e.cycles;
                g.totalDurationUs += e.isrDurationUs;
                if (g.minDurationUs === null || e.isrDurationUs < g.minDurationUs)
                    g.minDurationUs = e.isrDurationUs;
                if (g.maxDurationUs === null || e.isrDurationUs > g.maxDurationUs)
                    g.maxDurationUs = e.isrDurationUs;
                if (g.maxCycles === null || e.cycles > g.maxCycles)
                    g.maxCycles = e.cycles;
            }
        });
        const r1 = (v) => parseFloat(v.toFixed(1));
        const r3 = (v) => parseFloat(v.toFixed(3));
        const isrBreakdown = Object.values(isrTypeMap)
            .map(g => ({
            typeName: g.typeName,
            excepNum: g.excepNum,
            count: g.count,
            totalCycles: r1(g.totalCycles),
            totalInstructions: g.totalInstructions,
            totalDurationUs: r3(g.totalDurationUs),
            avgCycles: g.timedCount > 0 ? r1(g.totalCycles / g.timedCount) : 0,
            avgInstructions: g.count > 0 ? r1(g.totalInstructions / g.count) : 0,
            avgDurationUs: g.timedCount > 0 ? r3(g.totalDurationUs / g.timedCount) : 0,
            minDurationUs: g.minDurationUs !== null ? r3(g.minDurationUs) : null,
            maxDurationUs: g.maxDurationUs !== null ? r3(g.maxDurationUs) : null,
            maxCycles: g.maxCycles !== null ? r1(g.maxCycles) : null,
            maxInstructions: g.maxInstructions,
            interArrivalUs: (() => {
                const p = meanPeriodUs(entryTsByVector[g.excepNum] || []);
                return p !== null ? r3(p) : null;
            })(),
            cpuPercentage: totalCycles > 0 ? parseFloat(((g.totalCycles / totalCycles) * 100).toFixed(2)) : 0
        }))
            .sort((a, b) => b.totalCycles - a.totalCycles);
        // Headline period: that of the most frequently occurring vector.
        const dominant = [...isrBreakdown].sort((a, b) => b.count - a.count)[0];
        const interArrivalPeriodUs = dominant ? dominant.interArrivalUs : null;
        const sortedHotspots = Object.entries(hotspotsMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([address, count]) => ({
            address,
            count,
            percentage: totalInstructions > 0 ? parseFloat(((count / totalInstructions) * 100).toFixed(2)) : 0
        }));
        const sampleExceptions = [];
        if (allExceptions.length <= 15) {
            sampleExceptions.push(...allExceptions);
        }
        else {
            sampleExceptions.push(...allExceptions.slice(0, 6));
            const mid = Math.floor(allExceptions.length / 2);
            sampleExceptions.push(allExceptions[mid], allExceptions[mid + 1]);
            sampleExceptions.push(...allExceptions.slice(-4));
        }
        const reportData = {
            snapshotName,
            pplFileName,
            generatedAt: new Date().toLocaleString(),
            coreFreqMhz,
            tsFreqMhz,
            tsPerCycleRatio,
            tsClockVerdict,
            firstTsHex: firstTs !== null ? '0x' + firstTs.toString(16).toUpperCase() : null,
            lastTsHex: lastTs !== null ? '0x' + lastTs.toString(16).toUpperCase() : null,
            windowDurationTicks,
            windowDurationUs: r3(windowDurationUs),
            windowDurationMs,
            totalInstructions,
            totalCycles,
            averageCpi,
            totalAtoms,
            totalPackets,
            notSyncElementCount,
            syncBytesDiscarded: firstSyncByteIdx !== null ? firstSyncByteIdx : lastNotSyncEndIdx,
            firstSyncByteIdx,
            syncPacketCount,
            avgSyncPeriodBytes: syncPeriodCount > 0 ? Math.round(syncPeriodSum / syncPeriodCount) : null,
            exceptionElementCount,
            exceptionRetElementCount,
            exceptionsCount: allExceptions.length,
            recordsWithMissingTs,
            unmatchedRets,
            unclosedAtEof,
            maxNestingDepth,
            totalIsrCycles: r1(totalIsrCycles),
            avgIsrCycles,
            totalIsrDurationUs: r3(totalIsrDurationUs),
            totalIsrInstructions,
            avgIsrInstructions,
            isrCyclePercentage,
            interArrivalPeriodUs,
            isrBreakdown,
            sampleExceptions,
            allExceptions,
            hotspots: sortedHotspots,
            warnings
        };
        const baseName = `${snapshotName}_trace_report`;
        const mdPath = path.join(workspaceRoot, `${baseName}.md`);
        const htmlPath = path.join(workspaceRoot, `${baseName}.html`);
        fs.writeFileSync(mdPath, this.renderMarkdownReport(reportData), 'utf8');
        fs.writeFileSync(htmlPath, this.renderHtmlReport(reportData), 'utf8');
        try {
            if (path.resolve(snapDir) !== path.resolve(workspaceRoot)) {
                fs.copyFileSync(mdPath, path.join(snapDir, `${baseName}.md`));
                fs.copyFileSync(htmlPath, path.join(snapDir, `${baseName}.html`));
            }
        }
        catch (e) { }
        return { mdPath, htmlPath, data: reportData };
    }
    // ---- formatting helpers -------------------------------------------------
    static us(v, digits = 3) {
        return v === null ? 'N/A' : `${v.toFixed(digits)} µs`;
    }
    static cyc(v) {
        return v === null ? 'N/A' : Math.round(v).toLocaleString();
    }
    static hex(v) {
        return v !== null ? '0x' + v.toString(16).toUpperCase() : 'N/A';
    }
    static renderMarkdownReport(d) {
        let md = `# Trace Execution & Hardware Timing Report\n\n`;
        md += `**Snapshot:** \`${d.snapshotName}\`  \n`;
        md += `**Disassembly Source:** \`${d.pplFileName}\`  \n`;
        md += `**Generated:** ${d.generatedAt}  \n\n`;
        md += `---\n\n`;
        md += `## 1. Clock Configuration & Calibration\n\n`;
        md += `All µs figures below are derived from the **supplied** clock values - the trace stream does not encode them.\n\n`;
        md += `| Parameter | Value | Notes |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **Core Clock** | **${d.coreFreqMhz} MHz** | Used to convert elapsed time to core cycles |\n`;
        md += `| **Timestamp Clock (TSG)** | **${d.tsFreqMhz} MHz** | 1 tick = ${(1 / d.tsFreqMhz).toFixed(4)} µs |\n`;
        md += `| **Measured ticks / cycle** | **${d.tsPerCycleRatio !== null ? d.tsPerCycleRatio : 'N/A'}** | &Delta;TS over the window &divide; total CYCLE_COUNT cycles |\n\n`;
        md += `> ${d.tsClockVerdict}\n\n`;
        if (d.warnings.length > 0) {
            md += `### Decoder Warnings\n\n`;
            d.warnings.forEach(w => { md += `- ${w}\n`; });
            md += `\n`;
        }
        md += `---\n\n`;
        md += `## 2. Stream Synchronisation\n\n`;
        md += `| Parameter | Value | Notes |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **Bytes discarded before first sync** | **${d.syncBytesDiscarded.toLocaleString()}** | Unsynchronised head of the capture |\n`;
        md += `| **\`I_NOT_SYNC\` elements** | ${d.notSyncElementCount.toLocaleString()} | Decoder reports of pre-sync bytes |\n`;
        md += `| **First \`I_ASYNC\` at byte** | ${d.firstSyncByteIdx !== null ? d.firstSyncByteIdx.toLocaleString() : 'N/A'} | Point where decoding actually begins |\n`;
        md += `| **A-Sync packets in capture** | ${d.syncPacketCount.toLocaleString()} | One per \`TRCSYNCPR\` period |\n`;
        md += `| **Mean sync period** | ${d.avgSyncPeriodBytes !== null ? d.avgSyncPeriodBytes.toLocaleString() + ' bytes' : 'N/A'} | Matches \`2^TRCSYNCPR\` |\n\n`;
        md += `*The head of every capture is unsynchronised. The ETM emits its alignment-sync pattern only once per sync period, so a capture started at an arbitrary instant must wait up to a full period before the decoder can lock on. Those bytes are valid trace data that cannot be interpreted without a preceding sync point - they are not data the logic analyser failed to record. Lower \`TRCSYNCPR\` to shorten this head, at the cost of trace-port bandwidth.*\n\n`;
        md += `---\n\n`;
        md += `## 3. Hardware Timestamps & Active Window Duration\n\n`;
        md += `| Parameter | Hardware Value | Notes |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **First Timestamp (post-sync)** | \`${d.firstTsHex}\` | First TS after the decoder synchronised |\n`;
        md += `| **Last Timestamp (Trace End)** | \`${d.lastTsHex}\` | End of captured trace window |\n`;
        md += `| **Trace Window (&Delta;TS)** | **${d.windowDurationTicks.toLocaleString()} ticks** | Raw TSG ticks |\n`;
        md += `| **Trace Window Duration** | **${d.windowDurationUs.toLocaleString()} µs (${d.windowDurationMs} ms)** | @ ${d.tsFreqMhz} MHz TSG |\n`;
        md += `| **Total Core Clock Cycles** | **${d.totalCycles.toLocaleString()}** | Accumulated CCI cycle packets |\n`;
        md += `| **Total Instructions Executed** | **${d.totalInstructions.toLocaleString()}** | Real executed instructions decoded |\n`;
        md += `| **Average CPI** | **${d.averageCpi}** | Clock cycles per instruction ratio |\n`;
        md += `| **Branch Decisions (\`I_ATOM\`)** | **${d.totalAtoms.toLocaleString()}** | Branch outcome atoms (E/N) |\n`;
        md += `| **Total Trace Packets** | **${d.totalPackets.toLocaleString()}** | Lines parsed from capture |\n\n`;
        md += `---\n\n`;
        md += `## 4. Exception & IRQ Service Routine Analysis\n\n`;
        md += `ISR duration is measured from the **entry timestamp** (first \`TIMESTAMP\` inside the handler, which the ETM emits in response to the exception) to the **exit timestamp** (first \`TIMESTAMP\` after \`EXCEPTION_RET\`). This span includes the exception entry latency but excludes the unstacking that follows the return, so it is a **lower bound** on the interference seen by the preempted thread.\n\n`;
        md += `| Metric | Value | Description |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **\`EXCEPTION\` elements seen** | **${d.exceptionElementCount}** | Raw decoder elements |\n`;
        md += `| **\`EXCEPTION_RET\` elements seen** | **${d.exceptionRetElementCount}** | Raw decoder elements |\n`;
        md += `| **Records produced** | **${d.exceptionsCount}** | ${d.exceptionsCount === d.exceptionElementCount ? 'All exceptions accounted for' : '**MISMATCH - see warnings**'} |\n`;
        md += `| **Records missing a timestamp** | **${d.recordsWithMissingTs}** | Excluded from timing statistics |\n`;
        md += `| **Max nesting depth** | **${d.maxNestingDepth}** | ${d.maxNestingDepth > 1 ? 'Preemption occurred' : 'No preemption'} |\n`;
        md += `| **IRQ Inter-Arrival Interval** | **${this.us(d.interArrivalPeriodUs)}** | Entry-to-entry, dominant vector |\n`;
        md += `| **Total CPU Time in All ISRs** | **${this.us(d.totalIsrDurationUs)} / ${this.cyc(d.totalIsrCycles)} cycles (${d.isrCyclePercentage}%)** | Cumulative interrupt overhead |\n`;
        md += `| **Main Thread Execution** | **${this.cyc(d.totalCycles - d.totalIsrCycles)} cycles (${(100 - d.isrCyclePercentage).toFixed(2)}%)** | Application main loop |\n`;
        md += `| **Average Cost per ISR** | **${d.avgIsrCycles} cycles (${(d.avgIsrCycles / d.coreFreqMhz).toFixed(3)} µs @ ${d.coreFreqMhz} MHz)** | Mean per invocation |\n`;
        md += `| **Instructions Executed per ISR** | **${d.avgIsrInstructions} instrs** | Excludes nested handlers |\n\n`;
        md += `### CPU Execution Split by ISR Type\n\n`;
        md += `| Exception / ISR Type | Vector | Count | Period | Mean Dur | **Max Dur (WCET obs.)** | Max Cycles | Mean Instrs | Max Instrs | CPU % |\n`;
        md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
        d.isrBreakdown.forEach(b => {
            md += `| **${b.typeName}** | \`${b.excepNum.toUpperCase()}\` | ${b.count.toLocaleString()} | ${this.us(b.interArrivalUs)} | ${this.us(b.avgDurationUs)} | **${this.us(b.maxDurationUs)}** | ${this.cyc(b.maxCycles)} | ${b.avgInstructions} | ${b.maxInstructions} | **${b.cpuPercentage}%** |\n`;
        });
        md += `\n*Max duration is the largest observed value, i.e. a high-water mark, not a proven worst case.*\n\n`;
        md += `### Timestamps Before and After IRQ Service Routines\n\n`;
        md += `| # | Type | D | Pre-IRQ TS | Entry TS | Exit TS | &Delta;TS (ticks) | Duration | Cycles | Instrs | Est. Entry Ovh |\n`;
        md += `| :-: | :--- | :-: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |\n`;
        d.sampleExceptions.forEach(e => {
            const flag = e.tsComplete ? '' : ' ⚠';
            md += `| ${e.index}${flag} | ${e.type} | ${e.depth} | \`${this.hex(e.preTs)}\` | \`${this.hex(e.entryTs)}\` | \`${this.hex(e.exitTs)}\` | ${e.durationTicks !== null ? e.durationTicks : 'N/A'} | **${this.us(e.isrDurationUs)}** | ${this.cyc(e.cycles)} | ${e.instructions}${e.instructionsInclusive !== e.instructions ? ` (${e.instructionsInclusive})` : ''} | ${e.estEntryOverheadCycles !== null ? e.estEntryOverheadCycles : 'N/A'} |\n`;
        });
        md += `\n*Representative sample (start, middle, end). Total occurrences: ${d.exceptionsCount}. "D" is nesting depth; a bracketed instruction count is the inclusive figure. "Est. Entry Ovh" is \`cycles − instructions × CPI\`, an estimate of exception entry latency.*\n\n`;
        md += `---\n\n`;
        md += `## 5. Execution Hotspots (Address Distribution)\n\n`;
        md += `| Rank | Address Range | Instructions Executed | % Share |\n`;
        md += `| :-: | :--- | :---: | :---: |\n`;
        d.hotspots.forEach((h, idx) => {
            md += `| ${idx + 1} | \`${h.address}\` | ${h.count.toLocaleString()} | ${h.percentage}% |\n`;
        });
        md += `\n*Instructions are attributed to the start address of each decoded \`exec range\`, not to individual addresses.*\n`;
        return md;
    }
    static renderHtmlReport(d) {
        const warningsBlock = d.warnings.length === 0 ? '' : `
        <div class="card" style="border-color: rgba(240,136,62,0.5);">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--orange);">Decoder Warnings</h2>
            <ul style="margin-left: 18px; font-size: 13px;">
                ${d.warnings.map(w => `<li style="margin-bottom: 6px;">${w}</li>`).join('')}
            </ul>
        </div>`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trace Report - ${d.snapshotName}</title>
    <style>
        :root {
            --bg: #0d1117;
            --card: #161b22;
            --border: #30363d;
            --text: #c9d1d9;
            --heading: #f0f6fc;
            --muted: #8b949e;
            --blue: #58a6ff;
            --green: #3fb950;
            --purple: #bc8cff;
            --orange: #f0883e;
            --red: #f85149;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            background: var(--bg);
            color: var(--text);
            line-height: 1.5;
            padding: 30px 20px;
        }
        .container { max-width: 1180px; margin: 0 auto; }
        .header {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 22px 26px;
            margin-bottom: 20px;
        }
        h1 { color: var(--heading); font-size: 22px; margin-bottom: 6px; }
        .meta { color: var(--muted); font-size: 13px; display: flex; gap: 20px; flex-wrap: wrap; margin-top: 8px; }
        .badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            background: rgba(88, 166, 255, 0.15);
            color: var(--blue);
            border: 1px solid rgba(88, 166, 255, 0.3);
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        }
        .card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .metric-title {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--muted);
            margin-bottom: 8px;
        }
        .metric-val {
            font-size: 24px;
            font-weight: 700;
            color: var(--heading);
            font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .metric-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin: 10px 0;
        }
        th, td {
            padding: 9px 12px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        th { color: var(--muted); font-weight: 600; background: rgba(0,0,0,0.25); }
        code {
            font-family: ui-monospace, SFMono-Regular, monospace;
            background: rgba(110,118,129,0.2);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            color: #79c0ff;
        }
        .progress-bar {
            height: 12px;
            background: #21262d;
            border-radius: 6px;
            overflow: hidden;
            display: flex;
            margin: 10px 0;
        }
        .bar-isr { background: var(--red); height: 100%; }
        .bar-main { background: var(--green); height: 100%; }
        .note { font-size: 12px; color: var(--muted); margin-top: 10px; }
        .verdict {
            font-size: 13px;
            border-left: 3px solid var(--blue);
            padding: 8px 12px;
            background: rgba(88,166,255,0.07);
            margin-top: 10px;
        }
        .scroll { overflow-x: auto; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="badge">Hardware Trace Report</span>
            <h1 style="margin-top: 10px;">CoreSight Trace Execution &amp; Timing Report</h1>
            <div class="meta">
                <span>Snapshot: <code>${d.snapshotName}</code></span>
                <span>Source: <code>${d.pplFileName}</code></span>
                <span>Generated: ${d.generatedAt}</span>
                <span>Core: <code>${d.coreFreqMhz} MHz</code></span>
                <span>TSG: <code>${d.tsFreqMhz} MHz</code></span>
            </div>
        </div>

        <div class="grid">
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Trace Window Duration</div>
                <div class="metric-val" style="color: var(--blue);">${d.windowDurationMs} ms</div>
                <div class="metric-sub">${d.windowDurationTicks.toLocaleString()} ticks &rarr; ${d.windowDurationUs.toLocaleString()} µs @ ${d.tsFreqMhz} MHz</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Processor Core Cycles</div>
                <div class="metric-val" style="color: var(--green);">${d.totalCycles.toLocaleString()}</div>
                <div class="metric-sub">Average CPI: <b>${d.averageCpi}</b> (${d.totalInstructions.toLocaleString()} instrs)</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Exception Occurrences</div>
                <div class="metric-val" style="color: var(--purple);">${d.exceptionsCount}</div>
                <div class="metric-sub">Period: <b>${this.us(d.interArrivalPeriodUs)}</b> &middot; max depth ${d.maxNestingDepth}</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Total Time in All ISRs</div>
                <div class="metric-val" style="color: var(--orange);">${this.us(d.totalIsrDurationUs, 1)}</div>
                <div class="metric-sub">${this.cyc(d.totalIsrCycles)} cycles &middot; ${d.isrCyclePercentage}% of CPU &middot; mean ${d.avgIsrCycles} cycles / invocation</div>
            </div>
        </div>

        ${warningsBlock}

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">1. Clock Configuration &amp; Calibration</h2>
            <p class="note" style="margin-top:0;">Every µs figure in this report is derived from the clock values supplied in the decoder panel. The trace stream does not encode them.</p>
            <table>
                <tbody>
                    <tr><td style="width: 35%;"><strong>Core Clock</strong></td><td><b>${d.coreFreqMhz} MHz</b></td></tr>
                    <tr><td><strong>Timestamp Clock (TSG)</strong></td><td><b>${d.tsFreqMhz} MHz</b> &mdash; 1 tick = ${(1 / d.tsFreqMhz).toFixed(4)} µs</td></tr>
                    <tr><td><strong>Measured ticks per cycle</strong></td><td><b>${d.tsPerCycleRatio !== null ? d.tsPerCycleRatio : 'N/A'}</b> (&Delta;TS &divide; total CYCLE_COUNT cycles)</td></tr>
                </tbody>
            </table>
            <div class="verdict">${d.tsClockVerdict}</div>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">2. Stream Synchronisation</h2>
            <table>
                <tbody>
                    <tr><td style="width: 35%;"><strong>Bytes discarded before first sync</strong></td><td><b>${d.syncBytesDiscarded.toLocaleString()}</b></td></tr>
                    <tr><td><strong><code>I_NOT_SYNC</code> elements</strong></td><td>${d.notSyncElementCount.toLocaleString()}</td></tr>
                    <tr><td><strong>First <code>I_ASYNC</code> at byte</strong></td><td>${d.firstSyncByteIdx !== null ? d.firstSyncByteIdx.toLocaleString() : 'N/A'}</td></tr>
                    <tr><td><strong>A-Sync packets in capture</strong></td><td>${d.syncPacketCount.toLocaleString()}</td></tr>
                    <tr><td><strong>Mean sync period</strong></td><td>${d.avgSyncPeriodBytes !== null ? d.avgSyncPeriodBytes.toLocaleString() + ' bytes' : 'N/A'}</td></tr>
                </tbody>
            </table>
            <p class="note">The head of every capture is unsynchronised. The ETM emits its alignment-sync pattern only once per <code>TRCSYNCPR</code> period, so a capture started at an arbitrary instant must wait up to a full period before the decoder can lock on. Those bytes are valid trace data that cannot be interpreted without a preceding sync point &mdash; not data the logic analyser failed to record. Lower <code>TRCSYNCPR</code> to shorten this head, at the cost of trace-port bandwidth.</p>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">3. Hardware Timestamps &amp; Window Timing</h2>
            <table>
                <tbody>
                    <tr><td style="width: 35%;"><strong>1st Timestamp (post-sync)</strong></td><td><code>${d.firstTsHex}</code></td></tr>
                    <tr><td><strong>Last Timestamp (Trace Window End)</strong></td><td><code>${d.lastTsHex}</code></td></tr>
                    <tr><td><strong>Trace Window (&Delta;TS)</strong></td><td><b>${d.windowDurationTicks.toLocaleString()} ticks</b></td></tr>
                    <tr><td><strong>Trace Window Duration</strong></td><td><b>${d.windowDurationUs.toLocaleString()} µs (${d.windowDurationMs} ms)</b></td></tr>
                    <tr><td><strong>Total Instructions Decoded</strong></td><td>${d.totalInstructions.toLocaleString()} instructions</td></tr>
                    <tr><td><strong>Total Clock Cycles</strong></td><td>${d.totalCycles.toLocaleString()} cycles</td></tr>
                    <tr><td><strong>Average CPI</strong></td><td>${d.averageCpi} cycles/instruction</td></tr>
                    <tr><td><strong>Branch Atoms (<code>I_ATOM</code>)</strong></td><td>${d.totalAtoms.toLocaleString()} branch decisions</td></tr>
                    <tr><td><strong>Trace Packet Lines</strong></td><td>${d.totalPackets.toLocaleString()}</td></tr>
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">4. Interrupt &amp; Exception Handling Performance</h2>
            <p class="note" style="margin-top:0;">
                ISR duration spans the <b>entry timestamp</b> (first <code>TIMESTAMP</code> inside the handler, emitted by the ETM in response to the exception)
                to the <b>exit timestamp</b> (first <code>TIMESTAMP</code> after <code>EXCEPTION_RET</code>).
                It <b>includes</b> exception entry latency and <b>excludes</b> the unstacking after the return, so it is a
                <b>lower bound</b> on the interference seen by the preempted thread.
            </p>
            <table>
                <tbody>
                    <tr><td style="width: 35%;"><strong><code>EXCEPTION</code> / <code>EXCEPTION_RET</code> elements</strong></td><td>${d.exceptionElementCount} / ${d.exceptionRetElementCount}</td></tr>
                    <tr><td><strong>Records produced</strong></td><td><b>${d.exceptionsCount}</b> ${d.exceptionsCount === d.exceptionElementCount ? '&mdash; all exceptions accounted for' : '&mdash; <span style="color:var(--red)">MISMATCH</span>'}</td></tr>
                    <tr><td><strong>Records missing a timestamp</strong></td><td>${d.recordsWithMissingTs} (excluded from timing statistics)</td></tr>
                    <tr><td><strong>Max nesting depth</strong></td><td>${d.maxNestingDepth} ${d.maxNestingDepth > 1 ? '&mdash; preemption occurred' : '&mdash; no preemption'}</td></tr>
                </tbody>
            </table>
            <p class="note">
                Execution split: <b>${d.isrCyclePercentage}% in ISRs</b> (${this.cyc(d.totalIsrCycles)} cycles) vs.
                <b>${(100 - d.isrCyclePercentage).toFixed(2)}% in Main Thread</b> (${this.cyc(d.totalCycles - d.totalIsrCycles)} cycles).
            </p>
            <div class="progress-bar">
                <div class="bar-isr" style="width: ${d.isrCyclePercentage}%;" title="ISR: ${d.isrCyclePercentage}%"></div>
                <div class="bar-main" style="width: ${100 - d.isrCyclePercentage}%;" title="Main Thread: ${(100 - d.isrCyclePercentage).toFixed(2)}%"></div>
            </div>

            <h3 style="font-size: 13px; margin: 18px 0 10px 0; color: var(--heading);">CPU Execution Split by ISR Type:</h3>
            <div class="scroll">
            <table>
                <thead>
                    <tr>
                        <th>Exception / ISR Type</th><th>Vector</th><th>Count</th><th>Period</th>
                        <th>Mean Duration</th><th>Max Duration (observed)</th><th>Max Cycles</th>
                        <th>Mean Instrs</th><th>Max Instrs</th><th>CPU % Share</th>
                    </tr>
                </thead>
                <tbody>
                    ${d.isrBreakdown.map(b => `
                        <tr>
                            <td><span style="color: var(--purple); font-weight: 600;">${b.typeName}</span></td>
                            <td><code>${b.excepNum.toUpperCase()}</code></td>
                            <td>${b.count.toLocaleString()}</td>
                            <td>${this.us(b.interArrivalUs)}</td>
                            <td>${this.us(b.avgDurationUs)}</td>
                            <td><b style="color: var(--red);">${this.us(b.maxDurationUs)}</b></td>
                            <td>${this.cyc(b.maxCycles)}</td>
                            <td>${b.avgInstructions}</td>
                            <td>${b.maxInstructions}</td>
                            <td><span style="color: var(--orange); font-weight: 600;">${b.cpuPercentage}%</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            </div>
            <p class="note">Max duration is the largest observed value &mdash; a high-water mark, not a proven worst case.</p>

            <h3 style="font-size: 13px; margin: 18px 0 10px 0; color: var(--heading);">Timestamps Before and After IRQ Service Routines:</h3>
            <div class="scroll">
            <table>
                <thead>
                    <tr>
                        <th>#</th><th>Type</th><th>Depth</th><th>Pre-IRQ TS</th><th>Entry TS</th><th>Exit TS</th>
                        <th>&Delta;TS (ticks)</th><th>Duration</th><th>Cycles</th><th>Instrs</th><th>Est. Entry Ovh</th>
                    </tr>
                </thead>
                <tbody>
                    ${d.sampleExceptions.map(e => `
                        <tr${e.tsComplete ? '' : ' style="background: rgba(248,81,73,0.08);"'}>
                            <td>${e.index}${e.tsComplete ? '' : ' &#9888;'}</td>
                            <td><span style="color: var(--purple); font-weight: 600;">${e.type}</span></td>
                            <td>${e.depth}</td>
                            <td><code>${this.hex(e.preTs)}</code></td>
                            <td><code>${this.hex(e.entryTs)}</code></td>
                            <td><code>${this.hex(e.exitTs)}</code></td>
                            <td>${e.durationTicks !== null ? e.durationTicks : 'N/A'}</td>
                            <td><b>${this.us(e.isrDurationUs)}</b></td>
                            <td>${this.cyc(e.cycles)}</td>
                            <td>${e.instructions}${e.instructionsInclusive !== e.instructions ? ` <span style="color:var(--muted)">(${e.instructionsInclusive})</span>` : ''}</td>
                            <td>${e.estEntryOverheadCycles !== null ? e.estEntryOverheadCycles : 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            </div>
            <p class="note">
                Representative samples across the trace window. Total exception occurrences: ${d.exceptionsCount}.
                A bracketed instruction count is the inclusive figure (this handler plus anything that preempted it).
                &ldquo;Est. Entry Ovh&rdquo; is <code>cycles &minus; instructions &times; CPI</code>, an estimate of exception entry latency.
            </p>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">5. Execution Hotspots (Address Distribution)</h2>
            <table>
                <thead>
                    <tr><th>Rank</th><th>Address Range</th><th>Instructions Executed</th><th>Share</th></tr>
                </thead>
                <tbody>
                    ${d.hotspots.map((h, i) => `
                        <tr>
                            <td>${i + 1}</td>
                            <td><code>${h.address}</code></td>
                            <td>${h.count.toLocaleString()}</td>
                            <td><b>${h.percentage}%</b></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p class="note">Instructions are attributed to the start address of each decoded <code>exec range</code>, not to individual addresses.</p>
        </div>
    </div>
</body>
</html>`;
    }
}
exports.ReportGenerator = ReportGenerator;
//# sourceMappingURL=reportGenerator.js.map