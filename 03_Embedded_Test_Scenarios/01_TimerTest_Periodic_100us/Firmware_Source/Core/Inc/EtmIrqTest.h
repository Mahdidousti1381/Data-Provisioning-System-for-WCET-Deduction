/*
 * EtmIrqTest.h
 *
 *  ETM interference test, minimal form.
 *
 *  ---------------------------------------------------------------------------
 *  What it proves
 *  ---------------------------------------------------------------------------
 *  A 100 us periodic timer (TIM6) starts on a press of PC5 and stops itself
 *  after exactly ETMIRQ_TICKS interrupts. Inside each handler the ETM trace
 *  window opens, a handful of instructions run, and it closes again.
 *
 *  The claim under test is simply: **consecutive ETM starts are ~100 us
 *  apart**. If that holds, the ETM is not distorting the timing of the program
 *  it is watching.
 *
 *  Two independent ways to check it, which is the point of the design:
 *
 *    Software side - g_etmirq.delta_ns[], from DWT->CYCCNT sampled at the
 *      first instruction of each handler. Should read ~100000 ns.
 *
 *    Trace side - the ETM timestamp packet emitted at each trace restart.
 *      Ten windows, so ten timestamps; consecutive differences should also
 *      come out at 100 us. This is the half that lives in the log, and it is
 *      the one that would move if the ETM were stealing cycles.
 *
 *  For the trace side to exist at all, the ETM's programming bit is cycled
 *  per window - enabled before StartPoint(), disabled after StopPoint() -
 *  which forces a synchronisation sequence at the head of each window. The
 *  periodic TRCSYNCPR counter (2^10 = 1024 bytes) never fires on windows this
 *  small: an earlier run produced 28-48 trace bytes for ten windows and
 *  decoded to NO_SYNC with nothing else. Expect ten A-Syncs in the capture,
 *  one per window; that count is the check that this worked.
 *
 *  Agreement between the two is the result. Disagreement means the trace
 *  timebase is lying, which is worth knowing on its own.
 *
 *  ---------------------------------------------------------------------------
 *  Clock
 *  ---------------------------------------------------------------------------
 *  HCLK is 10 MHz (HSI 64 /8 -> PLLM 2 -> PLLN 40 -> PLLP 8 -> D1CPRE /2).
 *  So one 100 us period is 1000 core cycles, and the handler - roughly 25
 *  cycles of exception entry and return plus the window - fits with an order
 *  of magnitude to spare. That headroom is the whole reason the clock moved
 *  up from the old 1 MHz, where a period was only 100 cycles.
 *
 *  The timer is clocked from PCLK1 with the APB1 prescaler at 1, and ARR is
 *  computed from HAL_RCC_GetPCLK1Freq() at run time, so the period stays
 *  100 us if the clock tree moves again.
 * ---------------------------------------------------------------------------
 */

#ifndef INC_ETMIRQTEST_H_
#define INC_ETMIRQTEST_H_

#include "stm32h7xx.h"
#include <stdint.h>

/* --------------------------------------------------------------------------
 * ETMIRQ_TEST_ENABLE
 *
 * 1 - a press on PC5 runs this 100 us periodic timer test.
 * -------------------------------------------------------------------------- */
#ifndef ETMIRQ_TEST_ENABLE
#define ETMIRQ_TEST_ENABLE   1
#endif

/* --------------------------------------------------------------------------
 * ETMIRQ_WINDOW_MODE
 *
 * 0 - one small ETM window per tick. The handler programming-enables the ETM,
 *     opens the window, runs the payload, closes it and disables again, so
 *     each window carries its own synchronisation sequence.
 *
 * 1 - ONE continuous window spanning all ETMIRQ_TICKS interrupts (default).
 *     The window opens before the timer starts and closes after the last
 *     tick; the handler never touches a CoreSight register. Everything in
 *     between is traced, including the main loop's wait and all ten exception
 *     entries and returns.
 *
 * Mode 1 exists because mode 0's sync sequences, though genuinely emitted by
 * the hardware, did not survive the capture and deframing path. Mode 1 sidesteps
 * the question: a continuously traced run produces thousands of bytes, so
 * A-Sync arrives on the ordinary TRCSYNCPR period exactly as it does in the
 * long-running FreqTest capture that decodes cleanly today.
 *
 * The measurement also gets better rather than worse. With the exception
 * entries inside the traced region, the time between interrupts can be read
 * from the trace itself - cycle counts and timestamps between successive
 * exception packets - instead of only from DWT->CYCCNT.
 * -------------------------------------------------------------------------- */
#ifndef ETMIRQ_WINDOW_MODE
#define ETMIRQ_WINDOW_MODE   1
#endif

/* Timer interrupts per run. */
#define ETMIRQ_TICKS         10U

/* Mode 1 only: iterations of the priming workload run inside the window
 * before the timer starts.
 *
 * The first A-Sync only appears after TRCSYNCPR = 1024 bytes of trace. On the
 * FreqTest capture the ETM produced 1.6 MB over 4.2 M core cycles, about one
 * byte per 2.6 cycles, so 1024 bytes costs roughly 2700 cycles. Ten ticks are
 * only 10000 cycles, which would leave the first two or three ticks ahead of
 * the first A-Sync and therefore undecodable.
 *
 * The prime burns traced cycles before tick 0 so the decoder is already locked
 * when the measurement starts. It sits outside the timing path entirely. */
#define ETMIRQ_PRIME_ITER    20000U

/* Timer period in microseconds. */
#define ETMIRQ_PERIOD_US     100U

/* Iterations of the traced payload loop. Four back-edges plus one not-taken
 * exit is a small enough atom sequence to count off the decode by eye. */
#define ETMIRQ_PAYLOAD_ITER  4U

typedef struct {
    uint32_t run_count;                  /* presses serviced since reset     */
    uint32_t hclk_hz;                    /* what the cycle counts are in     */
    uint32_t tim_hz;                     /* what cnt_entry[] is in           */
    uint16_t ticks;                      /* interrupts actually serviced     */
    uint8_t  overruns;                   /* handlers that outlasted a period */
                                         /*   - must be 0                    */
    uint8_t  poll_timeouts;              /* ticks where the ETM did not reach */
                                         /*   IDLE/PMSTABLE inside the poll   */
                                         /*   budget - must be 0              */
    uint8_t  complete;                   /* 1 = all ETMIRQ_TICKS serviced    */

    /* Per tick, captured at the first instruction of the handler. */
    uint32_t cyc_entry[ETMIRQ_TICKS];    /* DWT->CYCCNT                      */
    uint32_t cnt_entry[ETMIRQ_TICKS];    /* TIM6->CNT: interrupt latency, in */
                                         /*   timer counts                   */
    uint32_t d_etm_on[ETMIRQ_TICKS];     /* entry to trace-on: clearing UIF  */
                                         /*   plus the programming-enable    */
                                         /*   that forces the sync sequence  */
    uint32_t window_cyc[ETMIRQ_TICKS];   /* StartPoint()..StopPoint() cost   */
    uint32_t d_etm_off[ETMIRQ_TICKS];    /* cost of disabling it again       */
    uint32_t d_isr[ETMIRQ_TICKS];        /* whole measured handler body      */

    /* THE RESULT. Spacing between consecutive ETM starts. */
    uint32_t delta_cyc[ETMIRQ_TICKS - 1U];
    uint32_t delta_ns[ETMIRQ_TICKS - 1U];

    uint32_t mean_delta_ns;              /* target: 100000                   */
    uint32_t min_delta_ns;
    uint32_t max_delta_ns;
    uint32_t jitter_ns;                  /* max - min                        */

    uint32_t mean_window_cyc;            /* what one traced window costs     */
    uint32_t mean_etm_on_cyc;            /* mean cost of the enable          */
    uint32_t mean_etm_off_cyc;           /* mean cost of the disable         */
    uint32_t mean_isr_cyc;               /* mean whole handler body          */
    uint32_t mean_latency_ns;            /* mean interrupt latency           */
} EtmIrq_Result_t;

extern volatile EtmIrq_Result_t g_etmirq;

/* Trip count for the traced payload. A volatile global rather than a literal
 * so -Os cannot unroll the loop away: the trace shape has to be the same on
 * every tick and predictable enough to check by hand. */
extern volatile uint32_t g_etmirq_payload_iter;

/* Sink for the payload result, written inside the trace window so the call
 * cannot be optimised out or sunk past StopPoint(). */
extern volatile uint32_t g_etmirq_payload_result;

/* Sink for the priming filler's result (mode 1), same anti-elision purpose. */
extern volatile uint32_t g_etmirq_prime_result;

/* Called once from main(), after Parallel_Trace_configure(). */
void EtmIrq_Init(void);

/* One button press: ETMIRQ_TICKS timer interrupts, then the result.
 * Blocking, about 1 ms plus a debounce wait. */
void EtmIrq_RunTest(void);

/* TIM6 handler body. The vector itself stays in stm32h7xx_it.c. */
void EtmIrq_TIM_ISR(void);

/* The traced payload. noinline so it keeps its own symbol and a matchable
 * entry address in the decode. */
uint32_t EtmIrq_Payload(uint32_t seed);

/* Mode 1 only: branch-rich filler run inside the window before the timer
 * starts, to push the trace past the first A-Sync. noinline for the same
 * reason - it should be trivially identifiable in the decode and skippable. */
uint32_t EtmIrq_Prime(uint32_t iters);

#endif /* INC_ETMIRQTEST_H_ */
