# CoreSight Hardware-Assisted ETMv4 Execution Trace and Hybrid WCET Analysis Framework

### Bachelor of Science Thesis Deliverables & Technical Archive
*   **Candidate**: Mohammad Mahdi Doustmohammadi
*   **Student ID**: 810100142
*   **Supervisor**: Dr. Mehdi Kargahi
*   **Institution**: School of Electrical and Computer Engineering, College of Engineering, University of Tehran
*   **Academic Year**: 1404–1405 (2025–2026)

---

## 1. Executive Summary
This master archive contains the complete research deliverables, embedded firmware source code, hardware configuration drivers, digital trace capture datasets, OpenCSD memory snapshots, Python decompression processors, and the IDE toolchain developed for the bachelor project:

> **"Hardware-Assisted Non-Intrusive Execution Tracing Using ARM CoreSight ETMv4 for Worst-Case Execution Time (WCET) Analysis and Dynamic System Verification."**

The framework establishes an end-to-end open ecosystem capable of extracting instruction-level, cycle-accurate program execution traces from an ARM Cortex-M7 microcontroller (STM32H750VBT6) using a commercial logic analyzer (DreamSourceLab DSLogic U3Pro16) with **zero software instrumentation overhead and zero timing intrusion**.

---

## 2. Directory Structure & Deliverables Organization

```
CoreSight_Trace_Framework_Deliverables/
│
├── 01_Proposal_and_Thesis/
│   ├── Bachelor_Thesis_MohammadMahdiDoustmohammadi.pdf  # Final evaluated thesis PDF
│   ├── Bachelor_Project_Proposal.pdf / .docx           # Approved initial proposal
│   ├── Projectday_Proposal_Revised.docx                # Revised project day submission
│   ├── Thesis_LaTeX_Source/                            # Complete LaTeX source, preamble & bib
│   └── README.md
│
├── 02_Literature_and_References/
│   ├── ARM_Architecture_and_Technical_Manuals/         # CoreSight v3.0, ETMv4, Cortex-M7 TRM
│   ├── STMicroelectronics_Hardware_Manuals/            # STM32H7 RM0433 Rev 7, register maps
│   ├── Academic_Papers_and_Research/                   # 25 peer-reviewed papers on WCET & trace
│   ├── Technical_Application_Notes/                    # DSView User Guide ug31, Lauterbach, iSYSTEM
│   ├── OpenCSD_Trace_Decoder_Documentation/            # Linaro OpenCSD architecture manuals
│   └── README.md
│
├── 03_Embedded_Test_Scenarios/
│   ├── 00_Base_Initial_Program/                        # Initial baseline project (BP_Test0_H7)
│   ├── 01_TimerTest_Periodic_100us/                    # ETM non-intrusiveness & interference test
│   ├── 02_FreqTest_Scalability_and_Sync/               # Frequency scalability & sustained loop
│   ├── 03_Routine_Irq_Multi_Interrupt/                 # Multi-routine algorithms, SVC & hardware ISRs
│   ├── 04_ProjectsDay_WCET_Demo/                       # Live defence demo + presenter runbook
│   └── README.md
│
├── 04_Python_Trace_Decoder/
│   ├── TraceStreamProcessor.py                         # Production trace processor & snapshot builder
│   ├── Development_History/                            # Evolution prototypes (V0, V0.1, V0.2, gaps)
│   └── README.md
│
├── 05_VSCode_Coresight_Trace_Studio_Extension/
│   ├── src/                                            # TypeScript source code (Webview, IPC, ReportEngine)
│   ├── templates/                                      # ETMv4 firmware driver templates
│   ├── out/                                            # Compiled JavaScript extension bundle
│   ├── icon.png                                        # Official extension logo icon (512x512)
│   ├── coresight-trace-studio-0.4.6.vsix               # VS Code Extension VSIX installer (Latest v0.4.6)
│   ├── package.json, tsconfig.json
│   └── README.md
│
├── 06_ETMv4_Driver_Module/
│   ├── ETMv4.c                                         # Standalone CoreSight trace driver
│   ├── ETMv4.h                                         # Hardware register definitions & prototypes
│   └── README.md                                       # Drop-in integration & pinout guide
│
└── README.md                                           # Master documentation (this file)
```

---

## 3. Directory Descriptions & Key Highlights

### `01_Proposal_and_Thesis`
*   Contains the complete, final compiled **Bachelor's Thesis PDF** (`Bachelor_Thesis_MohammadMahdiDoustmohammadi.pdf`), signed and formatted in accordance with University of Tehran academic standards.
*   Includes original and revised project proposals.
*   Provides full, buildable LaTeX source code with XePersian packages and `references.bib`.

### `02_Literature_and_References`
*   Houses the comprehensive library of technical literature:
    *   ARM Architecture Specifications (CoreSight v3.0, ETMv4.0–v4.4, Cortex-M7 TRM).
    *   STMicroelectronics Reference Manual RM0433 Rev 7 (4,000+ pages) and bitfield register sheets.
    *   All papers cited in the thesis (`references.bib`), including Wilhelm (2008), Bernat (2002), Betts & Bernat (2010), plus 23 domain papers covering hybrid WCET analysis, control-flow integrity, and hardware performance counters.
    *   DreamSourceLab DSView User Guide (v1.3.0) and Linaro OpenCSD technical documentation.

### `03_Embedded_Test_Scenarios`
*   Contains **4 structured firmware projects** representing the experimental trajectory:
    1.  **`00_Base_Initial_Program`**: Baseline firmware bring-up.
    2.  **`01_TimerTest_Periodic_100us`**: Proves ETM zero-overhead claim by showing zero jitter in a 100 µs (10 kHz) periodic timer (`TIM6`). Firmware was scrubbed of temporary files and obsolete test code. Includes sanitized TPIU binary (`_tpiu.bin`), complete OpenCSD snapshot, and decoded logs (`success.log` and `193100.log`).
    3.  **`02_FreqTest_Scalability_and_Sync`**: Stress-tests trace bandwidth and periodic A-Sync synchronization over 10.4 million decoded instructions. Includes compact native session `.dsl` (27 MB), extracted TPIU stream (`_tpiu.bin`), and full execution log (`195532.log`).
    4.  **`03_Routine_Irq_Multi_Interrupt`**: Multi-routine execution (Checksum, Bubble Sort, SVC syscall) with asynchronous UART interrupts from a Raspberry Pi Pico and button EXTI. Includes extracted TPIU stream (`_tpiu.bin`), OpenCSD snapshot, and decoded log (`134532.log`).
    5.  **`04_ProjectsDay_WCET_Demo`**: The live demonstration scenario built for the Projects Day defence. It is an ordinary STM32CubeIDE HAL application containing **no trace code at all** - no counters, no timestamps, no instrumentation. The only trace-related lines in the project are the three CoreSight Trace Studio injects into `main.c` (`Parallel_Trace_configure()`, `StartPoint()`, `StopPoint()`), so every timing figure in the demonstration is recovered from four data pins and a clock pin. A single button press produces a window of a few milliseconds carrying one artefact for every poster claim: a **measured WCET pair** (one routine, best-case and worst-case inputs, identical results, an order-of-magnitude difference in cycles) and a **nested interrupt preemption** (a priority-0 TIM6 tick entering while the priority-1 USART1 callback is still running). Ships with `PROJECTS_DAY_GUIDE.md`, a step-by-step booth runbook, and `Host_Tools/verify_demo.py`, which reduces a `.ppl` decode to a PASS/FAIL table against those claims.

### `04_Python_Trace_Decoder`
*   Features **`TraceStreamProcessor.py`**, which automatically reconstructs 4-bit parallel logic captures into TPIU frames, extracts memory sections from the firmware ELF, builds OpenCSD snapshots, and runs `trc_pkt_lister`.
*   Includes the development history of earlier decoders (`TempDecoder_V0.py` to `V0.2.py`).

### `05_VSCode_Coresight_Trace_Studio_Extension`
*   Full source code and `.vsix` installer for **CoreSight Trace Studio (v0.4.6)**, a custom VS Code extension providing:
    *   Official custom logo branding and high-DPI modern dark UI theme.
    *   Pinout visualization and DSLogic wiring guides.
    *   Interactive visual bitfield editor for ETMv4 registers (`TRCCONFIGR`, `TRCSYNCPR`, `TRCCCCTLR`).
    *   **Direct Firmware Synchronization**: Injects and updates configuration parameters directly into `ETMv4.c` in the active project workspace with silicon constraint enforcement (e.g. read-only `TRCSYNCPR` lock on Cortex-M7).
    *   **High-Speed Decoder & Execution Analyzer**: Invokes `trc_pkt_lister` with automated snapshot manifests, streaming disassembly and extracting cycle-accurate statistics. The core and timestamp-generator frequencies are supplied by the operator (the trace stream does not encode them); the analyzer then cross-checks them against the capture by reporting the measured timestamp-ticks-per-cycle ratio, and warns when the supplied pair is inconsistent with the trace. On the STM32H7 the TSG is core-clocked, so the ratio lands on ~1.000 (e.g. 496,222 ticks against 496,228 cycles = 0.999988).
    *   **One-Click Report Generation**: Exports comprehensive, data-driven **HTML** and **Markdown** reports containing active trace window duration ($\Delta\text{TS}$), detailed IRQ execution timelines (Pre-IRQ thread TS, Entry TS, Exit TS, duration, cycles, instructions), CPU execution split (ISR vs. Main), and code address hotspots.

### `06_ETMv4_Driver_Module`
*   Clean, standalone, documented C driver files (`ETMv4.c`, `ETMv4.h`).
*   Ready to be dropped into any STM32H7 project to enable CoreSight tracing with two functions: `Parallel_Trace_configure()` and bounding triggers `StartPoint()` / `StopPoint()`.

---

## 4. Summary of Experimental Results

1.  **Timing Non-Intrusiveness**:
    Software-measured cycle counts (`DWT->CYCCNT`) and hardware-decoded timestamps (`I_TIMESTAMP`) independently confirmed that a 100 µs periodic timer experienced **$0.00\%$ timing distortion** during active trace emission.
2.  **Instruction & Branch Reconstruction**:
    OpenCSD successfully decoded millions of instructions, reconstructing both conditional branch atoms (`E` / `N`) and asynchronous interrupt vector switches.
3.  **Nested Preemption and Interference Decomposition**:
    Scenario 04 recovers, from the trace port alone, a high-priority timer interrupt entering while a lower-priority UART callback is still executing, and separates that callback's own execution cycles from its response time. The interference term of classical response-time analysis is thus measured on real silicon rather than estimated - from an application that carries no instrumentation of any kind.
4.  **Cost-Effective Workflow**:
    Demonstrated that a sub-$300 commercial logic analyzer paired with open-source software (OpenCSD + Python) can substitute for expensive proprietary hardware trace probes (such as Lauterbach TRACE32 or IAR I-jet) for real-time verification and hybrid WCET bounding.
