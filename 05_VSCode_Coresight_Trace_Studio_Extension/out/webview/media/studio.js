// CoreSight Trace Studio - Webview Frontend Client
(function () {
    const vscode = acquireVsCodeApi();

    // DOM Elements - Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    // DOM Elements - Tab 1
    const badgeC = document.getElementById('badgeC');
    const badgeH = document.getElementById('badgeH');
    const badgeInclude = document.getElementById('badgeInclude');
    const btnAddDrivers = document.getElementById('btnAddDrivers');

    const targetSrcFile = document.getElementById('targetSrcFile');
    const btnBrowseSrcFile = document.getElementById('btnBrowseSrcFile');
    const configLine = document.getElementById('configLine');
    const btnInjectConfig = document.getElementById('btnInjectConfig');
    const btnWrapSelection = document.getElementById('btnWrapSelection');
    const fromLine = document.getElementById('fromLine');
    const toLine = document.getElementById('toLine');
    const btnWrapLines = document.getElementById('btnWrapLines');
    const traceModeSelect = document.getElementById('traceModeSelect');
    const btnApplyTraceMode = document.getElementById('btnApplyTraceMode');
    const traceModeHint = document.getElementById('traceModeHint');
    const wrapPairHintSel = document.getElementById('wrapPairHintSel');
    const wrapPairHintLines = document.getElementById('wrapPairHintLines');

    // DOM Elements - Tab 2
    const captureFilePath = document.getElementById('captureFilePath');
    const btnBrowseCapture = document.getElementById('btnBrowseCapture');
    const elfFilePath = document.getElementById('elfFilePath');
    const btnBrowseElf = document.getElementById('btnBrowseElf');

    const coreName = document.getElementById('coreName');
    const coreType = document.getElementById('coreType');
    const initialPC = document.getElementById('initialPC');
    const traceId = document.getElementById('traceId');
    const cycleThreshold = document.getElementById('cycleThreshold');
    const syncPeriod = document.getElementById('syncPeriod');
    const viewInstMode = document.getElementById('viewInstMode');
    const enableCCI = document.getElementById('enableCCI');
    const enableTS = document.getElementById('enableTS');

    const btnApplyEtmConfig = document.getElementById('btnApplyEtmConfig');
    const btnGenerateSnapshot = document.getElementById('btnGenerateSnapshot');
    const snapTerminal = document.getElementById('snapTerminal');
    const btnClearSnapLog = document.getElementById('btnClearSnapLog');

    // DOM Elements - Tab 3
    const decodeSnapshotPath = document.getElementById('decodeSnapshotPath');
    const btnBrowseSnapshot = document.getElementById('btnBrowseSnapshot');
    const decodeElfPath = document.getElementById('decodeElfPath');
    const btnBrowseDecodeElf = document.getElementById('btnBrowseDecodeElf');
    const decoderBinaryPath = document.getElementById('decoderBinaryPath');
    const btnBrowseDecoderBin = document.getElementById('btnBrowseDecoderBin');
    const decoderType = document.getElementById('decoderType');
    const coreFreqMhz = document.getElementById('coreFreqMhz');
    const tsFreqMhz = document.getElementById('tsFreqMhz');
    const decodeInstructions = document.getElementById('decodeInstructions');
    const decodeOnly = document.getElementById('decodeOnly');
    const decodeStats = document.getElementById('decodeStats');

    const btnRunDecoder = document.getElementById('btnRunDecoder');
    const decoderTerminal = document.getElementById('decoderTerminal');
    const btnClearDecodeLog = document.getElementById('btnClearDecodeLog');
    const decoderStatusPill = document.getElementById('decoderStatusPill');
    const decoderExportBanner = document.getElementById('decoderExportBanner');
    const decoderExportFileName = document.getElementById('decoderExportFileName');
    const btnOpenExportedFile = document.getElementById('btnOpenExportedFile');
    const btnExportReport = document.getElementById('btnExportReport');
    const btnBannerExportReport = document.getElementById('btnBannerExportReport');
    let currentExportFilePath = null;
    let latestDecoderResult = null;

    // Metrics
    const metricInstructions = document.getElementById('metricInstructions');
    const metricCycles = document.getElementById('metricCycles');
    const metricTime = document.getElementById('metricTime');
    const metricCpi = document.getElementById('metricCpi');
    const metricAtoms = document.getElementById('metricAtoms');

    // 1. Tab Switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPane = document.getElementById(target);
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });

    // 2. Initial Handshake with Extension
    vscode.postMessage({ command: 'init' });

    // 3. Button Click Listeners - Tab 1
    btnAddDrivers.addEventListener('click', () => {
        vscode.postMessage({ command: 'addDriverFiles' });
    });

    btnBrowseSrcFile.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseFile',
            targetId: 'targetSrcFile',
            title: 'Select C Source File',
            filters: { 'C Source': ['c', 'h', 'cpp'] }
        });
    });

    btnInjectConfig.addEventListener('click', () => {
        const filePath = targetSrcFile.value.trim();
        if (!filePath) {
            alert('Please specify a target source file.');
            return;
        }
        vscode.postMessage({
            command: 'injectConfig',
            filePath: filePath,
            line: configLine.value.trim() || undefined
        });
    });

    // ---- Trace window mode -------------------------------------------------
    // Tab 1 owns this choice. It decides which pair of calls gets injected and
    // how ETMv4.c configures ViewInst, so the two can never disagree.
    const TRACE_MODE_INFO = {
        dwt_gated: {
            pair: 'StartPoint() / StopPoint()',
            hint: 'ViewInst is gated by the DWT comparators. The window is the address range '
                + 'between <code>StartPoint()</code> and <code>StopPoint()</code>, matched in hardware.'
        },
        trace_all: {
            pair: 'Enable_ETM() / Disable_ETM()',
            hint: 'ViewInst is unconditional. The window is bounded by switching the trace unit '
                + 'itself with <code>Enable_ETM()</code> and <code>Disable_ETM()</code>, and every '
                + 'enable emits a fresh synchronisation sequence.'
        }
    };

    function currentTraceMode() {
        return (traceModeSelect && traceModeSelect.value === 'trace_all') ? 'trace_all' : 'dwt_gated';
    }

    function renderTraceMode() {
        const info = TRACE_MODE_INFO[currentTraceMode()];
        if (traceModeHint) { traceModeHint.innerHTML = info.hint; }
        if (wrapPairHintSel) { wrapPairHintSel.textContent = info.pair; }
        if (wrapPairHintLines) { wrapPairHintLines.textContent = info.pair; }
        // Tab 2 shows the same setting under its ETM register names.
        if (viewInstMode) {
            viewInstMode.value = currentTraceMode() === 'trace_all' ? 'unconditional' : 'dwt_gated';
        }
    }

    if (traceModeSelect) {
        traceModeSelect.addEventListener('change', renderTraceMode);
    }

    if (btnApplyTraceMode) {
        btnApplyTraceMode.addEventListener('click', () => {
            vscode.postMessage({ command: 'setTraceMode', mode: currentTraceMode() });
        });
    }

    // Tab 2's selector is the same setting seen from the register side.
    if (viewInstMode) {
        viewInstMode.addEventListener('change', () => {
            if (traceModeSelect) {
                traceModeSelect.value = viewInstMode.value === 'unconditional' ? 'trace_all' : 'dwt_gated';
                renderTraceMode();
            }
        });
    }

    btnWrapSelection.addEventListener('click', () => {
        vscode.postMessage({ command: 'wrapSelection', mode: currentTraceMode() });
    });

    btnWrapLines.addEventListener('click', () => {
        const filePath = targetSrcFile.value.trim();
        const start = parseInt(fromLine.value, 10);
        const end = parseInt(toLine.value, 10);

        if (!filePath) {
            alert('Please specify a target source file.');
            return;
        }
        if (isNaN(start) || isNaN(end) || start <= 0 || end <= 0) {
            alert('Please enter valid line numbers.');
            return;
        }

        vscode.postMessage({
            command: 'wrapLines',
            filePath: filePath,
            fromLine: start,
            toLine: end,
            mode: currentTraceMode()
        });
    });

    // 4. Button Click Listeners - Tab 2
    btnBrowseCapture.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseFile',
            targetId: 'captureFilePath',
            title: 'Select Logic Analyzer Capture (.csv / .bin)',
            filters: { 'Capture Files': ['csv', 'bin', 'txt'], 'All Files': ['*'] }
        });
    });

    btnBrowseElf.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseFile',
            targetId: 'elfFilePath',
            title: 'Select Firmware ELF',
            filters: { 'ELF Executable': ['elf', 'axf', 'out'], 'All Files': ['*'] }
        });
    });

    // Guard syncPeriod: Read-Only in silicon on STM32H7 / Cortex-M7
    syncPeriod.addEventListener('input', () => {
        const val = parseInt(syncPeriod.value, 10);
        if (val !== 10) {
            vscode.postMessage({
                command: 'syncPeriodError',
                message: 'TRCSYNCPR (Sync Period) is read-only on STM32H7 / Cortex-M7 (fixed in silicon at 10, i.e. 1024 bytes). Changing it is not supported by hardware.'
            });
            alert('Warning: TRCSYNCPR (Sync Period) is Read-Only on STM32H7 / Cortex-M7. It is fixed at 10 (1024 bytes) and cannot be changed.');
            syncPeriod.value = 10;
        }
    });

    syncPeriod.addEventListener('change', () => {
        if (parseInt(syncPeriod.value, 10) !== 10) {
            syncPeriod.value = 10;
        }
    });

    btnApplyEtmConfig.addEventListener('click', () => {
        const syncVal = parseInt(syncPeriod.value, 10);
        if (syncVal !== 10) {
            vscode.postMessage({
                command: 'syncPeriodError',
                message: 'TRCSYNCPR (Sync Period) is read-only on STM32H7 / Cortex-M7 (fixed at 10, i.e. 1024 bytes). Cannot change.'
            });
            syncPeriod.value = 10;
            return;
        }

        const params = {
            traceId: parseInt(traceId.value, 10) || 62,
            cycleThreshold: parseInt(cycleThreshold.value, 10) || 64,
            syncPeriodPower: 10,
            viewInstMode: viewInstMode.value,
            enableCCI: enableCCI.checked,
            enableTS: enableTS.checked
        };

        vscode.postMessage({
            command: 'updateEtmConfig',
            params: params
        });
    });

    btnGenerateSnapshot.addEventListener('click', () => {
        const capture = captureFilePath.value.trim();
        if (!capture) {
            alert('Please select a logic analyzer capture file.');
            return;
        }

        if (parseInt(syncPeriod.value, 10) !== 10) {
            vscode.postMessage({
                command: 'syncPeriodError',
                message: 'TRCSYNCPR (Sync Period) is read-only on STM32H7 / Cortex-M7 (fixed at 10, i.e. 1024 bytes).'
            });
            syncPeriod.value = 10;
        }

        const params = {
            captureFile: capture,
            elfFile: elfFilePath.value.trim() || undefined,
            coreName: coreName.value.trim() || 'Cortex-M7_0',
            coreType: coreType.value.trim() || 'ARMv7-M',
            etmName: 'CSETM_0',
            etmType: 'ETM4.0',
            initialPC: initialPC.value.trim() || '0x08000000',
            traceId: parseInt(traceId.value, 10) || 62,
            cycleThreshold: parseInt(cycleThreshold.value, 10) || 64,
            syncPeriodPower: 10,
            viewInstMode: viewInstMode.value,
            enableCCI: enableCCI.checked,
            enableTS: enableTS.checked
        };

        vscode.postMessage({
            command: 'generateSnapshot',
            params: params
        });
    });

    btnClearSnapLog.addEventListener('click', () => {
        snapTerminal.textContent = '';
    });

    // 5. Button Click Listeners - Tab 3
    btnBrowseSnapshot.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseFile',
            targetId: 'decodeSnapshotPath',
            title: 'Select Snapshot Folder or snapshot.ini',
            canSelectFiles: true,
            canSelectFolders: true,
            filters: { 'Snapshot': ['ini'], 'All Files': ['*'] }
        });
    });

    btnBrowseDecodeElf.addEventListener('click', () => {
        vscode.postMessage({
            command: 'browseFile',
            targetId: 'decodeElfPath',
            title: 'Select Firmware ELF',
            filters: { 'ELF Executable': ['elf', 'axf', 'out'], 'All Files': ['*'] }
        });
    });

    if (btnBrowseDecoderBin) {
        btnBrowseDecoderBin.addEventListener('click', () => {
            vscode.postMessage({
                command: 'browseFile',
                targetId: 'decoderBinaryPath',
                title: 'Select trc_pkt_lister Executable',
                filters: { 'All Files': ['*'] }
            });
        });
    }

    btnRunDecoder.addEventListener('click', () => {
        const snap = decodeSnapshotPath.value.trim();
        if (!snap) {
            alert('Please select a snapshot folder or snapshot.ini.');
            return;
        }

        const params = {
            snapshotPath: snap,
            elfPath: decodeElfPath.value.trim() || undefined,
            decoderType: decoderType.value,
            customBinaryPath: (decoderBinaryPath && decoderBinaryPath.value.trim()) || undefined,
            coreFreqMhz: parseFloat(coreFreqMhz.value) || 1,
            tsFreqMhz: parseFloat(tsFreqMhz && tsFreqMhz.value) || 1,
            decodeInstructions: decodeInstructions.checked,
            decodeOnly: decodeOnly.checked,
            stats: decodeStats.checked
        };

        vscode.postMessage({
            command: 'runDecoder',
            params: params
        });
    });

    btnClearDecodeLog.addEventListener('click', () => {
        decoderTerminal.innerHTML = '';
        if (decoderExportBanner) {
            decoderExportBanner.style.display = 'none';
        }
    });

    if (btnOpenExportedFile) {
        btnOpenExportedFile.addEventListener('click', () => {
            if (currentExportFilePath) {
                vscode.postMessage({
                    command: 'openFile',
                    filePath: currentExportFilePath
                });
            }
        });
    }

    function triggerExportReport() {
        const snap = decodeSnapshotPath.value.trim();
        if (!snap) {
            alert('Please select or decode a snapshot first.');
            return;
        }

        const freq = parseFloat(coreFreqMhz.value) || 1;
        const tsFreq = parseFloat(tsFreqMhz && tsFreqMhz.value) || 1;
        const stats = latestDecoderResult && latestDecoderResult.stats ? latestDecoderResult.stats : {
            totalInstructions: parseInt(metricInstructions.textContent.replace(/,/g, ''), 10) || 0,
            totalCycles: parseInt(metricCycles.textContent.replace(/,/g, ''), 10) || 0,
            totalAtoms: parseInt(metricAtoms.textContent.replace(/,/g, ''), 10) || 0,
            estimatedTimeUs: parseFloat(metricTime.textContent) || 0
        };

        vscode.postMessage({
            command: 'exportReport',
            params: {
                snapshotPath: snap,
                coreFreqMhz: freq,
                tsFreqMhz: tsFreq,
                stats: stats,
                exportFileName: latestDecoderResult ? latestDecoderResult.exportFileName : undefined
            }
        });
    }

    if (btnExportReport) {
        btnExportReport.addEventListener('click', triggerExportReport);
    }
    if (btnBannerExportReport) {
        btnBannerExportReport.addEventListener('click', triggerExportReport);
    }

    // 6. Incoming Messages from Extension
    window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
            case 'initStatus': {
                updateDriverBadges(message.status);
                if (message.dirs && message.dirs.mainFile) {
                    targetSrcFile.value = message.dirs.mainFile;
                }
                if (message.etmConfig) {
                    const cfg = message.etmConfig;
                    if (cfg.traceId !== undefined) { traceId.value = cfg.traceId; }
                    if (cfg.cycleThreshold !== undefined) { cycleThreshold.value = cfg.cycleThreshold; }
                    if (cfg.syncPeriodPower !== undefined) { syncPeriod.value = cfg.syncPeriodPower; }
                    if (cfg.viewInstMode !== undefined) { viewInstMode.value = cfg.viewInstMode; }
                    if (cfg.enableCCI !== undefined) { enableCCI.checked = cfg.enableCCI; }
                    if (cfg.enableTS !== undefined) { enableTS.checked = cfg.enableTS; }
                }
                // The saved setting wins over whatever the driver currently reads
                // as, so the selector shows what the next injection will do.
                if (message.traceMode && traceModeSelect) {
                    traceModeSelect.value = message.traceMode;
                }
                renderTraceMode();
                break;
            }

            case 'traceModeSet': {
                if (message.mode && traceModeSelect) {
                    traceModeSelect.value = message.mode;
                    renderTraceMode();
                }
                if (snapTerminal && message.result) {
                    snapTerminal.textContent += `[MODE] ${message.result.message}\n`;
                    snapTerminal.scrollTop = snapTerminal.scrollHeight;
                }
                break;
            }

            case 'etmConfigUpdated': {
                if (snapTerminal && message.result) {
                    snapTerminal.textContent += `[CONFIG] ${message.result.message}\n`;
                    snapTerminal.scrollTop = snapTerminal.scrollHeight;
                }
                break;
            }

            case 'syncPeriodError': {
                syncPeriod.value = 10;
                break;
            }

            case 'driverAdded': {
                updateDriverBadges(message.status);
                break;
            }

            case 'fileSelected': {
                const elem = document.getElementById(message.targetId);
                if (elem) {
                    elem.value = message.path;
                    // Auto-sync ELF between Tab 2 and Tab 3
                    if (message.targetId === 'elfFilePath' && !decodeElfPath.value) {
                        decodeElfPath.value = message.path;
                    }
                }
                break;
            }

            case 'snapshotStarted': {
                snapTerminal.textContent = '[INFO] Starting OpenCSD snapshot creation pipeline...\n';
                break;
            }

            case 'snapshotLog': {
                snapTerminal.textContent += message.text;
                snapTerminal.scrollTop = snapTerminal.scrollHeight;
                break;
            }

            case 'snapshotFinished': {
                if (message.result && message.result.success && message.result.snapshotDir) {
                    // Auto populate Tab 3 snapshot path!
                    decodeSnapshotPath.value = message.result.snapshotDir;
                }
                break;
            }

            case 'decoderStarted': {
                if (decoderExportBanner) {
                    decoderExportBanner.style.display = 'none';
                }
                decoderTerminal.innerHTML = '<div class="log-info">[INFO] High-Speed batch decoding started...</div>' +
                    '<div class="log-info">[RUN] Output is streaming directly to disk. Parameters will be calculated and reported at once.</div>';
                decoderStatusPill.textContent = 'Decoding...';
                decoderStatusPill.className = 'status-pill pill-running';

                // Reset metrics
                metricInstructions.textContent = '0';
                metricCycles.textContent = '0';
                metricTime.textContent = '0 µs';
                metricCpi.textContent = '0.00';
                metricAtoms.textContent = '0';
                break;
            }

            case 'decoderLog': {
                const lineDiv = document.createElement('div');
                lineDiv.className = `log-${message.lineType || 'info'}`;
                lineDiv.textContent = message.text;
                decoderTerminal.appendChild(lineDiv);
                decoderTerminal.scrollTop = decoderTerminal.scrollHeight;
                break;
            }

            case 'decoderStats': {
                const s = message.stats;
                if (s) {
                    metricInstructions.textContent = s.totalInstructions.toLocaleString();
                    metricCycles.textContent = s.totalCycles.toLocaleString();
                    metricTime.textContent = `${s.estimatedTimeUs.toFixed(3)} µs`;
                    if (s.totalInstructions > 0 && s.totalCycles > 0) {
                        metricCpi.textContent = (s.totalCycles / s.totalInstructions).toFixed(2);
                    } else {
                        metricCpi.textContent = '0.00';
                    }
                    metricAtoms.textContent = s.totalAtoms.toLocaleString();
                }
                break;
            }

            case 'decoderFinished': {
                const res = message.result;
                decoderStatusPill.textContent = res.success ? 'Finished' : 'Error';
                decoderStatusPill.className = res.success ? 'status-pill pill-ok' : 'status-pill pill-missing';

                if (res.exportFileName && decoderExportBanner) {
                    decoderExportBanner.style.display = 'flex';
                    decoderExportFileName.textContent = res.exportFileName;
                    currentExportFilePath = res.exportFilePath;
                }

                if (res.stats) {
                    const s = res.stats;
                    metricInstructions.textContent = s.totalInstructions.toLocaleString();
                    metricCycles.textContent = s.totalCycles.toLocaleString();
                    metricTime.textContent = `${s.estimatedTimeUs.toFixed(3)} µs`;
                    if (s.totalInstructions > 0 && s.totalCycles > 0) {
                        metricCpi.textContent = (s.totalCycles / s.totalInstructions).toFixed(2);
                    }
                    metricAtoms.textContent = s.totalAtoms.toLocaleString();
                }

                let html = '';
                if (res.success) {
                    html += `<div class="log-info" style="color:#4ec9b0; font-weight:bold; font-size:13px;">[SUCCESS] High-speed trace decoding completed in ${(res.executionTimeMs / 1000).toFixed(2)}s</div>`;
                    html += `<div class="log-info">Exported file: <b>${escapeHtml(res.exportFileName)}</b> (${res.totalLines ? res.totalLines.toLocaleString() : '0'} lines decoded)</div>`;
                    html += `<div class="log-info" style="margin: 10px 0; padding: 8px 12px; background: rgba(0,122,204,0.12); border-left: 3px solid #007acc; border-radius: 4px;">`;
                    html += `<b>Trace Parameters (Reported At Once):</b><br>`;
                    html += `• Instructions: <b>${res.stats ? res.stats.totalInstructions.toLocaleString() : 0}</b> | `;
                    html += `Cycles: <b>${res.stats ? res.stats.totalCycles.toLocaleString() : 0}</b> | `;
                    html += `WCET: <b>${res.stats ? res.stats.estimatedTimeUs.toFixed(3) : 0} µs</b> | `;
                    html += `CPI: <b>${(res.stats && res.stats.totalInstructions > 0 ? (res.stats.totalCycles / res.stats.totalInstructions).toFixed(2) : '0.00')}</b> | `;
                    html += `Atoms: <b>${res.stats ? res.stats.totalAtoms.toLocaleString() : 0}</b> | `;
                    html += `Packets: <b>${res.stats ? res.stats.totalPackets.toLocaleString() : 0}</b>`;
                    html += `</div>`;

                    if (res.previewHeader && res.previewHeader.length > 0) {
                        html += `<div class="log-info" style="color:#888; margin-top:8px;">--- DISASSEMBLY PREVIEW (First ${res.previewHeader.length} Lines) ---</div>`;
                        for (const hLine of res.previewHeader) {
                            html += `<div class="log-raw">${escapeHtml(hLine)}</div>`;
                        }
                    }

                    if (res.totalLines && res.totalLines > 70) {
                        const omitted = res.totalLines - (res.previewHeader ? res.previewHeader.length : 0) - (res.previewTail ? res.previewTail.length : 0);
                        html += `<div class="log-info" style="color:#569cd6; padding: 6px 0; font-weight: 500;">... [${omitted > 0 ? omitted.toLocaleString() : 0} lines written to ${escapeHtml(res.exportFileName)}] ...</div>`;
                    }

                    if (res.previewTail && res.previewTail.length > 0) {
                        html += `<div class="log-info" style="color:#888;">--- DISASSEMBLY PREVIEW (Final ${res.previewTail.length} Lines) ---</div>`;
                        for (const tLine of res.previewTail) {
                            html += `<div class="log-raw">${escapeHtml(tLine)}</div>`;
                        }
                    }
                } else {
                    html += `<div class="log-error">[ERROR] Decoder error: ${escapeHtml(res.message)}</div>`;
                }

                latestDecoderResult = res;
                decoderTerminal.innerHTML = html;
                decoderTerminal.scrollTop = 0;
                break;
            }

            case 'reportExported': {
                const infoDiv = document.createElement('div');
                infoDiv.className = 'log-info';
                infoDiv.style.color = '#34d399';
                infoDiv.style.fontWeight = 'bold';
                infoDiv.style.marginTop = '10px';
                infoDiv.innerHTML = `[REPORT] Exported Analysis Report: <b>${escapeHtml(message.reportBaseName)}.html</b> &amp; <b>${escapeHtml(message.reportBaseName)}.md</b>`;
                decoderTerminal.appendChild(infoDiv);
                decoderTerminal.scrollTop = decoderTerminal.scrollHeight;
                break;
            }
        }
    });

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateDriverBadges(status) {
        if (!status) return;

        if (status.hasC) {
            badgeC.textContent = 'Installed';
            badgeC.className = 'status-pill pill-ok';
        } else {
            badgeC.textContent = 'Missing';
            badgeC.className = 'status-pill pill-missing';
        }

        if (status.hasH) {
            badgeH.textContent = 'Installed';
            badgeH.className = 'status-pill pill-ok';
        } else {
            badgeH.textContent = 'Missing';
            badgeH.className = 'status-pill pill-missing';
        }

        if (status.mainHasInclude) {
            badgeInclude.textContent = 'Included';
            badgeInclude.className = 'status-pill pill-ok';
        } else {
            badgeInclude.textContent = 'Not Included';
            badgeInclude.className = 'status-pill pill-missing';
        }
    }
})();
