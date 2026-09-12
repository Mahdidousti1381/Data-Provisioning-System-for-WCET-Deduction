#!/usr/bin/env python3
"""
verify_demo.py - turn an OpenCSD .ppl decode log into the Projects Day evidence
table.

This is the on-stage tool. It reads the file the CoreSight Trace Studio
extension writes (<snapshot>_decoded_<N>.ppl, i.e. the stdout of
trc_pkt_lister -decode -stats) and prints, in one screen:

  * whether the decoder actually synchronised, so nobody argues with numbers
    taken from a broken capture
  * the trace window, its duration, instruction and cycle totals
  * the core clock recovered from the trace alone - decoded cycle counts
    divided by decoded timestamps, two independent on-chip counters agreeing
  * every exception, by name, with entry/exit timestamps and cycle cost
  * NESTED PREEMPTIONS: every exception that was entered while another was
    still executing, naming which handler was interrupted
  * the TIM6 cadence table: interval between consecutive ticks, and the spread
  * the ISR / thread CPU split, and the top code hotspots

Then it checks each of those against what the scenario is supposed to produce
and prints a PASS / FAIL / WARN line per poster claim.

Usage:
    python3 verify_demo.py <decode.ppl>
    python3 verify_demo.py <decode.ppl> --syms firmware.list
    python3 verify_demo.py <decode.ppl> --syms firmware.list --csv evidence.csv

--syms accepts either an objdump listing (Debug/BP_Test1_H7.list) or the
output of `arm-none-eabi-nm -n firmware.elf`. With it, decoded addresses are
reported as function names, which is what makes the hotspot table readable
from the back of a room.

Timestamp convention: an exception's entry timestamp is the first TS element
after its EXCEPTION element, and its exit timestamp is the first TS element
after the matching EXCEPTION_RET. This is deliberately identical to the
convention the extension's ReportGenerator uses, so the numbers here and the
numbers in the generated HTML report agree line for line.
"""

import argparse
import csv
import re
import sys
from collections import Counter, defaultdict

# --------------------------------------------------------------------------
# Cortex-M exception numbering. On M-profile the ETMv4 "excep num" field is the
# IPSR value, i.e. the vector table index: IRQn + 16.
# --------------------------------------------------------------------------
CORE_EXCEPTIONS = {
    1: "Reset", 2: "NMI", 3: "HardFault", 4: "MemManage", 5: "BusFault",
    6: "UsageFault", 11: "SVCall", 12: "DebugMonitor", 14: "PendSV",
    15: "SysTick",
}

# The four the Projects Day scenario is built to produce, by IRQn.
SCENARIO_IRQS = {
    54: "TIM6_DAC",     # excep num 70 = 0x46  priority 0, the control tick
    37: "USART1",       # excep num 53 = 0x35  priority 1, the comms handler
    23: "EXTI9_5",      # excep num 39 = 0x27  priority 2, the button
}
TIM6_EXCEP = 54 + 16
UART_EXCEP = 37 + 16
SVC_EXCEP = 11


def exception_name(num):
    if num in CORE_EXCEPTIONS:
        return CORE_EXCEPTIONS[num]
    if num >= 16:
        irq = num - 16
        known = SCENARIO_IRQS.get(irq)
        return f"IRQ_{irq} ({known})" if known else f"IRQ_{irq}"
    return f"Exception_{num}"


# --------------------------------------------------------------------------
# Symbol table
# --------------------------------------------------------------------------
LIST_SYM = re.compile(r"^([0-9a-fA-F]{8}) <([^>]+)>:")
NM_SYM = re.compile(r"^([0-9a-fA-F]{8})\s+[tTwW]\s+(\S+)")


def load_symbols(path):
    """[(addr, name)] sorted by address, from an objdump listing or nm output."""
    syms = []
    with open(path, "r", errors="replace") as f:
        for line in f:
            m = LIST_SYM.match(line) or NM_SYM.match(line)
            if m:
                syms.append((int(m.group(1), 16), m.group(2)))
    syms.sort()
    return syms


def resolve(syms, addr):
    """Nearest symbol at or below addr, as 'name+0xoff'."""
    if not syms:
        return None
    lo, hi = 0, len(syms) - 1
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if syms[mid][0] <= addr:
            best = syms[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None:
        return None
    off = addr - best[0]
    return best[1] if off == 0 else f"{best[1]}+0x{off:x}"


# --------------------------------------------------------------------------
# Parse
# --------------------------------------------------------------------------
RE_TS = re.compile(r"TS=0x([0-9a-fA-F]+)")
RE_CC = re.compile(r"\[CC=(\d+)\]")
RE_NUMI = re.compile(r"num_i\((\d+)\)")
RE_RANGE = re.compile(r"exec range=(0x[0-9a-fA-F]+):\[(0x[0-9a-fA-F]+)\]")
RE_EXCEP = re.compile(r"excep num \((0x[0-9a-fA-F]+)\)")
# trc_pkt_lister -stats footer: "Total Bytes: 95854; Unsynced Bytes: 1036"
RE_STATS = re.compile(r"Total Bytes:\s*(\d+);\s*Unsynced Bytes:\s*(\d+)")

# TRCSYNCPR is read-only at 10 on this silicon, so the ETM emits its A-Sync
# anchor every 2**10 bytes. Measured on a real capture: 93 A-Syncs in 95854
# bytes, one every 1030. Nothing decodes until the first one arrives, which is
# why the task's opening phase has to emit more than this many bytes.
SYNC_PERIOD_BYTES = 1024


class Excep:
    __slots__ = ("num", "name", "depth", "parent", "entry_ts", "exit_ts",
                 "cycles", "instrs", "line")

    def __init__(self, num, depth, parent, line):
        self.num = num
        self.name = exception_name(num)
        self.depth = depth
        self.parent = parent
        self.entry_ts = None
        self.exit_ts = None
        self.cycles = 0
        self.instrs = 0
        self.line = line

    @property
    def duration(self):
        if self.entry_ts is None or self.exit_ts is None:
            return None
        return self.exit_ts - self.entry_ts


def parse(path):
    st = {
        "lines": 0, "packets": 0, "unsynced": 0, "async_resyncs": 0,
        "instrs": 0, "cycles": 0, "atoms": 0,
        "first_ts": None, "last_ts": None,
        "exceptions": [], "nested": [],
        "hotspots": Counter(), "eo_trace": False, "no_sync": 0,
        "thread_instrs": 0, "thread_cycles": 0,
        "decoder_errors": [], "stat_total": None, "stat_unsynced": None,
    }

    stack = []          # open Excep objects, innermost last
    pending_exit = []   # Exceps whose RET was seen, awaiting their exit TS

    with open(path, "r", errors="replace") as f:
        for lineno, line in enumerate(f, 1):
            st["lines"] += 1

            if line.startswith("Idx:"):
                st["packets"] += 1
            if "I_NOT_SYNC" in line:
                st["unsynced"] += 1
            if "OCSD_GEN_TRC_ELEM_NO_SYNC" in line:
                st["no_sync"] += 1
            if "OCSD_GEN_TRC_ELEM_EO_TRACE" in line:
                st["eo_trace"] = True
            if "I_ASYNC" in line:
                st["async_resyncs"] += 1
            m = RE_STATS.search(line)
            if m:
                st["stat_total"] = int(m.group(1))
                st["stat_unsynced"] = int(m.group(2))
            if "ERROR" in line or "fatal" in line.lower():
                if len(st["decoder_errors"]) < 10:
                    st["decoder_errors"].append(line.rstrip())

            if "OCSD_GEN_TRC_ELEM_" not in line:
                continue

            # ---- timestamp -------------------------------------------------
            if "OCSD_GEN_TRC_ELEM_TIMESTAMP(" in line:
                m = RE_TS.search(line)
                if m:
                    ts = int(m.group(1), 16)
                    if st["first_ts"] is None:
                        st["first_ts"] = ts
                    st["last_ts"] = ts
                    # first TS after an entry closes the entry stamp
                    for ex in stack:
                        if ex.entry_ts is None:
                            ex.entry_ts = ts
                    # first TS after a RET closes the exit stamp
                    while pending_exit:
                        pending_exit.pop(0).exit_ts = ts
                continue

            # ---- cycle count -----------------------------------------------
            if "OCSD_GEN_TRC_ELEM_CYCLE_COUNT(" in line:
                m = RE_CC.search(line)
                if m:
                    cc = int(m.group(1))
                    st["cycles"] += cc
                    if stack:
                        stack[-1].cycles += cc
                    else:
                        st["thread_cycles"] += cc
                continue

            # ---- instruction range -----------------------------------------
            if "OCSD_GEN_TRC_ELEM_INSTR_RANGE(" in line:
                m = RE_NUMI.search(line)
                n = int(m.group(1)) if m else 0
                st["instrs"] += n
                if stack:
                    stack[-1].instrs += n
                else:
                    st["thread_instrs"] += n
                r = RE_RANGE.search(line)
                if r:
                    st["hotspots"][int(r.group(1), 16)] += n
                if "ATOM" in line or " E " in line or " N " in line:
                    st["atoms"] += 1
                continue

            # ---- exception entry -------------------------------------------
            if "OCSD_GEN_TRC_ELEM_EXCEPTION(" in line:
                m = RE_EXCEP.search(line)
                num = int(m.group(1), 16) if m else 0
                parent = stack[-1] if stack else None
                ex = Excep(num, len(stack), parent, lineno)
                if parent is not None:
                    st["nested"].append(ex)
                stack.append(ex)
                st["exceptions"].append(ex)
                continue

            # ---- exception return ------------------------------------------
            if "OCSD_GEN_TRC_ELEM_EXCEPTION_RET()" in line:
                if stack:
                    pending_exit.append(stack.pop())
                continue

    return st


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------
def rule(title=""):
    if title:
        print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")
    else:
        print("-" * 78)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ppl", help="the .ppl decode log")
    ap.add_argument("--syms", help="objdump .list or 'arm-none-eabi-nm -n' output")
    ap.add_argument("--csv", help="also write the exception table here")
    ap.add_argument("--tick-us", type=int, default=1000,
                    help="expected TIM6 period in timestamp units (default 1000)")
    ap.add_argument("--top", type=int, default=12, help="hotspot rows (default 12)")
    args = ap.parse_args()

    # Friendly failures. On the day, a mistyped path should cost one second,
    # not a stack trace read out in front of an audience.
    try:
        syms = load_symbols(args.syms) if args.syms else []
    except OSError as e:
        print(f"error: cannot read symbol file {args.syms!r}: {e.strerror}",
              file=sys.stderr)
        return 2

    try:
        st = parse(args.ppl)
    except OSError as e:
        print(f"error: cannot read decode log {args.ppl!r}: {e.strerror}",
              file=sys.stderr)
        print("       Expected the .ppl the extension writes, e.g. "
              "<snapshot>_decoded_1.ppl", file=sys.stderr)
        return 2

    if st["lines"] == 0:
        print(f"error: {args.ppl!r} is empty - the decoder produced no output.",
              file=sys.stderr)
        return 2

    def sym(addr):
        s = resolve(syms, addr)
        return f"0x{addr:08x}  {s}" if s else f"0x{addr:08x}"

    # ---------------------------------------------------------------- sync
    rule("1. CAPTURE HEALTH  - is this decode worth quoting at all?")
    print(f"  decode log lines              : {st['lines']:,}")
    print(f"  raw packets listed            : {st['packets']:,}")
    print(f"  unsynchronised packet lines   : {st['unsynced']:,}")
    print(f"  NO_SYNC elements              : {st['no_sync']}")
    print(f"  A-Sync anchors seen           : {st['async_resyncs']}")
    print(f"  end-of-trace reached cleanly  : {'yes' if st['eo_trace'] else 'NO'}")
    if st["stat_total"] is not None:
        u, t = st["stat_unsynced"], st["stat_total"]
        print(f"  trace bytes on the wire       : {t:,}")
        print(f"  discarded before lock         : {u:,} "
              f"({u * 100.0 / t:.1f} %)")
        print(f"\n  The decoder cannot produce anything until the first A-Sync,")
        print(f"  which the ETM emits every {SYNC_PERIOD_BYTES} bytes and no sooner. Those")
        print(f"  {u:,} bytes are the wait. They must fall inside the opening job")
        print(f"  phase, or real work is being lost - raise g_warmup_rounds.")
    if st["decoder_errors"]:
        print("  decoder complaints:")
        for e in st["decoder_errors"]:
            print(f"    {e}")

    # -------------------------------------------------------------- window
    rule("2. TRACE WINDOW  - StartPoint() .. StopPoint()")
    first, last = st["first_ts"], st["last_ts"]
    dur = (last - first) if (first is not None and last is not None) else 0
    cpi = st["cycles"] / st["instrs"] if st["instrs"] else 0
    print(f"  first timestamp               : 0x{first:012x}" if first is not None
          else "  first timestamp               : none")
    print(f"  last  timestamp               : 0x{last:012x}" if last is not None
          else "  last  timestamp               : none")
    print(f"  window duration (dTS)         : {dur:,} timestamp units")
    print(f"  instructions reconstructed    : {st['instrs']:,}")
    print(f"  cycles reported by CCI        : {st['cycles']:,}")
    print(f"  average CPI                   : {cpi:.2f}")

    # ---------------------------------------------------------- clock check
    rule("3. CORE CLOCK RECOVERED FROM THE TRACE ALONE")
    print("  The cycle counter (CCI) and the global timestamp (TSG) are two")
    print("  independent on-chip counters. Their ratio is the core clock, and")
    print("  nothing in the firmware told the decoder what it should be.")
    if dur:
        mhz = st["cycles"] / dur
        print(f"\n  {st['cycles']:,} cycles / {dur:,} timestamp units = {mhz:.6f} MHz")
        err = abs(mhz - 1.0) * 100.0
        print(f"  deviation from the configured 1.000000 MHz : {err:.4f} %")
    else:
        print("  no timestamp span - cannot compute")

    # ---------------------------------------------------- exception summary
    rule("4. EXCEPTIONS  - per-routine / per-ISR timing separation")
    if not st["exceptions"]:
        print("  none decoded.")
    else:
        by_type = defaultdict(list)
        for ex in st["exceptions"]:
            by_type[ex.num].append(ex)
        print("  'own cyc' counts only cycles executed AT that exception's own")
        print("  level - cycles burned by a handler that preempted it belong to")
        print("  the preempting handler. 'response dTS' is entry-to-exit wall")
        print("  clock and DOES include preemption. The gap between the two is")
        print("  interference, and separating them is the point of the tool.\n")
        print(f"  {'exception':<24}{'n':>5}{'own cyc':>10}{'avg own':>10}"
              f"{'instrs':>9}{'avg resp':>10}")
        rule()
        for num in sorted(by_type):
            g = by_type[num]
            tc = sum(e.cycles for e in g)
            ti = sum(e.instrs for e in g)
            durs = [e.duration for e in g if e.duration is not None]
            avgd = sum(durs) / len(durs) if durs else 0
            print(f"  {exception_name(num):<24}{len(g):>5}{tc:>10,}"
                  f"{tc / len(g):>10.1f}{ti:>9,}{avgd:>10.1f}")

        isr_cycles = sum(e.cycles for e in st["exceptions"])
        total = st["cycles"] or 1
        rule()
        print(f"  CPU in exception handlers     : {isr_cycles:,} cycles "
              f"({isr_cycles * 100.0 / total:.2f} %)")
        print(f"  CPU in main thread            : {st['thread_cycles']:,} cycles "
              f"({st['thread_cycles'] * 100.0 / total:.2f} %)")

    # -------------------------------------------------------- THE MONEY SHOT
    rule("5. NESTED PREEMPTION  - the headline result")
    print("  A higher-priority interrupt entered while a lower-priority handler")
    print("  was still running. In the log this is two EXCEPTION elements with")
    print("  only one EXCEPTION_RET between them. No instrumentation reported")
    print("  it; it was recovered entirely from the trace port.\n")
    if not st["nested"]:
        print("  *** NONE FOUND ***")
        print("  If the Pico echoed and TIM6 ticked, check that TIM6_DAC_IRQn")
        print("  really has a numerically LOWER priority value than USART1_IRQn,")
        print("  and raise g_rx_crc_passes so the RX callback outlasts a tick.")
    else:
        for ex in st["nested"]:
            print(f"  .ppl line {ex.line:>8}: {ex.name}")
            print(f"      preempted             : {ex.parent.name}")
            print(f"      nesting depth         : {ex.depth + 1}")
            if ex.entry_ts is not None:
                print(f"      entry TS              : 0x{ex.entry_ts:012x}")
            if ex.duration is not None:
                print(f"      handler duration      : {ex.duration} timestamp units")
            print(f"      cycles / instructions : {ex.cycles:,} / {ex.instrs:,}")
            if ex.parent.entry_ts is not None and ex.entry_ts is not None:
                lat = ex.entry_ts - ex.parent.entry_ts
                print(f"      landed {lat} units into the {ex.parent.name} handler")

        # ---- what the preemption cost the handler that was interrupted ----
        parents = {}
        for ex in st["nested"]:
            parents.setdefault(id(ex.parent), ex.parent)
        if parents:
            rule()
            print("  RESPONSE TIME vs EXECUTION TIME for each preempted handler.")
            print("  This is the WCET-relevant decomposition: a handler's own work")
            print("  is bounded by its code, but its response time is inflated by")
            print("  every higher-priority interrupt that lands inside it. Only a")
            print("  trace can tell the two apart after the fact.\n")
            for p in parents.values():
                kids = [e for e in st["nested"] if e.parent is p]
                kid_cyc = sum(e.cycles for e in kids)
                print(f"  {p.name}")
                if p.duration is not None:
                    print(f"      response time (entry->exit)   : {p.duration:,} "
                          f"timestamp units")
                print(f"      own execution cycles          : {p.cycles:,}")
                print(f"      preempted {len(kids)} time(s), costing  : {kid_cyc:,} "
                      f"cycles of interference")
                if p.duration is not None and p.duration:
                    print(f"      interference share of response: "
                          f"{kid_cyc * 100.0 / p.duration:.1f} %")

    # ------------------------------------------------------- TIM6 cadence
    rule("6. TICK CADENCE  - zero jitter under interference")
    ticks = [e for e in st["exceptions"]
             if e.num == TIM6_EXCEP and e.entry_ts is not None]
    if len(ticks) < 2:
        print(f"  fewer than two TIM6 entries decoded ({len(ticks)}) - no cadence "
              f"to report.")
    else:
        print("  Interval between consecutive TIM6 exception entries. The timer")
        print("  is free-running hardware, so every deviation here is either real")
        print("  jitter or timestamp quantisation - and one unit IS the")
        print("  quantisation floor.\n")
        print(f"  {'#':>3}  {'entry TS':>14}  {'interval':>9}  {'error':>7}  nested")
        rule()
        deltas = []
        for i, t in enumerate(ticks):
            if i == 0:
                print(f"  {i:>3}  0x{t.entry_ts:012x}  {'-':>9}  {'-':>7}  "
                      f"{'yes' if t.depth else 'no'}")
                continue
            d = t.entry_ts - ticks[i - 1].entry_ts
            deltas.append(d)
            print(f"  {i:>3}  0x{t.entry_ts:012x}  {d:>9,}  "
                  f"{d - args.tick_us:>+7}  {'yes' if t.depth else 'no'}")
        rule()
        lo, hi = min(deltas), max(deltas)
        mean = sum(deltas) / len(deltas)
        print(f"  expected period               : {args.tick_us}")
        print(f"  measured min / mean / max     : {lo} / {mean:.2f} / {hi}")
        print(f"  peak-to-peak jitter           : {hi - lo} timestamp unit(s)")

    # ------------------------------------------------------------ hotspots
    rule(f"7. CODE HOTSPOTS  - top {args.top} executed address ranges")
    tot = sum(st["hotspots"].values()) or 1
    for addr, n in st["hotspots"].most_common(args.top):
        print(f"  {n:>8,} insn  {n * 100.0 / tot:>5.1f}%   {sym(addr)}")
    if not syms:
        print("\n  (pass --syms Debug/BP_Test1_H7.list to see function names here)")

    # ------------------------------------------------------------- verdict
    rule("8. VERDICT  - one line per poster claim")
    checks = []

    ok_sync = st["eo_trace"] and st["instrs"] > 0
    checks.append(("Capture decoded end to end", ok_sync,
                   f"{st['instrs']:,} instructions reconstructed, "
                   f"EO_TRACE {'seen' if st['eo_trace'] else 'MISSING'}"))

    if st["stat_unsynced"] is not None:
        u = st["stat_unsynced"]
        ok_lock = u <= SYNC_PERIOD_BYTES + 64
        checks.append(("Decoder locked within one sync period", ok_lock,
                       f"{u:,} bytes discarded before lock "
                       f"(one A-Sync period is {SYNC_PERIOD_BYTES})"))

    if dur:
        mhz = st["cycles"] / dur
        ok_clk = 0.97 <= mhz <= 1.03
        checks.append(("Cycle-accurate: CCI and TSG agree", ok_clk,
                       f"recovered core clock {mhz:.6f} MHz from the wire alone"))
    else:
        checks.append(("Cycle-accurate: CCI and TSG agree", False,
                       "no timestamp span"))

    seen = {e.num for e in st["exceptions"]}
    want = {TIM6_EXCEP, UART_EXCEP, SVC_EXCEP}
    ok_sep = want.issubset(seen)
    checks.append(("Per-ISR timing separation", ok_sep,
                   "decoded: " + ", ".join(sorted(exception_name(n) for n in seen))
                   if seen else "no exceptions decoded"))

    ok_nest = any(e.num == TIM6_EXCEP and e.parent is not None
                  and e.parent.num == UART_EXCEP for e in st["nested"])
    checks.append(("TIM6 preempts the USART1 handler", ok_nest,
                   f"{len(st['nested'])} nested entr"
                   f"{'y' if len(st['nested']) == 1 else 'ies'} found"))

    if len(ticks) >= 2:
        pp = max(deltas) - min(deltas)
        ok_jit = pp <= 2
        checks.append(("Zero jitter on the periodic tick", ok_jit,
                       f"peak-to-peak {pp} timestamp unit(s) over "
                       f"{len(deltas)} interval(s)"))
    else:
        checks.append(("Zero jitter on the periodic tick", None,
                       "not enough ticks in the window"))

    for name, ok, detail in checks:
        tag = "PASS" if ok else ("WARN" if ok is None else "FAIL")
        print(f"  [{tag}]  {name}")
        print(f"          {detail}")

    # ----------------------------------------------------------------- csv
    if args.csv:
        with open(args.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["idx", "excep_num_hex", "name", "depth", "preempted",
                        "entry_ts", "exit_ts", "duration_ts", "cycles",
                        "instructions", "ppl_line"])
            for i, e in enumerate(st["exceptions"], 1):
                w.writerow([i, f"0x{e.num:02x}", e.name, e.depth,
                            e.parent.name if e.parent else "",
                            e.entry_ts if e.entry_ts is not None else "",
                            e.exit_ts if e.exit_ts is not None else "",
                            e.duration if e.duration is not None else "",
                            e.cycles, e.instrs, e.line])
        print(f"\n  exception table written to {args.csv}")

    failed = sum(1 for _, ok, _ in checks if ok is False)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
