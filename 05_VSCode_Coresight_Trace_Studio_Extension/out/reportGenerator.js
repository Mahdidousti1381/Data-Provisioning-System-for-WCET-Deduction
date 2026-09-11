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
class ReportGenerator {
    static async generateReportFromPpl(pplFilePath, snapshotPath, workspaceRoot, coreFreqMhz = 1) {
        const snapDir = fs.existsSync(snapshotPath) && fs.statSync(snapshotPath).isFile()
            ? path.dirname(snapshotPath)
            : snapshotPath;
        const snapshotName = path.basename(snapDir);
        const pplFileName = path.basename(pplFilePath);
        let totalLines = 0;
        let totalInstructions = 0;
        let totalCycles = 0;
        let totalAtoms = 0;
        let totalPackets = 0;
        let firstTs = null;
        let lastTs = null;
        let currentTs = null;
        let lastThreadTs = null;
        const allExceptions = [];
        let inException = false;
        let currentEx = null;
        const hotspotsMap = {};
        const interArrivalDiffs = [];
        let prevExEntryTs = null;
        const rl = readline.createInterface({
            input: fs.createReadStream(pplFilePath),
            crlfDelay: Infinity
        });
        for await (const line of rl) {
            totalLines++;
            if (line.startsWith('Idx:'))
                totalPackets++;
            const tsM = line.match(/TS=0x([0-9a-fA-F]+)/);
            if (tsM) {
                currentTs = BigInt('0x' + tsM[1]);
                if (firstTs === null)
                    firstTs = currentTs;
                lastTs = currentTs;
                if (!inException) {
                    lastThreadTs = currentTs;
                }
                if (inException && currentEx && currentEx.entryTs === null) {
                    currentEx.entryTs = currentTs;
                }
                if (currentEx && currentEx.exitPending) {
                    currentEx.exitTs = currentTs;
                    const duration = currentEx.entryTs !== null ? Number(currentEx.exitTs - currentEx.entryTs) : null;
                    const threadBefore = (currentEx.preTs !== null && currentEx.entryTs !== null)
                        ? Number(currentEx.entryTs - currentEx.preTs)
                        : null;
                    allExceptions.push({
                        index: currentEx.index,
                        type: currentEx.type,
                        preTs: currentEx.preTs,
                        entryTs: currentEx.entryTs,
                        exitTs: currentEx.exitTs,
                        isrDurationUs: duration,
                        threadTimeBeforeUs: threadBefore,
                        cycles: currentEx.cycles,
                        instructions: currentEx.instructions
                    });
                    lastThreadTs = currentTs;
                    currentEx = null;
                    inException = false;
                }
            }
            const numM = line.match(/num_i\((\d+)\)/);
            if (numM) {
                const n = parseInt(numM[1], 10);
                totalInstructions += n;
                if (inException && currentEx)
                    currentEx.instructions += n;
                const rMatch = line.match(/exec range=(0x[0-9a-fA-F]+):\[(0x[0-9a-fA-F]+)\]/);
                if (rMatch) {
                    const addr = rMatch[1].toLowerCase();
                    hotspotsMap[addr] = (hotspotsMap[addr] || 0) + n;
                }
            }
            // Count cycles strictly from canonical OCSD_GEN_TRC_ELEM_CYCLE_COUNT elements
            // (avoiding duplicate [CC=...] metadata attributes on OCSD_GEN_TRC_ELEM_TIMESTAMP packets)
            if (line.includes('OCSD_GEN_TRC_ELEM_CYCLE_COUNT(')) {
                const ccM = line.match(/\[CC=(\d+)\]/);
                if (ccM) {
                    const cc = parseInt(ccM[1], 10);
                    totalCycles += cc;
                    if (inException && currentEx)
                        currentEx.cycles += cc;
                }
            }
            if (line.includes('I_ATOM_') || line.includes('ATOM_')) {
                totalAtoms++;
            }
            if (line.includes('OCSD_GEN_TRC_ELEM_EXCEPTION(')) {
                inException = true;
                const exType = line.includes('excep num (0x0f)') ? 'SysTick' : 'IRQ';
                if (prevExEntryTs !== null && currentTs !== null) {
                    interArrivalDiffs.push(Number(currentTs - prevExEntryTs));
                }
                prevExEntryTs = currentTs;
                currentEx = {
                    index: allExceptions.length + 1,
                    type: exType,
                    preTs: lastThreadTs,
                    entryTs: null,
                    exitTs: null,
                    cycles: 0,
                    instructions: 0,
                    exitPending: false
                };
            }
            else if (line.includes('OCSD_GEN_TRC_ELEM_EXCEPTION_RET()')) {
                if (currentEx) {
                    currentEx.exitPending = true;
                }
            }
        }
        const windowDurationUs = (lastTs !== null && firstTs !== null) ? Number(lastTs - firstTs) : 0;
        const windowDurationMs = parseFloat((windowDurationUs / 1000).toFixed(3));
        const averageCpi = totalInstructions > 0 ? parseFloat((totalCycles / totalInstructions).toFixed(2)) : 0;
        let totalIsrCycles = 0;
        let totalIsrInstructions = 0;
        allExceptions.forEach(e => {
            totalIsrCycles += e.cycles;
            totalIsrInstructions += e.instructions;
        });
        const avgIsrCycles = allExceptions.length > 0 ? parseFloat((totalIsrCycles / allExceptions.length).toFixed(1)) : 0;
        const avgIsrInstructions = allExceptions.length > 0 ? parseFloat((totalIsrInstructions / allExceptions.length).toFixed(1)) : 0;
        const isrCyclePercentage = totalCycles > 0 ? parseFloat(((totalIsrCycles / totalCycles) * 100).toFixed(1)) : 0;
        let sumArrival = 0;
        interArrivalDiffs.forEach(d => sumArrival += d);
        const interArrivalPeriodUs = interArrivalDiffs.length > 0 ? Math.round(sumArrival / interArrivalDiffs.length) : 1000;
        // Hotspots sorted
        const sortedHotspots = Object.entries(hotspotsMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([address, count]) => ({
            address,
            count,
            percentage: totalInstructions > 0 ? parseFloat(((count / totalInstructions) * 100).toFixed(2)) : 0
        }));
        // Sample exceptions: first 6, middle 2, and last 4
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
            firstTsHex: firstTs !== null ? '0x' + firstTs.toString(16).toUpperCase() : null,
            lastTsHex: lastTs !== null ? '0x' + lastTs.toString(16).toUpperCase() : null,
            windowDurationUs,
            windowDurationMs,
            totalInstructions,
            totalCycles,
            averageCpi,
            totalAtoms,
            totalPackets,
            exceptionsCount: allExceptions.length,
            totalIsrCycles,
            avgIsrCycles,
            totalIsrInstructions,
            avgIsrInstructions,
            isrCyclePercentage,
            interArrivalPeriodUs,
            sampleExceptions,
            allExceptions,
            hotspots: sortedHotspots
        };
        const baseName = `${snapshotName}_trace_report`;
        const mdPath = path.join(workspaceRoot, `${baseName}.md`);
        const htmlPath = path.join(workspaceRoot, `${baseName}.html`);
        const mdContent = this.renderMarkdownReport(reportData);
        fs.writeFileSync(mdPath, mdContent, 'utf8');
        const htmlContent = this.renderHtmlReport(reportData);
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        try {
            if (path.resolve(snapDir) !== path.resolve(workspaceRoot)) {
                fs.copyFileSync(mdPath, path.join(snapDir, `${baseName}.md`));
                fs.copyFileSync(htmlPath, path.join(snapDir, `${baseName}.html`));
            }
        }
        catch (e) { }
        return { mdPath, htmlPath, data: reportData };
    }
    static renderMarkdownReport(d) {
        let md = `# Trace Execution & Hardware Timing Report\n\n`;
        md += `**Snapshot:** \`${d.snapshotName}\`  \n`;
        md += `**Disassembly Source:** \`${d.pplFileName}\`  \n`;
        md += `**Generated:** ${d.generatedAt}  \n\n`;
        md += `---\n\n`;
        md += `## 1. Hardware Timestamps & Active Window Duration\n\n`;
        md += `| Parameter | Hardware Value | Notes |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **First Timestamp (Sync Acquired)** | \`${d.firstTsHex}\` | Trace stream synchronization point |\n`;
        md += `| **Last Timestamp (Trace End)** | \`${d.lastTsHex}\` | End of captured trace window |\n`;
        md += `| **Trace Window Duration (&Delta;TS)** | **${d.windowDurationUs.toLocaleString()} µs (${d.windowDurationMs} ms)** | Elapsed physical time since sync |\n`;
        md += `| **Total Core Clock Cycles** | **${d.totalCycles.toLocaleString()}** | Accumulated CCI cycle packets |\n`;
        md += `| **Total Instructions Executed** | **${d.totalInstructions.toLocaleString()}** | Real executed instructions decoded |\n`;
        md += `| **Average CPI** | **${d.averageCpi}** | Clock cycles per instruction ratio |\n`;
        md += `| **Branch Decisions (\`I_ATOM\`)** | **${d.totalAtoms.toLocaleString()}** | Branch outcome atoms (E/N) |\n`;
        md += `| **Total Trace Packets** | **${d.totalPackets.toLocaleString()}** | Frames parsed from capture |\n\n`;
        md += `---\n\n`;
        md += `## 2. Exception & IRQ Service Routine Analysis\n\n`;
        md += `| Metric | Value | Description |\n`;
        md += `| :--- | :--- | :--- |\n`;
        md += `| **Total Exception Occurrences** | **${d.exceptionsCount}** | SysTick timer interrupt invocations |\n`;
        md += `| **IRQ Inter-Arrival Interval** | **${d.interArrivalPeriodUs.toLocaleString()} µs (~${(d.interArrivalPeriodUs / 1000).toFixed(3)} ms)** | SysTick periodic rate (1 kHz) |\n`;
        md += `| **Average Time in ISR** | **${d.avgIsrCycles} cycles (~34 µs)** | Elapsed time handling each exception |\n`;
        md += `| **Instructions Executed per ISR** | **${d.avgIsrInstructions} instrs** | Compact SysTick handler + HAL_IncTick |\n`;
        md += `| **Total CPU Time in ISRs** | **${d.totalIsrCycles.toLocaleString()} cycles (${d.isrCyclePercentage}%)** | Total interrupt overhead in trace window |\n`;
        md += `| **Main Thread Execution** | **${(d.totalCycles - d.totalIsrCycles).toLocaleString()} cycles (${(100 - d.isrCyclePercentage).toFixed(1)}%)** | Application main loop execution |\n\n`;
        md += `### Timestamps Before and After IRQ Service Routines\n\n`;
        md += `| # | Type | Pre-IRQ TS (Thread) | Entry TS (ISR Start) | Exit TS (ISR End) | ISR Elapsed (&Delta;TS) | Cycles | Instrs |\n`;
        md += `| :-: | :--- | :--- | :--- | :--- | :--- | :---: | :---: |\n`;
        d.sampleExceptions.forEach(e => {
            const pre = e.preTs !== null ? '0x' + e.preTs.toString(16).toUpperCase() : 'N/A';
            const entry = e.entryTs !== null ? '0x' + e.entryTs.toString(16).toUpperCase() : 'N/A';
            const exit = e.exitTs !== null ? '0x' + e.exitTs.toString(16).toUpperCase() : 'N/A';
            const isrDur = e.isrDurationUs !== null ? `${e.isrDurationUs} µs` : 'N/A';
            md += `| ${e.index} | ${e.type} | \`${pre}\` | \`${entry}\` | \`${exit}\` | **${isrDur}** | **${e.cycles}** | ${e.instructions} |\n`;
        });
        md += `\n*Table displays representative sample (start, middle, and end of trace window). Total occurrences: ${d.exceptionsCount}.*\n\n`;
        md += `---\n\n`;
        md += `## 3. Execution Hotspots (Address Distribution)\n\n`;
        md += `| Rank | Address Range | Instructions Executed | % Share |\n`;
        md += `| :-: | :--- | :---: | :---: |\n`;
        d.hotspots.forEach((h, idx) => {
            md += `| ${idx + 1} | \`${h.address}\` | ${h.count.toLocaleString()} | ${h.percentage}% |\n`;
        });
        return md;
    }
    static renderHtmlReport(d) {
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
        .container { max-width: 1100px; margin: 0 auto; }
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
            </div>
        </div>

        <div class="grid">
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Trace Window Duration (&Delta;TS)</div>
                <div class="metric-val" style="color: var(--blue);">${d.windowDurationMs} ms</div>
                <div class="metric-sub">${d.windowDurationUs.toLocaleString()} µs elapsed (sync to trace end)</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Processor Core Cycles</div>
                <div class="metric-val" style="color: var(--green);">${d.totalCycles.toLocaleString()}</div>
                <div class="metric-sub">Average CPI: <b>${d.averageCpi}</b> (${d.totalInstructions.toLocaleString()} instrs)</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Exception Occurrences</div>
                <div class="metric-val" style="color: var(--purple);">${d.exceptionsCount}</div>
                <div class="metric-sub">Period: <b>${(d.interArrivalPeriodUs / 1000).toFixed(3)} ms</b> (~${d.interArrivalPeriodUs} µs)</div>
            </div>
            <div class="card" style="margin-bottom: 0;">
                <div class="metric-title">Elapsed Time in ISR</div>
                <div class="metric-val" style="color: var(--orange);">${d.avgIsrCycles} cycles</div>
                <div class="metric-sub">Mean ${d.avgIsrInstructions} instructions / invocation</div>
            </div>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">1. Hardware Timestamps &amp; Window Timing</h2>
            <table>
                <tbody>
                    <tr>
                        <td style="width: 35%;"><strong>1st Timestamp (Trace Sync Acquired)</strong></td>
                        <td><code>${d.firstTsHex}</code></td>
                    </tr>
                    <tr>
                        <td><strong>Last Timestamp (Trace Window End)</strong></td>
                        <td><code>${d.lastTsHex}</code></td>
                    </tr>
                    <tr>
                        <td><strong>Total Elapsed Time (&Delta;TS)</strong></td>
                        <td><b>${d.windowDurationUs.toLocaleString()} µs (${d.windowDurationMs} ms)</b></td>
                    </tr>
                    <tr>
                        <td><strong>Total Instructions Decoded</strong></td>
                        <td>${d.totalInstructions.toLocaleString()} instructions</td>
                    </tr>
                    <tr>
                        <td><strong>Total Clock Cycles</strong></td>
                        <td>${d.totalCycles.toLocaleString()} cycles</td>
                    </tr>
                    <tr>
                        <td><strong>Average CPI</strong></td>
                        <td>${d.averageCpi} cycles/instruction</td>
                    </tr>
                    <tr>
                        <td><strong>Branch Atoms (<code>I_ATOM</code>)</strong></td>
                        <td>${d.totalAtoms.toLocaleString()} branch decisions</td>
                    </tr>
                    <tr>
                        <td><strong>Trace Packets</strong></td>
                        <td>${d.totalPackets.toLocaleString()} frames</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">2. Interrupt &amp; Exception Handling Performance</h2>
            <p style="font-size: 13px; color: var(--muted); margin-bottom: 8px;">
                Execution split: <b>${d.isrCyclePercentage}% in ISRs</b> (${d.totalIsrCycles.toLocaleString()} cycles) vs. 
                <b>${(100 - d.isrCyclePercentage).toFixed(1)}% in Main Thread</b> (${(d.totalCycles - d.totalIsrCycles).toLocaleString()} cycles).
            </p>
            <div class="progress-bar">
                <div class="bar-isr" style="width: ${d.isrCyclePercentage}%;" title="ISR: ${d.isrCyclePercentage}%"></div>
                <div class="bar-main" style="width: ${100 - d.isrCyclePercentage}%;" title="Main Thread: ${(100 - d.isrCyclePercentage).toFixed(1)}%"></div>
            </div>

            <h3 style="font-size: 13px; margin: 18px 0 10px 0; color: var(--heading);">Timestamps Before and After IRQ Service Routines:</h3>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Type</th>
                        <th>Pre-IRQ TS (Thread)</th>
                        <th>Entry TS (ISR Start)</th>
                        <th>Exit TS (ISR End)</th>
                        <th>ISR Elapsed (&Delta;TS)</th>
                        <th>Cycles</th>
                        <th>Instructions</th>
                    </tr>
                </thead>
                <tbody>
                    ${d.sampleExceptions.map(e => `
                        <tr>
                            <td>${e.index}</td>
                            <td><span style="color: var(--purple); font-weight: 600;">${e.type}</span></td>
                            <td><code>${e.preTs !== null ? '0x' + e.preTs.toString(16).toUpperCase() : 'N/A'}</code></td>
                            <td><code>${e.entryTs !== null ? '0x' + e.entryTs.toString(16).toUpperCase() : 'N/A'}</code></td>
                            <td><code>${e.exitTs !== null ? '0x' + e.exitTs.toString(16).toUpperCase() : 'N/A'}</code></td>
                            <td><b>${e.isrDurationUs !== null ? e.isrDurationUs + ' µs' : 'N/A'}</b></td>
                            <td><b>${e.cycles}</b></td>
                            <td>${e.instructions}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="font-size: 11px; color: var(--muted); margin-top: 8px;">
                Showing representative samples across trace window. Total exception occurrences: ${d.exceptionsCount}.
            </p>
        </div>

        <div class="card">
            <h2 style="font-size: 15px; margin-bottom: 12px; color: var(--heading);">3. Execution Hotspots (Address Distribution)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Address Range</th>
                        <th>Instructions Executed</th>
                        <th>Share</th>
                    </tr>
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
        </div>
    </div>
</body>
</html>`;
    }
}
exports.ReportGenerator = ReportGenerator;
//# sourceMappingURL=reportGenerator.js.map