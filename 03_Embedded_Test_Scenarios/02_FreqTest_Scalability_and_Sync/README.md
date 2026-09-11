# Scenario 2: Frequency Scalability and Sustained Loop Trace (`02_FreqTest_Scalability_and_Sync`)

## 1. Objective and Scope
This test scenario evaluates the **bandwidth scalability, buffer overflow resistance, and periodic alignment synchronization (A-Sync)** of the CoreSight trace pipeline under sustained, continuous execution.

**Target Phenomena Investigated**:
1.  **Trace Port Throughput**: High-throughput execution across millions of CPU cycles without FIFO overrun.
2.  **Periodic Synchronization**: Verification that the ETMv4 synchronization counter (`TRCSYNCPR`) periodically emits `I_ASYNC` (Alignment Synchronization) and `I_TRACE_INFO` packets to maintain decoder lock across continuous instruction streams.
3.  **Frequency Stability**: Validating trace packet integrity and signal eye diagrams across varying TRACECLK prescalers.

---

## 2. Firmware Workload Description
The core firmware executes a heavy loop payload between DWT-triggered trace boundaries:
```c
StartPoint();
GPIOA->BSRR = LED_Pin;
while(i < 0xfffff)
{
    __NOP();
    i++;
}
StopPoint();
GPIOA->BSRR = LED_Pin << 16;
```
This payload generates over **1,000,000 continuous branch and cycle operations**, producing a massive trace stream that stresses the hardware Trace Port Interface Unit (TPIU), the Embedded Trace FIFO (ETF), and the logic analyzer capture buffer.

---

## 3. Directory Contents
```
02_FreqTest_Scalability_and_Sync/
├── Firmware_Source/
│   ├── Core/              # ETMv4 driver, main loop, and interrupt handlers
│   ├── Drivers/
│   ├── Debug/             # ELF binary (BP_Test1_H7.elf), map, and list
│   └── *.ioc, *.ld, *.launch
├── Trace_Capture/
│   ├── DSLogic U3Pro16-la-260903-195532.dsl      # Compact native DSLogic session (27 MB)
│   └── DSLogic U3Pro16-la-260903-195532_tpiu.bin # Extracted TPIU byte stream (4.2 MB)
├── Decoded_Execution_Log/
│   └── 195532.log                                # 10.4-million-line fully decoded execution trace
└── README.md
```

---

## 4. Key Results from the Decoded Log (`195532.log`)
*   **Total Decoded Lines**: 10,399,882 lines.
*   **Synchronization Acquisition**:
    *   `Idx:210; I_ASYNC : Alignment Synchronisation.`
    *   `Idx:224; I_TRACE_INFO : INFO=0x1 { CC.1 }; CC_THRESHOLD=0x40`
    *   `Idx:230; I_TIMESTAMP : Updated val = 0x21ea74c34`
    *   `Idx:239; OCSD_GEN_TRC_ELEM_PE_CONTEXT((ISA=T32) EL0S; 32-bit; )`
*   **Loop Execution**: Unbroken sequence of `OCSD_GEN_TRC_ELEM_INSTR_RANGE(exec range=0x80007d6:[0x80007dc])` demonstrating continuous trace capture without data loss or buffer corruption.

---

## 5. Reproduction Instructions
1.  **Build Firmware**:
    ```bash
    cd Firmware_Source/Debug
    make all
    ```
2.  **View Logic Capture in DSView**:
    *   Open `Trace_Capture/DSLogic U3Pro16-la-260903-195532.dsl` directly in DreamSourceLab DSView.
    *   Displays 16 digital channels showing sustained high-speed TRACECLK clocking and 4-bit TRACED[0:3] activity.
3.  **Inspect Decoded Execution Trace**:
    *   Inspect `Decoded_Execution_Log/195532.log` to examine the full disassembled instruction stream.
    *   To regenerate the OpenCSD snapshot from `Trace_Capture/DSLogic U3Pro16-la-260903-195532_tpiu.bin`:
    ```bash
    python TraceStreamProcessor.py --bin "Trace_Capture/DSLogic U3Pro16-la-260903-195532_tpiu.bin" --elf "Firmware_Source/Debug/BP_Test1_H7.elf"
    ```
