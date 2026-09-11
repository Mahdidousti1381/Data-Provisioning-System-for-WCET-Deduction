"""
DSLogic 4-bit parallel trace capture  ->  OpenCSD snapshot.

Pipeline:
  1. CSV (or ASCII-hex, or raw binary) -> nibbles -> TPIU wire bytes
  2. Validate the TPIU framing (FSYNC / HSYNC census, frame alignment, ATB IDs)
  3. Write <base>_tpiu.bin  (raw wire bytes, sync packets left in place)
  4. Emit an OpenCSD snapshot directory that trc_pkt_lister can read directly
  5. Print the trc_pkt_lister command line

The wire bytes are handed to OpenCSD *unmodified* - FSYNC and HSYNC are left in
the stream and stripped by OpenCSD's own frame deformatter via -tpiu_hsync.
Do not pre-deframe here; the buffer format must stay "coresight".

Usage:
    python3 TraceStreamProcessor.py                       # Tk file picker
    python3 TraceStreamProcessor.py capture.csv
    python3 TraceStreamProcessor.py capture.csv firmware.elf
"""

import collections
import csv
import os
import re
import struct
import sys
# ---------------------------------------------------------------------------
# ETM / trace-path register values.
#
# Replace the "from ETMv4.c" block with what Trace_DumpStatus() reads back off
# the silicon - these are the values the running firmware was configured with.
# The TRCIDR* block is read-only silicon ID; the defaults below are ARM's
# published Cortex-M7 ETM values (OpenCSD tests/snapshots/v7m_svc_vector).
# ---------------------------------------------------------------------------
ETM_REGS = {
    # ---- from ETMv4.c: ETM_Configure() ----
    # VERIFIED on this STM32H750 via Trace_DumpStatus()/g_trace_status, after
    # fixing Trace_DumpStatus() to actually read these off the hardware (it
    # previously left them at zero-init - see ETMv4.c history).
    # NOT YET RE-VERIFIED: ETM_Configure() now writes CONFIG = (1<<4)|(1<<11)
    # (CCI|TS) and CCCTL = 64, for WCET cycle-count extraction. The value below
    # is that write, PLUS the unexplained bit0 that read back as 1 even when
    # firmware wrote CONFIG=0 (see the old comment this replaced) - carried
    # forward as a guess. Re-run Trace_DumpStatus() after reflashing and
    # correct TRCCONFIGR/TRCCCCTLR here from the real g_trace_status readback
    # before trusting a decode that depends on cycle-count packets.
    "TRCCONFIGR":    0x00000811,   # bit0 (unexplained, was RAO before) | bit4 CCI | bit11 TS
    "TRCSYNCPR":     0x0000000A,   # 2^10 bytes - now confirmed by direct
                                   # readback (previously inferred only from
                                   # measured 1026 B A-Sync spacing).
    "TRCTRACEIDR":   0x0000003E,   # ATB ID - must match what is on the wire
    "TRCSTALLCTLR":  0x00000000,
    "TRCCCCTLR":     0x00000040,   # 64 - cycle-count report threshold (cycles)
    "TRCEVENTCTL0R": 0x00000000,
    "TRCEVENTCTL1R": 0x00000000,
    "TRCTSCTLR":     0x00000000,
    "TRCVICTLR":     0x00000201,   # VERIFIED: bit9 SSSTATUS latched to 1 by the
                                   # DWT start comparator - the gating works.
    "TRCVIIECTLR":   0x00000000,
    "TRCVISSCTLR":   0x00000000,
    "TRCVIPCSSCTLR": 0x00020001,   # VERIFIED: DWT comp0 starts, comp1 stops
    # ---- read-only silicon ID - VERIFIED ----
    #   TRCIDR1 = 0x4100F401 -> DESIGNER=0x41 (ARM), confirming this is a real
    #                           register read and not the old zero-init bug.
    #   TRCIDR4 = 0x00114000 -> NUMACPAIRS=0 (no ETM address comparators),
    #                           4 PE comparator inputs (the DWT comparators),
    #                           1 resource-selector pair, 1 single-shot comp.
    #   TRCIDR5 = 0x90C70002
    "TRCIDR0":       0x080006E1,
    "TRCIDR1":       0x4100F401,
    "TRCIDR2":       0x00000004,
    "TRCIDR3":       0x07090004,   # CCITMIN = bits[11:0] = 4
    "TRCIDR4":       0x00114000,
    "TRCIDR5":       0x90C70002,
    "TRCIDR8":       0x00000001,
    "TRCIDR9":       0x00000000,
    "TRCIDR10":      0x00000000,
    "TRCIDR11":      0x00000000,
    "TRCIDR12":      0x00000001,
    "TRCIDR13":      0x00000000,
    "TRCAUTHSTATUS": 0x000000C0,
}

# OpenCSD's snapshot parser matches these names exactly; the (0x..) suffix is
# the architectural register id and is cosmetic.
REG_IDS = {
    "TRCCONFIGR": 0x4, "TRCEVENTCTL0R": 0x8, "TRCEVENTCTL1R": 0x9,
    "TRCSTALLCTLR": 0xB, "TRCTSCTLR": 0xC, "TRCSYNCPR": 0xD, "TRCCCCTLR": 0xE,
    "TRCTRACEIDR": 0x10, "TRCVICTLR": 0x20, "TRCVIIECTLR": 0x21,
    "TRCVISSCTLR": 0x22, "TRCVIPCSSCTLR": 0x23,
    "TRCIDR8": 0x60, "TRCIDR9": 0x61, "TRCIDR10": 0x62, "TRCIDR11": 0x63,
    "TRCIDR12": 0x64, "TRCIDR13": 0x65,
    "TRCIDR0": 0x78, "TRCIDR1": 0x79, "TRCIDR2": 0x7A, "TRCIDR3": 0x7B,
    "TRCIDR4": 0x7C, "TRCIDR5": 0x7D, "TRCAUTHSTATUS": 0x3EE,
}

CORE_NAME = "Cortex-M7_0"
CORE_TYPE = "ARMv7-M"  # OpenCSD 1.4.1 recognizes ARMv7-M (Cortex-M7 is not in its core profile table)
ETM_NAME = "CSETM_0"
ETM_TYPE = "ETM4.0"
BUFFER_NAME = "TPIU_WIRE"

FSYNC = b"\xff\xff\xff\x7f"      # 0x7FFFFFFF full frame sync
HSYNC = b"\xff\x7f"              # 0x7FFF     halfword sync (idle filler)


# ---------------------------------------------------------------------------
# Stage 1: samples -> nibbles -> bytes
# ---------------------------------------------------------------------------
def nibbles_from_csv(path):
    """Recover the TRACEDATA nibble sequence from a DSLogic CSV export.

    TRACEDATA is double-data-rate: one nibble per TRACECLK edge. A nibble is
    committed only once the clock has changed and then held for at least one
    sample, which rejects single-sample glitches. If the capture sample rate is
    barely above the trace clock this drops every other nibble - see the FSYNC
    census in validate() for the symptom (a 1:1 ff/7f ratio instead of 3:1).
    """
    CLK_COL, D0_COL, D1_COL, D2_COL, D3_COL = 1, 2, 3, 4, 5

    nibbles = bytearray()
    prev_raw_clk = None
    potential_edge = False
    saved_nibble = 0

    with open(path, "r") as f_in:
        for row in csv.reader(f_in):
            if not row or row[0].startswith(";") or "Time" in row[0]:
                continue
            try:
                raw_clk = int(row[CLK_COL])
                nib = ((int(row[D3_COL]) << 3) | (int(row[D2_COL]) << 2) |
                       (int(row[D1_COL]) << 1) | int(row[D0_COL]))
            except (ValueError, IndexError):
                continue

            if prev_raw_clk is None:
                prev_raw_clk = raw_clk
                continue

            if raw_clk != prev_raw_clk:
                if not potential_edge:
                    potential_edge = True
                    saved_nibble = nib
                else:
                    potential_edge = False
            elif potential_edge:
                nibbles.append(saved_nibble)
                potential_edge = False

            prev_raw_clk = raw_clk

    return nibbles


def bytes_from_nibbles(nibbles, phase):
    """Assemble nibbles into bytes, low nibble first (TPIU sends LSN first)."""
    out = bytearray()
    for i in range(phase, len(nibbles) - 1, 2):
        out.append(nibbles[i] | (nibbles[i + 1] << 4))
    return bytes(out)


def pick_nibble_phase(nibbles):
    """A capture can start mid-byte, which nibble-swaps everything.

    Assemble both phases and keep whichever yields more FSYNC patterns.
    """
    cands = [(bytes_from_nibbles(nibbles, p), p) for p in (0, 1)]
    scored = [(data.count(FSYNC), data, p) for data, p in cands]
    scored.sort(key=lambda t: t[0], reverse=True)
    best_score, best_data, best_phase = scored[0]
    other_score = scored[1][0]
    print(f"  nibble phase {best_phase}: {best_score} FSYNC "
          f"(phase {scored[1][2]}: {other_score})")
    if best_score == 0:
        print("  WARNING: no FSYNC found in either phase - check the capture.")
    return best_data


def load_wire_bytes(path):
    """Accept a DSLogic CSV, an ASCII-hex dump, or an already-raw binary."""
    with open(path, "rb") as f:
        head = f.read(4096)

    if b"," in head and (b"Time" in head or head.count(b",") > 8):
        print("Input looks like a DSLogic CSV export.")
        nibbles = nibbles_from_csv(path)
        print(f"  recovered {len(nibbles)} nibbles")
        return pick_nibble_phase(nibbles)

    text = head.decode("latin-1")
    if re.fullmatch(r"[0-9a-fA-F\s]+", text or "x"):
        print("Input looks like an ASCII-hex dump; converting to raw bytes.")
        with open(path, "rb") as f:
            toks = re.findall(rb"[0-9a-fA-F]{2}", f.read())
        return bytes(int(t, 16) for t in toks)

    print("Input looks like raw binary; using as-is.")
    with open(path, "rb") as f:
        return f.read()


# ---------------------------------------------------------------------------
# Stage 2: validate the TPIU framing
# ---------------------------------------------------------------------------
def fsync_intervals(data):
    """Frame-data bytes between consecutive FSYNCs, with each FSYNC's offset.

    The TPIU emits FSYNC every TPIU_FSCR frames, so in a sound capture every
    interval holds a whole number of 16-byte frames. An interval that is not a
    multiple of 16 is the fingerprint of a real discontinuity: bytes went
    missing, and every frame after it is misaligned.

    NOTE: sync density says nothing about capture quality. An idle trace port
    emits FSYNC constantly; a busy one emits it only every FSCR frames. Both
    are correct. Only the interval arithmetic below is diagnostic.
    """
    out, i, cur, start = [], 0, 0, None
    while i < len(data) - 3:
        if data[i:i + 4] == FSYNC:
            if start is not None:
                out.append((start, cur))
            cur = 0
            while i + 4 <= len(data) and data[i:i + 4] == FSYNC:
                i += 4
            start = i
            continue
        if data[i:i + 2] == HSYNC:
            i += 2
            continue
        cur += 2
        i += 2
    return out


# ---------------------------------------------------------------------------
# Frame realignment
#
# Replaces trim_to_frame_bounds() as the pre-decode step. That function looked
# for the first FSYNC interval whose length was a multiple of 16 and discarded
# everything before it. On a real capture (6956 bytes, two valid A-Syncs at
# offsets 949 and 2949) it kept only bytes 4952..6956 - 71% of the wire thrown
# away, both A-Syncs with it - so OpenCSD had nothing to lock onto and reported
# NO_SYNC. Nothing is discarded here.
#
# Two ideas do the work:
#
#   1. Every FSYNC is an absolute frame boundary, so the wire is cut into
#      FSYNC-delimited segments and each is framed from its own start. A short
#      segment can no longer shift the segments after it. The old deframe loop
#      skipped the FSYNC bytes but did NOT reset its frame accumulator, which
#      is exactly how a partial frame leaked across the boundary.
#
#   2. Where a segment is not a whole number of frames, the missing bytes are
#      not assumed to be at the tail. All 16 phases are tried and scored on how
#      many well-formed A-Sync packets survive deframing, because that is what
#      OpenCSD needs in order to lock. On the capture above this recovers the
#      leading segment at phase 12, which tail-trimming had mangled.
#
# Only true fragments are lost - the few bytes of an incomplete frame at a
# segment edge, which are unusable by construction (8% on that capture, versus
# 71%).
# ---------------------------------------------------------------------------

ASYNC = b"\x00" * 11 + b"\x80"       # ETMv4 alignment sync packet

# One FSYNC every this many frames in the rebuilt wire, so the interval
# arithmetic in validate() stays meaningful and OpenCSD gets resync points.
REFRAME_FSYNC_EVERY = 64


def count_async(buf):
    """Well-formed A-Syncs in a deframed byte stream.

    A match that is itself preceded by a zero is part of a longer run, not a
    second packet - counting those inflates the score and lets the phase search
    talk itself into an alignment that only manufactures zero runs.
    """
    n, j = 0, 0
    while True:
        j = buf.find(ASYNC, j)
        if j < 0:
            return n
        if j == 0 or buf[j - 1] != 0:
            n += 1
        j += 12


def split_on_fsync(data):
    """[(offset, payload)] - the wire cut at every FSYNC run, HSYNC removed."""
    segs, i, cur, start = [], 0, bytearray(), 0
    while i < len(data):
        if data[i:i + 4] == FSYNC:
            segs.append((start, bytes(cur)))
            cur = bytearray()
            while data[i:i + 4] == FSYNC:
                i += 4
            start = i
            continue
        if data[i:i + 2] == HSYNC:
            i += 2
            continue
        cur.append(data[i])
        i += 1
    segs.append((start, bytes(cur)))
    return [s for s in segs if s[1]]


RESERVED_IDS = {0x00} | set(range(0x70, 0x80))


def _frame_ok(f, want):
    """True if every ATB ID this frame declares is the one ID we expect.

    Only the ETM is feeding the funnel, so a correctly aligned frame can only
    ever declare `want`. In a misaligned frame the even slots hold ordinary
    trace payload instead, and 21% of ETM bytes have bit0 = 1 - each of those
    reads as an ID change to byte>>1, which is how one lost byte turns the rest
    of a capture into phantom IDs. Requiring every declared ID to equal `want`
    rejects a random frame ~99.6% of the time, which is what makes it usable as
    a resync test.
    """
    for k in range(0, 15, 2):
        if f[k] & 1 and (f[k] >> 1) != want:
            return False
    return True


def _deframe(frames, seed=0):
    """Frames -> per-ATB-ID byte streams, CoreSight formatter rules.

    `seed` is the ID in force before the first ID byte. The wire often starts
    mid-stream, so the opening frames carry no declaration; seeding with
    TRCTRACEIDR files them under the real source instead of the reserved ID 0.
    """
    st, cur = collections.defaultdict(bytearray), seed
    for f in frames:
        aux, k = f[15], 0
        while k < 15:
            if k % 2 == 0 and (f[k] & 1):
                nid = f[k] >> 1
                if (aux >> (k // 2)) & 1:
                    if k + 1 < 15:
                        st[cur].append(f[k + 1])
                    cur = nid
                    k += 2
                else:
                    cur = nid
                    k += 1
                continue
            st[cur].append(f[k] | ((aux >> (k // 2)) & 1) if k % 2 == 0 else f[k])
            k += 1
    return st


def realign_frames(data):
    """Rebuild the wire as whole frames, resyncing wherever framing breaks.

    The previous version chose one byte phase per FSYNC-delimited segment by
    counting A-Syncs. That score is near-useless here: a whole capture holds
    only a handful of A-Syncs, so almost every segment scored 0 and fell back
    to frame count, which barely varies with phase. Segments then picked phases
    at random and each misaligned one manufactured its own set of phantom IDs.

    This version scores on the one thing we actually know - TRCTRACEIDR - and
    resyncs at frame granularity instead of per segment, so a single lost byte
    costs a few bytes rather than the remainder of the capture.
    """
    want = ETM_REGS["TRCTRACEIDR"] & 0x7F
    segs = split_on_fsync(data)
    if not segs:
        print("  no FSYNC anywhere - passing the wire through untouched")
        return data

    all_frames, lost, resyncs, rep = [], 0, 0, []
    for n, (off, payload) in enumerate(segs):
        i, nf, drop, nres = 0, 0, 0, 0
        while i + 16 <= len(payload):
            if _frame_ok(payload[i:i + 16], want):
                all_frames.append(payload[i:i + 16])
                nf += 1
                i += 16
                continue
            # Framing is broken here. Slide forward a byte at a time to the
            # next offset where two frames in a row look sane - one lucky
            # frame is not enough to re-anchor on.
            j = i + 1
            while j + 16 <= len(payload):
                if _frame_ok(payload[j:j + 16], want) and (
                        j + 32 > len(payload)
                        or _frame_ok(payload[j + 16:j + 32], want)):
                    break
                j += 1
            drop += j - i
            if j + 16 <= len(payload):
                nres += 1
            i = j
        drop += len(payload) - i
        lost += drop
        resyncs += nres
        rep.append((n, off, len(payload), nf, nres, drop))

    total = sum(len(p) for _, p in segs)
    print(f"  FSYNC-delimited segments       : {len(segs)}")
    print(f"  expected ATB ID (TRCTRACEIDR)  : 0x{want:02x}")
    print("    seg    offset  payload  frames  resync  dropped")
    for n, off, pl, nf, nres, dr in rep:
        if nf or dr:
            print(f"    [{n:3d}] {off:8d} {pl:8d} {nf:7d} {nres:7d} {dr:8d}")
    print(f"  frames recovered               : {len(all_frames)}")
    print(f"  resync events                  : {resyncs}")
    print(f"  bytes lost to broken framing   : {lost} of {total} "
          f"({lost * 100.0 / max(1, total):.2f}%)")
    st = _deframe(all_frames, seed=want)
    print(f"  A-Syncs surviving deframe      : "
          f"{count_async(bytes(st.get(want, b'')))}")
    stray = {k: len(v) for k, v in st.items() if k != want}
    print(f"  bytes on ID 0x{want:02x}                 : "
          f"{len(st.get(want, b''))}")
    if stray:
        print(f"  stray IDs after realign        : "
              + ", ".join(f"0x{k:02x}:{v}" for k, v in sorted(stray.items())))

    out = bytearray()
    for k, fr in enumerate(all_frames):
        if k % REFRAME_FSYNC_EVERY == 0:
            out += FSYNC
        out += fr
    return bytes(out)


def etm_stream(wire):
    """The realigned wire deframed down to the one ETM source's byte stream.

    Handing this to OpenCSD as `source_data` takes its frame deformatter out of
    the path. That matters because the capture starts mid-stream: the opening
    frames carry no ID declaration, so the deformatter files them under the
    reserved ID 0 and throws them away - taking the leading A-Sync with them,
    which is why a capture with sync bytes at byte 7 would only synchronise
    hundreds of bytes later. Deframing here lets us seed the ID with
    TRCTRACEIDR instead of guessing it from the wire.
    """
    want = ETM_REGS["TRCTRACEIDR"] & 0x7F
    body = bytearray()
    i = 0
    while i < len(wire):
        if wire[i:i + 4] == FSYNC:
            i += 4
            continue
        body.append(wire[i])
        i += 1
    frames = [bytes(body[k * 16:(k + 1) * 16]) for k in range(len(body) // 16)]
    return bytes(_deframe(frames, seed=want).get(want, b""))


def trim_to_frame_bounds(data):
    """Hand OpenCSD a buffer that starts on a VERIFIED frame boundary.

    Trimming to the first FSYNC is not enough. A capture usually starts partway
    through the TPIU's frame counter, so the first interval is a partial one -
    short by however much was already sent before recording began. OpenCSD then
    walks into the next FSYNC while still mid-frame and aborts with a "Data
    Path fatal error" having produced nothing.

    So: start at the first FSYNC that is followed by a whole number of frames.

    Trailing: the capture almost always stops mid-frame, which errors at
    end-of-trace. Cutting at the last FSYNC also discards the run of idle HSYNC
    filler after the last real trace data.
    """
    if data.find(FSYNC) < 0:
        return data

    ivals = fsync_intervals(data)
    start = data.find(FSYNC)
    for n, (off, nbytes) in enumerate(ivals):
        if nbytes % 16 == 0:
            start = off - len(FSYNC)
            if n:
                print(f"  skipped {n} partial interval(s) at the start of the "
                      f"capture (recording began mid-frame)")
            break

    end = data.rfind(FSYNC) + len(FSYNC)
    if start:
        print(f"  trimmed {start} leading bytes to reach a verified frame start")
    if end < len(data):
        print(f"  trimmed {len(data) - end} trailing bytes at the last FSYNC")
    return data[start:end]


def validate(data):
    """Sanity-check the wire stream and report the ATB IDs it carries."""
    n_fsync = data.count(FSYNC)
    ff, sf = data.count(0xFF), data.count(0x7F)
    print(f"\nTPIU wire census: {len(data)} bytes")
    print(f"  FSYNC (ff ff ff 7f) occurrences : {n_fsync}")
    print(f"  0xff = {100*ff/len(data):.1f}%   0x7f = {100*sf/len(data):.1f}%")

    if n_fsync == 0:
        print("  ERROR: no frame sync - OpenCSD cannot lock onto this stream.")
        return False

    # Walk frames the way OpenCSD will: strip sync at halfword boundaries,
    # accumulate 16-byte frames, and report which ATB IDs appear.
    i = data.find(FSYNC)
    ids, buf, frames, cur_id = {}, [], 0, 0
    streams = collections.defaultdict(bytearray)
    while i < len(data):
        if data[i:i + 4] == FSYNC and len(buf) % 2 == 0:
            i += 4
            continue
        if data[i:i + 2] == HSYNC and len(buf) % 2 == 0:
            i += 2
            continue
        buf.append(data[i])
        i += 1
        if len(buf) == 16:
            frames += 1
            aux, k = buf[15], 0
            while k < 15:
                # Even bytes carry a flag in bit 0: 1 = ATB ID change, 0 = data
                # (its stripped LSB comes from bit k/2 of the aux byte).
                if k % 2 == 0 and (buf[k] & 1):
                    new_id = buf[k] >> 1
                    if (aux >> (k // 2)) & 1:
                        # aux bit set: the byte after the ID byte still
                        # belongs to the OLD id, then the new id takes effect.
                        if k + 1 < 15:
                            ids[cur_id] = ids.get(cur_id, 0) + 1
                            streams[cur_id].append(buf[k + 1])
                        cur_id = new_id
                        k += 2
                    else:
                        cur_id = new_id
                        k += 1
                    continue
                ids[cur_id] = ids.get(cur_id, 0) + 1
                streams[cur_id].append(
                    buf[k] | ((aux >> (k // 2)) & 1) if k % 2 == 0 else buf[k])
                k += 1
            buf = []

    print(f"  16-byte frames recovered       : {frames}")
    print(f"  ATB IDs present                : "
          + ", ".join(f"0x{k:02x} ({v} B)" for k, v in sorted(ids.items())))

    ok = True

    # --- Framing integrity -------------------------------------------------
    # Every FSYNC interval must hold a whole number of 16-byte frames. Anything
    # else means bytes are genuinely missing and everything after that point is
    # misaligned. This is the only reliable capture-quality signal; sync
    # DENSITY is not one, because it only reflects how idle the trace port was.
    ivals = [n for _, n in fsync_intervals(data)]
    bad = [n for n in ivals if n % 16]
    if ivals:
        common = collections.Counter(ivals).most_common(1)[0]
        print(f"  FSYNC intervals                : {len(ivals)}"
              f" (most common: {common[0]} bytes = {common[0]//16} frames"
              f" x{common[1]})")
    print(f"  intervals not a whole frame    : {len(bad)}", end="")
    if bad:
        print("   <-- data loss")
        print(f"         short/long by: {sorted(set(n % 16 for n in bad))} bytes")
        print("  ERROR: bytes are missing mid-capture. Frames after the first")
        print("         gap are misaligned and will decode to garbage.")
        ok = False
    else:
        print("   (framing intact)")

    want = ETM_REGS["TRCTRACEIDR"]
    if want not in ids:
        print(f"  ERROR: TRCTRACEIDR is 0x{want:02x} but that ID is not on the "
              f"wire. Fix ETM_REGS['TRCTRACEIDR'] or the firmware.")
        return False

    # --- Stream integrity ---------------------------------------------------
    # The ETM emits an A-Sync (11 zero bytes + 0x80) on a fixed period. Even
    # spacing proves nothing was lost. Ragged spacing means bytes are missing,
    # and OpenCSD will then decode plausible-looking headers with garbage
    # payloads - which is far more misleading than an outright failure.
    stream = bytes(streams[want])
    hits = [m.start() for m in re.finditer(rb"\x00{11}\x80", stream)]
    print(f"  A-Sync packets in ID 0x{want:02x}       : {len(hits)}")
    if len(hits) >= 3:
        gaps = [hits[i + 1] - hits[i] for i in range(len(hits) - 1)]
        lo, hi = min(gaps), max(gaps)
        print(f"  A-Sync spacing (bytes)         : min={lo} max={hi}", end="")
        if hi > lo * 1.5:
            print("   <-- BAD")
            print("  ERROR: A-Sync spacing is irregular, so bytes are missing "
                  "from\n         the stream. Re-capture at a higher sample rate.")
            ok = False
        else:
            print("   (even)")
    elif len(hits) < 2:
        print("  WARNING: too few A-Sync packets to verify stream integrity.")

    return ok


# ---------------------------------------------------------------------------
# Stage 3: memory image for full instruction decode
# ---------------------------------------------------------------------------
def elf_load_segments(path):
    """Yield (vaddr, bytes) for every PT_LOAD segment with file contents.

    Minimal 32-bit little-endian ELF reader - no toolchain dependency.
    """
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"\x7fELF" or data[4] != 1 or data[5] != 1:
        raise ValueError("not a 32-bit little-endian ELF")
    e_phoff, = struct.unpack_from("<I", data, 0x1C)
    e_phentsize, e_phnum = struct.unpack_from("<HH", data, 0x2A)
    for n in range(e_phnum):
        off = e_phoff + n * e_phentsize
        p_type, p_offset, p_vaddr, _, p_filesz = struct.unpack_from("<IIIII", data, off)
        if p_type == 1 and p_filesz:            # PT_LOAD with contents
            yield p_vaddr, data[p_offset:p_offset + p_filesz]


# ---------------------------------------------------------------------------
# Stage 4: emit the OpenCSD snapshot
# ---------------------------------------------------------------------------
def write_snapshot(out_dir, wire, elf_path):
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(out_dir, "tpiu_wire.bin"), "wb") as f:
        f.write(wire)

    stream = etm_stream(wire)
    with open(os.path.join(out_dir, "etm_stream.bin"), "wb") as f:
        f.write(stream)
    print(f"  ETM source stream {len(stream)} bytes -> etm_stream.bin")

    dumps = []
    if elf_path:
        for vaddr, blob in elf_load_segments(elf_path):
            name = f"mem_{vaddr:08x}.bin"
            with open(os.path.join(out_dir, name), "wb") as f:
                f.write(blob)
            dumps.append((name, vaddr, len(blob)))
            print(f"  memory dump 0x{vaddr:08x} + 0x{len(blob):x} -> {name}")
    else:
        print("  no ELF supplied: packet listing only, no instruction decode")

    with open(os.path.join(out_dir, "snapshot.ini"), "w") as f:
        f.write("; OpenCSD snapshot - STM32H750 Cortex-M7 ETMv4 over 4-bit TPIU\n\n"
                "[snapshot]\nversion=1.0\n\n"
                "[device_list]\ndevice1=device1.ini\ndevice2=device2.ini\n\n"
                "[trace]\nmetadata=trace.ini\n")

    with open(os.path.join(out_dir, "device1.ini"), "w") as f:
        f.write(f"[device]\nname={CORE_NAME}\nclass=core\ntype={CORE_TYPE}\n\n"
                "[regs]\nPC=0x08000000\nxPSR=0x01000000\n")
        for n, (name, vaddr, length) in enumerate(dumps, 1):
            f.write(f"\n[dump{n}]\nfile={name}\naddress=0x{vaddr:08X}\n"
                    f"length=0x{length:X}\n")

    with open(os.path.join(out_dir, "device2.ini"), "w") as f:
        f.write(f"[device]\nname={ETM_NAME}\nclass=trace_source\ntype={ETM_TYPE}\n\n"
                "[regs]\n")
        for name, val in ETM_REGS.items():
            f.write(f"{name}(0x{REG_IDS[name]:X})=0x{val:08X}\n")

    with open(os.path.join(out_dir, "trace.ini"), "w") as f:
        # source_data on the already-deframed stream, not coresight on the
        # wire. Letting OpenCSD deframe means it must learn the ATB ID from the
        # wire itself, and everything ahead of the first ID byte is discarded
        # as reserved ID 0 - including the leading A-Sync. See etm_stream().
        f.write("[trace_buffers]\nbuffers=buffer0\n\n"
                f"[buffer0]\nname={BUFFER_NAME}\nfile=etm_stream.bin\n"
                "format=source_data\n\n"
                f"[core_trace_sources]\n{CORE_NAME}={ETM_NAME}\n\n"
                f"[source_buffers]\n{ETM_NAME}={BUFFER_NAME}\n")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        selected, elf = args[0], (args[1] if len(args) > 1 else None)
    else:
        from tkinter import Tk, filedialog
        root = Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        print("Opening file browser... select the logic analyzer export.")
        selected = filedialog.askopenfilename(
            title="Select Logic Analyzer Export",
            filetypes=[("CSV Files", "*.csv"), ("All Files", "*.*")])
        if not selected:
            print("Operation cancelled.")
            sys.exit()
        elf = filedialog.askopenfilename(
            title="Select the MATCHING firmware .elf (Cancel to skip)",
            filetypes=[("ELF", "*.elf"), ("All Files", "*.*")]) or None

    if elf and not os.path.exists(elf):
        print(f"ELF not found: {elf}")
        sys.exit(1)

    base, _ = os.path.splitext(selected)
    wire_path = f"{base}_tpiu.bin"
    snap_dir = f"{base}_snapshot"

    wire = load_wire_bytes(selected)
    print("\nRealigning frames (nothing discarded but true fragments):")
    wire = realign_frames(wire)
    with open(wire_path, "wb") as f:
        f.write(wire)
    print(f"\nWrote raw TPIU wire bytes -> {wire_path} ({len(wire)} bytes)")

    ok = validate(wire)

    print(f"\nBuilding OpenCSD snapshot -> {snap_dir}")
    write_snapshot(snap_dir, wire, elf)

    print("\n" + "-" * 68)
    print("Decode with:")
    print(f"  $TPL -ss_dir {snap_dir} -logstdout"
          + (" -decode" if elf else ""))
    print("  (no -tpiu / -tpiu_hsync: the snapshot is already deframed)")
    print("-" * 68)
    if not ok:
        print("NOTE: validation reported problems; decode may fail.")
    if elf:
        print("The .elf MUST be the exact build that was running during the "
              "capture, or addresses will resolve to the wrong functions.")


if __name__ == "__main__":
    main()