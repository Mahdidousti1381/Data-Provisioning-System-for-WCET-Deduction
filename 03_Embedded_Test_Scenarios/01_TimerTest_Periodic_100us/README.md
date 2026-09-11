# Scenario 1: Periodic 100 µs Timer Non-Intrusiveness Test (`01_TimerTest_Periodic_100us`)

## 1. Objective and Theoretical Claim
The primary goal of this test scenario is to formally prove the **zero-overhead, non-intrusive nature of hardware-assisted CoreSight ETMv4 instruction tracing**.

**Hypothesis Under Test**:
If on-chip ETMv4 execution tracing operates strictly in parallel without intruding upon the processor pipeline or stealing execution cycles, then a high-frequency periodic hardware interrupt (**TIM6 at 100 µs period / 10 kHz**) will experience **zero timing distortion, zero drift, and zero jitter** whether tracing is active or inactive.

---

## 2. Test Architecture and Dual-Verification Methodology
To establish undeniable experimental proof, two independent measurement channels were evaluated simultaneously:

1.  **On-Chip Software Ground Truth**:
    *   `DWT->CYCCNT` (hardware cycle counter running at core clock) is sampled on the first instruction of each TIM6 interrupt handler.
    *   Delta cycle counts are converted to nanoseconds and logged into `g_etmirq.delta_ns[]`.
    *   Expected mean interval: **$100,000 \pm 20\text{ ns}$ ($100\text{ }\mu\text{s}$)**.

2.  **External Hardware Trace Timebase**:
    *   The CoreSight Timestamp Generator (TSG) generates 64-bit synchronized timestamps.
    *   ETMv4 emits `I_TIMESTAMP` and `I_CCNT` packets synchronized at each window boundary.
    *   Decoded externally by Linaro OpenCSD, verifying that decoded timestamp deltas match the internal timer period with nanosecond fidelity.

---

## 3. Directory Structure
```
01_TimerTest_Periodic_100us/
├── Firmware_Source/
│   ├── Core/
│   │   ├── Inc/           # Cleaned headers: EtmIrqTest.h, ETMv4.h, main.h
│   │   ├── Src/           # Cleaned sources: EtmIrqTest.c, ETMv4.c, main.c, stm32h7xx_it.c
│   │   └── Startup/
│   ├── Drivers/
│   ├── Debug/             # Freshly compiled binary (BP_Test1_H7.elf), map, and list
│   └── *.ioc, *.ld, *.launch
├── Trace_Capture/
│   └── DSLogic U3Pro16-la-260909-193100_tpiu.bin  # Sanitized demultiplexed TPIU byte stream
├── OpenCSD_Snapshot/                              # Complete Linaro OpenCSD snapshot (trace.ini, device*.ini, memory dumps)
├── Decoded_Execution_Log/
│   ├── success.log                                # Fully synchronized decoded trace log
│   └── 193100.log                                 # Complete raw execution trace packet dump
└── README.md
```

---

## 4. Code Cleanup and Directory Sanitation
*   **Purged Obsolete Code**: Early development test routines (`TestApp.c` and `TestApp.h`) and redundant UART test hooks have been completely removed.
*   **Cleaned Firmware Directory**: All temporary images, screenshots, intermediate docs, and duplicate scripts were thoroughly scrubbed from `Firmware_Source`, leaving a clean, standard STM32CubeIDE project.
*   **Archive Size Optimization**: Raw multi-hundred MB CSV files were replaced by the sanitized wire capture (`_tpiu.bin`) and complete `OpenCSD_Snapshot/`, providing full verification capability with a fraction of the archive footprint.
*   **Deterministic Execution**: `TIM6` register accesses are executed directly without HAL abstraction overhead inside the timing-critical path.

---

## 5. Execution and Verification
1.  **Compile Firmware**:
    ```bash
    cd Firmware_Source/Debug
    make all
    ```
2.  **Flash and Run**:
    *   Flash `BP_Test1_H7.elf` onto STM32H750.
    *   Press push-button `PC5` to trigger a 10-tick periodic test sequence.
3.  **Trace Replay & Decompression**:
    *   Use the provided `OpenCSD_Snapshot/` directory with `trc_pkt_lister`:
    ```bash
    trc_pkt_lister -ss_dir OpenCSD_Snapshot -decode -src_name ETMA
    ```
4.  **Results**: Inspect `Decoded_Execution_Log/success.log` to view decoded assembly instruction ranges, atom branches (`E`/`N`), cycle counts, and exact timestamps matching the 100 µs interval.
