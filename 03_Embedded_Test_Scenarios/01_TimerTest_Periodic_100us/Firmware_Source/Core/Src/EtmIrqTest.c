/*
 * EtmIrqTest.c
 *
 *  ETM interference test - see EtmIrqTest.h for what is being proved.
 *
 *  ---------------------------------------------------------------------------
 *  Shape of a run
 *  ---------------------------------------------------------------------------
 *    idle  ->  press PC5  ->  EXTI9_5_IRQHandler sets g_arm_request
 *          ->  main loop calls EtmIrq_RunTest()
 *          ->  10 x (TIM6 tick -> open ETM window -> few instructions -> close)
 *          ->  result  ->  idle
 *
 *  PA1 (the LED) is HIGH for the duration of the ten ticks, so a spare
 *  DSLogic channel on PA1 brackets the whole run in the capture. Both writes
 *  are outside the measured region and cost nothing.
 *
 *  The ETM's programming bit is cycled once per window: enabled just before
 *  StartPoint(), disabled just after StopPoint(). That is deliberate, and it
 *  is the whole reason this test can be decoded at all.
 *
 *  A-Sync - the only anchor OpenCSD can lock onto - is emitted on a byte
 *  counter, TRCSYNCPR = 0x0A, i.e. one every 2^10 = 1024 bytes of trace.
 *  Measured on a real capture: 1,603,272 trace bytes carried 1568 A-Syncs,
 *  1022.5 bytes apart. Windows this small produce 28-48 bytes for a whole
 *  run, so that counter never arrives and the capture decodes to NO_SYNC and
 *  nothing else. Programming-enabling the trace unit forces a fresh sync
 *  sequence, so every window carries its own anchor and is independently
 *  decodable.
 *
 *  The cost of that is real - CoreSight APB writes with poll loops attached -
 *  and it lands inside the handler. It is measured per tick into d_etm_on[]
 *  and d_etm_off[] rather than assumed, and `overruns` says whether the
 *  handler still fits inside the 100 us period.
 *
 *  ---------------------------------------------------------------------------
 *  Style note
 *  ---------------------------------------------------------------------------
 *  TIM6 is driven from raw registers, same reasoning as USART1 in TestApp.c:
 *  the timer is part of what is under test, so its accesses need to be single
 *  loads and stores at addresses that are obvious in the decode. HAL is used
 *  for the clock gate and the NVIC only, which is setup code that never
 *  appears in the trace.
 *
 *  TIM6 is a basic timer - no channels, no capture/compare, the smallest
 *  register footprint of anything that can generate a periodic interrupt, and
 *  otherwise unused in this project.
 */

#include "main.h"
#include "EtmIrqTest.h"
#include "ETMv4.h"

/* Push-button on PC5 (active low with internal pull-up) */
#define BTN_PORT        GPIOC
#define BTN_PIN         GPIO_PIN_5
#define BTN_CLK_EN()    __HAL_RCC_GPIOC_CLK_ENABLE()

/* ==========================================================================
 * TIM6 bit positions
 *
 * Spelled out directly for clarity and deterministic register access.
 * Bit positions do not move between header versions.
 * ========================================================================== */
#define T_CR1_CEN     (1U << 0)    /* counter enable                        */
#define T_CR1_URS     (1U << 2)    /* only overflow raises an update event  */
#define T_DIER_UIE    (1U << 0)    /* update interrupt enable               */
#define T_SR_UIF      (1U << 0)    /* update interrupt flag, rc_w0          */
#define T_EGR_UG      (1U << 0)    /* software update generation            */

/* Fixed payload input. Identical every tick, so all ten windows should decode
 * to exactly the same packet sequence - which is what makes them checkable by
 * hand, and what makes a difference between them meaningful. */
#define ETMIRQ_PAYLOAD_SEED   0xA5A5A5A5UL

/* ==========================================================================
 * State
 * ========================================================================== */

volatile EtmIrq_Result_t g_etmirq;
extern volatile uint8_t g_arm_request;

volatile uint32_t g_etmirq_payload_iter   = ETMIRQ_PAYLOAD_ITER;
volatile uint32_t g_etmirq_payload_result = 0;
volatile uint32_t g_etmirq_prime_result   = 0;

static volatile uint32_t s_tick     = 0;
static volatile uint8_t  s_run_done = 0;

/* Timer counts per second, latched in EtmIrq_Init(). */
static uint32_t s_tim_hz = 0;

/* ==========================================================================
 * ISR-safe trace enable / disable
 *
 * ETMv4.c's Enable_ETM()/Disable_ETM() are the right thing outside an ISR but
 * not inside one: Enable_ETM() spins on TRCSTATR with no bound at all, and
 * Disable_ETM() polls up to 100000 times, which at 10 MHz is 10 ms against a
 * 100 us period. A hang or a 10 ms stall in here would wreck the run rather
 * than report a problem.
 *
 * These are the same register writes with a hard iteration cap. Each returns
 * the poll iterations it used; hitting the cap is counted into
 * g_etmirq.poll_timeouts so a capture is never silently trusted.
 *
 * The TRCLAR unlock that Disable_ETM() performs is skipped deliberately: the
 * software lock was opened by Parallel_Trace_configure() at boot and nothing
 * re-locks it, so unlocking every tick would only add an APB write to the hot
 * path.
 * ========================================================================== */

#define ETMIRQ_POLL_BUDGET   64U

static inline uint32_t EtmIrq_TraceEnable(void)
{
    uint32_t n = 0;

    ETM->PRGCTL |= 1U;

    /* Wait for IDLE (bit 0) to clear: the unit is running, and the sync
     * sequence is on its way out. */
    while (((ETM->STAT & 0x1U) != 0U) && (n < ETMIRQ_POLL_BUDGET))
    {
        n++;
    }
    return n;
}

static inline uint32_t EtmIrq_TraceDisable(void)
{
    uint32_t n = 0;

    ETM->PRGCTL &= ~1U;

    /* Wait for IDLE and PMSTABLE (bits 1:0) before the next enable. */
    while (((ETM->STAT & 0x3U) != 0x3U) && (n < ETMIRQ_POLL_BUDGET))
    {
        n++;
    }
    return n;
}

/* ==========================================================================
 * The traced payload
 *
 * Everything between StartPoint() and StopPoint() is this call and one store.
 * The trip count comes from a volatile global so -Os cannot unroll it: the
 * decode should show g_etmirq_payload_iter taken back-edges and one not-taken
 * exit, the same on all ten ticks.
 *
 * Confirm the shape before trusting a hand count - the compiler still chooses
 * whether the loop is top- or bottom-tested and whether it gets a guard
 * branch:
 *
 *   arm-none-eabi-objdump -d Release/BP_Test1_H7.elf | \
 *     sed -n '/<EtmIrq_Payload>:/,/^$/p'
 * ========================================================================== */

__attribute__((noinline)) uint32_t EtmIrq_Payload(uint32_t seed)
{
    uint32_t acc = seed;
    uint32_t n   = g_etmirq_payload_iter;

    for (uint32_t i = 0; i < n; i++)
    {
        acc = (acc << 1) ^ (acc >> 7);
    }

    return acc;
}

#if ETMIRQ_WINDOW_MODE == 1
/* ==========================================================================
 * Priming filler (mode 1 only)
 *
 * Runs inside the window, before the timer starts, purely to generate trace
 * bytes so the first A-Sync lands before tick 0. The branch is data-dependent
 * so the compiler cannot fold the loop into straight-line code and the ETM
 * emits a real atom per iteration.
 *
 * Nothing here is measured. It exists so the decoder is already locked by the
 * time the measurement begins.
 * ========================================================================== */
__attribute__((noinline)) uint32_t EtmIrq_Prime(uint32_t iters)
{
    uint32_t acc = 0x12345678U;

    for (uint32_t i = 0; i < iters; i++)
    {
        if ((acc & 0x10U) != 0U)
        {
            acc = (acc * 1664525U) + 1013904223U;
        }
        else
        {
            acc = (acc >> 1) ^ 0xB4BCD35CU;
        }
    }
    return acc;
}
#endif

/* ==========================================================================
 * TIM6
 * ========================================================================== */

static void Timer_Init(void)
{
    __HAL_RCC_TIM6_CLK_ENABLE();

    /* TIM6 is on APB1. main.c leaves the APB1 prescaler at 1, so the timer
     * kernel clock is PCLK1 with no x2 multiplier. Computed rather than
     * hard-coded so the period survives another move of the clock tree. */
    s_tim_hz = HAL_RCC_GetPCLK1Freq();

    TIM6->CR1  = T_CR1_URS;                 /* counter off, overflow-only    */
    TIM6->PSC  = 0U;                        /* full resolution on the latency */
    TIM6->ARR  = ((s_tim_hz / 1000000U) * ETMIRQ_PERIOD_US) - 1U;
    TIM6->CNT  = 0U;

    TIM6->EGR  = T_EGR_UG;                  /* load PSC/ARR now              */
    TIM6->SR   = ~T_SR_UIF;                 /* UG set UIF; drop it           */
    TIM6->DIER = 0U;                        /* armed in Timer_Start()        */

    /* Above EXTI9_5 (priority 2) so a bouncing button edge can never sit in
     * front of a tick and inflate the spacing we are trying to measure. */
    HAL_NVIC_SetPriority(TIM6_DAC_IRQn, 1, 0);
    HAL_NVIC_EnableIRQ(TIM6_DAC_IRQn);
}

static void Timer_Start(void)
{
    TIM6->CNT  = 0U;
    TIM6->SR   = ~T_SR_UIF;
    TIM6->DIER = T_DIER_UIE;
    TIM6->CR1 |= T_CR1_CEN;
}

/* Called from inside the handler on the last tick: "deactivated after 10
 * timer interrupts". Runs after the measurement, so it costs it nothing. */
static void Timer_Stop(void)
{
    TIM6->CR1 &= ~T_CR1_CEN;
    TIM6->DIER = 0U;
    TIM6->SR   = ~T_SR_UIF;
}

/* ==========================================================================
 * The handler
 *
 * Ordering here is the whole measurement, so it is worth being explicit:
 *
 *   TIM6->CNT first, before anything else. It counts up from the overflow
 *   that raised this interrupt, so its value at the first executed
 *   instruction of the handler IS the interrupt latency. Reading CYCCNT
 *   ahead of it would put an extra access in front and inflate every sample.
 *
 *   CYCCNT second, and this is the number the test lives on: the difference
 *   between consecutive cyc_entry[] values is the spacing between ETM starts.
 *
 *   Both stamps go into locals. They are written to the result arrays at the
 *   end, after the window has closed, so no store lands inside a measured
 *   interval or inside the trace window.
 * ========================================================================== */

void EtmIrq_TIM_ISR(void)
{
    uint32_t cnt0, t0, t1, t2, t3;
    uint32_t i, np_on, np_off;

    cnt0 = TIM6->CNT;                       /* interrupt latency             */
    t0   = DWT->CYCCNT;                     /* the timebase for delta_cyc[]  */

    TIM6->SR = ~T_SR_UIF;

    i = s_tick;

#if ETMIRQ_WINDOW_MODE == 0
    /* Programming-enable forces a fresh A-Sync + Trace Info at the head of
     * this window. Without it the window is undecodable - see the file
     * header. */
    np_on = EtmIrq_TraceEnable();
    t1 = DWT->CYCCNT;

    /* ====================== TRACE ON ====================== */
    StartPoint();
    g_etmirq_payload_result = EtmIrq_Payload(ETMIRQ_PAYLOAD_SEED);
    StopPoint();
    /* ====================== TRACE OFF ===================== */

    t2 = DWT->CYCCNT;

    np_off = EtmIrq_TraceDisable();
    t3 = DWT->CYCCNT;
#else
    /* Mode 1: the window is already open and stays open. The handler touches
     * no CoreSight register at all, so the exception entry and return are
     * themselves inside the trace - which is what makes the interrupt spacing
     * readable from the log rather than only from CYCCNT.
     *
     * The payload still runs, so every interrupt has an identifiable body at
     * a known address in the decode. */
    np_on  = 0U;
    np_off = 0U;
    t1 = DWT->CYCCNT;
    g_etmirq_payload_result = EtmIrq_Payload(ETMIRQ_PAYLOAD_SEED);
    t2 = DWT->CYCCNT;
    t3 = t2;
#endif

    /* ---- past this point nothing is being timed ---- */

    if (i < ETMIRQ_TICKS)
    {
        g_etmirq.cyc_entry[i]  = t0;
        g_etmirq.cnt_entry[i]  = cnt0;
        g_etmirq.d_etm_on[i]   = t1 - t0;
        g_etmirq.window_cyc[i] = t2 - t1;
        g_etmirq.d_etm_off[i]  = t3 - t2;
        g_etmirq.d_isr[i]      = t3 - t0;

        if ((np_on >= ETMIRQ_POLL_BUDGET) || (np_off >= ETMIRQ_POLL_BUDGET))
        {
            g_etmirq.poll_timeouts++;
        }

        /* The next tick already fired while we were still in here. At 10 MHz
         * a period is 1000 cycles; the handler now also carries the ETM
         * enable and disable, so the margin is real but no longer enormous -
         * mean_isr_cyc says how much of the period is used. This must stay 0;
         * if it does not, the spacing numbers are measuring saturation rather
         * than the timer, and ETMIRQ_PERIOD_US needs raising. */
        if ((TIM6->SR & T_SR_UIF) != 0U)
        {
            g_etmirq.overruns++;
        }

        g_etmirq.ticks = (uint16_t)(i + 1U);
    }

    s_tick = i + 1U;

    if (s_tick >= ETMIRQ_TICKS)
    {
        Timer_Stop();
        s_run_done = 1;
    }
}

/* ==========================================================================
 * Run control
 * ========================================================================== */

static void Result_Clear(void)
{
    for (uint32_t i = 0; i < ETMIRQ_TICKS; i++)
    {
        g_etmirq.cyc_entry[i]  = 0;
        g_etmirq.cnt_entry[i]  = 0;
        g_etmirq.d_etm_on[i]   = 0;
        g_etmirq.window_cyc[i] = 0;
        g_etmirq.d_etm_off[i]  = 0;
        g_etmirq.d_isr[i]      = 0;
    }
    for (uint32_t i = 0; i < (ETMIRQ_TICKS - 1U); i++)
    {
        g_etmirq.delta_cyc[i] = 0;
        g_etmirq.delta_ns[i]  = 0;
    }

    g_etmirq.hclk_hz         = HAL_RCC_GetHCLKFreq();
    g_etmirq.tim_hz          = s_tim_hz;
    g_etmirq.ticks           = 0;
    g_etmirq.overruns        = 0;
    g_etmirq.poll_timeouts   = 0;
    g_etmirq.complete        = 0;
    g_etmirq.mean_delta_ns   = 0;
    g_etmirq.min_delta_ns    = 0xFFFFFFFFUL;
    g_etmirq.max_delta_ns    = 0;
    g_etmirq.jitter_ns       = 0;
    g_etmirq.mean_window_cyc = 0;
    g_etmirq.mean_etm_on_cyc = 0;
    g_etmirq.mean_etm_off_cyc = 0;
    g_etmirq.mean_isr_cyc    = 0;
    g_etmirq.mean_latency_ns = 0;
}

static void Result_Summarise(void)
{
    uint32_t hclk = g_etmirq.hclk_hz;
    uint32_t n    = g_etmirq.ticks;
    uint32_t sum_ns = 0, sum_win = 0, sum_lat_ns = 0;
    uint32_t sum_on = 0, sum_off = 0, sum_isr = 0;
    uint32_t k = 0;

    if (hclk == 0U || n == 0U)
    {
        g_etmirq.min_delta_ns = 0;
        return;
    }

    /* Cycles to nanoseconds. hclk is a whole number of MHz here, so
     * hclk/1000000 is exact and the division cannot lose a digit the way
     * 1000000000/hclk would. */
    uint32_t cyc_per_us = hclk / 1000000U;
    uint32_t tim_per_us = (s_tim_hz != 0U) ? (s_tim_hz / 1000000U) : 1U;

    if (cyc_per_us == 0U) { cyc_per_us = 1U; }
    if (tim_per_us == 0U) { tim_per_us = 1U; }

    for (uint32_t i = 0; i + 1U < n; i++)
    {
        uint32_t d  = g_etmirq.cyc_entry[i + 1U] - g_etmirq.cyc_entry[i];
        uint32_t ns = (d * 1000U) / cyc_per_us;

        g_etmirq.delta_cyc[i] = d;
        g_etmirq.delta_ns[i]  = ns;

        if (ns < g_etmirq.min_delta_ns) { g_etmirq.min_delta_ns = ns; }
        if (ns > g_etmirq.max_delta_ns) { g_etmirq.max_delta_ns = ns; }

        sum_ns += ns;
        k++;
    }

    for (uint32_t i = 0; i < n; i++)
    {
        sum_win    += g_etmirq.window_cyc[i];
        sum_on     += g_etmirq.d_etm_on[i];
        sum_off    += g_etmirq.d_etm_off[i];
        sum_isr    += g_etmirq.d_isr[i];
        sum_lat_ns += (g_etmirq.cnt_entry[i] * 1000U) / tim_per_us;
    }

    if (k != 0U)
    {
        g_etmirq.mean_delta_ns = sum_ns / k;
        g_etmirq.jitter_ns     = g_etmirq.max_delta_ns - g_etmirq.min_delta_ns;
    }
    else
    {
        g_etmirq.min_delta_ns = 0;
    }

    g_etmirq.mean_window_cyc  = sum_win / n;
    g_etmirq.mean_etm_on_cyc  = sum_on / n;
    g_etmirq.mean_etm_off_cyc = sum_off / n;
    g_etmirq.mean_isr_cyc     = sum_isr / n;
    g_etmirq.mean_latency_ns  = sum_lat_ns / n;
    g_etmirq.complete        = (n == ETMIRQ_TICKS) ? 1U : 0U;
}

void EtmIrq_RunTest(void)
{
    /* SysTick has to be off for the duration. At 10 MHz it fires every 10000
     * cycles, so over a 1 ms run it would land inside a handler about once
     * and put a visible spike in delta_ns[] that has nothing to do with the
     * ETM. USART1 and the button go quiet for the same reason. */
    HAL_SuspendTick();
    HAL_NVIC_DisableIRQ(EXTI9_5_IRQn);
    HAL_NVIC_DisableIRQ(USART1_IRQn);

    Result_Clear();

#if ETMIRQ_WINDOW_MODE == 0
    /* Start from disabled. The handler's first act on every tick is to
     * programming-enable the ETM, and that transition is what emits the sync
     * sequence - if the unit were already enabled here, tick 0 would produce
     * no A-Sync and the first window would be undecodable. */
    Disable_ETM();
#else
    /* One window for the whole run: enable now, open it below, and leave both
     * alone until every tick has been serviced. */
    Enable_ETM();
#endif

    s_tick     = 0;
    s_run_done = 0;

#if ETMIRQ_WINDOW_MODE == 1
    /* ====================== TRACE ON ====================== */
    StartPoint();

    /* Burn traced cycles so the first A-Sync is behind us before tick 0.
     * Outside the timing path entirely - the timer has not started yet. */
    g_etmirq_prime_result = EtmIrq_Prime(ETMIRQ_PRIME_ITER);
#endif

    Timer_Start();

    /* Spin rather than __WFI(): waking from sleep costs cycles that would
     * land inside the latency measurement and differ from tick to tick. */
    while (s_run_done == 0U)
    {
        __NOP();
    }
#if ETMIRQ_WINDOW_MODE == 1
    StopPoint();
    /* ====================== TRACE OFF ===================== */
    Disable_ETM();
#endif

    GPIOA->BSRR = LED_Pin;                  /* run marker HIGH(OFF)               */


    Result_Summarise();
    g_etmirq.run_count++;

    /* Drain the button bounce this press threw before re-arming:
     * a mechanical switch produces several edges over 1-5 ms
     * and each one would queue another whole run. */
    HAL_ResumeTick();
    HAL_Delay(250);
    GPIOA->BSRR = (uint32_t)LED_Pin << 16;  /* run marker LOW(ON)                */
    __HAL_GPIO_EXTI_CLEAR_IT(BTN_PIN);
    NVIC_ClearPendingIRQ(EXTI9_5_IRQn);
    g_arm_request = 0;

    HAL_NVIC_EnableIRQ(EXTI9_5_IRQn);
}

static void Button_Init(void)
{
    GPIO_InitTypeDef gpio = {0};

    BTN_CLK_EN();

    gpio.Pin  = BTN_PIN;
    gpio.Mode = GPIO_MODE_IT_FALLING;
    gpio.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(BTN_PORT, &gpio);

    HAL_NVIC_SetPriority(EXTI9_5_IRQn, 2, 0);
    HAL_NVIC_EnableIRQ(EXTI9_5_IRQn);
}

void EtmIrq_Init(void)
{
    /* Parallel_Trace_configure() -> DWT_Configure() already does both, but
     * the test is meaningless without CYCCNT and it is two stores. */
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CTRL        |= 1U;                 /* CYCCNTENA                     */

    Button_Init();
    Timer_Init();

    GPIOA->BSRR = (uint32_t)LED_Pin << 16;  /* marker starts LOW             */
}
