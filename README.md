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
│   └── README.md
│
├── 04_Python_Trace_Decoder/
│   ├── TraceStreamProcessor.py                         # Production trace processor & snapshot builder
│   ├── Development_History/                            # Evolution prototypes (V0, V0.1, V0.2, gaps)
│   └── README.md
│
├── 05_VSCode_Trace_Studio_Extension/
│   ├── src/                                            # TypeScript source code (Webview, IPC, ReportEngine)
│   ├── templates/                                      # ETMv4 firmware driver templates
│   ├── out/                                            # Compiled JavaScript extension bundle
│   ├── coresight-trace-studio-0.4.3.vsix               # VS Code Extension VSIX installer (Latest v0.4.3)
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

### `04_Python_Trace_Decoder`
*   Features **`TraceStreamProcessor.py`**, which automatically reconstructs 4-bit parallel logic captures into TPIU frames, extracts memory sections from the firmware ELF, builds OpenCSD snapshots, and runs `trc_pkt_lister`.
*   Includes the development history of earlier decoders (`TempDecoder_V0.py` to `V0.2.py`).

### `05_VSCode_Trace_Studio_Extension`
*   Full source code and `.vsix` installer for **CoreSight Trace Studio (v0.4.2)**, a custom VS Code extension providing:
    *   Pinout visualization and DSLogic wiring guides.
    *   Interactive visual bitfield editor for ETMv4 registers (`TRCCONFIGR`, `TRCSYNCPR`, `TRCCCCTLR`).
    *   **Direct Firmware Synchronization**: Injects and updates configuration parameters directly into `ETMv4.c` in the active project workspace with silicon constraint enforcement (e.g. read-only `TRCSYNCPR` lock on Cortex-M7).
    *   **High-Speed Decoder & Execution Analyzer**: Invokes `trc_pkt_lister` with automated snapshot manifests, streaming disassembly and extracting cycle-accurate statistics (filtering duplicate timestamp metadata to verify true clock cycles, e.g. 496,228 cycles in 496,222 µs = 1.000012 MHz).
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
3.  **Cost-Effective Workflow**:
    Demonstrated that a sub-$300 commercial logic analyzer paired with open-source software (OpenCSD + Python) can substitute for expensive proprietary hardware trace probes (such as Lauterbach TRACE32 or IAR I-jet) for real-time verification and hybrid WCET bounding.
