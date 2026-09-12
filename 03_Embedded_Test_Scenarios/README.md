# Embedded Firmware Test Scenarios and Experimental Evaluations

## 1. Overview
This directory contains the complete set of embedded firmware projects, experimental capture datasets, OpenCSD memory snapshots, and fully decoded execution logs developed to evaluate the **CoreSight Hardware-Assisted ETMv4 Execution Trace and Hybrid WCET Analysis Framework**.

The test suite consists of **one baseline project**, **three rigorous empirical test scenarios**, and **one live demonstration scenario** built for the Projects Day defence:

```
03_Embedded_Test_Scenarios/
├── 00_Base_Initial_Program/            # Starting base project for CoreSight bring-up
├── 01_TimerTest_Periodic_100us/         # ETM non-intrusiveness & zero-interference validation
├── 02_FreqTest_Scalability_and_Sync/    # Frequency scalability, sustained throughput & A-Sync
├── 03_Routine_Irq_Multi_Interrupt/      # Complex control flow, algorithms, SVC & hardware ISRs
├── 04_ProjectsDay_WCET_Demo/            # LIVE DEMO: WCET pair + nested interrupt preemption
└── README.md
```

---

## 2. Experimental Test Scenarios Summary Matrix

| Scenario Folder | Experimental Objective | Firmware Workload | Trigger Mechanism | Capture Data | Decoded Verification Log |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`00_Base_Initial_Program`** | Initial baseline bring-up & hardware clocking validation | Minimal GPIO & SPI loop | Manual execution | N/A (Baseline project) | N/A (Baseline project) |
| **`01_TimerTest_Periodic_100us`** | Prove zero execution overhead & non-intrusiveness of ETM | 100 µs periodic timer (`TIM6`) across 10 windows | Hardware DWT comparators on `StartPoint()` / `StopPoint()` | `_tpiu.bin` & `OpenCSD_Snapshot/` | `success.log` & `193100.log` (Nanosecond-accurate cycle matching) |
| **`02_FreqTest_Scalability_and_Sync`** | Stress-test FIFO throughput, A-Sync periodic synchronization | Sustained heavy loop (`>1,000,000` NOP cycles) | DWT Comparator gating | `.dsl` (27 MB DSView session) & `_tpiu.bin` (4.2 MB) | `195532.log` (10.4 million lines of decoded instruction trace) |
| **`03_Routine_Irq_Multi_Interrupt`** | Multi-routine path recovery, nested loops, SVC & peripheral ISRs | Checksum, Bubble Sort, SVC syscall, UART IRQ, Button EXTI | PC5 Button trigger + Raspberry Pi Pico UART handshake | `_tpiu.bin` & `OpenCSD_Snapshot/` | `134532.log` (Accurate branch atom and vector recovery) |
| **`04_ProjectsDay_WCET_Demo`** | Live defence demo: measured WCET pair, and **nested interrupt preemption recovered from the wire**, from an application containing zero trace code | Plain HAL application: same sort routine on best-case and worst-case inputs; heavy USART1 RX callback preempted by a 1 ms TIM6 tick; SVC | PC5 Button + Pico UART echo; PA1 busy LED drives the analyser trigger | CSV -> `_tpiu.bin` -> `OpenCSD_Snapshot/` (~1-2.5 kB of wire) | `.ppl` of a few thousand lines, plus `Host_Tools/verify_demo.py` PASS/FAIL evidence table |

---

## 3. Key Achievements Demonstrated Across Scenarios
1.  **Strict Non-Intrusiveness**: Demonstrated zero timing drift or jitter in high-frequency ($10\text{ kHz}$) periodic interrupt tasks during active hardware tracing.
2.  **Deterministic Bounding**: Tracing is bounded precisely between `StartPoint()` and `StopPoint()` using on-chip DWT comparators without inserting software instrumentation into the measured code.
3.  **Complete Asynchronous Event Visibility**: Hardware interrupts from external sources (Raspberry Pi Pico handshake) and software exceptions (`SVC #0`) are transparently captured and reconstructed.
4.  **Long-Duration Stability**: Sustained loop captures of over 10 million decoded trace lines verify that the TPIU-ETF pipeline prevents data loss and maintains synchronization.
5.  **Nested Preemption Recovery**: Scenario 04 shows a priority-0 timer interrupt entering while a priority-1 UART handler is still executing, decoded as two `EXCEPTION` elements separated by a single `EXCEPTION_RET`. The application contains no instrumentation whatsoever, so this is recovered entirely from the trace port.
6.  **Measured WCET Bounds**: Scenario 04 executes one routine twice, on a best-case and a worst-case input, and reports both cycle costs from the decoded trace. The routine returns the same value both times, so the two runs differ only in execution time - which is the measurement-based WCET argument in a single window.

---

## 4. Software and Hardware Prerequisites
*   **Target MCU**: STM32H750VBT6 (Arm Cortex-M7 core).
*   **Logic Analyzer**: DreamSourceLab DSLogic U3Pro16 (configured for 4-bit parallel trace + TRACECLK).
*   **Toolchains**:
    *   STM32CubeIDE (v1.12.0 or higher) or Arm GNU Toolchain (`arm-none-eabi-gcc`).
    *   Python 3.10+ with OpenCSD trace decode libraries.
