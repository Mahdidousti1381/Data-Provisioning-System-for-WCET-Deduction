# Projects Day — Booth Runbook

Scenario 4. Everything you need to do, in order.

---

## 0. The demo in one breath

> *"This is an ordinary application. A control loop, a serial link, some maths. There is not one
> line of debug code in it — no printf, no counters, no trace driver, nothing that knows it is being
> watched. My extension adds the tracing, here, now, in front of you. Then I press the button, and
> four wires carry the processor's own execution trace off the chip. From that I rebuild every
> instruction it executed and the cycle it executed on — and I find something the code never
> reported: the timer interrupt cutting into the middle of the serial handler."*

**The one number:** the core clock, recovered from the trace alone — `1.0000xx MHz`.
**The one picture:** two `EXCEPTION` lines with one `EXCEPTION_RET` between them.

---

## 1. What is on the table

| Item | Notes |
| :--- | :--- |
| STM32H750VBT6 board | flashed, **Debug** build |
| Raspberry Pi Pico | `Host_Tools/pico_echo.py` saved as `main.py` |
| DSLogic U3Pro16 + probes | 6 channels |
| Laptop | VS Code + CoreSight Trace Studio (rebuilt VSIX), DSView, Python 3, `trc_pkt_lister` |
| The poster | on the wall behind you |
| Printed cheat card | section 9 |
| USB stick | the fallback capture |

### Wiring — tick every line before powering anything

```
[ ]  PE2  TRACECLK   -> DSLogic CH0
[ ]  PE3  TRACED0    -> DSLogic CH1
[ ]  PE4  TRACED1    -> DSLogic CH2
[ ]  PE5  TRACED2    -> DSLogic CH3
[ ]  PE6  TRACED3    -> DSLogic CH4
[ ]  PA1  LED        -> DSLogic CH5        <- capture TRIGGER
[ ]  GND             -> DSLogic ground clip

[ ]  PA9  (USART1 TX) -> Pico GP5 / pin 7
[ ]  PA10 (USART1 RX) <- Pico GP4 / pin 6
[ ]  GND              -- Pico GND / pin 8

[ ]  PC5 button to GND
```

Both parts are 3.3 V. **Do not cross to 5 V.**
If the Pico never echoes, TX/RX are swapped — the most likely fault and the cheapest to check.

---

## 2. The night before

### 2.1 Get it building

Start from scenario 03's CubeIDE project and copy in from `Firmware_Source/Core/`:

* **new:** `Inc/App.h`, `Src/App.c` — add them to the build
* **replace:** `Src/main.c`, `Src/stm32h7xx_it.c`, `Src/stm32h7xx_hal_msp.c`, `Inc/main.h`,
  `Inc/stm32h7xx_hal_conf.h`
* **delete:** `TestApp.c` / `TestApp.h` if still present
* **delete `ETMv4.c` and `ETMv4.h` from the project.** This matters: the extension puts them there
  during the demo, and it cannot demonstrate that if they are already present.

> The project must **not compile** with tracing until the extension has run. That is the point —
> when a referee asks what your tool actually does, the answer is visible in the diff.

`stm32h7xx_hal_conf.h` now enables TIM and UART and disables SPI, so **add these to the build**:
`stm32h7xx_hal_tim.c`, `stm32h7xx_hal_tim_ex.c`, `stm32h7xx_hal_uart.c`, `stm32h7xx_hal_uart_ex.c`.
`stm32h7xx_hal_spi.c` can go.

If you would rather regenerate from CubeMX: enable **USART1** (asynchronous, 9600 8N1, global
interrupt on), **TIM6** (prescaler 0, period 999, global interrupt on), **PA1** as output `LED`,
**PC5** as `GPIO_EXTI5` falling with pull-up, and remove SPI1. Then set the NVIC priorities to
TIM6 = 0, USART1 = 1, EXTI9\_5 = 2. My files already match that configuration.

Build **Debug**. Save both `.elf` and `.list` — the ELF must be the exact build that was running
during the capture, or every address resolves to the wrong function.

Save `pico_echo.py` on the Pico as `main.py`. It blinks three times at boot. Open a REPL once and
confirm `n` climbs by one per button press.

### 2.2 Functional check

Press the button, break after `App_Run()` returns, and read `g_app`:

| Field | Must be | If not |
| :--- | :--- | :--- |
| `run_count` | 1, then 2, 3… | the run never happened — check the button and `g_start_request` |
| `echo_ok` | **1** | the Pico is not answering — TX/RX swapped, unpowered, or wrong baud |
| `sort_best` == `sort_worst` | **yes** | the sort inputs are wrong |
| `jobs_done` | `64` | the opening job phase completed |
| `ticks` | 8–12 | run length sanity |

That is all the firmware can tell you, by design. **Everything about timing comes from the trace**,
which is exactly the point you are making — so the real check is section 2.4.

### 2.3 DSLogic settings — find them once, write them down

1. Capture once at **100 MS/s** with a large depth. Decode it. Confirm it works.
2. Zoom into `TRACECLK` in DSView and read its period, `T`.
3. Set the sample rate to about **20 × (1/T)**, rounded to a rate DSView offers.
4. Set the depth so the capture spans **~25 ms**: `depth = rate × 0.025`.
5. Trigger: **CH5 (PA1), rising edge, position ~10 %**.
6. Re-capture, re-decode, confirm, and **write the numbers on the cheat card.**

| Preset | Rate | Depth | Span | CSV | When |
| :--- | ---: | ---: | ---: | ---: | :--- |
| Safe | 100 MS/s | 2.5 M | 25 ms | ~45 MB | first dry run only |
| **Booth** | **20 MS/s** | **500 k** | **25 ms** | **~8 MB** | the day itself |
| Tight | 10 MS/s | 250 k | 25 ms | ~4 MB | only if verified |

Measure your actual window first (`verify_demo.py` prints it) and trim the depth to fit it plus
50 %. There is no value in capturing idle time.

Triggering on PA1 brackets the run automatically, so the CSV is the same small size every time
instead of depending on your reaction speed.

### 2.4 The one thing to understand about this capture

OpenCSD produces nothing until it sees an A-Sync anchor. The ETM emits one every `2^TRCSYNCPR`
bytes, and **`TRCSYNCPR` is read-only at 10** on this silicon — 1024 bytes, and no software can
shorten it. Measured on the scenario 00 capture in this repository:

```
93 A-Sync anchors in 95,854 bytes          -> one every 1030 bytes
Total Bytes: 95854; Unsynced Bytes: 1036   -> discarded before the decoder locked
0.193 trace bytes per core cycle
```

That is ~1024 bytes — about 5.3 ms at 1 MHz — before a DWT-gated window decodes anything.

**So the demo runs in Unconditional (Trace All) mode.** Switching the trace unit on is itself a
synchronisation point, so the window carries its own anchor and can be short. Tab 1 sets the mode,
writes it into `ETMv4.c`, and injects `Enable_ETM()` / `Disable_ETM()` instead of
`StartPoint()` / `StopPoint()`.

If you also want to show the DWT-gated version — and it is the stronger claim, because the boundary
then costs the CPU nothing — raise `g_warmup_rounds` to 1024 first. The job phase emits ~1.7–3 trace
bytes per round, so that forces the periodic anchor to land inside it and leaves the measured phases
fully decoded. Counted in rounds, not milliseconds, because trace bytes scale with branches
executed, not elapsed time.

`verify_demo.py` §1 prints `discarded before lock`. Watch it in either mode.

### 2.5 Run the whole chain

```bash
cd 03_Embedded_Test_Scenarios/04_ProjectsDay_WCET_Demo

python3 ../../04_Python_Trace_Decoder/TraceStreamProcessor.py \
        "Trace_Capture/<capture>.csv" "Firmware_Source/Debug/<project>.elf"

trc_pkt_lister -ss_dir "Trace_Capture/<capture>_snapshot" -logstdout -decode -stats \
        > Decoded_Execution_Log/demo.ppl

python3 Host_Tools/verify_demo.py Decoded_Execution_Log/demo.ppl \
        --syms Firmware_Source/Debug/<project>.list \
        --csv  Decoded_Execution_Log/evidence.csv
```

**It passes when section 8 shows five `[PASS]` lines.** If "TIM6 preempts the USART1 handler" fails,
raise `g_rx_crc_passes` to 3 or 4 from the debugger — no reflash — and capture again.

Then **copy the whole working set to the USB stick**: CSV, `_snapshot/`, `.ppl`, `evidence.csv`,
`.elf`, `.list`.

> Reset the board between captures anyway — one reset, one press, one window. It keeps the runs
> comparable and stops a bounced button queueing a second one.

---

## 3. Showing the extension — this is now the centrepiece

Do this **before** you capture anything, with `App.c` and `main.c` open in the editor.

### 3.1 Show them the program first

Open `App.c` and scroll through it. Then run this in the terminal, in front of them:

```bash
grep -rn "ETM\|StartPoint\|StopPoint\|CoreSight\|DWT" Firmware_Source/Core/Src Firmware_Source/Core/Inc
```

It prints nothing.

> *"This is the program. A control tick, a serial link, a sorting routine, a CRC. It has no debug
> code, no counters, no trace driver — it does not even have the header. Nothing in here knows it is
> going to be measured. Watch what my tool does to it."*

### 3.2 Tab 1 — Hardware Wizard & Pinout

Point at the pipeline: `Cortex-M7 → ETMv4 → CSTF funnel → ETF FIFO → TPIU → PE2..PE6`.

> *"All of this is hardware that already exists in the silicon. My work is making it usable without
> a three-thousand-euro probe."*

### 3.3 Tab 2 — ETMv4 Configuration, and the injection

| Register | Value | What to say |
| :--- | :--- | :--- |
| `TRCCONFIGR` | bit 4 **CCI**, bit 11 **TS** | *"cycle counting and timestamps on — this is what makes it cycle-accurate rather than just a control-flow log."* |
| `TRCCCCTLR` | `64` | *"report the cycle count at least every 64 cycles."* |
| `TRCSYNCPR` | `10` (1024 B) | *"greyed out — read-only on Cortex-M7 silicon. The tool detects that and refuses to let you write it. And that one read-only register decides how this whole capture has to be structured — I will come back to it."* |
| `TRCVIPCSSCTLR` | comp 0 starts, comp 1 stops | *"DWT comparator 0 on `StartPoint()`, comparator 1 on `StopPoint()`. Pure hardware gating — the CPU never checks a flag."* |

Now inject, in this order, letting them watch the editor change each time:

1. **Update `ETMv4.c`** — the driver appears in `Core/Src` and `Core/Inc`, carrying the register
   values from the tab.
2. **Back in Tab 1, set *Trace Window Mode*** and press **Apply to ETMv4.c**. Show the diff: with
   *Unconditional* the driver writes `VIPCSSCTL = 0` and `VICTL = 0x201`; with *DWT Start/Stop
   Gated* it writes the comparator pair and `VICTL = 0x1`. The selector in Tab 2 tracks it, because
   it is the same setting seen from the register side.
3. **Inject config function** — `#include "ETMv4.h"` appears under
   `/* USER CODE BEGIN Includes */`, and `Parallel_Trace_configure();` under
   `/* USER CODE BEGIN 2 */`.
4. **Select the single line `App_Run();`** in `main.c`, right-click → **CoreSight Trace** → **Wrap
   Selection with Trace Window**. The mode decides which pair you get:

```c
      /* Unconditional (Trace All) */          /* DWT Start/Stop Gated */
      Enable_ETM();                            StartPoint();
      App_Run();                               App_Run();
      Disable_ETM();                           StopPoint();
```

> *"One selector. It writes the ViewInst registers in the driver and it decides which pair of calls
> goes into my code, so the two can never disagree — which is exactly the mistake that costs you an
> afternoon when you do this by hand."*

The same actions are on the editor's right-click menu under **CoreSight Trace**, including entries
that force either pair regardless of the mode. That is worth showing: you never have to open the
dashboard to instrument a file.

Now build and flash, with them watching. **That is the demo of the extension**, and it is worth more
than any screenshot.

### 3.4 Tab 3 — Decompression & Analysis

Where you run the decode in section 4.

## 4. The live run — four minutes

Have DSView, VS Code and a terminal already open and positioned.

| # | Do | Say |
| :---: | :--- | :--- |
| 1 | **Reset the board.** Arm DSView. | *"The analyser is armed, waiting for the board to say it has started."* |
| 2 | **Press PC5 once.** | *"One press, one run, a few tens of milliseconds."* |
| 3 | **File → Export → CSV** into `Trace_Capture/`. | *"Raw electrical capture — five signals, nothing decoded."* |
| 4 | Run `TraceStreamProcessor.py`. | *"This finds the clock edges in the middle of the eye, rebuilds the nibbles into TPIU frames, checks the framing, and packages an OpenCSD snapshot with the memory image from the ELF."* Point at `A-Sync spacing … (even)` and `intervals not a whole frame : 0`. |
| 5 | Tab 3 → **Run Decoder**. | *"Linaro's reference decoder replaying my capture. Every line is an instruction the processor actually executed."* |
| 6 | **Generate Report**. | *"Window duration, per-interrupt timeline, CPU split, hotspots."* |
| 7 | Run `verify_demo.py`. | *"And this checks each poster claim against the log."* |
| 8 | **Section 5. Do not skip it.** | The finish. |

In `verify_demo.py` section 1, point at `discarded before lock`:

> *"Remember that read-only register — the trace unit only emits its alignment marker every 1024
> bytes, and I cannot make it more often. My whole window is smaller than that. That is why I am
> running in unconditional mode: switching the trace unit on is itself a synchronisation point, so
> the window carries its own marker. That number is how many bytes the decoder had to discard
> before it locked."*

---

## 5. THE ONE THING TO FIND IN THE OPENCSD LOG

Everything above is the chain. This is the result.

A high-priority interrupt entering while a lower-priority handler is still running: **two
`EXCEPTION` elements with only one `EXCEPTION_RET` between them.**

| `excep num` | Handler | Priority |
| :---: | :--- | :---: |
| `0x46` | `TIM6_DAC_IRQHandler` | **0 — preempts** |
| `0x35` | `USART1_IRQHandler` | 1 — **preempted** |
| `0x27` | `EXTI9_5_IRQHandler` | 2 |
| `0x0f` | `SysTick_Handler` | 15 |
| `0x0b` | `SVC_Handler` | — |

### Three commands

```bash
cd Decoded_Execution_Log

# (a) the exception skeleton of the whole run
grep -nE "OCSD_GEN_TRC_ELEM_EXCEPTION\(|OCSD_GEN_TRC_ELEM_EXCEPTION_RET\(\)" demo.ppl \
 | sed -E 's/^([0-9]+):.*excep num \((0x[0-9a-f]+)\).*/line \1  ENTER  \2/;
           s/^([0-9]+):.*EXCEPTION_RET.*/line \1  return/'

# (b) the nesting, by depth. PRINTS THE LINE NUMBER YOU WANT.
grep -nE "OCSD_GEN_TRC_ELEM_EXCEPTION\(|OCSD_GEN_TRC_ELEM_EXCEPTION_RET\(\)" demo.ppl \
 | awk -F: '/excep num/ { if (d>0) printf "  NESTED: .ppl line %s  at depth %d\n", $1, d+1; d++ }
            /EXCEPTION_RET/ { if (d>0) d-- }'

# (c) which handlers fired, and how often
grep -o "excep num (0x[0-9a-f]*)" demo.ppl | sort | uniq -c
```

`(a)` reads something like — there will be many more ticks than this, from the job phase:

```
line  611  ENTER  0x0f      <- SysTick. Lowest priority, background noise.
line  640  return
line  842  ENTER  0x46      <- TIM6 tick in thread mode. Ordinary.
line  871  return
   ... many more of these during the job phase ...
line 1103  ENTER  0x35      <- the echo arrived: USART1 handler starts
line 1240  ENTER  0x46      <- *** TIM6 CUT INTO IT ***  no return in between
line 1268  return           <-     TIM6 returns...
line 1499  return           <-     ...and only now does USART1 finish
line 1604  ENTER  0x0b      <- the SVC
line 1615  return
```

### Open it in the file

`(b)` gives you a line number. In VS Code: open the `.ppl`, **`Ctrl+G`**, type it.

```
OCSD_GEN_TRC_ELEM_EXCEPTION(pref ret addr:0x8000d2a; excep num (0x35) )
OCSD_GEN_TRC_ELEM_INSTR_RANGE(exec range=0x8000c10:[0x8000c34] num_i(9) ... E --- )
OCSD_GEN_TRC_ELEM_TIMESTAMP( [ TS=0x0000xxxxxxxx];  [CC=..]; )
     ... the RX callback running Routine_Crc16 ...
OCSD_GEN_TRC_ELEM_EXCEPTION(pref ret addr:0x8000c22; excep num (0x46) )   <=== HERE
OCSD_GEN_TRC_ELEM_INSTR_RANGE(exec range=0x8000b40:[0x8000b58] num_i(7) ... )
OCSD_GEN_TRC_ELEM_EXCEPTION_RET()
     ... the RX callback resumes exactly where it was ...
OCSD_GEN_TRC_ELEM_EXCEPTION_RET()
```

**What to say, pointing at the screen:**

> *"`0x35` is the UART handler — it starts here. And here, before it has returned, `0x46` — the
> timer. The timer interrupt cut into the middle of the UART handler, because I gave it a higher
> priority. Look at the return address: `0x8000c22`. That is not the start of a function. That is
> the exact instruction the UART handler was executing when it got interrupted. Nothing in my code
> wrote that down. It came off four wires."*

> *"And this is what worst-case execution time analysis needs. The UART handler's **own** work is
> bounded, and I can read it off this trace. But its **response time**, entry to exit, is longer,
> because the timer stole cycles out of the middle of it. That difference is the interference term,
> and here it is measured on real silicon instead of estimated."*

`verify_demo.py` prints exactly that decomposition in its section 5.

---

## 6. Reading it against the poster

Walk the **نتایج** block left to right.

| Poster bullet | Point at | Say |
| :--- | :--- | :--- |
| **رفتار غیرتهاجمی / Zero Probe Effect** | `App.c`, then `verify_demo.py` §3 | *"There is nothing to remove from this program — it has no instrumentation. And the clock I recover from the trace matches the clock the chip is configured for, which it could not if tracing were stealing cycles."* |
| **همگام با کلاک / Zero Jitter** | §6, the cadence table | *"The timer is set to 1000 microseconds. Every measured interval is 1000, plus or minus one. That one unit is not jitter — it is the resolution of the timestamp. I am at the measurement floor."* |
| **تفکیک رفتار زمانی روتین‌ها** | §4 and the HTML report | *"Five different exception sources, each with its own entry time, exit time, cycles and instruction count — separated automatically out of one undifferentiated byte stream."* |
| **آزمون سخت‌افزار در حلقه / HIL** | §5, the nesting and interference block | *"This is the data the automated test platform consumes. Not an estimate — a measurement taken without touching the code under test."* |
| **قابلیت ارتقا با FPGA** | the DSLogic | *"The only part of this chain with a frequency limit is the sampling front end. Everything above it is frequency-independent — put an FPGA there and the same software scales."* |

Worth adding if a referee looks technical, pointing at the `App_Dispatch` hotspot:

> *"That opening phase calls through a function pointer table, so the branch target is only decided
> at run time. A decoder cannot infer those from the binary — the target address has to come over
> the wire. Indirect branches are the hard case in control-flow reconstruction, and they are
> resolved here."*

### The WCET argument — the heart of it

Show the two `Routine_Sort()` cycle costs from `verify_demo.py`, and `g_app.sort_best` /
`g_app.sort_worst` side by side.

> *"Same function, compiled once, at one address. I called it twice. The first time with data
> already in order, the second time with data in exactly the wrong order. Same length of input —
> and look, the same return value, so it computed the same answer. The only thing that changed is
> the time."*
>
> *"That is the whole problem with worst-case execution time. You cannot read it off the source
> code, and static analysis on a Cortex-M7 with caches and a dual-issue pipeline is so pessimistic
> it wastes the hardware you paid for. So you measure — and to measure you need traces that are
> exact and that do not disturb what you are measuring. That is why this is a data provisioning
> system and not a WCET tool."*

---

## 7. Questions you will be asked

**"How do you know tracing doesn't slow the program down?"**
The ETM observes the pipeline; it has no path to stall it. But argue from the measurement, not the
architecture: the clock recovered from the trace matches the configured clock, and the periodic
timer holds its exact period. Neither would hold if tracing cost cycles.

**"Why only 1 MHz? Real systems run at 480 MHz."**
Deliberate, and it is the honest limit of the current front end. The trace port scales with the core
clock and a consumer logic analyser runs out of sample rate before the H7 does. Scenario 02 pushes
the same chain to 10.4 million decoded instructions to find exactly where that ceiling is. Slowing
the clock moves the bottleneck out of the way so the method can be validated; the FPGA front end is
the path past it, and nothing above the sampling layer changes.

**"Couldn't you just use printf, or toggle a GPIO?"**
Both change what you are measuring — the probe effect, and on a cached pipelined core it is not
small. A `printf` in an interrupt handler can cost more than the handler. And instrumentation only
tells you about the points you thought to instrument. This tells you about every instruction,
including the ones you did not predict — like a timer landing inside a UART handler.

**"Is this not what a Lauterbach does?"**
Yes, for roughly the price of a car. This is a sub-$300 logic analyser and open-source software.
The point is that the capability does not require the price tag.

**"What is the ±1 microsecond?"**
One LSB of the timestamp counter. It is the floor of the instrument, not jitter in the system. If it
were ±50 I would be reporting jitter; ±1 means I cannot see any.

**"How much is yours and how much is the library?"**
OpenCSD decodes an ETMv4 byte stream and I did not write it. Everything between the pins and that
byte stream is mine: the CoreSight configuration driver, the signal recovery and glitch filtering,
the TPIU frame reconstruction and realignment, the snapshot generation, and the analysis and IDE
layer on top. OpenCSD expects a clean stream from a commercial probe — the work was getting there
from a logic analyser capture.

**"Why does SysTick show up? Is that part of your test?"**
No — that is HAL's own 1 kHz tick, running as it does in any CubeIDE project. I left it in
deliberately: it is a fair picture of a real application, and it is a good demonstration that the
tool separates interrupt sources it was never told about.

---

## 8. When something breaks

Narrate it — a referee who watches you diagnose a real system learns more than one who watches an
animation. But **time-box it: two minutes, then the USB stick.**

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| DSView never triggers | PA1 not on CH5, or wrong edge | recheck probe and trigger |
| `no FSYNC found in either phase` | sample rate too low, or TRACECLK probe off | raise the rate, reseat CH0 |
| `intervals not a whole frame: N` | samples dropped | raise the sample rate, re-capture |
| Decode is all `I_NOT_SYNC` | DWT-gated window shorter than 1024 bytes | switch Tab 1 to *Unconditional*, or raise `g_warmup_rounds` (§2.4) |
| `discarded before lock` near 1024 | no anchor at the window head | as above |
| Sort pair missing from the decode | lock happened after the job phase | raise `g_warmup_rounds` |
| Window never opens at all | mode and injected calls disagree | re-apply the mode in Tab 1; it writes both |
| Addresses resolve to wrong functions | ELF is not the build that ran | re-export from the flashed build |
| `g_app.echo_ok == 0` | Pico not echoing | TX/RX swapped, unpowered, wrong baud |
| No nested preemption | RX callback shorter than a tick | `g_rx_crc_passes = 4` in the debugger, capture again |
| Window far longer than expected | `g_warmup_rounds` raised earlier and left high | lower it while watching `discarded before lock` |
| `.ppl` enormous | capture depth too large | reduce depth; the run is only a few ms |
| Extension will not decode | `trc_pkt_lister` path / WSL distro | use the terminal command from §2.5 |

**The fallback:** the verified working set from the dry run.

> *"The capture hardware is being difficult — let me show you the run I recorded last night. Same
> board, same firmware, same three commands."*

Legitimate. Do not apologise more than once.

---

## 9. Cheat card — print this page

```
+--------------------------------------------------------------------------+
|  PROJECTS DAY  -  SCENARIO 4                                             |
+--------------------------------------------------------------------------+
|  DSVIEW      rate ______ MS/s   depth ______   trigger CH5 RISING  10%   |
|                                                                          |
|  INJECT      Tab2 Update ETMv4.c -> Tab1 set MODE + Apply -> Inject      |
|              config -> select App_Run() -> right-click > CoreSight       |
|              Trace > Wrap Selection -> build -> flash                    |
|                                                                          |
|  RUN         RESET board -> arm DSView -> press PC5 once -> export CSV   |
|                                                                          |
|  CHAIN       python3 TraceStreamProcessor.py <csv> <elf>                 |
|              trc_pkt_lister -ss_dir <snap> -logstdout -decode -stats     |
|                     > demo.ppl                                           |
|              python3 verify_demo.py demo.ppl --syms <list>               |
|                                                                          |
|  EXCEP NUM   0x46 TIM6   (prio 0, preempts)                              |
|              0x35 USART1 (prio 1, preempted)                             |
|              0x27 EXTI9_5   0x0f SysTick   0x0b SVCall                   |
|                                                                          |
|  MONEY SHOT  grep -nE "ELEM_EXCEPTION\(|ELEM_EXCEPTION_RET\(\)" demo.ppl \|
|                awk -F: '/excep num/{if(d>0)print "NESTED line "$1; d++}  |
|                         /EXCEPTION_RET/{if(d>0)d--}'                     |
|              -> Ctrl+G to that line in VS Code                           |
|                                                                          |
|  THE POINT   The project ships with ZERO trace code. The extension       |
|              adds the driver + 3 lines, live, on stage.                  |
|                                                                          |
|  MODE        Trace All  -> Enable_ETM() / Disable_ETM()   <- use this   |
|              DWT Gated   -> StartPoint() / StopPoint()                   |
|  SYNC        A-Sync only every 1024 B (TRCSYNCPR read-only). Trace All   |
|              syncs on enable. DWT gated needs g_warmup_rounds = 1024.    |
|              verify_demo.py §1 "discarded before lock" must be small.    |
|                                                                          |
|  NUMBERS     core clock  1.0000__ MHz  (recovered from the trace)        |
|              tick        1000 +/- 1 us                                   |
|              sort best   ______ cyc    sort worst ______ cyc             |
|              nested      ______       discarded before lock ______       |
|                                                                          |
|  IF STUCK    2 minutes, then the USB stick. Say it once, move on.        |
+--------------------------------------------------------------------------+
```

Fill the blanks in pen during the dry run.
