# Baseline Embedded Firmware Project (BP_Test0_H7)

## 1. Overview and Purpose
This directory contains the **initial baseline STM32CubeIDE project (`BP_Test0_H7`)** around which the hardware trace framework was developed. It represents the starting point of the project before the multi-routine, frequency scalability, and interrupt interference test harnesses were integrated.

The project configures the STM32H750VBT6 microcontroller with:
*   Core clock at initial configuration.
*   Basic GPIO and SPI1 peripherals enabled.
*   Initial ETMv4 and TPIU initialization functions (`ETMv4.c`, `ETMv4.h`).
*   Direct hardware mapping for `StartPoint()` and `StopPoint()` trace triggers.

---

## 2. Directory Contents
```
00_Base_Initial_Program/
├── Firmware_Source/
│   ├── Core/
│   │   ├── Inc/           # Core header files (ETMv4.h, main.h, stm32h7xx_it.h)
│   │   ├── Src/           # Source files (main.c, ETMv4.c, stm32h7xx_it.c, etc.)
│   │   └── Startup/       # Vector table and startup assembly (startup_stm32h750vbtx.s)
│   ├── Drivers/           # CMSIS and STM32H7xx HAL Driver interfaces
│   ├── Debug/             # Compiled ELF (`BP_Test0_H7.elf`), disassembly map, and list files
│   ├── .cproject, .project, .mxproject, .ioc
│   ├── STM32H750VBTX_FLASH.ld, STM32H750VBTX_RAM.ld
│   └── ETM_Setup.gdb      # GDB startup script for ETM register access
└── README.md
```

---

## 3. Hardware Configuration & Trace Pins
*   **Target Device**: STM32H750VBT6 (ARM Cortex-M7, up to 480 MHz).
*   **Trace Pins Configured (4-bit Parallel ETM)**:
    *   `PE2` -> `TRACECLK`
    *   `PE3` -> `TRACED0`
    *   `PE4` -> `TRACED1`
    *   `PE5` -> `TRACED2`
    *   `PE6` -> `TRACED3`
*   **Trace Sink**: Off-chip parallel trace port via TPIU routed to DreamSourceLab DSLogic U3Pro16 logic analyzer.

---

## 4. Compilation and Usage Instructions
1.  **STM32CubeIDE**: Open STM32CubeIDE, select `File -> Open Projects from File System...`, point to `Firmware_Source/`, and build.
2.  **Command Line**:
    ```bash
    make -C Debug all
    ```
    The build produces `Debug/BP_Test0_H7.elf`.
3.  **Flashing**:
    Flash using ST-LINK V2/V3 or OpenOCD / GDB using the provided launch scripts.
