# Literature, Technical References, and Academic Research Repository

## 1. Overview

This directory houses the complete theoretical foundation, hardware specifications, architecture manuals, and academic literature supporting the **CoreSight Hardware-Assisted ETMv4 Execution Trace and Hybrid WCET Analysis Framework**.

Every reference cited in the bachelor thesis (`references.bib`) is directly mapped to documents within this repository, alongside extensive industrial reference manuals from ARM and STMicroelectronics, vendor application notes, and related peer-reviewed research papers.

---

## 2. Directory Structure

```
02_Literature_and_References/
├── ARM_Architecture_and_Technical_Manuals/
├── STMicroelectronics_Hardware_Manuals/
├── Academic_Papers_and_Research/
├── Technical_Application_Notes/
├── OpenCSD_Trace_Decoder_Documentation/
└── README.md
```

---

## 3. Detailed Contents

### 3.1. ARM Architecture and Technical Reference Manuals (`ARM_Architecture_and_Technical_Manuals/`)
Official architectural specifications and technical reference manuals directly governing the on-chip CoreSight debug subsystem:

*   **`IHI0029G_coresight_v3_0_architecture_specification.pdf`**  
    *ARM CoreSight Architecture Specification v3.0*  
    Defines the global topology, component discovery via CoreSight ROM tables, ATB (Advanced Trace Bus) interconnect protocols, trace sinks, and trace formatters.
*   **`IHI0064H_b_etm_v4_architecture_specification.pdf`**  
    *Embedded Trace Macrocell Architecture Specification (ETMv4.0 to ETMv4.4)*  
    The primary specification for the instruction tracing protocol used throughout this project, detailing branch broadcast, cycle counting, synchronization packets (A-sync), address compression (exact match, short/long address), and atom packets (`E` / `N`).
*   **`DDI0489F_cortex_m7_trm.pdf`**  
    *ARM Cortex-M7 Technical Reference Manual (r1p2)*  
    Covers the dual-issue superscalar pipeline microarchitecture, branch prediction unit, ITCM/DTCM, L1 caches, and external trace interfaces.
*   **`DDI0494D_coresight_etm_m7_r0p1_trm.pdf`**  
    *CoreSight ETM-M7 Technical Reference Manual*  
    Details the Cortex-M7 specific implementation of ETMv4.1, register offsets, trace bus bandwidth constraints, and synchronization counters.
*   **`DDI0403E_e_armv7m_arm.pdf` & `DDI0403E_e_armv7m_arm_dwt.pdf`**  
    *ARMv7-M / ARMv7-E-M Architecture Reference Manual & DWT Module*  
    Defines instruction encodings, exception models, and Data Watchpoint and Trace (DWT) comparator behavior.
*   **`coresight_soc400_technical_reference_manual_100536_0302_01_en.pdf`**  
    *CoreSight SoC-400 Technical Reference Manual*  
    Covers System Trace Funnel (CSTF), Embedded Trace FIFO (ETF), and debug APB access topologies.
*   **`tpium_trm_102427_0000_01_en.pdf`**  
    *CoreSight Trace Port Interface Unit M-profile (TPIU-M) Technical Reference Manual*  
    Specifies pin demultiplexing, framing protocols, TRACECLK generation, and TRACEDATA[0:3] formatting.
*   **`Understanding Trace.pdf`**  
    *ARM Technical Guide: Understanding On-Chip Trace*  
    Foundational guide explaining trace concepts, off-chip vs on-chip storage, and bandwidth optimization.

---

### 3.2. STMicroelectronics Hardware Manuals (`STMicroelectronics_Hardware_Manuals/`)
Hardware reference manuals, datasheets, and peripheral register breakdowns specific to the target microcontroller:

*   **`rm0433-...pdf`**  
    *STM32H742, STM32H743/753, and STM32H750 Value Line Reference Manual (RM0433 Rev 7)*  
    4,000+ page primary reference manual detailing RCC clock trees, DBGMCU control registers, trace pin multiplexing, SWTF (Software Trace Funnel), and power domains.
*   **`stm32h750vb.pdf`**  
    *STM32H750xB Value Line ARM Cortex-M7 32-bit 480 MHz MCU Datasheet*  
    Pinouts, electrical characteristics, trace port timing constraints (maximum TRACECLK slew rate, setup/hold times).
*   **`en.STM32H7-System-ARM_Cortex_M7_M7.pdf`**  
    *STM32H7 System Architecture and Cortex-M7 Integration Guide*
*   **Target Register Maps & Bitfield Guides:**
    *   `ETM_STM32H750.pdf` — Complete ETM register layout and control bitfields.
    *   `TPIU_STM32H750.pdf` & `stm32h750_TPIU_registermap.pdf` — TPIU current port size, formatter enable, and pattern generation registers.
    *   `CSTF_STM32H750.pdf` & `CSTF,ETF,TPIU,SWO,SWTF stm32h750.pdf` — CoreSight trace funnel slave port routing.
    *   `ETF_STM32H750.pdf` — Embedded Trace FIFO circular buffer configuration.
    *   `DWT_STM32H750.pdf` — DWT cycle counter and comparator registers.
    *   `SystemRomTable_STM32H750.pdf` — ROM table base address mapping for CoreSight APB discovery.

---

### 3.3. Academic Papers and Research (`Academic_Papers_and_Research/`)
Foundational research on Worst-Case Execution Time (WCET) analysis, hardware-assisted tracing, and runtime verification:

*   **Core Thesis Citations:**
    *   `Wilhelm2008_WCET_Survey.pdf`  
        *R. Wilhelm, J. Engblom, A. Ermedahl, N. Holsti, S. Thesing, D. Whalley, G. Bernat, C. Ferdinand, et al. (ACM TECS 2008)*  
        "The worst-case execution-time problem—overview of methods and practice." Foundational taxonomy and state-of-the-art survey for WCET analysis methods and tools.
    *   `Betts2010_Hybrid_WCET_Analysis.pdf`  
        *A. Betts, N. Merriam, G. Bernat (WCET 2010)*  
        "Hybrid measurement-based WCET analysis at the source level using object-level traces."
    *   `Bernat2002_pWCET.pdf`  
        *G. Bernat, A. Colin, S. M. Petters (RTSS 2002)*  
        "WCET analysis of systems with execution traces."
    *   `TimeWeaver A Tool for Hybrid Worst-Case Execution Time Analysis.pdf`  
        AbsInt GmbH technical documentation detailing execution-trace-driven hybrid WCET analysis.
*   **Broader Real-Time & Trace Research Portfolio (23 Papers):**
    *   *WCET Analysis & Bounding:*
        *   `Assessment of trace-differences in timing analysis for Complex Real-Time Embedded Systems.pdf`
        *   `Computing worst case execution time (WCET) by Symbolically Executing a time-accurate Hardware Model.pdf`
        *   `Embedded Program Annotations for WCET Analysis.pdf`
        *   `Guaranteed Loop Bound Identification from program Traces for WCET.pdf`
        *   `Hardware support for WCET analysis of hard real-time multicore systems.pdf`
        *   `Hardware-in-the-loop based WCET analysis with KLEE.pdf`
        *   `Measurement based WCET Analysis for Multi-core Architectures.pdf`
        *   `Probabilistic Safe WCET Estimation for Weakly Hard Real-Time Systems at Design Stages.pdf`
        *   `WCET(m) Estimation in Multi-core Systems Using Single Core Equivalence.pdf`
    *   *Hardware-Assisted Tracing & Monitoring:*
        *   `Everything You Always wanted to know about embedded trace.pdf`
        *   `Hardware‐assisted software event tracing.pdf`
        *   `Non-Intrusive Online Timing Analysis of Large Embedded Applications.pdf`
        *   `Online Analysis of Debug Trace Data for Embedded systems.pdf`
        *   `Applications of On-chip Trace on Debugging Embedded Processor.pdf`
        *   `A Traced-based Automated System Diagnosis and Software Debugging Methodology for Embedded Multi-core Systems.pdf`
        *   `Mining Traces of Embedded Software systems for insights.pdf`
        *   `Runtime verification and monitoring of embedded systems.pdf`
    *   *Control Flow Integrity & Hardware Performance Counters:*
        *   `Performance Counters and DWT Enabled Control Flow Integrity.pdf`
        *   `Software-based Control-Flow Error Detection with Hardware Performance Counters in ARM Processors.pdf`
        *   `Malicious Firmware Detection with Hardware Performance Counters.pdf`
        *   `Non-determinism and overcount on modern hardware performance counter implementations.pdf`
        *   `Enabling Raspberry Pi Performance Counter Support on Linux perf_event.pdf`

---

### 3.4. Technical Application Notes and Tool Guides (`Technical_Application_Notes/`)
*   **`ug31.pdf`**  
    *DreamSourceLab DSView User Guide (v1.3.0)*  
    Covers DSLogic U3Pro16 buffer modes, RLE compression, high-impedance probe calibration, and sample rate configurations up to 1 GHz / 100 MHz streaming.
*   **`AN_iSYSTEM_CortexM7_ETMv4.pdf`**  
    *iSYSTEM Application Note: Cortex-M7 ETMv4 Hardware Trace Configuration*  
    Guidance on pin multiplexing, TRACECLK termination, and clock duty-cycle stabilization.
*   **`trace_arm_etm.pdf` & `training_arm_etm.pdf`**  
    *Lauterbach TRACE32 ETM Hardware Trace Manual & Training Course*  
    In-depth operational protocols for off-chip trace acquisition, TPIU packet framing, and decompression state machines.
*   **`Weingarten_Matt.pdf`**  
    Comprehensive research on embedded trace reconstruction and debugger interface instrumentation.
*   **Infrastructure Architectural Diagrams:**
    *   `Debug Infrastructure.png` — Global CoreSight topology on STM32H750.
    *   `Debug Infrastructure(Clocking).png` — TRACECLK generation and APB prescaling paths.
    *   `Debug Infrastructure(Power).png` — D1/D2/D3 domain power gating for debug blocks.

---

### 3.5. OpenCSD Trace Decoder Documentation (`OpenCSD_Trace_Decoder_Documentation/`)
Official documentation for the Linaro OpenCSD CoreSight Trace Decode Library (cited in the thesis under `linaroopencsd`), including:
*   `open_csd_api.html` / `open_csd_api.md` — API interfaces and packet sinks.
*   `dcd_etmv4.html` — ETMv4 protocol decompressor specifications.
*   `custom_decoders.html` — Architecture for plugging in custom packet decoders.
*   `build_scripts.html` — Compilation and deployment workflows.

---

## 4. Mapping to Thesis Bibliography (`references.bib`)

| BibTeX Key | Cited Publication / Standard | Local Repository Document |
| :--- | :--- | :--- |
| `armcoresight2013` | ARM CoreSight Architecture Specification v2.0/v3.0 | `ARM_Architecture_and_Technical_Manuals/IHI0029G_...pdf` |
| `dslab2023dsview` | DSView User Guide v1.3.0 (DreamSourceLab) | `Technical_Application_Notes/ug31.pdf` |
| `armetmv42017` | Embedded Trace Macrocell Architecture Specification | `ARM_Architecture_and_Technical_Manuals/IHI0064H_...pdf` |
| `st2020stm32h7` | STM32H742/743/750 Reference Manual (RM0433 Rev 7) | `STMicroelectronics_Hardware_Manuals/rm0433-...pdf` |
| `linaroopencsd` | OpenCSD - Open Source CoreSight Trace Decode Library | `OpenCSD_Trace_Decoder_Documentation/` |
| `wilhelm2008worst` | Wilhelm et al. (2008), TECS Survey of Methods and Practice | `Academic_Papers_and_Research/Wilhelm2008_WCET_Survey.pdf` |
| `bernat2002wcet` | Bernat et al. (2002), WCET Analysis with Execution Traces | `Academic_Papers_and_Research/Bernat2002_pWCET.pdf` |
| `betts2010hybrid` | Betts & Bernat (2010), Hybrid WCET Using Hardware Trace | `Academic_Papers_and_Research/Betts2010_Hybrid_WCET_Analysis.pdf` |
| `cullmann2010predictability` | Cullmann et al. (2010), Predictability in Hardware Design | `Academic_Papers_and_Research/TimeWeaver...pdf` & PREDATOR research |
| `kargahi2008analytical` | Kargahi & Movaghar (2008), IEEE Trans. on Reliability | IEEE Copyrighted Paper (Available via IEEE Xplore DOI: 10.1109/TR.2008.928178) |
