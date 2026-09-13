import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Timing model
 * ------------
 * The CoreSight timestamp generator (TSG) and the ETM cycle counter are two
 * independent hardware sources. Nothing in the trace stream states the TSG
 * frequency, so it must be supplied by the caller (`tsFreqMhz`).
 *
 *   durationTicks = exitTs - entryTs        (raw TSG ticks, always exact)
 *   durationUs    = durationTicks / tsFreqMhz
 *   cycles        = durationUs * coreFreqMhz
 *
 * `tsPerCycleRatio` (window ticks / total CYCLE_COUNT cycles) is reported so
 * the operator can see whether the TSG happens to be clocked from the core
 * domain. On STM32H7 it is, so the ratio lands on ~1.000 - but that is a
 * property of the board, not an assumption this code is allowed to make.
 *
 * ISR boundaries
 * --------------
 * entryTs is the first TIMESTAMP element between OCSD_GEN_TRC_ELEM_EXCEPTION
 * and its matching OCSD_GEN_TRC_ELEM_EXCEPTION_RET; exitTs is the first
 * TIMESTAMP element after that EXCEPTION_RET. The resulting span covers
 * [exception taken] -> [handler's final exception-return instruction]. It
 * therefore INCLUDES the exception entry latency (stacking + vector fetch) but
 * EXCLUDES the unstacking that follows the return, making it a lower bound on
 * the total interference a preempted thread sees.
 */

export interface ExceptionRecord {
    index: number;
    excepNum: string;
    type: string;
    /** 0 = top level, >0 = preempted another handler that was already active. */
    depth: number;
    preTs: bigint | null;
    entryTs: bigint | null;
    exitTs: bigint | null;
    /** Raw TSG ticks between entryTs and exitTs. Null when a timestamp is missing. */
    durationTicks: number | null;
    /** durationTicks converted with tsFreqMhz. */
    isrDurationUs: number | null;
    /** Core cycles derived from isrDurationUs x coreFreqMhz. */
    cycles: number | null;
    /** Raw sum of CYCLE_COUNT elements spanned by this handler. Diagnostic only:
     *  the enclosing cycle blocks usually start before the exception was taken. */
    ccBlockCycles: number;
    /** Instructions retired in this handler only (nested handlers excluded). */
    instructions: number;
    /** Instructions retired in this handler plus everything it was preempted by. */
    instructionsInclusive: number;
    /** cycles - instructions x averageCpi. Estimate of exception entry overhead. */
    estEntryOverheadCycles: number | null;
    /** Ticks of thread execution between the previous trace timestamp and entry. */
    threadTimeBeforeUs: number | null;
    /** False when entryTs or exitTs could not be recovered from the stream. */
    tsComplete: boolean;

    /** Byte offset of the exception in the trace stream (the decoder's Idx). */
    traceIdx: number | null;
    /** Vector name as the packet processor printed it, e.g. "IRQ54", "SysTick". */
    vectorName: string | null;
    /**
     * 'decoded' - reconstructed from OCSD_GEN_TRC_ELEM_EXCEPTION, with timing.
     * 'raw'     - only the I_EXCEPT protocol packet survived; the instruction
     *             decoder was desynchronised here, so no timing is available.
     */
    source: 'decoded' | 'raw';
    /** Preferred return address carried by the exception. */
    prefRetAddr: string | null;
    /** Address execution actually resumed at after the matching return. */
    resumeAddr: string | null;
    /** How this exception ended. */
    closure: 'returned' | 'no-return-dropped' | 'no-return-eot' | 'no-return-desync';
    /** False when the entry/return pair failed validation. */
    pairOk: boolean;
    /** Why the pair is suspect, or how the exception ended unreturned. */
    pairNote: string | null;
}

export interface IsrTypeBreakdown {
    typeName: string;
    excepNum: string;
    count: number;
    totalCycles: number;
    totalInstructions: number;
    totalDurationUs: number;
    avgCycles: number;
    avgInstructions: number;
    avgDurationUs: number;
    /** Observed extremes - the WCET-relevant figures. */
    minDurationUs: number | null;
    maxDurationUs: number | null;
    maxCycles: number | null;
    maxInstructions: number;
    /** Mean entry-to-entry period for this vector. */
    interArrivalUs: number | null;
    cpuPercentage: number;
}

export interface TraceReportData {
    snapshotName: string;
    pplFileName: string;
    generatedAt: string;

    // --- clock configuration (supplied, not inferred) ---
    coreFreqMhz: number;
    tsFreqMhz: number;
    /** windowDurationTicks / totalCycles. ~1.0 means the TSG runs at the core clock. */
    tsPerCycleRatio: number | null;
    tsClockVerdict: string;

    firstTsHex: string | null;
    lastTsHex: string | null;
    windowDurationTicks: number;
    windowDurationUs: number;
    windowDurationMs: number;

    totalInstructions: number;
    totalCycles: number;
    averageCpi: number;
    totalAtoms: number;
    totalPackets: number;

    // --- stream synchronisation ---
    notSyncElementCount: number;
    syncBytesDiscarded: number;
    firstSyncByteIdx: number | null;
    syncPacketCount: number;
    avgSyncPeriodBytes: number | null;

    // --- exception accounting / self-check ---
    exceptionElementCount: number;
    exceptionRetElementCount: number;
    exceptionsCount: number;
    recordsWithMissingTs: number;
    unmatchedRets: number;
    unclosedAtEof: number;
    maxNestingDepth: number;

    // --- raw protocol packets, independent of the instruction decoder ---
    rawExceptPackets: number;
    rawExceptRtnPackets: number;
    /** I_EXCEPT minus I_EXCEPT_RTN. Non-zero needs explaining. */
    exceptionReturnDeficit: number;
    /** Exceptions recovered from raw packets because no element was decoded. */
    rawOnlyExceptions: number;
    unreturnedExceptions: number;
    droppedReturns: number;
    pairMismatches: number;

    // --- capture integrity ---
    badPacketCount: number;
    malformedSyncCount: number;
    desyncEvents: { traceIdx: number; reason: string }[];
    decoderErrors: { traceIdx: number | null; code: string; text: string }[];
    /** Byte ranges in which the instruction decoder produced nothing. */
    deadRanges: { from: number; to: number }[];
    deadBytes: number;
    traceByteLength: number;
    captureHealthy: boolean;
    captureVerdict: string;

    totalIsrCycles: number;
    avgIsrCycles: number;
    totalIsrDurationUs: number;
    totalIsrInstructions: number;
    avgIsrInstructions: number;
    isrCyclePercentage: number;
    interArrivalPeriodUs: number | null;

    isrBreakdown: IsrTypeBreakdown[];
    sampleExceptions: ExceptionRecord[];
    allExceptions: ExceptionRecord[];
    hotspots: { address: string; count: number; percentage: number }[];
    warnings: string[];
}

/**
 * ETMv4 M-profile exception type -> name. This mirrors OpenCSD's own table
 * (EtmV4ITrcPacket::exceptionInfo) exactly. The ETM encoding is NOT the NVIC
 * vector number:
 *   0x00-0x1F  fixed table (0x10-0x17 are IRQ0-IRQ7)
 *   0x208-0x3EF  IRQ(n - 0x200), i.e. IRQ8 upwards
 * so IRQ54 is traced as 0x236, not 54 + 16.
 */
const M_EXCEPTION_NAMES = [
    'Reserved', 'Reset', 'NMI', 'HardFault',
    'MemManage', 'BusFault', 'UsageFault', 'Reserved',
    'Reserved', 'Reserved', 'Reserved', 'SVCall',
    'DebugMonitor', 'Reserved', 'PendSV', 'SysTick',
    'IRQ0', 'IRQ1', 'IRQ2', 'IRQ3',
    'IRQ4', 'IRQ5', 'IRQ6', 'IRQ7',
    'DebugHalt', 'LazyFP Push', 'Lockup', 'Reserved',
    'Reserved', 'Reserved', 'Reserved', 'Reserved'
];

function getExceptionName(excepNumHex: string): string {
    const num = parseInt(excepNumHex, 16);
    if (Number.isNaN(num)) return 'Exception';
    if (num < 0x20) return M_EXCEPTION_NAMES[num];
    if (num >= 0x208 && num <= 0x3EF) return `IRQ${num - 0x200}`;
    return 'Reserved';
}

/** One active exception on the nesting stack. */
interface ExcFrame {
    index: number;
    excepNum: string;
    type: string;
    depth: number;
    preTs: bigint | null;
    entryTs: bigint | null;
    exitTs: bigint | null;
    ccBlockCycles: number;
    instructions: number;
    instructionsInclusive: number;
    traceIdx: number | null;
    prefRetAddr: string | null;
    closure: 'returned' | 'no-return-dropped' | 'no-return-eot' | 'no-return-desync';
    pairNote: string | null;
    /** Set when the frame was popped by an EXCEPTION_RET (so a resume address is due). */
    closedByRet: boolean;
}

/** An I_EXCEPT protocol packet, tracked independently of the decoder. */
interface RawExc {
    traceIdx: number;
    vectorName: string;
    prefRetAddr: string | null;
}

/**
 * Map a vector name printed by the packet processor back to the ETM exception
 * type the decoder uses, so raw-only and decoded records share one label.
 * Inverse of getExceptionName.
 */
function vectorNameToNum(name: string): string | null {
    const fmt = (v: number) => '0x' + v.toString(16).toUpperCase().padStart(2, '0');
    const n = name.trim();
    const irq = n.match(/^IRQ\s*(\d+)$/i);
    if (irq) {
        const k = parseInt(irq[1], 10);
        return fmt(k < 8 ? 0x10 + k : 0x200 + k);
    }
    const key = n.toLowerCase().replace(/[^a-z]/g, '');
    const aliases: { [k: string]: string } = { pereset: 'reset', svc: 'svcall' };
    const target = aliases[key] || key;
    // Skip the IRQ0-7 slots (handled above) and the Reserved entries.
    const idx = M_EXCEPTION_NAMES.findIndex((x, i) =>
        (i < 0x10 || i >= 0x18)
        && x !== 'Reserved'
        && x.toLowerCase().replace(/[^a-z]/g, '') === target);
    return idx >= 0 ? fmt(idx) : null;
}

export class ReportGenerator {
    public static async generateReportFromPpl(
        pplFilePath: string,
        snapshotPath: string,
        workspaceRoot: string,
        coreFreqMhz: number = 1,
        tsFreqMhz: number = 1
    ): Promise<{ mdPath: string; htmlPath: string; data: TraceReportData }> {
        const snapDir = fs.existsSync(snapshotPath) && fs.statSync(snapshotPath).isFile()
            ? path.dirname(snapshotPath)
            : snapshotPath;
        const snapshotName = path.basename(snapDir);
        const pplFileName = path.basename(pplFilePath);

        if (!(coreFreqMhz > 0)) coreFreqMhz = 1;
        if (!(tsFreqMhz > 0)) tsFreqMhz = 1;

        let totalInstructions = 0;
        let totalCycles = 0;
        let totalAtoms = 0;
        let totalPackets = 0;
        let firstTs: bigint | null = null;
        let lastTs: bigint | null = null;
        let lastThreadTs: bigint | null = null;

        // Stream synchronisation accounting.
        let notSyncElementCount = 0;
        let lastNotSyncEndIdx = 0;
        let firstSyncByteIdx: number | null = null;
        let lastSyncByteIdx: number | null = null;
        let syncPacketCount = 0;
        let syncPeriodSum = 0;
        let syncPeriodCount = 0;

        // Exception accounting.
        let exceptionElementCount = 0;
        let exceptionRetElementCount = 0;
        let unmatchedRets = 0;
        let maxNestingDepth = 0;
        let droppedReturns = 0;
        let pairMismatches = 0;

        // Raw protocol layer, parsed independently of the instruction decoder so
        // that exceptions are still reported when the decoder loses sync.
        const rawExceptions: RawExc[] = [];
        const rawRetIdx: number[] = [];
        let pendingRawAddr: RawExc | null = null;

        // Capture integrity.
        let badPacketCount = 0;
        let malformedSyncCount = 0;
        const desyncEvents: { traceIdx: number; reason: string }[] = [];
        const decoderErrors: { traceIdx: number | null; code: string; text: string }[] = [];
        const deadRanges: { from: number; to: number }[] = [];
        let pendingDead: number | null = null;
        let lastIdxSeen = 0;

        /**
         * Record closed by a return, still awaiting its resume address. Held in
         * an object so that assignment from inside finalize() is visible to the
         * loop's control-flow analysis.
         */
        const resumeWatch: { rec: ExceptionRecord | null } = { rec: null };

        const allExceptions: ExceptionRecord[] = [];
        /** Active handlers, innermost last. */
        const stack: ExcFrame[] = [];
        /** Frames that have returned and are waiting for their exit TIMESTAMP. */
        let awaitingExitTs: ExcFrame[] = [];

        const hotspotsMap: { [addr: string]: number } = {};
        /** Per-vector entry timestamps, for inter-arrival. */
        const entryTsByVector: { [vec: string]: bigint[] } = {};

        const ticksToUs = (ticks: number) => ticks / tsFreqMhz;

        /** Commit a returned frame once its exit TS is known (or known missing). */
        const finalize = (f: ExcFrame) => {
            const durationTicks = (f.entryTs !== null && f.exitTs !== null)
                ? Number(f.exitTs - f.entryTs)
                : null;
            const isrDurationUs = durationTicks !== null ? ticksToUs(durationTicks) : null;
            const cycles = isrDurationUs !== null ? isrDurationUs * coreFreqMhz : null;
            const threadTimeBeforeUs = (f.preTs !== null && f.entryTs !== null)
                ? ticksToUs(Number(f.entryTs - f.preTs))
                : null;

            const rec: ExceptionRecord = {
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
                tsComplete: f.entryTs !== null && f.exitTs !== null,
                traceIdx: f.traceIdx,
                vectorName: null,
                source: 'decoded',
                prefRetAddr: f.prefRetAddr,
                resumeAddr: null,
                closure: f.closure,
                pairOk: f.closure === 'returned',
                pairNote: f.pairNote
            };
            allExceptions.push(rec);
            // A returned handler owes us a resume address to validate the pair.
            if (f.closedByRet) resumeWatch.rec = rec;
        };

        /** No timestamp arrived before the stream moved on - commit without one. */
        const flushAwaiting = () => {
            if (awaitingExitTs.length === 0) return;
            for (const f of awaitingExitTs) finalize(f);
            awaitingExitTs = [];
        };

        const rl = readline.createInterface({
            input: fs.createReadStream(pplFilePath),
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            // A decoder error message is sometimes printed as a prefix on the
            // following packet line, so match the Idx anywhere, not just at the
            // start, and record the error without consuming the line.
            const idxM = line.match(/Idx:(\d+); ID:([0-9a-fA-F]+);/);
            const idx = idxM ? parseInt(idxM[1], 10) : null;
            const isElem = idxM ? idxM[2].toLowerCase() === '3e' : false;
            if (idx !== null) {
                totalPackets++;
                if (idx > lastIdxSeen) lastIdxSeen = idx;
            }

            const errM = line.match(/(DCD_[A-Z0-9_]+)\s*:\s*0x[0-9a-fA-F]+\s*\(([A-Z0-9_]+)\)\s*\[([^\]]*)\]/);
            if (errM) {
                const tM = line.match(/TrcIdx=(\d+)/);
                decoderErrors.push({
                    traceIdx: tM ? parseInt(tM[1], 10) : idx,
                    code: errM[2],
                    text: errM[3]
                });
            }

            // Any successfully decoded element ends a dead region.
            if (isElem && pendingDead !== null && !line.includes('OCSD_GEN_TRC_ELEM_NO_SYNC')) {
                deadRanges.push({ from: pendingDead, to: idx! });
                pendingDead = null;
            }

            // ---- raw protocol packets (ID:0) -------------------------------
            if (!isElem) {
                // Checked before I_ASYNC: a corrupt sync pattern is reported as
                // I_BAD_SEQUENCE ... [I_ASYNC] and must not count as a sync point.
                if (line.includes('I_BAD_')) {
                    badPacketCount++;
                    if (line.includes('[I_ASYNC]')) malformedSyncCount++;
                    continue;
                }
                if (line.includes('I_NOT_SYNC')) {
                    notSyncElementCount++;
                    const bytes = (line.match(/0x[0-9a-fA-F]{2}/g) || []).length;
                    if (idx !== null) lastNotSyncEndIdx = idx + bytes;
                    continue;
                }
                if (line.includes('I_ASYNC')) {
                    if (idx !== null) {
                        if (firstSyncByteIdx === null) firstSyncByteIdx = idx;
                        if (lastSyncByteIdx !== null) {
                            syncPeriodSum += idx - lastSyncByteIdx;
                            syncPeriodCount++;
                        }
                        lastSyncByteIdx = idx;
                    }
                    syncPacketCount++;
                    continue;
                }
                if (line.includes('I_EXCEPT_RTN')) {
                    if (idx !== null) rawRetIdx.push(idx);
                    pendingRawAddr = null;
                    continue;
                }
                if (/I_EXCEPT\s*:/.test(line)) {
                    const vm = line.match(/I_EXCEPT\s*:\s*Exception\.;\s*([^;]+);/);
                    const rec: RawExc = {
                        traceIdx: idx !== null ? idx : lastIdxSeen,
                        vectorName: vm ? vm[1].trim() : 'Unknown',
                        prefRetAddr: null
                    };
                    rawExceptions.push(rec);
                    // The preferred return address follows in the next address packet.
                    pendingRawAddr = /Ret Addr Follows/i.test(line) ? rec : null;
                    continue;
                }
                if (pendingRawAddr && line.includes('I_ADDR_')) {
                    const am = line.match(/Addr=0x([0-9a-fA-F]+)/);
                    if (am) {
                        pendingRawAddr.prefRetAddr = '0x' + am[1].replace(/^0+/, '').toLowerCase();
                        pendingRawAddr = null;
                    }
                    continue;
                }
                if (line.includes('I_ATOM_')) {
                    totalAtoms++;
                    continue;
                }
                continue;
            }

            // ---- decoded generic elements (ID:3e) --------------------------
            // Order matters: EXCEPTION_RET is checked before EXCEPTION so that a
            // tail-chained pair on adjacent lines is handled in stream order.

            if (line.includes('OCSD_GEN_TRC_ELEM_NO_SYNC')) {
                const rm = line.match(/NO_SYNC\(\s*\[([^\]]*)\]/);
                const reason = rm ? rm[1] : 'unknown';
                // "init-decoder" is the decoder's start state, not a fault.
                if (reason !== 'init-decoder' && idx !== null) {
                    desyncEvents.push({ traceIdx: idx, reason });
                    if (pendingDead === null) pendingDead = idx;
                }
                continue;
            }

            if (line.includes('OCSD_GEN_TRC_ELEM_TIMESTAMP(')) {
                const tsM = line.match(/TS=0x([0-9a-fA-F]+)/);
                if (!tsM) continue;
                const ts = BigInt('0x' + tsM[1]);
                if (firstTs === null) firstTs = ts;
                lastTs = ts;

                if (awaitingExitTs.length > 0) {
                    // Closest pending return claims this timestamp.
                    const f = awaitingExitTs.shift()!;
                    f.exitTs = ts;
                    finalize(f);
                    if (stack.length === 0) lastThreadTs = ts;
                } else if (stack.length > 0) {
                    const top = stack[stack.length - 1];
                    if (top.entryTs === null) {
                        top.entryTs = ts;
                        (entryTsByVector[top.excepNum] ||= []).push(ts);
                    }
                } else {
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
                    if (stack.length > 0) stack[stack.length - 1].ccBlockCycles += cc;
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
                f.closure = 'returned';
                f.closedByRet = true;
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
                const prefM = line.match(/pref ret addr:\s*(0x[0-9a-fA-F]+)/);

                // A vector cannot preempt itself: same priority never preempts,
                // and the NVIC cannot re-enter an active exception. Seeing the
                // same vector taken while it is still on the stack therefore
                // means the EXCEPTION_RET between the two was never decoded.
                const dupAt = stack.findIndex(fr => fr.excepNum === hexFormatted);
                if (dupAt >= 0) {
                    for (let i = stack.length - 1; i >= dupAt; i--) {
                        const lost = stack[i];
                        lost.closure = 'no-return-dropped';
                        lost.pairNote = `Vector ${hexFormatted} was taken again while still active - the EXCEPTION_RET between the two was lost.`;
                        droppedReturns++;
                        finalize(lost);
                    }
                    stack.length = dupAt;
                }

                const frame: ExcFrame = {
                    index: exceptionElementCount,
                    excepNum: hexFormatted,
                    type: `${getExceptionName(exNum)} (${hexFormatted})`,
                    depth: stack.length,
                    preTs: stack.length === 0 ? lastThreadTs : null,
                    entryTs: null,
                    exitTs: null,
                    ccBlockCycles: 0,
                    instructions: 0,
                    instructionsInclusive: 0,
                    traceIdx: idx,
                    prefRetAddr: prefM ? prefM[1].toLowerCase() : null,
                    closure: 'no-return-eot',
                    pairNote: null,
                    closedByRet: false
                };
                stack.push(frame);
                if (stack.length > maxNestingDepth) maxNestingDepth = stack.length;
                continue;
            }

            const numM = line.match(/num_i\((\d+)\)/);
            if (numM) {
                // Execution has resumed, so any pending return is settled.
                flushAwaiting();

                const startM = line.match(/exec range=(0x[0-9a-fA-F]+):/);
                if (resumeWatch.rec && startM) {
                    // The instruction stream resumes at the exception's preferred
                    // return address. Anything else means the EXCEPTION /
                    // EXCEPTION_RET we paired are not actually a pair.
                    const resume = startM[1].toLowerCase();
                    resumeWatch.rec.resumeAddr = resume;
                    const expected = resumeWatch.rec.prefRetAddr;
                    if (expected && resume !== expected) {
                        resumeWatch.rec.pairOk = false;
                        resumeWatch.rec.pairNote =
                            `Resumed at ${resume} but the exception's preferred return address was ${expected}; `
                            + `this entry/return pair does not match.`;
                        pairMismatches++;
                    }
                    resumeWatch.rec = null;
                }

                const n = parseInt(numM[1], 10);
                totalInstructions += n;
                if (stack.length > 0) {
                    stack[stack.length - 1].instructions += n;
                    for (const f of stack) f.instructionsInclusive += n;
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
        while (stack.length > 0) {
            const f = stack.pop()!;
            f.closure = 'no-return-eot';
            f.pairNote = 'Still active when the trace ended - the handler had not returned yet.';
            finalize(f);
        }
        if (pendingDead !== null) {
            deadRanges.push({ from: pendingDead, to: lastIdxSeen });
            pendingDead = null;
        }

        allExceptions.sort((a, b) => a.index - b.index);

        // ---- reconcile against the raw protocol layer -----------------------
        // The instruction decoder emits no EXCEPTION element while it is out of
        // sync, but the packet processor still recovers the I_EXCEPT packets.
        // Those exceptions really happened, so report them rather than dropping
        // them; they simply carry no timing.
        const inDeadRange = (i: number | null) =>
            i !== null && deadRanges.some(r => i >= r.from && i <= r.to);

        const synthesiseRaw = (raw: RawExc, closure: ExceptionRecord['closure'], note: string | null): ExceptionRecord => {
            const vecNum = vectorNameToNum(raw.vectorName);
            const label = vecNum ? `${getExceptionName(vecNum)} (${vecNum})` : raw.vectorName;
            return {
                index: 0,
                excepNum: vecNum || raw.vectorName,
                type: label,
                depth: 0,
                preTs: null, entryTs: null, exitTs: null,
                durationTicks: null, isrDurationUs: null, cycles: null,
                ccBlockCycles: 0, instructions: 0, instructionsInclusive: 0,
                estEntryOverheadCycles: null, threadTimeBeforeUs: null,
                tsComplete: false,
                traceIdx: raw.traceIdx,
                vectorName: raw.vectorName,
                source: 'raw',
                prefRetAddr: raw.prefRetAddr,
                resumeAddr: null,
                closure,
                pairOk: closure === 'returned',
                pairNote: note
            };
        };

        let rawOnlyExceptions = 0;
        let merged: ExceptionRecord[] = allExceptions;

        if (rawExceptions.length > 0) {
            // Pair the raw packets on their own, using the same same-vector rule,
            // so raw-only exceptions still get a closure verdict.
            const rawEvents: { idx: number; kind: 'exc' | 'ret'; raw?: RawExc }[] = [
                ...rawExceptions.map(r => ({ idx: r.traceIdx, kind: 'exc' as const, raw: r })),
                ...rawRetIdx.map(i => ({ idx: i, kind: 'ret' as const }))
            ].sort((a, b) => a.idx - b.idx);

            const rawClosure = new Map<number, { closure: ExceptionRecord['closure']; note: string | null }>();
            const rawStack: RawExc[] = [];
            for (const ev of rawEvents) {
                if (ev.kind === 'exc') {
                    const dupAt = rawStack.findIndex(f => f.vectorName === ev.raw!.vectorName);
                    if (dupAt >= 0) {
                        for (let i = rawStack.length - 1; i >= dupAt; i--) {
                            rawClosure.set(rawStack[i].traceIdx, {
                                closure: 'no-return-dropped',
                                note: `${rawStack[i].vectorName} was taken again at byte ${ev.idx} while still active - the I_EXCEPT_RTN between the two was never captured.`
                            });
                        }
                        rawStack.length = dupAt;
                    }
                    rawStack.push(ev.raw!);
                } else {
                    const f = rawStack.pop();
                    if (f) rawClosure.set(f.traceIdx, { closure: 'returned', note: null });
                }
            }
            for (const f of rawStack) {
                rawClosure.set(f.traceIdx, {
                    closure: 'no-return-eot',
                    note: 'Still active when the trace ended - the handler had not returned yet.'
                });
            }

            const decodedByIdx = new Map<number, ExceptionRecord>();
            for (const r of allExceptions) {
                if (r.traceIdx !== null) decodedByIdx.set(r.traceIdx, r);
            }

            merged = [];
            for (const raw of rawExceptions) {
                const dec = decodedByIdx.get(raw.traceIdx);
                if (dec) {
                    dec.vectorName = raw.vectorName;
                    if (!dec.prefRetAddr) dec.prefRetAddr = raw.prefRetAddr;
                    // The decoder stops seeing events when it desyncs, so a decoded
                    // record left open can look "still running at end of trace"
                    // while the raw packets show what really happened next. For
                    // unreturned records, the raw layer's verdict wins.
                    const rc = rawClosure.get(raw.traceIdx);
                    if (dec.closure !== 'returned' && rc && rc.closure !== dec.closure) {
                        dec.closure = rc.closure;
                        dec.pairOk = rc.closure === 'returned';
                        dec.pairNote = rc.note;
                        if (inDeadRange(raw.traceIdx) || deadRanges.some(r => r.from > raw.traceIdx && r.from < (rawExceptions[rawExceptions.indexOf(raw) + 1]?.traceIdx ?? Infinity))) {
                            dec.pairNote = (dec.pairNote ? dec.pairNote + ' ' : '')
                                + 'The instruction decoder lost sync before this handler finished, so its exit was not decoded.';
                        }
                    }
                    decodedByIdx.delete(raw.traceIdx);
                    merged.push(dec);
                } else {
                    rawOnlyExceptions++;
                    const rc = rawClosure.get(raw.traceIdx)
                        || { closure: 'no-return-eot' as const, note: null };
                    let closure = rc.closure;
                    let note = rc.note;
                    // Only the final exception can legitimately be unreturned
                    // because the trace ended. An earlier one left open means
                    // its return went missing.
                    const isLast = raw === rawExceptions[rawExceptions.length - 1];
                    if (closure === 'no-return-eot' && !isLast) {
                        closure = inDeadRange(raw.traceIdx) ? 'no-return-desync' : 'no-return-dropped';
                        note = 'No matching return was captured before the next exception.';
                    }
                    // A desync explains the missing timing, but never overrides a
                    // specific packet-level diagnosis such as a lost return.
                    if (inDeadRange(raw.traceIdx)) {
                        note = (note ? note + ' ' : '')
                            + 'The instruction decoder was out of sync over this byte range, so no timing could be recovered.';
                    }
                    merged.push(synthesiseRaw(raw, closure, note));
                }
            }
            // Decoded records with no raw counterpart (raw packets suppressed).
            for (const rest of decodedByIdx.values()) merged.push(rest);
            merged.sort((a, b) => (a.traceIdx ?? 0) - (b.traceIdx ?? 0));
            merged.forEach((r, i) => { r.index = i + 1; });
        }

        allExceptions.length = 0;
        allExceptions.push(...merged);

        // Recompute from the merged list so raw-only and decoded records are
        // counted exactly once each.
        const unreturnedExceptions = allExceptions.filter(e => e.closure !== 'returned').length;
        droppedReturns = allExceptions.filter(e => e.closure === 'no-return-dropped').length;
        pairMismatches = allExceptions.filter(e => e.closure === 'returned' && !e.pairOk).length;

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

        let tsClockVerdict: string;
        if (tsPerCycleRatio === null) {
            tsClockVerdict = 'Not determinable: this trace carries no cycle-count or timestamp packets.';
        } else if (clocksConsistent) {
            tsClockVerdict = `Consistent. The trace gives ${tsPerCycleRatio} ticks per core cycle, matching the `
                + `${tsFreqMhz} MHz / ${coreFreqMhz} MHz pair you supplied (expected ${parseFloat(expectedRatio.toFixed(6))}). `
                + `1 tick = ${(1 / tsFreqMhz).toFixed(4)} µs.`
                + (Math.abs(tsPerCycleRatio - 1) <= 0.01
                    ? ' The TSG advances once per core cycle on this board, so timestamp resolution tracks the core clock.'
                    : '');
        } else {
            tsClockVerdict = `INCONSISTENT. The trace gives ${tsPerCycleRatio} ticks per core cycle, but the supplied `
                + `${tsFreqMhz} MHz TSG / ${coreFreqMhz} MHz core pair implies ${parseFloat(expectedRatio.toFixed(6))}. `
                + `Against a ${coreFreqMhz} MHz core the TSG is actually running at about ${impliedTsFreqMhz} MHz; `
                + `against a ${tsFreqMhz} MHz TSG the core is actually about ${parseFloat((tsFreqMhz / tsPerCycleRatio).toFixed(4))} MHz. `
                + `Every µs and cycle figure below is wrong until one of the two fields is corrected.`;
        }

        // ---- capture integrity ----------------------------------------------
        const rawExceptPackets = rawExceptions.length;
        const rawExceptRtnPackets = rawRetIdx.length;
        const exceptionReturnDeficit = rawExceptPackets > 0
            ? rawExceptPackets - rawExceptRtnPackets
            : exceptionElementCount - exceptionRetElementCount;
        const deadBytes = deadRanges.reduce((a, r) => a + (r.to - r.from), 0);
        const traceByteLength = lastIdxSeen;

        const captureHealthy = badPacketCount === 0
            && malformedSyncCount === 0
            && desyncEvents.length === 0
            && droppedReturns === 0
            && pairMismatches === 0;

        const verdictParts: string[] = [];
        if (captureHealthy) {
            verdictParts.push('No capture faults detected: every packet decoded cleanly, the decoder never lost synchronisation, and every exception paired with a matching return.');
        } else {
            verdictParts.push('CAPTURE FAULTS DETECTED - this trace is incomplete and the figures below cover only the decodable parts.');
            if (badPacketCount > 0) {
                verdictParts.push(`${badPacketCount} malformed packet(s) were rejected by the protocol decoder.`);
            }
            if (malformedSyncCount > 0) {
                verdictParts.push(`${malformedSyncCount} alignment-sync pattern(s) arrived corrupted. A valid A-Sync is eleven 0x00 bytes followed by 0x80; a short one means bytes were lost on the trace port, which is the clearest evidence of a sampling problem.`);
            }
            if (desyncEvents.length > 0) {
                verdictParts.push(`The instruction decoder lost synchronisation ${desyncEvents.length} time(s) (first at byte ${desyncEvents[0].traceIdx}).`);
            }
            if (deadBytes > 0 && traceByteLength > 0) {
                const pct = ((deadBytes / traceByteLength) * 100).toFixed(1);
                verdictParts.push(`${deadBytes.toLocaleString()} of ${traceByteLength.toLocaleString()} bytes (${pct}%) produced no decoded instructions.`);
            }
            if (droppedReturns > 0) {
                verdictParts.push(`${droppedReturns} exception return(s) were never captured.`);
            }
            if (pairMismatches > 0) {
                verdictParts.push(`${pairMismatches} entry/return pair(s) failed the return-address check.`);
            }
            verdictParts.push('Most likely cause is trace-port sampling margin: check TRACECLK setup/hold at the logic analyser, lower the trace clock, or raise the sample rate.');
        }
        const captureVerdict = verdictParts.join(' ');

        // ---- warnings / self-check ------------------------------------------
        const warnings: string[] = [];
        const recordsWithMissingTs = allExceptions.filter(e => !e.tsComplete).length;

        if (!captureHealthy) {
            warnings.push(captureVerdict);
        }
        if (rawOnlyExceptions > 0) {
            warnings.push(`${rawOnlyExceptions} of ${allExceptions.length} exceptions were recovered from raw I_EXCEPT packets because the instruction decoder produced no EXCEPTION element for them. They are listed with timing "N/A" - they did occur, but their duration cannot be measured from this capture.`);
        }
        if (exceptionReturnDeficit > 0) {
            const openAtEot = allExceptions.filter(e => e.closure === 'no-return-eot').length;
            const desynced = allExceptions.filter(e => e.closure === 'no-return-desync').length;
            const parts = [`${rawExceptPackets || exceptionElementCount} exceptions were seen but only ${rawExceptRtnPackets || exceptionRetElementCount} returns - ${exceptionReturnDeficit} exception(s) never returned.`];
            if (droppedReturns > 0) {
                parts.push(`${droppedReturns} is/are confirmed LOST RETURNS: the same vector was taken again while still active, which the hardware cannot do, so the EXCEPTION_RET packet was not captured.`);
            }
            if (desynced > 0) {
                parts.push(`${desynced} fell in a byte range where the decoder was out of sync, so the return cannot be confirmed either way.`);
            }
            if (openAtEot > 0) {
                parts.push(`${openAtEot} was/were still running when the trace ended, which is expected and benign.`);
            }
            warnings.push(parts.join(' '));
        } else if (exceptionReturnDeficit < 0) {
            warnings.push(`${Math.abs(exceptionReturnDeficit)} more exception returns than exceptions were seen. The capture began inside one or more handlers, or entry packets were lost.`);
        }
        if (exceptionElementCount !== allExceptions.length && rawExceptPackets === 0) {
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
            warnings.push(`Clock calibration failed: the trace shows ${tsPerCycleRatio} timestamp ticks per core cycle, but Core = ${coreFreqMhz} MHz with TSG = ${tsFreqMhz} MHz implies ${parseFloat(expectedRatio.toFixed(6))} (off by ${(ratioError! * 100).toFixed(1)}%). Correct the Core Clock or Timestamp Clock field - all µs and cycle figures are unreliable until you do.`);
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
            if (e.cycles !== null) totalIsrCycles += e.cycles;
            if (e.isrDurationUs !== null) totalIsrDurationUs += e.isrDurationUs;
            totalIsrInstructions += e.instructions;
        });

        const avgIsrCycles = timed.length > 0 ? parseFloat((totalIsrCycles / timed.length).toFixed(1)) : 0;
        const timedCountAll = timed.length;
        const avgIsrInstructions = timedCountAll > 0
            ? parseFloat((totalIsrInstructions / timedCountAll).toFixed(1)) : 0;
        const isrCyclePercentage = totalCycles > 0
            ? parseFloat(((totalIsrCycles / totalCycles) * 100).toFixed(2)) : 0;

        /** Mean of consecutive differences, in ticks. */
        const meanPeriodUs = (stamps: bigint[]): number | null => {
            if (stamps.length < 2) return null;
            let sum = 0;
            for (let i = 1; i < stamps.length; i++) sum += Number(stamps[i] - stamps[i - 1]);
            return ticksToUs(sum / (stamps.length - 1));
        };

        interface TypeAcc {
            typeName: string;
            excepNum: string;
            count: number;
            totalCycles: number;
            totalInstructions: number;
            totalDurationUs: number;
            timedCount: number;
            minDurationUs: number | null;
            maxDurationUs: number | null;
            maxCycles: number | null;
            maxInstructions: number;
        }
        const isrTypeMap: { [key: string]: TypeAcc } = {};

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
            if (e.instructions > g.maxInstructions) g.maxInstructions = e.instructions;
            if (e.isrDurationUs !== null && e.cycles !== null) {
                g.timedCount++;
                g.totalCycles += e.cycles;
                g.totalDurationUs += e.isrDurationUs;
                if (g.minDurationUs === null || e.isrDurationUs < g.minDurationUs) g.minDurationUs = e.isrDurationUs;
                if (g.maxDurationUs === null || e.isrDurationUs > g.maxDurationUs) g.maxDurationUs = e.isrDurationUs;
                if (g.maxCycles === null || e.cycles > g.maxCycles) g.maxCycles = e.cycles;
            }
        });

        const r1 = (v: number) => parseFloat(v.toFixed(1));
        const r3 = (v: number) => parseFloat(v.toFixed(3));

        const isrBreakdown: IsrTypeBreakdown[] = Object.values(isrTypeMap)
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

        // Problem records are never sampled away: an exception that did not
        // return, or whose pair failed validation, is always listed.
        const problemExceptions = allExceptions.filter(e => e.closure !== 'returned' || !e.pairOk);
        const sampleExceptions: ExceptionRecord[] = [];
        if (allExceptions.length <= 15) {
            sampleExceptions.push(...allExceptions);
        } else {
            const picked = new Set<ExceptionRecord>();
            allExceptions.slice(0, 6).forEach(e => picked.add(e));
            const mid = Math.floor(allExceptions.length / 2);
            picked.add(allExceptions[mid]);
            if (allExceptions[mid + 1]) picked.add(allExceptions[mid + 1]);
            allExceptions.slice(-4).forEach(e => picked.add(e));
            problemExceptions.slice(0, 40).forEach(e => picked.add(e));
            sampleExceptions.push(...Array.from(picked).sort((a, b) => a.index - b.index));
        }

        const reportData: TraceReportData = {
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

            rawExceptPackets,
            rawExceptRtnPackets,
            exceptionReturnDeficit,
            rawOnlyExceptions,
            unreturnedExceptions,
            droppedReturns,
            pairMismatches,

            badPacketCount,
            malformedSyncCount,
            desyncEvents,
            decoderErrors: decoderErrors.slice(0, 20),
            deadRanges,
            deadBytes,
            traceByteLength,
            captureHealthy,
            captureVerdict,

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
        } catch (e) {}

        return { mdPath, htmlPath, data: reportData };
    }

    // ---- formatting helpers -------------------------------------------------

    private static us(v: number | null, digits = 3): string {
        return v === null ? 'N/A' : `${v.toFixed(digits)} µs`;
    }

    private static cyc(v: number | null): string {
        return v === null ? 'N/A' : Math.round(v).toLocaleString();
    }

    private static hex(v: bigint | null): string {
        return v !== null ? '0x' + v.toString(16).toUpperCase() : 'N/A';
    }

    /** Describes the undecodable span a desync event belongs to. */
    private static deadSpanFor(
        traceIdx: number,
        ranges: { from: number; to: number }[]
    ): string {
        const own = ranges.find(r => r.from === traceIdx);
        if (own) return `byte ${own.to.toLocaleString()} (${(own.to - own.from).toLocaleString()} bytes lost)`;
        const enclosing = ranges.find(r => traceIdx > r.from && traceIdx <= r.to);
        if (enclosing) {
            return `already inside the ${enclosing.from.toLocaleString()}-${enclosing.to.toLocaleString()} gap`;
        }
        return 'recovered immediately';
    }

    private static closureLabel(e: ExceptionRecord): string {
        switch (e.closure) {
            case 'returned': return e.pairOk ? 'returned' : 'returned (PAIR MISMATCH)';
            case 'no-return-dropped': return 'NO RETURN - lost packet';
            case 'no-return-desync': return 'NO RETURN - decoder desync';
            case 'no-return-eot': return 'no return - trace ended';
        }
    }

    private static renderMarkdownReport(d: TraceReportData): string {
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

        md += `## 3. Capture Integrity\n\n`;
        md += `> **${d.captureHealthy ? 'PASS' : 'FAIL'}** &mdash; ${d.captureVerdict}\n\n`;
        md += `| Check | Value | Meaning |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **Malformed packets** | **${d.badPacketCount.toLocaleString()}** | Bytes the protocol decoder could not parse |\n`;
        md += `| **Corrupted sync patterns** | **${d.malformedSyncCount}** | A-Sync must be 11&times;\`0x00\` + \`0x80\`; short ones mean dropped bytes |\n`;
        md += `| **Decoder desynchronisations** | **${d.desyncEvents.length}** | Times the instruction decoder gave up and restarted |\n`;
        md += `| **Undecodable byte ranges** | **${d.deadBytes.toLocaleString()} / ${d.traceByteLength.toLocaleString()}** | ${d.traceByteLength > 0 ? ((d.deadBytes / d.traceByteLength) * 100).toFixed(1) : '0'}% of the capture produced no instructions |\n`;
        md += `| **Exceptions vs returns** | **${d.rawExceptPackets || d.exceptionElementCount} / ${d.rawExceptRtnPackets || d.exceptionRetElementCount}** | Deficit of ${d.exceptionReturnDeficit} |\n`;
        md += `| **Confirmed lost returns** | **${d.droppedReturns}** | Same vector re-entered while active - impossible in hardware |\n`;
        md += `| **Failed pair validations** | **${d.pairMismatches}** | Resume address did not match the preferred return address |\n\n`;

        if (d.desyncEvents.length > 0) {
            md += `### Desynchronisation Events\n\n`;
            md += `| Byte | Reason | Undecodable span |\n`;
            md += `| :--- | :--- | :--- |\n`;
            d.desyncEvents.forEach(ev => {
                md += `| ${ev.traceIdx.toLocaleString()} | \`${ev.reason}\` | ${this.deadSpanFor(ev.traceIdx, d.deadRanges)} |\n`;
            });
            md += `\n`;
        }
        if (d.decoderErrors.length > 0) {
            md += `### Decoder Errors\n\n`;
            md += `| Byte | Code | Detail |\n`;
            md += `| :--- | :--- | :--- |\n`;
            d.decoderErrors.forEach(e => {
                md += `| ${e.traceIdx !== null ? e.traceIdx.toLocaleString() : 'N/A'} | \`${e.code}\` | ${e.text} |\n`;
            });
            md += `\n`;
        }
        md += `---\n\n`;

        md += `## 4. Hardware Timestamps & Active Window Duration\n\n`;
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

        md += `## 5. Exception & IRQ Service Routine Analysis\n\n`;
        md += `ISR duration is measured from the **entry timestamp** (first \`TIMESTAMP\` inside the handler, which the ETM emits in response to the exception) to the **exit timestamp** (first \`TIMESTAMP\` after \`EXCEPTION_RET\`). This span includes the exception entry latency but excludes the unstacking that follows the return, so it is a **lower bound** on the interference seen by the preempted thread.\n\n`;
        md += `| Metric | Value | Description |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **\`I_EXCEPT\` / \`I_EXCEPT_RTN\` packets** | **${d.rawExceptPackets} / ${d.rawExceptRtnPackets}** | Raw protocol layer - independent of the instruction decoder |\n`;
        md += `| **\`EXCEPTION\` / \`EXCEPTION_RET\` elements** | **${d.exceptionElementCount} / ${d.exceptionRetElementCount}** | Fully decoded, carry timing |\n`;
        md += `| **Records produced** | **${d.exceptionsCount}** | ${d.exceptionsCount >= Math.max(d.rawExceptPackets, d.exceptionElementCount) ? 'Every exception is reported' : '**MISMATCH - see warnings**'} |\n`;
        md += `| **Recovered from raw packets only** | **${d.rawOnlyExceptions}** | Occurred, but no timing recoverable |\n`;
        md += `| **Exceptions that never returned** | **${d.unreturnedExceptions}** | ${d.droppedReturns} confirmed lost return(s) |\n`;
        md += `| **Failed pair validations** | **${d.pairMismatches}** | Checked by vector and return address |\n`;
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

        const problems = d.allExceptions.filter(e => e.closure !== 'returned' || !e.pairOk);
        if (problems.length > 0) {
            md += `### Unpaired / Suspect Exceptions (all ${problems.length} listed)\n\n`;
            md += `| # | Byte | Vector | Status | Pref. Return | Resumed At | Diagnosis |\n`;
            md += `| :-: | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
            problems.forEach(e => {
                md += `| ${e.index} | ${e.traceIdx !== null ? e.traceIdx.toLocaleString() : 'N/A'} | ${e.type} | **${this.closureLabel(e)}** | \`${e.prefRetAddr || 'N/A'}\` | \`${e.resumeAddr || 'N/A'}\` | ${e.pairNote || '-'} |\n`;
            });
            md += `\n`;
        }

        md += `### Timestamps Before and After IRQ Service Routines\n\n`;
        md += `| # | Type | Src | Status | D | Pre-IRQ TS | Entry TS | Exit TS | &Delta;TS | Duration | Cycles | Instrs | Ovh |\n`;
        md += `| :-: | :--- | :-: | :--- | :-: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |\n`;
        d.sampleExceptions.forEach(e => {
            const flag = (e.closure === 'returned' && e.pairOk) ? '' : ' ⚠';
            md += `| ${e.index}${flag} | ${e.type} | ${e.source === 'raw' ? 'raw' : 'dec'} | ${this.closureLabel(e)} | ${e.depth} | \`${this.hex(e.preTs)}\` | \`${this.hex(e.entryTs)}\` | \`${this.hex(e.exitTs)}\` | ${e.durationTicks !== null ? e.durationTicks : 'N/A'} | **${this.us(e.isrDurationUs)}** | ${this.cyc(e.cycles)} | ${e.instructions}${e.instructionsInclusive !== e.instructions ? ` (${e.instructionsInclusive})` : ''} | ${e.estEntryOverheadCycles !== null ? e.estEntryOverheadCycles : 'N/A'} |\n`;
        });
        md += `\n*Every exception that did not return cleanly is listed above and in the sample below. Total occurrences: ${d.exceptionsCount}. "Src" is \`dec\` for a fully decoded exception and \`raw\` for one recovered from protocol packets after a decoder desync (no timing available). "D" is nesting depth; a bracketed instruction count is the inclusive figure. "Ovh" is \`cycles − instructions × CPI\`, an estimate of exception entry latency.*\n\n`;
        md += `---\n\n`;

        md += `## 6. Execution Hotspots (Address Distribution)\n\n`;
        md += `| Rank | Address Range | Instructions Executed | % Share |\n`;
        md += `| :-: | :--- | :---: | :---: |\n`;
        d.hotspots.forEach((h, idx) => {
            md += `| ${idx + 1} | \`${h.address}\` | ${h.count.toLocaleString()} | ${h.percentage}% |\n`;
        });
        md += `\n*Instructions are attributed to the start address of each decoded \`exec range\`, not to individual addresses.*\n`;

        return md;
    }

    private static renderHtmlReport(d: TraceReportData): string {
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

        <div class="card"${d.captureHealthy ? '' : ' style="border-color: rgba(248,81,73,0.6);"'}>
            <h2 style="font-size: 15px; margin-bottom: 12px; color: ${d.captureHealthy ? 'var(--heading)' : 'var(--red)'};">
                3. Capture Integrity &mdash; ${d.captureHealthy ? '<span style="color:var(--green)">PASS</span>' : '<span style="color:var(--red)">FAIL</span>'}
            </h2>
            <div class="verdict" style="border-left-color: ${d.captureHealthy ? 'var(--green)' : 'var(--red)'}; background: ${d.captureHealthy ? 'rgba(63,185,80,0.07)' : 'rgba(248,81,73,0.07)'};">${d.captureVerdict}</div>
            <table>
                <tbody>
                    <tr><td style="width: 35%;"><strong>Malformed packets</strong></td><td><b>${d.badPacketCount.toLocaleString()}</b> &mdash; bytes the protocol decoder could not parse</td></tr>
                    <tr><td><strong>Corrupted sync patterns</strong></td><td><b>${d.malformedSyncCount}</b> &mdash; a valid A-Sync is 11&times;<code>0x00</code> + <code>0x80</code>; a short one means bytes were lost</td></tr>
                    <tr><td><strong>Decoder desynchronisations</strong></td><td><b>${d.desyncEvents.length}</b></td></tr>
                    <tr><td><strong>Undecodable byte ranges</strong></td><td><b>${d.deadBytes.toLocaleString()}</b> of ${d.traceByteLength.toLocaleString()} bytes (${d.traceByteLength > 0 ? ((d.deadBytes / d.traceByteLength) * 100).toFixed(1) : '0'}%)</td></tr>
                    <tr><td><strong>Exceptions vs returns</strong></td><td><b>${d.rawExceptPackets || d.exceptionElementCount} / ${d.rawExceptRtnPackets || d.exceptionRetElementCount}</b> &mdash; deficit ${d.exceptionReturnDeficit}</td></tr>
                    <tr><td><strong>Confirmed lost returns</strong></td><td><b style="color:${d.droppedReturns > 0 ? 'var(--red)' : 'inherit'}">${d.droppedReturns}</b> &mdash; same vector re-entered while active, impossible in hardware</td></tr>
                    <tr><td><strong>Failed pair validations</strong></td><td><b style="color:${d.pairMismatches > 0 ? 'var(--red)' : 'inherit'}">${d.pairMismatches}</b> &mdash; resume address did not match the preferred return address</td></tr>
                </tbody>
            </table>
            ${d.desyncEvents.length === 0 ? '' : `
            <h3 style="font-size: 13px; margin: 18px 0 10px 0; color: var(--heading);">Desynchronisation Events:</h3>
            <table>
                <thead><tr><th>Byte</th><th>Reason</th><th>Undecodable span</th></tr></thead>
                <tbody>
                    ${d.desyncEvents.map(ev =>
                        `<tr><td><code>${ev.traceIdx.toLocaleString()}</code></td><td><code>${ev.reason}</code></td><td>${this.deadSpanFor(ev.traceIdx, d.deadRanges)}</td></tr>`
                    ).join('')}
                </tbody>
            </table>`}
            ${d.decoderErrors.length === 0 ? '' : `
            <h3 style="font-size: 13px; margin: 18px 0 10px 0; color: var(--heading);">Decoder Errors:</h3>
            <table>
                <thead><tr><th>Byte</th><th>Code</th><th>Detail</th></tr></thead>
                <tbody>
                    ${d.decoderErrors.map(e => `<tr><td><code>${e.traceIdx !== null ? e.traceIdx.toLocaleString() : 'N/A'}</code></td><td><code>${e.code}</code></td><td>${e.text}</td></tr>`).join('')}
                </tbody>
            </table>`}
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">4. Hardware Timestamps &amp; Window Timing</h2>
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
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">5. Interrupt &amp; Exception Handling Performance</h2>
            <p class="note" style="margin-top:0;">
                ISR duration spans the <b>entry timestamp</b> (first <code>TIMESTAMP</code> inside the handler, emitted by the ETM in response to the exception)
                to the <b>exit timestamp</b> (first <code>TIMESTAMP</code> after <code>EXCEPTION_RET</code>).
                It <b>includes</b> exception entry latency and <b>excludes</b> the unstacking after the return, so it is a
                <b>lower bound</b> on the interference seen by the preempted thread.
            </p>
            <table>
                <tbody>
                    <tr><td style="width: 35%;"><strong><code>I_EXCEPT</code> / <code>I_EXCEPT_RTN</code> packets</strong></td><td>${d.rawExceptPackets} / ${d.rawExceptRtnPackets} &mdash; raw protocol layer, independent of the instruction decoder</td></tr>
                    <tr><td><strong><code>EXCEPTION</code> / <code>EXCEPTION_RET</code> elements</strong></td><td>${d.exceptionElementCount} / ${d.exceptionRetElementCount} &mdash; fully decoded, carry timing</td></tr>
                    <tr><td><strong>Records produced</strong></td><td><b>${d.exceptionsCount}</b> ${d.exceptionsCount >= Math.max(d.rawExceptPackets, d.exceptionElementCount) ? '&mdash; every exception is reported' : '&mdash; <span style="color:var(--red)">MISMATCH</span>'}</td></tr>
                    <tr><td><strong>Recovered from raw packets only</strong></td><td>${d.rawOnlyExceptions} &mdash; occurred, but no timing recoverable</td></tr>
                    <tr><td><strong>Exceptions that never returned</strong></td><td><b style="color:${d.unreturnedExceptions > 0 ? 'var(--orange)' : 'inherit'}">${d.unreturnedExceptions}</b> &mdash; ${d.droppedReturns} confirmed lost return(s)</td></tr>
                    <tr><td><strong>Failed pair validations</strong></td><td><b style="color:${d.pairMismatches > 0 ? 'var(--red)' : 'inherit'}">${d.pairMismatches}</b> &mdash; checked by vector and return address</td></tr>
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

            ${(() => {
                const problems = d.allExceptions.filter(e => e.closure !== 'returned' || !e.pairOk);
                if (problems.length === 0) {
                    return '<p class="note" style="color: var(--green);">Every exception paired with a matching return, validated by vector and return address.</p>';
                }
                return `
            <h3 style="font-size: 13px; margin: 18px 0 10px 0; color: var(--red);">Unpaired / Suspect Exceptions &mdash; all ${problems.length} listed:</h3>
            <div class="scroll">
            <table>
                <thead><tr><th>#</th><th>Byte</th><th>Vector</th><th>Status</th><th>Pref. Return</th><th>Resumed At</th><th>Diagnosis</th></tr></thead>
                <tbody>
                    ${problems.map(e => `
                        <tr style="background: rgba(248,81,73,0.08);">
                            <td>${e.index}</td>
                            <td><code>${e.traceIdx !== null ? e.traceIdx.toLocaleString() : 'N/A'}</code></td>
                            <td><span style="color: var(--purple); font-weight: 600;">${e.type}</span></td>
                            <td><b style="color: var(--red);">${this.closureLabel(e)}</b></td>
                            <td><code>${e.prefRetAddr || 'N/A'}</code></td>
                            <td><code>${e.resumeAddr || 'N/A'}</code></td>
                            <td style="font-size:12px;">${e.pairNote || '-'}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
            })()}

            <h3 style="font-size: 13px; margin: 18px 0 10px 0; color: var(--heading);">Timestamps Before and After IRQ Service Routines:</h3>
            <div class="scroll">
            <table>
                <thead>
                    <tr>
                        <th>#</th><th>Type</th><th>Src</th><th>Status</th><th>Depth</th><th>Pre-IRQ TS</th><th>Entry TS</th><th>Exit TS</th>
                        <th>&Delta;TS (ticks)</th><th>Duration</th><th>Cycles</th><th>Instrs</th><th>Est. Entry Ovh</th>
                    </tr>
                </thead>
                <tbody>
                    ${d.sampleExceptions.map(e => {
                        const ok = e.closure === 'returned' && e.pairOk;
                        return `
                        <tr${ok ? '' : ' style="background: rgba(248,81,73,0.08);"'}>
                            <td>${e.index}${ok ? '' : ' &#9888;'}</td>
                            <td><span style="color: var(--purple); font-weight: 600;">${e.type}</span></td>
                            <td><code>${e.source === 'raw' ? 'raw' : 'dec'}</code></td>
                            <td${ok ? '' : ' style="color: var(--red); font-weight: 600;"'}>${this.closureLabel(e)}</td>
                            <td>${e.depth}</td>
                            <td><code>${this.hex(e.preTs)}</code></td>
                            <td><code>${this.hex(e.entryTs)}</code></td>
                            <td><code>${this.hex(e.exitTs)}</code></td>
                            <td>${e.durationTicks !== null ? e.durationTicks : 'N/A'}</td>
                            <td><b>${this.us(e.isrDurationUs)}</b></td>
                            <td>${this.cyc(e.cycles)}</td>
                            <td>${e.instructions}${e.instructionsInclusive !== e.instructions ? ` <span style="color:var(--muted)">(${e.instructionsInclusive})</span>` : ''}</td>
                            <td>${e.estEntryOverheadCycles !== null ? e.estEntryOverheadCycles : 'N/A'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>
            <p class="note">
                Every exception that did not return cleanly is listed above and included below. Total exception occurrences: ${d.exceptionsCount}.
                &ldquo;Src&rdquo; is <code>dec</code> for a fully decoded exception and <code>raw</code> for one recovered from protocol packets after a decoder desync (no timing available).
                A bracketed instruction count is the inclusive figure (this handler plus anything that preempted it).
                &ldquo;Est. Entry Ovh&rdquo; is <code>cycles &minus; instructions &times; CPI</code>, an estimate of exception entry latency.
            </p>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">6. Execution Hotspots (Address Distribution)</h2>
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
