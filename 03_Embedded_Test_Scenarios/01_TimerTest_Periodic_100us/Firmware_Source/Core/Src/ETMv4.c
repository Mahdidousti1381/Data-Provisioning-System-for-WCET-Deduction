/*
 * ETMv4.c
 *
 *  Created on: Feb 17, 2026
 *      Author: ASUS
 */
#include "ETMv4.h"
#include "core_cm7.h"

uint32_t startAddr = 0;
uint32_t stopAddr = 0;

void Parallel_Trace_configure(){
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

void TSG_Configure(void)
{
    // Unlock, same CoreSight software-lock pattern as every other component here.
    TSG->LAR = CORESIGHT_UNLOCK;

    // CNTCR bit0 = EN. Without this the counter never starts, so every ETM
    // TS packet (TRCCONFIGR.TS) faithfully reports whatever the halted
    // counter holds - which is 0. Leave bit1 (HDBG, halt-on-debug) clear so
    // the counter keeps running through breakpoints.
    TSG->CNTCR = 0x1;
}

void TPIU_Configure(void)
{
    // 1. Unlock the TPIU Access
    // Write the CoreSight unlock key (CORESIGHT_UNLOCK) to the Lock Access Register
    TPIU->LAR = CORESIGHT_UNLOCK;

    // 2. Configure the Trace Port Size
    TPIU->CURPSIZE = 8;   // Set the current parallel port size [cite: 45]

    // 3. Test Pattern generator: MUST be 0 for normal trace output.
    // Bit 17 (PCONTEN) alone enables the pattern generator in continuous mode
    // with NO pattern selected -> TRACECLK keeps toggling but TRACED[3:0] stay idle.
    // For a pin/wiring test only, use (1<<17)|(1<<2) = continuous AA/55 pattern.
    TPIU->CURTPM = 0;

    // 4. Configure Formatter and Flush Control Register (FFCR)
    // Bit 1: ENFTC - Enable Formatter Time-Stamping / Continuous formatting
    // Bit 8: TRIGIN - Enable trigger formatting if needed
    // Setting ENFCONT (Bit 1) forces continuous formatting so the debugger can frame the data stream
    TPIU->FFCR = 0x2;
    TPIU->FSCR = 0x40;
    // 5. Verify the configuration status using Formatter & Flush Status Register (FFSR)
    // Ensure that a flush operation isn't currently stuck in progress
    while (TPIU->FFSR & (1 << 0)) {
        // Wait until FLINPROG (Flush In Progress) bit clears
    }
}
void ETF_Configure(void) {
    // 1. Unlock write access to the ETF registers
    // The component requires the value CORESIGHT_UNLOCK to permit writes.
    ETF->LAR = CORESIGHT_UNLOCK;

    // 2. Disable trace capture to safely change states
    // Writing 0 to the TCEN bit moves the system into the Disabling or Disabled state[cite: 386].
    ETF->CTL &= ~(1U << 0);

    // 3. Wait for ETF to be fully drained and reach the Disabled/Stopped state
    // The READY bit (bit 2) is set when trace capture has stopped and buffers are drained[cite: 136, 137].
    for (uint32_t t = 0; t < 100000U; t++) {
        if (ETF->STS & (1U << 2)) break;   // READY == 1
    }

    // 4. Set ETF Operation Mode to Hardware FIFO mode
    // Value 10b (0x2) configures the RAM as a FIFO drained through the ATB master interface.
    ETF->MODE = 0x2;

    // 5. Enable Formatting
    // Bit 0 (ENFT) is set to 1 to enable formatting[cite: 784, 785].
    // Note: Disabling formatting is only supported in Circular buffer mode[cite: 787],
    // so in Hardware FIFO mode EnFt MUST be 1 or nothing valid reaches the TPIU.
    ETF->FFCR = (1U << 0);
    // 6. Enable trace capture
    // Writing 1 to the TCEN bit moves the ETF from the Disabled state to the Running state[cite: 387].
    ETF->CTL |= (1U << 0);
}

void ETM_Configure(void){

	Disable_ETM();

    // WCET measurement: CCI (bit4) inserts cycle-count deltas into the P0 stream,
    // so the elapsed core-clock cycles for the StartPoint()..StopPoint() block can
    // be summed straight out of the decode. TS (bit11) adds periodic 64-bit
    // absolute timestamps - OpenCSD cross-tags every timestamp with the current
    // cycle count whenever CCI is also on, which gives a wall-clock sanity check
    // on the cycle-sum total for free.
    // Both VERIFIED implemented in silicon via Trace_DumpStatus() readback:
    // TRCIDR0 bit7 = 1 (CCI present), TRCIDR0 bits[28:24] = 8 (64-bit TS present).
    // NOTE: enabling CCI (bit 4) requires TRCCCCTLR >= TRCIDR3.CCITMIN (bits [11:0]);
    // VERIFIED CCITMIN = 4 (TRCIDR3 = 0x07090004). The old "ETM->CCCTL |= 1" was
    // almost certainly below the minimum -> UNPREDICTABLE.
    ETM->CONFIG = (1U << 4) | (1U << 11);   // CCI | TS

    // TRCCCCTLR: cycle-count report threshold, in core clock cycles - must be
    // >= TRCIDR3.CCITMIN (VERIFIED = 4). Left at the legal floor this packs a
    // cycle-count packet after nearly every atom, multiplying trace bandwidth
    // many times over - more than our capture chain (4-bit port, logic
    // analyzer) can absorb. 64 keeps sub-microsecond resolution at the current
    // clock while keeping byte volume sane; lower it only if the capture setup
    // can keep up with the extra bandwidth.
    ETM->CCCTL = 64;

    // TRCSTALLCTLR: 0 for bring-up. The old 0x30C also set bit 9, which is RES0.
    ETM->STALLCTL = 0x00000000;

    ETM->EVENTCTL0 = 0x00000000;
    ETM->EVENTCTL1 = 0x00000000;
    ETM->TSCTL     = 0x00000000;

    // TRCSYNCPR: periodic synchronization every 2^10 bytes, so a decoder can lock on.
    ETM->SYNCP = 0x0000000A;

    // TRCTRACEIDR: must be non-zero and not 0x00 / 0x70-0x7F.
    ETM->TRACEID = 0x3E;

#if ETM_BRINGUP_TRACE_ALL
    // Trace unconditionally: EVENT = resource selector 1 (always TRUE),
    // SSSTATUS (bit 9) pre-set to 1 so the ViewInst start/stop logic is already "started".
    ETM->VIPCSSCTL = 0x00000000;
    ETM->VICTL     = 0x00000201;
#else
    // DWT-gated: PE comparator input 0 starts tracing, input 1 stops it.
    // SSSTATUS starts at 0, so NOTHING is traced until DWT COMP0 matches.
    // START = bits [15:0], STOP = bits [31:16] -> PE comp 0 starts, PE comp 1 stops.
    ETM->VIPCSSCTL = (1U << (16 + 1)) | (1U << 0);
    ETM->VICTL     = 0x00000001;
#endif
}

void CSTF_Configure(void){
    CSTF->LAR = CORESIGHT_UNLOCK;         // Unlock Funnel access
    // Enable every slave port (bits [7:0]) - the port the M7 ETM sits on is
    // device specific - and set a minimum hold time of 3 (bits [11:8]).
    CSTF->CTRL = (0x3U << 8) | 0x1U;
}

void TraceGPIO_Configure(void){

	CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk; // Equivalent to (1U << 24)
	RCC->AHB4ENR |= RCC_AHB4ENR_GPIOEEN;

	// Configure PE2, PE3, PE4, PE5, PE6 for Alternate Function (Mode 2 / 0b10)
	GPIOE->MODER &= ~(GPIO_MODER_MODE2 | GPIO_MODER_MODE3 |
	                  GPIO_MODER_MODE4 | GPIO_MODER_MODE5 | GPIO_MODER_MODE6);
	GPIOE->MODER |= (2U << GPIO_MODER_MODE2_Pos) | (2U << GPIO_MODER_MODE3_Pos) |
	                (2U << GPIO_MODER_MODE4_Pos) | (2U << GPIO_MODER_MODE5_Pos) |
	                (2U << GPIO_MODER_MODE6_Pos);

	// Set output speed to Very High Speed (0b11) for trace pins
	GPIOE->OSPEEDR |= (3U << GPIO_OSPEEDR_OSPEED2_Pos) | (3U << GPIO_OSPEEDR_OSPEED3_Pos) |
	                  (3U << GPIO_OSPEEDR_OSPEED4_Pos) | (3U << GPIO_OSPEEDR_OSPEED5_Pos) |
	                  (3U << GPIO_OSPEEDR_OSPEED6_Pos);

	//  Set Alternate Function to AF0 for PE2 to PE6
	// PE2 to PE6 are in the AFRL (Alternate Function Low) register
	GPIOE->AFR[0] &= ~((0xFU << (4 * 2)) | (0xFU << (4 * 3)) |
	                   (0xFU << (4 * 4)) | (0xFU << (4 * 5)) | (0xFU << (4 * 6)));
	// (Bitwise ORing with 0 does nothing, but this is where you'd put the AF number if it wasn't AF0)
	DBGMCU->CR |= DBGMCU_CR_DBG_TRACECKEN|DBGMCU_CR_DBG_CKD1EN|DBGMCU_CR_DBG_CKD3EN;

}

void DWT_Configure() {
    // 1. Unlock DWT block access if it implements a Software Lock (typical for CoreSight)
    // DWT doesn't always strictly require LAR unlocking on M7, but it is safe execution practice
	CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk; // Equivalent to (1U << 24)
	DWT->LAR = CORESIGHT_UNLOCK;
    DWT->CTRL = (1<<10)|(1<<0);
    // 2. Configure DWT Comparator 0 as the START trigger
        DWT->COMP0 = startAddr;
        DWT->MASK0 = 0;             // Exact address match
        DWT->FUNCTION0 = 8;         // Match on instruction address execution
        // 3. Configure DWT Comparator 1 as the STOP trigger
#undef COMP1
        DWT->COMP1 = stopAddr;
        DWT->MASK1 = 0;             // Exact address match
        DWT->FUNCTION1 = 8;         // Match on instruction address execution
}

void Enable_ETM(){
	// Set the ETMEN bit (Bit 0) in the PRGCTL register
	ETM->PRGCTL |= 1U;
	// Wait for ETM to be active
	while ((ETM->STAT & 0x01) != 0);
}

void Disable_ETM(){

	ETM->LAR = CORESIGHT_UNLOCK;
	// Wait for the ETM to be unlocked by checking the Lock Status Register (LSR)
	while ((ETM->LSR & 0x02) != 0); // Bit 1 is the Lock Status bit (0 = Unlocked)

	// 2. Disable ETM to configure it safely
	// Clear the ETMEN bit (Bit 0) in the Programming Control Register (PRGCTL)
	ETM->PRGCTL &= ~1U;

	// Wait for IDLE (bit 0) and PMSTABLE (bit 1). Writes to the programmable
	// registers before this point are lost / UNPREDICTABLE.
	for (uint32_t t = 0; t < 100000U; t++) {
		if ((ETM->STAT & 0x3U) == 0x3U) break;
	}
}

/* Fills a snapshot of the whole trace path. Put a breakpoint after the call and
 * inspect it, or watch g_trace_status in the Live Expressions view. */
Trace_Status_t g_trace_status;

void Trace_DumpStatus(void)
{
	g_trace_status.etm_prgctl    = ETM->PRGCTL;
	g_trace_status.etm_stat      = ETM->STAT;      // bit0 IDLE, bit1 PMSTABLE
	g_trace_status.etm_victl     = ETM->VICTL;     // bit9 SSSTATUS -> 1 = tracing started
	g_trace_status.etm_vipcssctl = ETM->VIPCSSCTL;
	g_trace_status.etm_traceid   = ETM->TRACEID;
	g_trace_status.etm_authstat  = ETM->AUTHSTAT;  // [3:2] NSNID must be 0b11
	g_trace_status.etm_config    = ETM->CONFIG;
	g_trace_status.etm_syncp     = ETM->SYNCP;
	g_trace_status.etm_ccctl     = ETM->CCCTL;
	g_trace_status.etm_stallctl  = ETM->STALLCTL;
	g_trace_status.etm_idr0      = ETM->IDR0;
	g_trace_status.etm_idr1      = ETM->IDR1;      // [31:24] DESIGNER, must read 0x41
	g_trace_status.etm_idr2      = ETM->IDR2;
	g_trace_status.etm_idr3      = ETM->IDR3;      // [11:0] CCITMIN
	g_trace_status.etm_idr4      = ETM->IDR4;      // [31:28] NUMPC = PE comparator inputs
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
	g_trace_status.etf_rwp       = ETF->RWP;       // != 0 -> trace really reached the ETF
	g_trace_status.etf_cbuflvl   = ETF->CBUFLVL;

	g_trace_status.cstf_ctrl     = CSTF->CTRL;

	g_trace_status.tpiu_suppsize = TPIU->SUPPSIZE; // bit3 set -> 4-bit port supported
	g_trace_status.tpiu_curpsize = TPIU->CURPSIZE;
	g_trace_status.tpiu_curtpm   = TPIU->CURTPM;   // MUST be 0 for real trace
	g_trace_status.tpiu_ffcr     = TPIU->FFCR;
	g_trace_status.tpiu_ffsr     = TPIU->FFSR;

	g_trace_status.dwt_ctrl      = DWT->CTRL;
	g_trace_status.dwt_func0     = DWT->FUNCTION0; // bit24 MATCHED (clears on read)
	g_trace_status.dwt_func1     = DWT->FUNCTION1;

	g_trace_status.tsg_cntcr     = TSG->CNTCR;     // bit0 must read 1 (EN)
	g_trace_status.tsg_cntsr     = TSG->CNTSR;
	g_trace_status.tsg_cvl       = TSG->CNTCVL;    // != 0 and increasing across two
	g_trace_status.tsg_cvu       = TSG->CNTCVU;    // breakpoint hits -> counter is real
}

/* The two gate functions MUST end up at two different addresses, or DWT
 * COMP0 == COMP1 and the ViewInst start/stop gating silently does nothing.
 * Two identical `nop`-only noinline functions are exactly what GCC's
 * -fipa-icf (on at -O2/-Os, and this project builds at -Os) is entitled to
 * fold into one symbol. The distinct volatile store below makes them
 * non-identical, so folding is not allowed.
 *
 * Verify after every build:
 *   arm-none-eabi-nm Release/BP_Test1_H7.elf | grep -i -E 'StartPoint|StopPoint'
 * The two addresses must differ, and must match DWT->COMP0 / DWT->COMP1
 * (with bit 0, the Thumb bit, masked off) in g_trace_status. */
volatile uint32_t g_gate_marker;

__attribute__((noinline)) void StartPoint(void){
    g_gate_marker = 0xA5A50001UL;
}
__attribute__((noinline)) void StopPoint(void){
    g_gate_marker = 0x5A5A0002UL;
}

void SetupStartStopAddr()
{
    // Cast to uint32_t and mask off the Thumb bit (bit 0)
    startAddr = (uint32_t)&StartPoint & ~1UL;
    stopAddr  = (uint32_t)&StopPoint & ~1UL;
}
