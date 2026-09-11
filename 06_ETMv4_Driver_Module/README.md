# CoreSight ETMv4 Embedded Driver Module for ARM Cortex-M7

## 1. Overview
This module provides a **clean, modular, standalone C driver (`ETMv4.c`, `ETMv4.h`)** for initializing, arming, and gating the complete on-chip **ARM CoreSight Debug and Trace Subsystem** on STM32H7 microcontrollers (ARM Cortex-M7 core).

It enables cycle-accurate, non-intrusive instruction execution tracing exported off-chip through a 4-bit parallel trace port.

---

## 2. Managed CoreSight Hardware Subsystems

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                            STM32H7 MCU (D1 / D2 / D3)                       │
 │                                                                             │
 │  ┌──────────────┐     ┌───────────┐                                         │
 │  │  Cortex-M7   │────▶│   ETMv4   │                                         │
 │  │  Execution   │     │  (Trace)  │                                         │
 │  └──────────────┘     └─────┬─────┘                                         │
 │         │                   │                                               │
 │         ▼                   ▼ ATB                                           │
 │  ┌──────────────┐     ┌───────────┐     ┌───────────┐     ┌──────────────┐  │
 │  │     DWT      │────▶│   CSTF    │────▶│    ETF    │────▶│     TPIU     │──┼──▶ [PE2-PE6 Pins]
 │  │ (Start/Stop) │gate │ (Funnel)  │     │  (FIFO)   │     │ (Formatter)  │  │    (TRACECLK +
 │  └──────────────┘     └───────────┘     └───────────┘     └──────────────┘  │     TRACED[0:3])
 │                             ▲                                               │
 │                       ┌─────┴─────┐                                         │
 │                       │    TSG    │ (64-bit Global Timestamp)               │
 │                       └───────────┘                                         │
 └─────────────────────────────────────────────────────────────────────────────┘
```

1.  **ETMv4 (Embedded Trace Macrocell v4.1)**:
    *   Configures cycle counting (CCI) and global timestamps (TS).
    *   Filters instruction execution between program start/stop boundaries.
    *   Generates branch atom packets (`E` / `N`), exact address matches, and context changes.
2.  **DWT (Data Watchpoint and Trace)**:
    *   Configures Comparators 0 and 1 to match instruction fetch addresses corresponding to `StartPoint()` and `StopPoint()`.
    *   Controls ETM `ViewInst` gating (`TRCVICTLR` and `TRCVIPCSSCTLR`) strictly in hardware.
3.  **CSTF (CoreSight Trace Funnel)**:
    *   Arbitrates trace streams across slave ports and configures minimum hold times.
4.  **ETF (Embedded Trace FIFO / TMC)**:
    *   Configures on-chip SRAM in Hardware FIFO mode (`MODE = 0x2`) to absorb trace bursts and prevent pipeline stalling.
5.  **TPIU (Trace Port Interface Unit)**:
    *   Frames the ATB data stream, sets 4-bit parallel port size (`CURPSIZE = 8`), and drives external physical pins.
6.  **TSG (Timestamp Generator)**:
    *   Enables the CoreSight 64-bit global timestamp counter (`0x5C005000`) for absolute wall-clock timing correlations.

---

## 3. Physical Trace Pinout Mapping (STM32H750)

| Signal Name | MCU Pin | Alternate Function | Target Logic Analyzer Channel |
| :--- | :--- | :--- | :--- |
| **`TRACECLK`** | `PE2` | AF0 (`AF0_TRACE`) | Channel 0 (Clock input) |
| **`TRACED0`** | `PE3` | AF0 (`AF0_TRACE`) | Channel 1 (Data bit 0) |
| **`TRACED1`** | `PE4` | AF0 (`AF0_TRACE`) | Channel 2 (Data bit 1) |
| **`TRACED2`** | `PE5` | AF0 (`AF0_TRACE`) | Channel 3 (Data bit 2) |
| **`TRACED3`** | `PE6` | AF0 (`AF0_TRACE`) | Channel 4 (Data bit 3) |
| **`GND`** | `GND` | Ground Reference | Logic Analyzer Ground Grounding Clip |

---

## 4. Integration Guide into Any STM32 Project

### Step 1: Add Files to Project
*   Copy `ETMv4.h` into your `Core/Inc/` directory.
*   Copy `ETMv4.c` into your `Core/Src/` directory.

### Step 2: Include Header in `main.c`
```c
#include "ETMv4.h"
```

### Step 3: Configure and Arm the Trace Pipeline
In `main()`, after basic system clock and GPIO initialization, call:
```c
/* Arms trace pins, TPIU, ETF, Funnel, TSG, ETM, and DWT triggers */
Parallel_Trace_configure();

/* Optional: Snapshot initial hardware registers */
Trace_DumpStatus();
```

### Step 4: Bound Code Under Measurement
Enclose any function, block, or critical section between `StartPoint()` and `StopPoint()`:
```c
/* Start tracing here (DWT COMP0 matches) */
StartPoint();

/* ==============================================
 * Critical Algorithm / Task Under Analysis
 * (No instrumentation required inside this block)
 * ============================================== */
Execute_Mission_Task();

/* Stop tracing here (DWT COMP1 matches) */
StopPoint();
```

---

## 5. Diagnostic and Register Verification
The driver includes `Trace_DumpStatus()`, which reads back all active CoreSight registers into `g_trace_status`:
*   `g_trace_status.etm_stat` — bit 0 (IDLE) and bit 1 (PMSTABLE).
*   `g_trace_status.dwt_func0` / `dwt_func1` — bit 24 (MATCHED) confirms whether triggers fired.
*   `g_trace_status.etf_rwp` — non-zero write pointer proves trace data reached the FIFO.
*   `g_trace_status.tsg_cvl` — increasing value proves timestamp clock is alive.
