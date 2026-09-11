# CoreSight ETMv4 Python Trace Decoder & Stream Processor

## 1. Overview and Architecture
This directory contains the Python trace processing toolchain designed to bridge raw digital logic analyzer captures with the **Linaro OpenCSD** instruction trace decode engine.

The primary production engine is **`TraceStreamProcessor.py`**, which automates the complete data pipeline from physical logic transitions to disassembled, cycle-accurate instruction logs.

---

## 2. Directory Contents
```
04_Python_Trace_Decoder/
├── TraceStreamProcessor.py       # Main production trace processor & OpenCSD snapshot generator
├── Development_History/          # Evolution of the decoder across project milestones
│   ├── TempDecoder_V0.py         # Initial prototype: raw byte parsing
│   ├── TempDecoder_V0.1.py       # TPIU frame validator and packet demultiplexer
│   ├── TempDecoder_V0.2.py       # OpenCSD snapshot builder with static register maps
│   └── etm_window_gaps.py        # Gap analysis and window interval calculation script
└── README.md
```

---

## 3. End-to-End Processing Pipeline

```
  [DSLogic U3Pro16]
         │ (16-channel logic capture: TRACECLK + TRACED[0:3])
         ▼
  [Capture.csv / Capture.bin]
         │
         ▼
  ┌─────────────────────────────────────────────────────────┐
  │              TraceStreamProcessor.py                    │
  │                                                         │
  │  1. Nibble Assembly:                                    │
  │     Reconstructs 8-bit bytes from 4-bit dual-edge       │
  │     transfers clocked by TRACECLK.                      │
  │                                                         │
  │  2. TPIU Frame Alignment:                               │
  │     Identifies 16-byte TPIU frames, validates FSYNC     │
  │     (Full Sync: 0xFFFFFF7F) & HSYNC (Half Sync).        │
  │                                                         │
  │  3. Wire Stream Export:                                 │
  │     Writes sanitized <capture>_tpiu.bin.                │
  │                                                         │
  │  4. Memory & ELF Section Extraction:                    │
  │     Parses firmware ELF to extract executable sections  │
  │     (Flash 0x08000000, RAM 0x24000000) as binary dumps. │
  │                                                         │
  │  5. OpenCSD Snapshot Generation:                        │
  │     Emits snapshot directory with `trace.ini` and       │
  │     silicon ID registers (TRCIDR*, TRCCONFIGR, etc.).   │
  └─────────────────────────────────────────────────────────┘
         │
         ▼
  [OpenCSD Snapshot Directory]
         │
         ▼
  [trc_pkt_lister / OpenCSD] ──▶ Decoded Assembly & Cycle Execution Log
```

---

## 4. Usage Instructions

### 4.1. Interactive GUI Mode
Running the script without arguments opens an interactive graphical file picker to select the capture CSV and ELF files:
```bash
python TraceStreamProcessor.py
```

### 4.2. Command-Line CLI Mode
```bash
# Process a capture and link with firmware ELF
python TraceStreamProcessor.py capture.csv firmware.elf

# Process with raw binary input
python TraceStreamProcessor.py capture_tpiu.bin firmware.elf
```

### 4.3. Generated Artifacts
When executed on `DSLogic U3Pro16-la-260909-193100.csv`, the processor produces:
1.  `DSLogic U3Pro16-la-260909-193100_tpiu.bin` — Extracted CoreSight wire stream.
2.  `DSLogic U3Pro16-la-260909-193100_snapshot/`:
    *   `trace.ini` — OpenCSD session metadata and CoreSight component topology.
    *   `mem_08000000.bin` — Binary flash memory image required for instruction disassembly.
    *   `mem_24000000.bin` — AXI SRAM execution space.
3.  **Command Execution**: Prints the exact Linaro OpenCSD command to decode the stream:
    ```bash
    trc_pkt_lister -ss_dir "DSLogic U3Pro16-la-260909-193100_snapshot" -tpiu_hsync -decode -logfilename "decoded.log"
    ```

---

## 5. Historical Decoder Evolution (`Development_History/`)
*   **`TempDecoder_V0.py`**: Initial proof-of-concept exploring binary file parsing and raw hex displays.
*   **`TempDecoder_V0.1.py`**: Implemented initial TPIU un-framing logic and basic packet header classification.
*   **`TempDecoder_V0.2.py`**: First version to introduce automated OpenCSD snapshot creation with hardcoded silicon register templates.
*   **`etm_window_gaps.py`**: Statistical analysis tool used during the 100 µs timer interference test to compute delta timestamps between successive trace windows.
