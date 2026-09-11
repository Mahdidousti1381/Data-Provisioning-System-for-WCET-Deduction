/*
 * TestApp.h
 *
 *  ETM trace test workload: 2 software routines, 1 software interrupt (SVC),
 *  2 hardware interrupts (USART1 RX from a Raspberry Pi Pico, EXTI on PC5).
 *
 *  Everything that runs inside the DWT-gated trace window lives here so the
 *  decoded address range stays small and every symbol is easy to match by hand.
 */

#ifndef INC_TESTAPP_H_
#define INC_TESTAPP_H_

#include "stm32h7xx.h"
#include <stdint.h>

/* ==========================================================================
 * Board wiring - CHECK THESE AGAINST YOUR HEADERBOARD BEFORE FLASHING
 * ==========================================================================
 *
 *   USART1  TX = PA9   (AF7)  ->  Pico GP5 / UART1 RX  (pin 7)
 *   USART1  RX = PA10  (AF7)  <-  Pico GP4 / UART1 TX  (pin 6)
 *           GND        -------- Pico GND               (pin 8)
 *
 *   Both parts are 3.3 V - no level shifter, and do NOT cross to 5 V.
 *
 *   Button    = PC5, EXTI line 5, active LOW with internal pull-up
 *               (press shorts PC5 to GND)
 *
 * PA9/PA10 is the usual USART1 breakout, but this pinout was never in the
 * .ioc so it is an assumption. If your board routes those pins elsewhere,
 * USART1 is also available on PB6 (TX) / PB7 (RX), same AF7 - change
 * TESTAPP_UART_PORT_* in TestApp.c and nothing else.
 *
 * Pins already taken and therefore off limits:
 *   PE2..PE6  TRACECLK + TRACED[3:0]      PA13/PA14  SWD
 *   PA5/6/7   SPI1                        PA1        LED
 *
 * Baud rate is 9600 8N1. PCLK2 is 1 MHz in this build (the clock tree is
 * deliberately slow so TRACECLK stays inside the logic analyser's range),
 * so 9600 is already fck/104 - do not ask for more.
 * ========================================================================== */

/* Bit0 of the button GPIO port / EXTI line used for the push-button. */
#define BTN_PIN_NUM      5U
#define BTN_PIN          (1U << BTN_PIN_NUM)

/* --------------------------------------------------------------------------
 * TESTAPP_REAL_BUTTON_EDGE
 *
 * Hardware interrupt #2 inside the traced window.
 *
 *   0 (default) - the window re-triggers EXTI line 5 through EXTI->SWIER1.
 *                 That is still a genuine EXTI -> NVIC -> EXTI9_5_IRQHandler
 *                 hardware interrupt at the same handler address, but it
 *                 happens at a fixed point in the window, so every capture
 *                 is byte-comparable with the last one.
 *
 *   1           - the window waits for the *release* edge of the real
 *                 button instead (rising and falling are both enabled on
 *                 PC5). Fully genuine, but KNOWN FRAGILE, for one-off manual
 *                 runs only: the window lasts as long as you hold the button,
 *                 the ISR lands at an arbitrary PC so no two captures look
 *                 alike, and on a quick tap the release edge can land before
 *                 the window opens - the race is detected and the window
 *                 bails out with exti_seen == 0, so press deliberately and
 *                 check that field before trusting the capture.
 *
 * Either way the press itself is a real hardware interrupt - it is what arms
 * the window in the first place.
 * -------------------------------------------------------------------------- */
#ifndef TESTAPP_REAL_BUTTON_EDGE
#define TESTAPP_REAL_BUTTON_EDGE   0
#endif

/* Iteration budget for the UART echo wait. ~30000 iterations of a 4-cycle
 * poll loop is >100 ms at 1 MHz, comfortably longer than a 9600-baud byte
 * round trip (~2.1 ms plus Pico turnaround). If the Pico is unplugged,
 * unprogrammed or at the wrong baud we give up, flag it, and still reach
 * StopPoint() - the capture stays valid, minus the UART interrupt. */
#define TESTAPP_UART_WAIT_BUDGET   30000U

/* Iteration budget for the button-release wait, used only when
 * TESTAPP_REAL_BUTTON_EDGE is 1. Roughly 8 s at 1 MHz - a finger is far
 * slower than a UART byte, so this needs its own much larger budget. */
#define TESTAPP_BTN_WAIT_BUDGET    2000000U

/* Ground truth for the decode, sampled from DWT->CYCCNT (already running -
 * DWT_Configure() sets CYCCNTENA). One load + one store per field, so it
 * costs almost nothing in the trace, and it gives a number to check the
 * ETM cycle-count (CCI) decode against instead of trusting it blind.
 *
 * Break after StopPoint() and read g_test_status, or watch it live. */
typedef struct {
    uint32_t run_count;        /* traced windows completed since reset       */

    uint32_t cyc_start;        /* CYCCNT at top of the window                */
    uint32_t cyc_after_a;      /* after Routine_Checksum()                   */
    uint32_t cyc_after_b;      /* after Routine_Sort()                       */
    uint32_t cyc_after_svc;    /* after the SVC returned                     */
    uint32_t cyc_after_uart;   /* after the UART echo arrived (or timed out) */
    uint32_t cyc_after_exti;   /* after the EXTI ISR ran                     */
    uint32_t cyc_stop;         /* CYCCNT just before StopPoint()             */

    uint32_t result_a;         /* Routine_Checksum() return value            */
    uint32_t result_b;         /* Routine_Sort() return value                */
    uint32_t result_svc;       /* value the SVC handler wrote back           */

    uint32_t uart_spins;       /* poll iterations the echo took              */
    uint8_t  uart_tx_byte;     /* byte we sent to the Pico                   */
    uint8_t  uart_rx_byte;     /* byte the Pico echoed                       */
    uint8_t  uart_timed_out;   /* 1 = no echo within the budget              */
    uint8_t  exti_seen;        /* 1 = EXTI ISR ran inside the window         */

    uint32_t irq_count_uart;   /* USART1_IRQHandler entries, all time        */
    uint32_t irq_count_exti;   /* EXTI9_5_IRQHandler entries, all time       */
    uint32_t irq_count_svc;    /* SVC_Handler entries, all time              */
} Test_Status_t;

extern volatile Test_Status_t g_test_status;

/* Set by EXTI9_5_IRQHandler on a button press; consumed by the main loop.
 * This is the only thing that starts a traced window. */
extern volatile uint8_t g_arm_request;

/* Handshake flags between the ISRs and the traced window. */
extern volatile uint8_t g_uart_rx_done;
extern volatile uint8_t g_exti_in_window;

/* Called once from main(), before the trace path is armed. */
void TestApp_Init(void);

/* One complete traced window: StartPoint() .. StopPoint(). */
void TestApp_RunWindow(void);

/* The two software routines. noinline so each keeps its own symbol and a
 * matchable entry address in the trace. */
uint32_t Routine_Checksum(const uint8_t *data, uint32_t len);
uint32_t Routine_Sort(uint8_t *data, uint32_t len);

/* ISR bodies. The vectors themselves stay in stm32h7xx_it.c. */
void TestApp_USART1_ISR(void);
void TestApp_EXTI5_ISR(void);
void TestApp_SVC_ISR(void);

#endif /* INC_TESTAPP_H_ */
