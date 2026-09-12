# Scenario 4: Projects Day Live Demonstration (`04_ProjectsDay_WCET_Demo`)

> **Presenting this?** Read [`PROJECTS_DAY_GUIDE.md`](PROJECTS_DAY_GUIDE.md) — the booth runbook.
> This file is the specification.

---

## 1. What this scenario is

An ordinary STM32CubeIDE application, written the way a user of this framework would write one, and
then traced from the outside.

The application contains **no trace code at all** - and neither does anything else shipped here.
There is no `ETMv4.c`, no `ETMv4.h`, no `#include`, no counters, no timestamps. Search the whole
`Firmware_Source/` tree for `ETM`, `StartPoint`, `StopPoint`, `DWT` or `CoreSight` and you get
nothing.

Everything trace-related is added by CoreSight Trace Studio, live, in front of the audience:

| Extension action | What it writes into `main.c` |
| :--- | :--- |
| *Inject driver / includes* | `#include "ETMv4.h"` after `/* USER CODE BEGIN Includes */`, and drops `ETMv4.c` / `ETMv4.h` into the project |
| *Inject config function* | `Parallel_Trace_configure();` after `/* USER CODE BEGIN 2 */` |
| *Trace Window Mode* (Tab 1) | writes ViewInst into `ETMv4.c`: DWT-gated, or unconditional |
| *Wrap selection* | select the single line `App_Run();`; it becomes `StartPoint();` / `App_Run();` / `StopPoint();`, or `Enable_ETM();` / `App_Run();` / `Disable_ETM();` depending on the mode |

Every timing number in the demonstration is therefore recovered from four data pins and a clock pin,
from a program that was never modified to produce them.

---

## 2. The application

`App.c` is a small periodic control task sharing a CPU with a serial link.

| Interrupt | Priority | Role |
| :--- | :---: | :--- |
| `TIM6_DAC_IRQn` | **0** | 1 ms control tick |
| `USART1_IRQn` | **1** | serial RX |
| `EXTI9_5_IRQn` | **2** | start button on PC5 |

Because TIM6 outranks USART1, a tick arriving while `HAL_UART_RxCpltCallback()` is still running
**preempts** it — the CPU stacks a second exception frame without returning to thread mode. The RX
callback runs a CRC over its frame, which takes longer than one tick period, so this happens on
every run.

### One run — `App_Run()`

```
[ StartPoint() ]                  <- injected by the extension
   HAL_TIM_Base_Start_IT()        1 ms control tick starts
   App_Dispatch()                 run queued jobs through a function pointer
                                  table - indirect calls, target chosen at
                                  run time
   Routine_Sort(sorted input)     best case  - inner loop never runs
   Routine_Sort(reversed input)   worst case - inner loop runs n(n-1)/2 times
   HAL_UART_Receive_IT()          arm the receiver
   HAL_UART_Transmit()            send one byte to the peer
   background Routine_Crc16()     until the peer answers
        -> peer answers, HAL_UART_RxCpltCallback() runs a heavy CRC
        -> the 1 ms tick lands inside it and preempts it
   svc #0
   HAL_TIM_Base_Stop_IT()
[ StopPoint() ]                   <- injected by the extension
```

The job phase is the hardest case in the run for a decoder, because the call target is only known at
run time and cannot be inferred from the binary. It doubles as the fallback described in section 8.

The two `Routine_Sort()` calls are the same function, on the same amount of data, and they return
**the same result**. Only the run time differs — which is the measurement-based WCET argument in two
lines of code.

`PA1` is driven high while the run is in progress. That is ordinary busy-LED behaviour, and it also
gives the logic analyser something to trigger on.

### Why the workload survives the optimiser

Two idioms look redundant and are not:

* `Routine_Crc16()` takes a `seed` and every caller chains the previous result in. Without a data
  dependency the calls are pure and loop-invariant, and the compiler may hoist them out of the loop
  or fold N of them into one — deleting the work the timing depends on.
* The sort buffer is reached through a `volatile` pointer, so constant propagation cannot
  pre-compute either sort at build time.

Verified in the generated assembly at `-O2`: both sorts are separate calls in order, and both CRC
loops are intact. `App.c` compiles warning-free under `-Wall -Wextra` at `-O0`, `-Og`, `-O2`, `-Os`.

---

## 3. What comes out of the trace

| Poster claim | Evidence in the decode |
| :--- | :--- |
| **Zero probe effect** | The application has no instrumentation to remove — the comparison is the point. The recovered core clock matches the configured one, which it could not if tracing stole cycles. |
| **Cycle resolution, zero jitter** | Decoded `TS` deltas between consecutive TIM6 entries read 1000 ± 1, and ±1 is the timestamp quantisation floor. |
| **Per-routine and per-ISR separation** | Four exception numbers decode out of one byte stream — TIM6, USART1, SysTick, SVCall — each with its own entry TS, exit TS, cycles and instruction count. |
| **WCET data provisioning** | Same routine, best-case and worst-case inputs, identical results, roughly an order of magnitude apart in cycles. |
| **HIL interference analysis** | TIM6 preempts the USART1 callback. The decode separates that callback's own execution cycles from its response time — the interference term of response-time analysis, measured rather than estimated. |

Exception numbers (on Cortex-M, `excep num` is the IPSR value = IRQn + 16):

| `excep num` | Handler |
| :---: | :--- |
| `0x46` | `TIM6_DAC_IRQHandler` — priority 0, **preempts** |
| `0x35` | `USART1_IRQHandler` — priority 1, **gets preempted** |
| `0x27` | `EXTI9_5_IRQHandler` — priority 2 |
| `0x0f` | `SysTick_Handler` — HAL's 1 kHz tick, priority 15 |
| `0x0b` | `SVC_Handler` |

SysTick is left running. It is the lowest priority in the system so it never preempts anything, and
it is a fair picture of a real HAL application. `verify_demo.py` reports it separately.

Expected scale: window ~5–12 ms, ~1–2.5 kB of trace, a `.ppl` of a few thousand lines.

---

## 4. Directory contents

```
04_ProjectsDay_WCET_Demo/
├── README.md                     # this file
├── PROJECTS_DAY_GUIDE.md         # the booth runbook
├── Firmware_Source/Core/          # no trace files here, by design
│   ├── Inc/  App.h  main.h  stm32h7xx_hal_conf.h  stm32h7xx_it.h
│   └── Src/  App.c  main.c  stm32h7xx_hal_msp.c  stm32h7xx_it.c
├── Host_Tools/
│   ├── verify_demo.py            # .ppl -> evidence table with PASS/FAIL
│   └── pico_echo.py              # Raspberry Pi Pico echo firmware
├── Trace_Capture/                # DSView CSV lands here
├── OpenCSD_Snapshot/             # TraceStreamProcessor.py writes here
└── Decoded_Execution_Log/        # the .ppl lands here
```

Only the files this scenario owns or changes are included. Drop them into a working CubeIDE project
alongside the untouched `Drivers/`, `Core/Startup/`, `syscalls.c`, `sysmem.c`,
`system_stm32h7xx.c` and the linker scripts.

`ETMv4.c` / `ETMv4.h` are deliberately **not** here. The extension ships them
(`05_VSCode_Coresight_Trace_Studio_Extension/templates/`) and installs them into the project, which
is the whole point of the demonstration. A reference copy also lives in `06_ETMv4_Driver_Module/`.

`stm32h7xx_hal_conf.h` is included because it changes: `HAL_TIM_MODULE_ENABLED` and
`HAL_UART_MODULE_ENABLED` are switched on, `HAL_SPI_MODULE_ENABLED` off. Add
`stm32h7xx_hal_tim.c`, `stm32h7xx_hal_tim_ex.c`, `stm32h7xx_hal_uart.c` and
`stm32h7xx_hal_uart_ex.c` to the build.

---

## 5. Hardware

| Signal | MCU pin | Goes to |
| :--- | :--- | :--- |
| `TRACECLK` | `PE2` | DSLogic CH0 |
| `TRACED0..3` | `PE3`–`PE6` | DSLogic CH1–CH4 |
| busy LED | `PA1` | DSLogic CH5 — **trigger source** |
| `USART1_TX` | `PA9` (AF7) | Pico GP5 / pin 7 |
| `USART1_RX` | `PA10` (AF7) | Pico GP4 / pin 6 |
| start button | `PC5` | to GND, internal pull-up |
| `GND` | `GND` | Pico GND **and** the DSLogic ground clip |

Both parts are 3.3 V. Do not cross to 5 V. `PA13/PA14` (SWD) are off limits.

---

## 6. Running it

```bash
# build Debug, flash the ELF, save pico_echo.py on the Pico as main.py
# arm the DSLogic (trigger CH5 rising), press PC5 once, export CSV

python3 ../../04_Python_Trace_Decoder/TraceStreamProcessor.py \
        "Trace_Capture/<capture>.csv" "Firmware_Source/Debug/<project>.elf"

trc_pkt_lister -ss_dir "Trace_Capture/<capture>_snapshot" -logstdout -decode -stats \
        > Decoded_Execution_Log/demo.ppl

python3 Host_Tools/verify_demo.py Decoded_Execution_Log/demo.ppl \
        --syms Firmware_Source/Debug/<project>.list \
        --csv  Decoded_Execution_Log/evidence.csv
```

`verify_demo.py` prints capture health, the recovered core clock, the exception inventory, the
nested-preemption report with its interference decomposition, the tick-cadence table,
symbol-resolved hotspots, and a PASS/FAIL line per poster claim. It exits non-zero on any failure,
so it works as a dry-run gate. Its timestamp conventions match the extension's `ReportGenerator`,
so its numbers and the generated HTML report agree.

---

## 7. Tunables

| Symbol | Where | Default | Effect |
| :--- | :--- | :---: | :--- |
| `htim6.Init.Period` | `main.c` | `999` | 1 ms tick at PCLK1 = 1 MHz |
| `g_rx_crc_passes` | `App.c` | `2` | Work in the RX callback. Must exceed one tick period. Volatile, so it can be raised from the debugger without a reflash. |
| `g_warmup_rounds` | `App.c` | `64` | Jobs run at the head of the task. Also the sync fallback - see section 8. Volatile. |
| `APP_FRAME_LEN` | `App.h` | `32` | Bytes the CRC covers |
| `APP_SORT_LEN` | `App.h` | `16` | Worst case is `n(n-1)/2` = 120 inner iterations |
| `APP_ECHO_TIMEOUT_TICKS` | `App.h` | `8` | Echo wait bound, in ticks, so a missing peer cannot inflate the capture |

---

## 8. Trace window mode, and synchronisation

The extension's Tab 1 offers two ways to bound a window. They are not interchangeable, and the
choice drives both the injected calls and the ViewInst registers in `ETMv4.c`.

| | **DWT Start/Stop Gated** | **Unconditional (Trace All)** |
| :--- | :--- | :--- |
| `TRCVIPCSSCTLR` | comp 0 start, comp 1 stop | `0x00000000` |
| `TRCVICTLR` | `0x00000001` | `0x00000201` |
| Injected calls | `StartPoint()` / `StopPoint()` | `Enable_ETM()` / `Disable_ETM()` |
| Boundary cost | none - matched in hardware | the enable/disable writes themselves |
| Synchronisation | only the periodic anchor | fresh sync sequence on every enable |

### The synchronisation constraint

The ETM emits its alignment anchor (A-Sync) every `2^TRCSYNCPR` bytes, and **`TRCSYNCPR` is
read-only at 10 on this silicon** - one anchor per 1024 bytes, and no software can shorten it.
OpenCSD produces nothing until it sees one. Measured on the scenario 00 capture in this repository:

```
93 A-Sync anchors in 95,854 bytes          ->  one every 1030 bytes
Total Bytes: 95854; Unsynced Bytes: 1036   ->  discarded before the decoder locked
overall density: 95,854 bytes / 496,228 cycles = 0.193 bytes per cycle
```

So a DWT-gated window has to emit about 1024 bytes - roughly 5,300 cycles, 5.3 ms at 1 MHz - before
anything decodes. For this scenario that is most of the window.

**Unconditional mode does not have that problem**, because switching the trace unit on is itself a
synchronisation point. That is the trade: hardware-gated boundaries, or a guaranteed anchor.

### Which to use here

Start in **Unconditional (Trace All)**. It is the mode that reliably yields a decodable capture of a
short window, and the run is short precisely because a short run keeps the CSV and the decode log
light.

If you want the DWT-gated version - and it is worth showing, because zero-cost hardware boundaries
are the stronger claim - budget for the 1024 bytes. Raise `g_warmup_rounds`: the job phase emits
roughly 1.7 to 3 bytes per round, so 1024 rounds forces the periodic anchor to arrive inside it,
leaving the measured phases fully decoded. The count is in **rounds, not milliseconds**, because
trace bytes scale with branches executed rather than elapsed time - a round count emits the same
bytes at `-O0` and `-O2`, while a time bound would emit ~40 % fewer on a debug build.

`verify_demo.py` prints `discarded before lock` straight from the decoder's own statistics. That is
the number to watch whichever mode you pick.
