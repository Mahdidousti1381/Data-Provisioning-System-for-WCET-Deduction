# Trace Execution & Hardware Timing Report

**Snapshot:** `OpenCSD_Snapshot`  
**Disassembly Source:** `OpenCSD_Snapshot_decoded_3.ppl`  
**Generated:** 9/12/2026, 4:04:50 PM  

---

## 1. Clock Configuration & Calibration

All µs figures below are derived from the **supplied** clock values - the trace stream does not encode them.

| Parameter | Value | Notes |
| :--- | :--- | :--- |
| **Core Clock** | **1 MHz** | Used to convert elapsed time to core cycles |
| **Timestamp Clock (TSG)** | **1 MHz** | 1 tick = 1.0000 µs |
| **Measured ticks / cycle** | **0.999919** | &Delta;TS over the window &divide; total CYCLE_COUNT cycles |

> Consistent. The trace gives 0.999919 ticks per core cycle, matching the 1 MHz / 1 MHz pair you supplied (expected 1). 1 tick = 1.0000 µs. The TSG advances once per core cycle on this board, so timestamp resolution tracks the core clock.

### Decoder Warnings

- 1 of 497 exceptions are missing an entry or exit timestamp; their duration is reported as N/A and they are excluded from timing statistics.
- 1 handlers were still active when the trace ended.
- 1036 bytes at the head of the capture were discarded before the first A-Sync packet. This is normal: the ETM only emits a sync pattern every TRCSYNCPR bytes, so a capture started at an arbitrary instant always loses up to one sync period. It does not mean the logic analyser missed data.

---

## 2. Stream Synchronisation

| Parameter | Value | Notes |
| :--- | :--- | :--- |
| **Bytes discarded before first sync** | **1,036** | Unsynchronised head of the capture |
| **`I_NOT_SYNC` elements** | 144 | Decoder reports of pre-sync bytes |
| **First `I_ASYNC` at byte** | 1,036 | Point where decoding actually begins |
| **A-Sync packets in capture** | 93 | One per `TRCSYNCPR` period |
| **Mean sync period** | 1,026 bytes | Matches `2^TRCSYNCPR` |

*The head of every capture is unsynchronised. The ETM emits its alignment-sync pattern only once per sync period, so a capture started at an arbitrary instant must wait up to a full period before the decoder can lock on. Those bytes are valid trace data that cannot be interpreted without a preceding sync point - they are not data the logic analyser failed to record. Lower `TRCSYNCPR` to shorten this head, at the cost of trace-port bandwidth.*

---

## 3. Hardware Timestamps & Active Window Duration

| Parameter | Hardware Value | Notes |
| :--- | :--- | :--- |
| **First Timestamp (post-sync)** | `0x52274610` | First TS after the decoder synchronised |
| **Last Timestamp (Trace End)** | `0x522ED84C` | End of captured trace window |
| **Trace Window (&Delta;TS)** | **496,188 ticks** | Raw TSG ticks |
| **Trace Window Duration** | **496,188 µs (496.188 ms)** | @ 1 MHz TSG |
| **Total Core Clock Cycles** | **496,228** | Accumulated CCI cycle packets |
| **Total Instructions Executed** | **233,210** | Real executed instructions decoded |
| **Average CPI** | **2.13** | Clock cycles per instruction ratio |
| **Branch Decisions (`I_ATOM`)** | **34,320** | Branch outcome atoms (E/N) |
| **Total Trace Packets** | **188,723** | Lines parsed from capture |

---

## 4. Exception & IRQ Service Routine Analysis

ISR duration is measured from the **entry timestamp** (first `TIMESTAMP` inside the handler, which the ETM emits in response to the exception) to the **exit timestamp** (first `TIMESTAMP` after `EXCEPTION_RET`). This span includes the exception entry latency but excludes the unstacking that follows the return, so it is a **lower bound** on the interference seen by the preempted thread.

| Metric | Value | Description |
| :--- | :--- | :--- |
| **`EXCEPTION` elements seen** | **497** | Raw decoder elements |
| **`EXCEPTION_RET` elements seen** | **496** | Raw decoder elements |
| **Records produced** | **497** | All exceptions accounted for |
| **Records missing a timestamp** | **1** | Excluded from timing statistics |
| **Max nesting depth** | **1** | No preemption |
| **IRQ Inter-Arrival Interval** | **999.998 µs** | Entry-to-entry, dominant vector |
| **Total CPU Time in All ISRs** | **16864.000 µs / 16,864 cycles (3.4%)** | Cumulative interrupt overhead |
| **Main Thread Execution** | **479,364 cycles (96.60%)** | Application main loop |
| **Average Cost per ISR** | **34 cycles (34.000 µs @ 1 MHz)** | Mean per invocation |
| **Instructions Executed per ISR** | **8 instrs** | Excludes nested handlers |

### CPU Execution Split by ISR Type

| Exception / ISR Type | Vector | Count | Period | Mean Dur | **Max Dur (WCET obs.)** | Max Cycles | Mean Instrs | Max Instrs | CPU % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **SysTick (0x0F)** | `0X0F` | 497 | 999.998 µs | 34.000 µs | **34.000 µs** | 34 | 8 | 8 | **3.4%** |

*Max duration is the largest observed value, i.e. a high-water mark, not a proven worst case.*

### Timestamps Before and After IRQ Service Routines

| # | Type | D | Pre-IRQ TS | Entry TS | Exit TS | &Delta;TS (ticks) | Duration | Cycles | Instrs | Est. Entry Ovh |
| :-: | :--- | :-: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | SysTick (0x0F) | 0 | `0x52274610` | `0x522746CD` | `0x522746EF` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 2 | SysTick (0x0F) | 0 | `0x522746EF` | `0x52274AB4` | `0x52274AD6` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 3 | SysTick (0x0F) | 0 | `0x52274AD6` | `0x52274E9D` | `0x52274EBF` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 4 | SysTick (0x0F) | 0 | `0x52274EBF` | `0x52275284` | `0x522752A6` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 5 | SysTick (0x0F) | 0 | `0x522752A6` | `0x5227566D` | `0x5227568F` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 6 | SysTick (0x0F) | 0 | `0x5227568F` | `0x52275A54` | `0x52275A76` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 249 | SysTick (0x0F) | 0 | `0x522B0BC7` | `0x522B0F8C` | `0x522B0FAE` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 250 | SysTick (0x0F) | 0 | `0x522B0FAE` | `0x522B1375` | `0x522B1397` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 494 | SysTick (0x0F) | 0 | `0x522EC8CE` | `0x522ECC95` | `0x522ECCB7` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 495 | SysTick (0x0F) | 0 | `0x522ECFC1` | `0x522ED07C` | `0x522ED09E` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 496 | SysTick (0x0F) | 0 | `0x522ED09E` | `0x522ED465` | `0x522ED487` | 34 | **34.000 µs** | 34 | 8 | 17 |
| 497 ⚠ | SysTick (0x0F) | 0 | `0x522ED487` | `0x522ED84C` | `N/A` | N/A | **N/A** | N/A | 8 | N/A |

*Representative sample (start, middle, end). Total occurrences: 497. "D" is nesting depth; a bracketed instruction count is the inclusive figure. "Est. Entry Ovh" is `cycles − instructions × CPI`, an estimate of exception entry latency.*

---

## 5. Execution Hotspots (Address Distribution)

| Rank | Address Range | Instructions Executed | % Share |
| :-: | :--- | :---: | :---: |
| 1 | `0x80009ec` | 98,244 | 42.13% |
| 2 | `0x80009c8` | 97,250 | 41.7% |
| 3 | `0x80009e8` | 32,748 | 14.04% |
| 4 | `0x80009b0` | 3,479 | 1.49% |
| 5 | `0x80009ca` | 992 | 0.43% |
| 6 | `0x80007f0` | 497 | 0.21% |

*Instructions are attributed to the start address of each decoded `exec range`, not to individual addresses.*
