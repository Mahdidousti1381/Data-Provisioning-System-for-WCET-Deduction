# Scenario 3: Multi-Routine Software Execution and Asynchronous Interrupt Handling (`03_Routine_Irq_Multi_Interrupt`)

## 1. Objective and Architecture
This scenario represents the **comprehensive validation of complex control-flow reconstruction**, testing the ability of the framework to accurately decompress and trace:
1.  **Algorithmic Routines**: Deterministic sequential code (`Routine_Checksum`) and data-dependent nested loops (`Routine_Sort`).
2.  **Synchronous Software Exceptions**: `SVC` instruction execution, vector entry to `SVC_Handler`, and exception return.
3.  **Asynchronous Hardware Peripheral Interrupts**: Incoming serial data transmitted from an external Raspberry Pi Pico microcontroller (`USART1_IRQHandler`), and manual push-button edge detection (`EXTI9_5_IRQHandler`).

---

## 2. Program Flow Within the Traced Window
The execution window is bounded by hardware DWT comparators triggered at `StartPoint()` and `StopPoint()`:
```
[StartPoint()]
       │
       ├──▶ Routine_Checksum(seed, size)     (Counted linear loop)
       │
       ├──▶ Routine_Sort(buffer, size)       (Data-dependent nested bubble sort)
       │
       ├──▶ Svc_Trigger(0x42)
       │        └──▶ Exception Entry: SVC_Handler ──▶ TestApp_SVC_ISR ──▶ Exception Return
       │
       ├──▶ Asynchronous USART1 IRQ (Pico Handshake)
       │        └──▶ Exception Entry: USART1_IRQHandler ──▶ Echo byte read ──▶ Exception Return
       │
       └──▶ Asynchronous EXTI5 IRQ (Push-button press)
                └──▶ Exception Entry: EXTI9_5_IRQHandler ──▶ Flag latch ──▶ Exception Return
       │
[StopPoint()]
```

---

## 3. Directory Contents
```
03_Routine_Irq_Multi_Interrupt/
├── Firmware_Source/
│   ├── Core/
│   │   ├── Inc/           # TestApp.h, ETMv4.h, main.h, stm32h7xx_it.h
│   │   ├── Src/           # TestApp.c (routines & ISRs), ETMv4.c, main.c, stm32h7xx_it.c
│   │   └── Startup/
│   ├── Drivers/
│   ├── Debug/             # ELF binary (BP_Test1_H7.elf), map, and list
│   └── *.ioc, *.ld, *.launch
├── Trace_Capture/
│   └── DSLogic U3Pro16-la-260909-134532_tpiu.bin  # Extracted TPIU byte stream (612 B)
├── OpenCSD_Snapshot/                              # Complete Linaro OpenCSD snapshot
├── Decoded_Execution_Log/
│   └── 134532.log                                 # Decoded packet log
└── README.md
```

---

## 4. Hardware Interconnect and Peripheral Setup
*   **External Controller**: Raspberry Pi Pico connected via UART:
    *   STM32 `PA9` (USART1 TX) <-> Pico RX
    *   STM32 `PA10` (USART1 RX) <-> Pico TX
    *   Baud Rate: 9600 bps, 8-N-1.
*   **Push-Button**: Pin `PC5` configured with internal pull-up and falling-edge trigger.
*   **Trace Port**: 4-bit parallel trace (`PE2` - `PE6`) connected to DSLogic U3Pro16.

---

## 5. Build and Execution
1.  **Build**:
    ```bash
    cd Firmware_Source/Debug
    make all
    ```
2.  **Flash & Run**: Flash `BP_Test1_H7.elf` to the STM32H750 board.
3.  **Trigger Trace**: Press the PC5 button. The LED illuminates during window execution and extinguishes at `StopPoint()`.
4.  **Replay Decoded Trace via OpenCSD**:
    *   Inspect `Decoded_Execution_Log/134532.log` to view decoded routines, SVC calls, and EXTI interrupt transitions.
    *   To replay decompression directly using OpenCSD:
    ```bash
    trc_pkt_lister -ss_dir OpenCSD_Snapshot -decode -src_name ETMA
    ```
