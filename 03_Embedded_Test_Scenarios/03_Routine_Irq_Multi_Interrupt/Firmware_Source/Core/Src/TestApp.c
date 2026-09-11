/*
 * TestApp.c
 *
 *  ETM trace test workload for BP_Test1_H7.
 *
 *  ---------------------------------------------------------------------------
 *  What this test is for
 *  ---------------------------------------------------------------------------
 *  The trace window (StartPoint() .. StopPoint(), gated by DWT COMP0/COMP1)
 *  is made to contain one of each control-flow shape an ETMv4 decoder has to
 *  get right, in a fixed order, in a few thousand core cycles:
 *
 *    1. Routine_Checksum()   software routine - single counted loop
 *    2. Routine_Sort()       software routine - nested, data-dependent loops
 *    3. svc #0               SOFTWARE interrupt - synchronous exception,
 *                            entry/exit at a known instruction
 *    4. USART1 RX            HARDWARE interrupt - genuinely asynchronous,
 *                            lands at an arbitrary PC inside a poll loop
 *    5. EXTI line 5          HARDWARE interrupt - the PC5 push-button's own
 *                            handler (see TESTAPP_REAL_BUTTON_EDGE)
 *
 *  Nothing else runs inside the window. Peripheral setup, status dumping and
 *  the idle wait all sit outside it, so the decoded address range stays inside
 *  this one file plus the three vectors in stm32h7xx_it.c.
 *
 *  ---------------------------------------------------------------------------
 *  How a run happens
 *  ---------------------------------------------------------------------------
 *    idle (untraced)  ->  press PC5  ->  EXTI9_5_IRQHandler sets g_arm_request
 *                     ->  main loop runs ONE traced window  ->  idle again
 *
 *  So one press produces exactly one window, and the window is the same shape
 *  every press. Arm the logic analyser, press once, stop the capture.
 *
 *  PA1 (LED) is driven HIGH for the duration of the window and LOW outside it.
 *  Hooking a sixth DSLogic channel to PA1 marks the window in the capture
 *  without costing a single trace byte, because both writes are outside it.
 *
 *  ---------------------------------------------------------------------------
 *  Style note
 *  ---------------------------------------------------------------------------
 *  HAL is used for pin/NVIC setup only - it never appears inside the window.
 *  USART1 is driven from raw registers throughout: HAL_UART_MODULE_ENABLED is
 *  commented out in stm32h7xx_hal_conf.h and stm32h7xx_hal_uart.c is not in
 *  the project's source list, so HAL UART would not build as-is, and its call
 *  depth would bury the interesting part of the trace.
 */

#include "main.h"
#include "TestApp.h"
#include "ETMv4.h"

/* ==========================================================================
 * USART1 bit positions
 *
 * Spelled out rather than taken from the CMSIS macros: on STM32H7 the RXNE
 * flag/enable carry the FIFO-era double names (USART_ISR_RXNE_RXFNE,
 * USART_CR1_RXNEIE_RXFNEIE) and which spelling exists depends on the header
 * version. Bit positions do not move.
 * ========================================================================== */
#define U_CR1_UE        (1U << 0)    /* USART enable                          */
#define U_CR1_RE        (1U << 2)    /* Receiver enable                       */
#define U_CR1_TE        (1U << 3)    /* Transmitter enable                    */
#define U_CR1_RXNEIE    (1U << 5)    /* RXNE / RXFNE interrupt enable         */

#define U_ISR_ORE       (1U << 3)    /* Overrun error                         */
#define U_ISR_RXNE      (1U << 5)    /* Read data register not empty          */
#define U_ISR_TC        (1U << 6)    /* Transmission complete                 */
#define U_ISR_TXE       (1U << 7)    /* Transmit data register empty          */

#define U_ICR_ORECF     (1U << 3)    /* Clear overrun                         */

/* PCLK2 = 1 MHz in this build, OVER8 = 0  ->  BRR = 1000000 / 9600 = 104
 * (actual 9615 baud, +0.16 % - well inside a UART's tolerance). */
#define U_BRR_9600      104U

/* USART1 pin mapping. If your headerboard breaks USART1 out on PB6/PB7
 * instead, change these four lines (same AF7) and nothing else. */
#define TESTAPP_UART_PORT       GPIOA
#define TESTAPP_UART_TX_PIN     GPIO_PIN_9
#define TESTAPP_UART_RX_PIN     GPIO_PIN_10
#define TESTAPP_UART_CLK_EN()   __HAL_RCC_GPIOA_CLK_ENABLE()

/* Byte sent to the Pico; whatever comes back is recorded but not checked, so
 * a plain echo script is enough on the Pico side. */
#define TESTAPP_UART_TX_BYTE    0x5AU

/* ==========================================================================
 * State
 * ========================================================================== */

volatile Test_Status_t g_test_status;

volatile uint8_t g_arm_request     = 0;
volatile uint8_t g_uart_rx_done    = 0;
volatile uint8_t g_exti_in_window  = 0;

/* 1 while StartPoint()..StopPoint() is executing. Lets the shared EXTI and
 * USART1 handlers tell an in-window interrupt from an idle-time one. */
static volatile uint8_t s_window_open = 0;

/* SVC argument / result. Passed through globals rather than registers so the
 * software-interrupt path has no ABI subtleties to reason about while reading
 * the decode. */
volatile uint32_t g_svc_arg = 0;
volatile uint32_t g_svc_ret = 0;

/* Fixed input for Routine_Sort(). Copied into the scratch buffer at the top
 * of every window, so window N and window N+1 do identical work - which is
 * what makes two captures comparable. */
static const uint8_t k_sort_seed[16] = {
    0x8F, 0x12, 0xC3, 0x04, 0x7A, 0xFE, 0x21, 0x59,
    0x33, 0xA6, 0x0D, 0xEB, 0x47, 0x90, 0x6C, 0xB2
};

static uint8_t s_sort_buf[16];

/* ==========================================================================
 * Software routine #1 - counted loop, one branch back-edge per byte.
 *
 * Fletcher-16 over the input. Straight-line body, loop count known at the
 * call: the decoder should produce exactly `len` taken back-edges and one
 * not-taken exit, and CCI should report a near-constant cycle count.
 * ========================================================================== */
__attribute__((noinline))
uint32_t Routine_Checksum(const uint8_t *data, uint32_t len)
{
    uint32_t lo = 0xFFU;
    uint32_t hi = 0xFFU;

    for (uint32_t i = 0; i < len; i++)
    {
        lo = (lo + data[i]) % 255U;
        hi = (hi + lo)      % 255U;
    }

    return (hi << 8) | lo;
}

/* ==========================================================================
 * Software routine #2 - nested loops with a data-dependent inner exit.
 *
 * Insertion sort, then a fold of the sorted result. The inner loop's trip
 * count depends on the data, so the trace carries an irregular E/N atom
 * pattern instead of a repeating one - the case where a decoder that is
 * merely "mostly right" starts drifting. Same input every window, so the
 * pattern itself is still reproducible.
 * ========================================================================== */
__attribute__((noinline))
uint32_t Routine_Sort(uint8_t *data, uint32_t len)
{
    for (uint32_t i = 1; i < len; i++)
    {
        uint8_t  key = data[i];
        uint32_t j   = i;

        while ((j > 0U) && (data[j - 1U] > key))
        {
            data[j] = data[j - 1U];
            j--;
        }

        data[j] = key;
    }

    uint32_t fold = 0;
    for (uint32_t i = 0; i < len; i++)
    {
        fold = (fold << 1) ^ data[i];
    }

    return fold;
}

/* ==========================================================================
 * Software interrupt - SVC
 *
 * noinline and nothing else in the body, so the `svc #0` instruction sits at
 * a single known address: exception entry is the instruction after it, and
 * the return lands on the `bx lr`.
 * ========================================================================== */
__attribute__((noinline))
static void Svc_Trigger(void)
{
    __asm volatile ("svc #0" ::: "memory");
}

/* ==========================================================================
 * USART1 - raw register driver
 * ========================================================================== */

static void Uart_Init(void)
{
    GPIO_InitTypeDef gpio = {0};

    TESTAPP_UART_CLK_EN();
    RCC->APB2ENR |= RCC_APB2ENR_USART1EN;

    gpio.Pin       = TESTAPP_UART_TX_PIN | TESTAPP_UART_RX_PIN;
    gpio.Mode      = GPIO_MODE_AF_PP;
    gpio.Pull      = GPIO_PULLUP;              /* idle-high line             */
    gpio.Speed     = GPIO_SPEED_FREQ_LOW;      /* 9600 baud needs nothing    */
    gpio.Alternate = GPIO_AF7_USART1;
    HAL_GPIO_Init(TESTAPP_UART_PORT, &gpio);

    USART1->CR1   = 0;                         /* disable while configuring  */
    USART1->CR2   = 0;                         /* 1 stop bit                 */
    USART1->CR3   = 0;                         /* no flow control, no DMA    */
    USART1->PRESC = 0;                         /* no extra prescaler         */
    USART1->BRR   = U_BRR_9600;

    /* 8N1, TX + RX, interrupt on every received byte. */
    USART1->CR1 = U_CR1_UE | U_CR1_TE | U_CR1_RE | U_CR1_RXNEIE;

    HAL_NVIC_SetPriority(USART1_IRQn, 1, 0);
    HAL_NVIC_EnableIRQ(USART1_IRQn);
}

/* Blocking single-byte send. Called inside the window, but TXE is already set
 * on an idle transmitter, so this costs one poll iteration - the *echo* is
 * what we actually wait for, and that arrives by interrupt. */
static void Uart_SendByte(uint8_t b)
{
    while ((USART1->ISR & U_ISR_TXE) == 0U)
    {
        /* wait for TDR to be free */
    }
    USART1->TDR = b;
}

/* Drop anything already in the receiver and clear a stale overrun, so the byte
 * the window waits for is definitely the echo of the byte it just sent.
 *
 * Drains in a loop rather than reading once: if the far end ever sends
 * unsolicited bytes - a startup banner, a stuck key in a terminal - one read
 * leaves the rest queued, the next window's RX interrupt fires immediately on
 * a stale byte, and the capture is a false pass with uart_spins near zero.
 * Bounded so a permanently-asserted line cannot wedge us here. */
static void Uart_FlushRx(void)
{
    for (uint32_t i = 0; i < 32U; i++)
    {
        if ((USART1->ISR & U_ISR_RXNE) == 0U)
        {
            break;
        }
        (void)USART1->RDR;
    }
    USART1->ICR = U_ICR_ORECF;
}

/* ==========================================================================
 * Push-button on PC5
 *
 * Active low with an internal pull-up, so a press is a FALLING edge.
 * HAL_GPIO_Init is used here on purpose: on STM32H7 an EXTI line needs
 * SYSCFG->EXTICR, EXTI->RTSR1/FTSR1 and EXTI_D1->IMR1 all set correctly, and
 * this is setup code that never shows up in the trace.
 * ========================================================================== */
static void Button_Init(void)
{
    GPIO_InitTypeDef gpio = {0};

    __HAL_RCC_GPIOC_CLK_ENABLE();
    __HAL_RCC_SYSCFG_CLK_ENABLE();

    gpio.Pin  = BTN_PIN;
#if TESTAPP_REAL_BUTTON_EDGE
    gpio.Mode = GPIO_MODE_IT_RISING_FALLING;   /* press arms, release traced */
#else
    gpio.Mode = GPIO_MODE_IT_FALLING;          /* press only                 */
#endif
    gpio.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(GPIOC, &gpio);

    HAL_NVIC_SetPriority(EXTI9_5_IRQn, 2, 0);
    HAL_NVIC_EnableIRQ(EXTI9_5_IRQn);
}

/* ==========================================================================
 * Interrupt handler bodies
 *
 * Kept short and HAL-free. HAL_GPIO_EXTI_IRQHandler would add two more frames
 * to every decoded exception; __HAL_GPIO_EXTI_CLEAR_IT is a single store to
 * the right pending register.
 * ========================================================================== */

void TestApp_USART1_ISR(void)
{
    g_test_status.irq_count_uart++;

    if ((USART1->ISR & U_ISR_ORE) != 0U)
    {
        USART1->ICR = U_ICR_ORECF;
    }

    if ((USART1->ISR & U_ISR_RXNE) != 0U)
    {
        uint8_t b = (uint8_t)(USART1->RDR & 0xFFU);   /* read clears RXNE */

        if (s_window_open)
        {
            g_test_status.uart_rx_byte = b;
            g_uart_rx_done = 1;
        }
    }
}

void TestApp_EXTI5_ISR(void)
{
    __HAL_GPIO_EXTI_CLEAR_IT(BTN_PIN);

    g_test_status.irq_count_exti++;

    if (s_window_open)
    {
        /* Hardware interrupt #2, inside the traced window. */
        g_exti_in_window = 1;
    }
    else
    {
        /* Idle-time press: ask the main loop for one traced window. */
        g_arm_request = 1;
    }
}

void TestApp_SVC_ISR(void)
{
    g_test_status.irq_count_svc++;

    /* Something cheap but not foldable, so the handler has a real body. */
    g_svc_ret = (g_svc_arg * 2654435761U) >> 16;
}

/* ==========================================================================
 * The traced window
 * ========================================================================== */

void TestApp_RunWindow(void)
{
    uint32_t a, b, spins;

    /* ---- setup, still OUTSIDE the window ---- */
    for (uint32_t i = 0; i < sizeof(s_sort_buf); i++)
    {
        s_sort_buf[i] = k_sort_seed[i];
    }

    g_uart_rx_done   = 0;
    g_exti_in_window = 0;
    Uart_FlushRx();

    s_window_open = 1;
    GPIOA->BSRR = LED_Pin;                     /* window marker HIGH-->LED OFF*/

    /* ====================== TRACE ON ====================== */
    StartPoint();

    g_test_status.cyc_start = DWT->CYCCNT;

    /* --- 1. software routine: counted loop --- */
    a = Routine_Checksum(k_sort_seed, sizeof(k_sort_seed));
    g_test_status.cyc_after_a = DWT->CYCCNT;

    /* --- 2. software routine: nested, data-dependent loops --- */
    b = Routine_Sort(s_sort_buf, sizeof(s_sort_buf));
    g_test_status.cyc_after_b = DWT->CYCCNT;

    /* --- 3. software interrupt: synchronous SVC --- */
    g_svc_arg = a ^ b;
    Svc_Trigger();
    g_test_status.cyc_after_svc = DWT->CYCCNT;

    /* --- 4. hardware interrupt: USART1 RX, asynchronous ---
     * One byte out to the Pico at 9600 baud; the Pico echoes it. The echo
     * interrupts this poll loop after roughly 2 ms plus the Pico's
     * turnaround - about 2000 core cycles at 1 MHz - so the exception lands
     * at a PC the compiler chose, not one we picked. That is the case worth
     * testing. Bounded, so an absent or misconfigured Pico costs us this one
     * interrupt and nothing else: StopPoint() is still reached and the
     * capture is still valid. */
    Uart_SendByte(TESTAPP_UART_TX_BYTE);

    spins = 0;
    while ((g_uart_rx_done == 0U) && (spins < TESTAPP_UART_WAIT_BUDGET))
    {
        spins++;
    }

    g_test_status.uart_spins     = spins;
    g_test_status.uart_timed_out = (uint8_t)(g_uart_rx_done == 0U);
    g_test_status.cyc_after_uart = DWT->CYCCNT;

    /* --- 5. hardware interrupt: EXTI line 5, the button's own handler --- */
#if TESTAPP_REAL_BUTTON_EDGE
    /* Wait for the release edge of the press that armed this window. Genuine,
     * but the window now lasts as long as a finger does - hence its own, much
     * larger budget than the UART's (TESTAPP_UART_WAIT_BUDGET is ~150 ms at
     * 1 MHz, shorter than most presses are held).
     *
     * The pin-level test is the race guard: on a quick tap the release edge
     * can land during this window's setup, before s_window_open goes high, in
     * which case the ISR took its idle-time branch and g_exti_in_window will
     * never be set. Seeing the pin already high (pull-up, released) means we
     * lost that race - give up straight away with exti_seen == 0 rather than
     * spinning out the whole budget. Read the flag first so a real in-window
     * edge always wins. */
    spins = 0;
    while ((g_exti_in_window == 0U) &&
           ((GPIOC->IDR & BTN_PIN) == 0U) &&
           (spins < TESTAPP_BTN_WAIT_BUDGET))
    {
        spins++;
    }
#else
    /* Re-trigger EXTI line 5 in software. Still EXTI -> NVIC ->
     * EXTI9_5_IRQHandler at the same handler address the button uses; only
     * the edge source differs, and in exchange every capture is comparable
     * with the last one. */
    EXTI->SWIER1 = BTN_PIN;
    __DSB();
    __ISB();
#endif

    g_test_status.exti_seen     = g_exti_in_window;
    g_test_status.cyc_after_exti = DWT->CYCCNT;

    /* --- close out --- */
    g_test_status.result_a   = a;
    g_test_status.result_b   = b;
    g_test_status.result_svc = g_svc_ret;
    g_test_status.cyc_stop   = DWT->CYCCNT;

    StopPoint();
    /* ====================== TRACE OFF ===================== */

    GPIOA->BSRR = (uint32_t)LED_Pin << 16;     /* window marker LOW */
    s_window_open = 0;

    g_test_status.uart_tx_byte = TESTAPP_UART_TX_BYTE;
    g_test_status.run_count++;

    /* Debounce, entirely outside the window so it costs zero trace bytes.
     *
     * A mechanical switch throws several falling edges over 1-5 ms, and the
     * window itself only lasts about 3 ms. Without this, bounce edges that
     * arrive after s_window_open drops re-arm g_arm_request and the capture
     * ends up holding three or four overlapping StartPoint/StopPoint pairs
     * instead of one. Wait for the contacts to settle, then discard whatever
     * queued up while we were busy.
     *
     * SysTick is live (HAL_Init + HAL_IncTick in the handler), 1 ms tick at
     * HCLK = 1 MHz, so HAL_Delay is real time here. */
    HAL_Delay(250);
    __HAL_GPIO_EXTI_CLEAR_IT(BTN_PIN);
    g_arm_request = 0;
}

/* ==========================================================================
 * Init
 * ========================================================================== */

void TestApp_Init(void)
{
    Uart_Init();
    Button_Init();

    GPIOA->BSRR = (uint32_t)LED_Pin << 16;     /* marker starts LOW */
}
