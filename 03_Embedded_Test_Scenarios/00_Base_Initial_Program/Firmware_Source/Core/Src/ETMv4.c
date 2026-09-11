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
	ETM_Configure();
    SetupStartStopAddr();
    DWT_Configure();
    Enable_ETM();
}

void System_Trace_Pipeline_Init(uint32_t SWO_prescaler)
{
    // Instance pointers for structured blocks


    // ----------------------------------------------------
    // STEP 1: Enable Hardware Debug Clocks & Unlock CoreSight Blocks
    // ----------------------------------------------------
	CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk; // Equivalent to (1U << 24)
	// 1. Enable GPIOB Clock (assuming RCC register map structure is available)
	RCC->AHB4ENR |= RCC_AHB4ENR_GPIOBEN;

	// 2. Set PB3 to Alternate Function Mode (0b10)
	GPIOB->MODER &= ~(3U << (3 * 2)); // Clear mode bits for pin 3
	GPIOB->MODER |=  (2U << (3 * 2)); // Set to 10 (Alternate Function)

	// 3. Map PB3 to Alternate Function 0 (AF0)
	// AFR[0] is the Low Register (pins 0-7), each pin takes 4 bits
	GPIOB->AFR[0] &= ~(0xFU << (3 * 4)); // Clear AF bits for pin 3 (sets it to AF0)

	// 4. Configure Speed to Very High (0b11) for high-frequency SWO trace clocking
	GPIOB->OSPEEDR |= (3U << (3 * 2));

	// 5. Configure Pin to Push-Pull (0), no Pull-up/Pull-down (00)
	GPIOB->OTYPER  &= ~(1U << 3);
	GPIOB->PUPDR   &= ~(3U << (3 * 2));

	DBGMCU->CR |= DBGMCU_CR_DBG_TRACECKEN|DBGMCU_CR_DBG_CKD1EN|DBGMCU_CR_DBG_CKD3EN;
    CSTF->LAR = CORESIGHT_UNLOCK;         // Unlock Funnel access
    ETF->LAR  = CORESIGHT_UNLOCK;
    SWTF->LAR = CORESIGHT_UNLOCK;
    SWO->LAR  = CORESIGHT_UNLOCK;
    ETM->LAR  = CORESIGHT_UNLOCK;
    // ----------------------------------------------------
    // STEP 2: Configure Main Trace Funnel (CSTF)
    // ----------------------------------------------------
    // Enable Master Port 0 (connected to Cortex-M7 ETM core stream)
    CSTF->CTRL |= (1 << 0);
//کانفیگ ای تی اف خیلی کار داره هنوز
//    // ----------------------------------------------------
//    // STEP 3: Configure Embedded Trace FIFO (ETF)
//    // ----------------------------------------------------
//    ETF->CTL &= ~(1 << 0); // Disable ETF temporarily to alter operational modes
//    while ((ETF->STS & (1 << 2)) == 0) {
//        // Wait until Ready bit is cleared / operational settings unlocked
//    }
//    ETF->MODE = 0x00000000; // Set to Circular Buffer Mode (Bypass/FIFO streaming)
//    // Enable the ETF formatter
//    ETF->FFCR = 0x103;
//    ETF->CTL |= (1 << 0);  // Re-enable ETF
    ETF_Configure();
    // ----------------------------------------------------
    // STEP 4: Configure SWO Funnel & SWO Serialization
    // ----------------------------------------------------
    // Enable the S0 source slave port inside SWTF to channel ETM data
    SWTF->CTRL |= (1 << 0);

    // Set Serial Wire Pin Protocol (SPPR)
    // 1 = Manchester encoding, 2 = Asynchronous UART NRZ format
    SWO->SPPR = 2;

    // Set Clock Divisor (ACPR)
    // Baudrate = TRACECLK / (SWO_prescaler + 1)
    SWO->CODR = SWO_prescaler;
//تا اینجا کشیدم کار کنم
    // ----------------------------------------------------
    // STEP 5: Configure ETMv4 Core Settings
    // ----------------------------------------------------
	ETM->PRGCTL &= ~1U; // Ensure ETM tracking is off before reprogramming
	while ((ETM->STAT & 0x03) != 3){// Bit 0 is the Idle bit (1 = Idle)
			// Wait for ETM to be turned off (idle)
	}

    // ETMv4 Protocol Control Configuration
//    ETM->CONFIG = (1 << 1)  | // CCI: Enable Cycle Count Accurate tracking (Crucial for WCET!)
//                   (0 << 4)  | // Clear Data Trace (Keep instruction tracing only)
//                   (1 << 12);  // Enable branch broadcasting rules
    ETM->CONFIG = 0x00001818;
//    ETM->VICTL = (1 << 0);    // Track unconditionally across processing window
    ETM->VICTL = 0x00000201;//!!??
    ETM->TRACEID = 0x00000002;
    ETM->EVENTCTL1 = 0;       // Disable extra trigger mapping exceptions

    // Activate the ETM trace engine
	ETM->PRGCTL |= 1U;
}

void Configure_System_TPIU_Pipeline(void) {

    // ---------------------------------------------------------
    // 1. Configure the Trace Funnel (CSTF)
    // ---------------------------------------------------------
    CSTF->LAR = CORESIGHT_UNLOCK;         // Unlock Funnel access
    CSTF->CTRL |= 0x01;             // Enable Slave Port 0 (ETM traffic)

    // ---------------------------------------------------------
    // 2. Configure the Embedded Trace FIFO (ETF)
    // ---------------------------------------------------------
    ETF->LAR = CORESIGHT_UNLOCK;          // Unlock ETF access

    // Put the ETF into "Hardware FIFO" mode to pass data smoothly
    ETF->MODE = 0x02;

    // Enable the ETF formatter
    ETF->FFCR = 0;

    // Enable Trace Capture
    ETF->CTL = 0x01;

    // ---------------------------------------------------------
    // 3. Configure the System TPIU
    // ---------------------------------------------------------
    TPIU_Configure();

}
void TPIU_Configure(void)
{
    // 1. Unlock the TPIU Access
    // Write the CoreSight unlock key (CORESIGHT_UNLOCK) to the Lock Access Register
    TPIU->LAR = CORESIGHT_UNLOCK;

    // 2. Configure the Trace Port Size
    TPIU->CURPSIZE = 8;   // Set the current parallel port size [cite: 45]

    // 3.
    //TPIU->CURTPM = (1<<17)|(1<<2);//Test in continuous AA/55 pattern
    TPIU->CURTPM = (1<<17);

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
//    while ((ETF->STS & (1U << 2)) == 0) {
//        // Wait for READY == 1
//    }

    // 4. Set ETF Operation Mode to Hardware FIFO mode
    // Value 10b (0x2) configures the RAM as a FIFO drained through the ATB master interface.
    ETF->MODE = 0x2;

    // 5. Enable Formatting
    // Bit 0 (ENFT) is set to 1 to enable formatting[cite: 784, 785].
    // Note: Disabling formatting is only supported in Circular buffer mode[cite: 787].
    //ETF->FFCR = (1U << 0);
    ETF->FFCR = 0;
    // 6. Enable trace capture
    // Writing 1 to the TCEN bit moves the ETF from the Disabled state to the Running state[cite: 387].
    ETF->CTL |= (1U << 0);
}

void ETM_Configure(void){

	Disable_ETM();
    // Enables: Return stack, Global Timestamping, Context ID, Virtual Context ID
    //ETM->CONFIG = 0x00001818;
    ETM->CONFIG |= 0x18;
    //ETM->CONFIG = (1<<11)|(0x7<<8)|(1<<4)|(1<<3); //=0xf18
    // TRCEVENTCTL0R: 0x00000000 (Disable all event tracing)
    ETM->STALLCTL |= 0x30c;

    ETM->CCCTL |= 1;

    // TRCTRACEIDR: Set Trace ID (e.g., 0x10)
    // Must be non-zero.
    ETM->TRACEID = 0x3E;
    ETM->VICTL = 0x00000001;
    ETM->VIPCSSCTL = (1U << 17) | (1U << 0);

//    ETM->EVENTCTL0 = 0x00000000;
//    ETM->EVENTCTL1 = 0x00000000;
//    // TRCTSCTLR: 0x00000000 (Disable TS event, TS still generated by Sync)
//    ETM->TSCTL = 0x00000000;

    // TRCVICTLR: 0x00000201
    // Enable ViewInst to trace everything, Start/Stop logic started.
    //ETM->VICTL = 0x1;

    // TRCVISSCTLR: 0x00000000 (No start/stop points)
//    ETM->VISSCTL = (1U << 17) | (1U << 0);

   // Enable_ETM();
}

void CSTF_Configure(void){
    CSTF->LAR = CORESIGHT_UNLOCK;         // Unlock Funnel access
    CSTF->CTRL = 0x01;             // Enable Slave Port 0 (ETM traffic)
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

	// Wait for ETM to be turned off (idle)
	//while ((ETM->STAT & 0x03) != 3);
}

//void StartPoint(){
//	uint32_t started = 1;
//}
//void StopPoint(){
//	uint32_t stopped = 1;
//}
__attribute__((noinline)) void StartPoint(void){
    __asm("nop");
}
__attribute__((noinline)) void StopPoint(void){
    __asm("nop");
}

void SetupStartStopAddr()
{
    // Cast to uint32_t and mask off the Thumb bit (bit 0)
    startAddr = (uint32_t)&StartPoint & ~1UL;
    stopAddr  = (uint32_t)&StopPoint & ~1UL;
}
