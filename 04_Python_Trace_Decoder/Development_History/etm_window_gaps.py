#!/usr/bin/env python3
"""
Measure the gap between consecutive ETM trace windows in a trc_pkt_lister
decode log.

The timer test opens one ETM window per TIM6 interrupt, so the decode should
contain one OCSD_GEN_TRC_ELEM_TRACE_ON per tick, each followed by a timestamp
element. The differences between those timestamps are the trace-side proof
that the windows are ~100 us apart - independent of the DWT->CYCCNT numbers
the firmware reports in g_etmirq.delta_ns[].

  python3 etm_window_gaps.py decode.log                  # infer the TS clock
  python3 etm_window_gaps.py decode.log --ts-hz 20000000 # convert directly

Element and field spellings come from OpenCSD's trc_gen_elem.cpp:
TRACE_ON has no payload; timestamps print as " [ TS=0x...]".
"""
import argparse
import re
import sys

RE_TRACE_ON = re.compile(r"OCSD_GEN_TRC_ELEM_TRACE_ON")
RE_TS       = re.compile(r"OCSD_GEN_TRC_ELEM_TIMESTAMP.*?\[\s*TS=0x([0-9a-fA-F]+)\s*\]")
RE_ANY_TS   = re.compile(r"\[\s*TS=0x([0-9a-fA-F]+)\s*\]")


def collect(path, use_any_ts):
    """Return (trace_on_lines, [(line_no, ts_value), ...])."""
    trace_on, stamps = [], []
    ts_re = RE_ANY_TS if use_any_ts else RE_TS
    with open(path, "r", errors="replace") as fh:
        for n, line in enumerate(fh):
            if RE_TRACE_ON.search(line):
                trace_on.append(n)
            m = ts_re.search(line)
            if m:
                stamps.append((n, int(m.group(1), 16)))
    return trace_on, stamps


def window_stamps(trace_on, stamps):
    """First timestamp at or after each TRACE_ON."""
    out, j = [], 0
    for n in trace_on:
        while j < len(stamps) and stamps[j][0] < n:
            j += 1
        if j < len(stamps):
            out.append(stamps[j][1])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--ts-hz", type=float, default=None,
                    help="timestamp generator clock, to convert gaps to us")
    ap.add_argument("--period-us", type=float, default=100.0,
                    help="expected window period (default 100)")
    ap.add_argument("--any-ts", action="store_true",
                    help="accept TS= on any element, not just TIMESTAMP ones")
    a = ap.parse_args()

    trace_on, stamps = collect(a.log, a.any_ts)
    print(f"TRACE_ON elements : {len(trace_on)}")
    print(f"timestamps found  : {len(stamps)}")

    if not stamps:
        print("\nNo timestamps in this log. Either TRCCONFIGR.TS is off, or the\n"
              "ETM is syncing too rarely to emit one per window - lower ETM->SYNCP.\n"
              "Re-run with --any-ts if timestamps are riding on other elements.")
        return 1

    ws = window_stamps(trace_on, stamps)
    if len(ws) < 2:
        print(f"\nOnly {len(ws)} window(s) carried a timestamp - need at least 2 "
              f"to measure a gap.")
        return 1

    gaps = [b - a_ for a_, b in zip(ws, ws[1:])]
    print(f"windows timestamped: {len(ws)}   gaps: {len(gaps)}")

    lo, hi = min(gaps), max(gaps)
    mean = sum(gaps) / len(gaps)
    print(f"\ngap in TS ticks   : min={lo} max={hi} mean={mean:.1f} jitter={hi - lo}")
    print("  " + " ".join(str(g) for g in gaps))

    if a.ts_hz:
        us = [g * 1e6 / a.ts_hz for g in gaps]
        m = sum(us) / len(us)
        print(f"\ngap in us         : min={min(us):.3f} max={max(us):.3f} mean={m:.3f}")
        print(f"expected          : {a.period_us:.3f} us")
        print(f"error on the mean : {m - a.period_us:+.3f} us "
              f"({(m - a.period_us) / a.period_us * 100:+.2f} %)")
    elif mean > 0:
        implied = mean / (a.period_us * 1e-6)
        print(f"\nNo --ts-hz given. If these gaps really are {a.period_us:g} us,\n"
              f"the timestamp clock is {implied / 1e6:.3f} MHz.")
        print("Cross-check that against your trace clock. The stronger evidence\n"
              "is the spread: jitter small next to the mean means the windows are\n"
              "evenly spaced, whatever the TS unit turns out to be.")

    if mean:
        spread = (hi - lo) / mean * 100
        print(f"\nspread            : {spread:.2f} % of the mean")
        print("verdict           : " + ("EVEN - windows are regularly spaced"
                                        if spread < 5 else
                                        "UNEVEN - investigate before trusting it"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
