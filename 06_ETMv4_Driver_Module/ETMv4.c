/*
 * ETMv4.c - ARM CoreSight ETMv4 & Parallel Trace Configuration for STM32H7
 * Bundled with CoreSight Trace Studio
 */

#include "ETMv4.h"
#include "core_cm7.h"

uint32_t startAddr = 0;
uint32_t stopAddr = 0;

void Parallel_Trace_configure(void) {
    TraceGPIO_Configure();
    Disable_ETM();
    TPIU_Configure();
    ETF_Configure();
    CSTF_Configure();
    TSG_Configure();
    ETM_Configure();
    SetupStartStopAddr();
    DWT_Configure();
    Enable_ETM();
}

void TSG_Configure(void) {
    TSG->LAR = CORESIGHT_UNLOCK;
    TSG->CNTCR = 0x1;
}

void TPIU_Configure(void) {
    TPIU->LAR = CORESIGHT_UNLOCK;
    TPIU->CURPSIZE = 8; // 4-bit parallel port size
    TPIU->CURTPM = 0;   // Normal trace output
    TPIU->FFCR = 0x2;   // Continuous formatting
    TPIU->FSCR = 0x40;  // Frame sync counter
    while (TPIU->FFSR & (1 << 0)) {
        // Wait until FLINPROG bit clears
    }
}

void ETF_Configure(void) {
    ETF->LAR = CORESIGHT_UNLOCK;
    ETF->CTL &= ~(1U << 0);
    for (uint32_t t = 0; t < 100000U; t++) {
        if (ETF->STS & (1U << 2)) break; // READY == 1
    }
    ETF->MODE = 0x2; // Hardware FIFO mode
    ETF->FFCR = (1U << 0); // Enable formatting
    ETF->CTL |= (1U << 0); // Enable trace capture
}

void ETM_Configure(void) {
    Disable_ETM();

    // Enable Cycle Count Insertion (CCI, bit 4) and Timestamps (TS, bit 11)
    ETM->CONFIG = (1U << 4) | (1U << 11);

    // TRCCCCTLR: Cycle-count report threshold (64 cycles)
    ETM->CCCTL = 64;

    ETM->STALLCTL = 0x00000000;
    ETM->EVENTCTL0 = 0x00000000;
    ETM->EVENTCTL1 = 0x00000000;
    ETM->TSCTL     = 0x00000000;

    // Synchronization frequency (2^10 = 1024 bytes) - Read-only on STM32H7
    ETM->SYNCP = 0x0000000A;

    // CoreSight Trace ID (ATB ID)
    ETM->TRACEID = 0x3E;

#if ETM_BRINGUP_TRACE_ALL
    ETM->VIPCSSCTL = 0x00000000;
    ETM->VICTL     = 0x00000201;
#else
    // DWT-gated: PE comparator 0 starts, comparator 1 stops
    ETM->VIPCSSCTL = (1U << (16 + 1)) | (1U << 0);
    ETM->VICTL     = 0x00000001;
#endif
}

void CSTF_Configure(void) {
    CSTF->LAR = CORESIGHT_UNLOCK;
    CSTF->CTRL = (0x3U << 8) | 0x1U;
}

void TraceGPIO_Configure(void) {
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    RCC->AHB4ENR |= RCC_AHB4ENR_GPIOEEN;

    // Configure PE2, PE3, PE4, PE5, PE6 for AF0 (Trace)
    GPIOE->MODER &= ~(GPIO_MODER_MODE2 | GPIO_MODER_MODE3 |
                      GPIO_MODER_MODE4 | GPIO_MODER_MODE5 | GPIO_MODER_MODE6);
    GPIOE->MODER |= (2U << GPIO_MODER_MODE2_Pos) | (2U << GPIO_MODER_MODE3_Pos) |
                    (2U << GPIO_MODER_MODE4_Pos) | (2U << GPIO_MODER_MODE5_Pos) |
                    (2U << GPIO_MODER_MODE6_Pos);

    // Very High Speed
    GPIOE->OSPEEDR |= (3U << GPIO_OSPEEDR_OSPEED2_Pos) | (3U << GPIO_OSPEEDR_OSPEED3_Pos) |
                      (3U << GPIO_OSPEEDR_OSPEED4_Pos) | (3U << GPIO_OSPEEDR_OSPEED5_Pos) |
                      (3U << GPIO_OSPEEDR_OSPEED6_Pos);

    GPIOE->AFR[0] &= ~((0xFU << (4 * 2)) | (0xFU << (4 * 3)) |
                       (0xFU << (4 * 4)) | (0xFU << (4 * 5)) | (0xFU << (4 * 6)));

    DBGMCU->CR |= DBGMCU_CR_DBG_TRACECKEN | DBGMCU_CR_DBG_CKD1EN | DBGMCU_CR_DBG_CKD3EN;
}

void DWT_Configure(void) {
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->LAR = CORESIGHT_UNLOCK;
    DWT->CTRL = (1 << 10) | (1 << 0);

    // Comparator 0: START trigger
    DWT->COMP0 = startAddr;
    DWT->MASK0 = 0;
    DWT->FUNCTION0 = 8; // Match on instruction execution

    // Comparator 1: STOP trigger
#undef COMP1
    DWT->COMP1 = stopAddr;
    DWT->MASK1 = 0;
    DWT->FUNCTION1 = 8; // Match on instruction execution
}

void Enable_ETM(void) {
    ETM->PRGCTL |= 1U;
    while ((ETM->STAT & 0x01) != 0);
}

void Disable_ETM(void) {
    ETM->LAR = CORESIGHT_UNLOCK;
    while ((ETM->LSR & 0x02) != 0);
    ETM->PRGCTL &= ~1U;
    for (uint32_t t = 0; t < 100000U; t++) {
        if ((ETM->STAT & 0x3U) == 0x3U) break;
    }
}

Trace_Status_t g_trace_status;

void Trace_DumpStatus(void) {
    g_trace_status.etm_prgctl    = ETM->PRGCTL;
    g_trace_status.etm_stat      = ETM->STAT;
    g_trace_status.etm_victl     = ETM->VICTL;
    g_trace_status.etm_vipcssctl = ETM->VIPCSSCTL;
    g_trace_status.etm_traceid   = ETM->TRACEID;
    g_trace_status.etm_authstat  = ETM->AUTHSTAT;
    g_trace_status.etm_config    = ETM->CONFIG;
    g_trace_status.etm_syncp     = ETM->SYNCP;
    g_trace_status.etm_ccctl     = ETM->CCCTL;
    g_trace_status.etm_stallctl  = ETM->STALLCTL;
    g_trace_status.etm_idr0      = ETM->IDR0;
    g_trace_status.etm_idr1      = ETM->IDR1;
    g_trace_status.etm_idr2      = ETM->IDR2;
    g_trace_status.etm_idr3      = ETM->IDR3;
    g_trace_status.etm_idr4      = ETM->IDR4;
    g_trace_status.etm_idr5      = ETM->IDR5;
    g_trace_status.etm_idr8      = ETM->IDR8;
    g_trace_status.etm_idr9      = ETM->IDR9;
    g_trace_status.etm_idr10     = ETM->IDR10;
    g_trace_status.etm_idr11     = ETM->IDR11;
    g_trace_status.etm_idr12     = ETM->IDR12;
    g_trace_status.etm_idr13     = ETM->IDR13;

    g_trace_status.etf_ctl       = ETF->CTL;
    g_trace_status.etf_mode      = ETF->MODE;
    g_trace_status.etf_ffcr      = ETF->FFCR;
    g_trace_status.etf_sts       = ETF->STS;
    g_trace_status.etf_rwp       = ETF->RWP;
    g_trace_status.etf_cbuflvl   = ETF->CBUFLVL;

    g_trace_status.cstf_ctrl     = CSTF->CTRL;

    g_trace_status.tpiu_suppsize = TPIU->SUPPSIZE;
    g_trace_status.tpiu_curpsize = TPIU->CURPSIZE;
    g_trace_status.tpiu_curtpm   = TPIU->CURTPM;
    g_trace_status.tpiu_ffcr     = TPIU->FFCR;
    g_trace_status.tpiu_ffsr     = TPIU->FFSR;

    g_trace_status.dwt_ctrl      = DWT->CTRL;
    g_trace_status.dwt_func0     = DWT->FUNCTION0;
    g_trace_status.dwt_func1     = DWT->FUNCTION1;

    g_trace_status.tsg_cntcr     = TSG->CNTCR;
    g_trace_status.tsg_cntsr     = TSG->CNTSR;
    g_trace_status.tsg_cvl       = TSG->CNTCVL;
    g_trace_status.tsg_cvu       = TSG->CNTCVU;
}

volatile uint32_t g_gate_marker;

__attribute__((noinline)) void StartPoint(void) {
    g_gate_marker = 0xA5A50001UL;
}

__attribute__((noinline)) void StopPoint(void) {
    g_gate_marker = 0x5A5A0002UL;
}

void SetupStartStopAddr(void) {
    startAddr = (uint32_t)&StartPoint & ~1UL;
    stopAddr  = (uint32_t)&StopPoint & ~1UL;
}
