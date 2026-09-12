/*
 * App.c
 *
 * The task under test.
 *
 * One run does six things:
 *   1. dispatch queued jobs for a few control ticks
 *   2. sort a vector that is already in order        (best case)
 *   3. sort the same vector reversed                 (worst case)
 *   4. send a byte to the serial peer
 *   5. run a background CRC until the peer answers;
 *      the RX callback then does a CRC of its own, and the 1 ms tick
 *      lands in the middle of it
 *   6. one SVC call
 *
 * Steps 1 and 2 call the same function on the same amount of data and return
 * the same result. Only the run time differs.
 */

#include "App.h"

extern UART_HandleTypeDef huart1;
extern TIM_HandleTypeDef  htim6;

App_State_t g_app;

volatile uint8_t  g_start_request = 0;
volatile uint32_t g_rx_crc_passes = 2;
volatile uint32_t g_warmup_rounds = APP_WARMUP_ROUNDS;

/* Ascending, so insertion sort's inner loop never runs. */
static const uint8_t k_sorted[APP_SORT_LEN] = {
    0x0F, 0x1E, 0x2D, 0x3C, 0x4B, 0x5A, 0x69, 0x78,
    0x87, 0x96, 0xA5, 0xB4, 0xC3, 0xD2, 0xE1, 0xF0
};

/* The exact reverse, which makes the inner loop run n(n-1)/2 times. */
static const uint8_t k_reversed[APP_SORT_LEN] = {
    0xF0, 0xE1, 0xD2, 0xC3, 0xB4, 0xA5, 0x96, 0x87,
    0x78, 0x69, 0x5A, 0x4B, 0x3C, 0x2D, 0x1E, 0x0F
};

static uint8_t s_buf[APP_SORT_LEN];

/* Reached through a volatile pointer so the compiler cannot pre-compute
 * either sort at build time. */
static uint8_t *volatile s_buf_ptr = s_buf;

static const uint8_t k_frame[APP_FRAME_LEN] = {
    0xA5, 0x5A, 0x00, 0xFF, 0x13, 0x37, 0xC0, 0xDE,
    0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x23, 0x45, 0x67,
    0x89, 0xAB, 0xCD, 0xEF, 0xFE, 0xDC, 0xBA, 0x98,
    0x76, 0x54, 0x32, 0x10, 0x0F, 0xF0, 0x55, 0xAA
};

static uint8_t s_rx;                 /* landing slot for HAL_UART_Receive_IT */

/* ------------------------------------------------------------------------ */
/* Four small jobs and a table to reach them through. */
typedef uint32_t (*Job_t)(uint32_t);

__attribute__((noinline)) static uint32_t Job_Scale(uint32_t x)  { return (x * 3U) + 1U; }
__attribute__((noinline)) static uint32_t Job_Mix(uint32_t x)    { return (x >> 1) ^ 0x9E37U; }
__attribute__((noinline)) static uint32_t Job_Shift(uint32_t x)  { return (x << 2) - 7U; }
__attribute__((noinline)) static uint32_t Job_Fold(uint32_t x)   { return x ^ (x >> 3); }

static const Job_t k_jobs[4] = { Job_Scale, Job_Mix, Job_Shift, Job_Fold };

/* Reached through a volatile pointer so the calls stay indirect. */
static const Job_t *volatile s_jobs = k_jobs;

/* Runs the given number of jobs. Which job comes next depends on the running
 * value, so the call target is only known at run time. */
__attribute__((noinline))
uint32_t App_Dispatch(uint32_t seed, uint32_t rounds)
{
    uint32_t acc = seed;

    for (uint32_t n = 0; n < rounds; n++)
    {
        Job_t job = s_jobs[acc & 3U];
        acc = job(acc) + n;
    }

    g_app.jobs_done = rounds;
    return acc;
}

/* ------------------------------------------------------------------------ */
/* Insertion sort, then a fold of the result. The inner loop's trip count
 * depends on the data. */
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

/* CRC-16/CCITT, one bit at a time. The seed is chained by every caller so
 * repeated calls cannot be folded into one. */
__attribute__((noinline))
uint32_t Routine_Crc16(const uint8_t *data, uint32_t len, uint32_t seed)
{
    uint32_t crc = seed & 0xFFFFU;

    for (uint32_t i = 0; i < len; i++)
    {
        crc ^= ((uint32_t)data[i]) << 8;

        for (uint32_t b = 0; b < 8U; b++)
        {
            if ((crc & 0x8000U) != 0U)
            {
                crc = ((crc << 1) ^ 0x1021U) & 0xFFFFU;
            }
            else
            {
                crc = (crc << 1) & 0xFFFFU;
            }
        }
    }
    return crc;
}

__attribute__((noinline))
static void Svc_Trigger(void)
{
    __asm volatile ("svc #0" ::: "memory");
}

/* ------------------------------------------------------------------------ */
/* Callbacks                                                                 */
/* ------------------------------------------------------------------------ */

/* 1 ms control tick. Highest priority, so it runs on time even when the
 * serial callback below is busy. */
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
    if (htim->Instance == TIM6)
    {
        g_app.ticks++;
    }
}

/* Serial byte received. This does a full integrity check inline, which takes
 * longer than one control tick - so the tick interrupts it. */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    if (huart->Instance != USART1)
    {
        return;
    }

    uint32_t crc = 0xFFFFU;
    for (uint32_t p = 0; p < g_rx_crc_passes; p++)
    {
        crc = Routine_Crc16(k_frame, APP_FRAME_LEN, crc);
    }

    g_app.rx_crc  = crc;
    g_app.rx_byte = s_rx;
    g_app.echo_ok = 1;
}

/* Start button on PC5. */
void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    if (pin == BTN_Pin)
    {
        g_start_request = 1;
    }
}

void App_SvcHandler(void)
{
    g_app.bg_crc ^= 0xA5A5U;
}

/* ------------------------------------------------------------------------ */
/* Run control                                                               */
/* ------------------------------------------------------------------------ */

void App_Init(void)
{
    HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);
}

void App_Prepare(void)
{
    g_app.ticks   = 0;
    g_app.echo_ok = 0;

    HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_SET);   /* busy */
}

void App_Run(void)
{
    uint8_t  tx  = APP_TX_BYTE;
    uint32_t crc = 0xFFFFU;

    HAL_TIM_Base_Start_IT(&htim6);

    /* 1. work through the job queue */
    g_app.job_acc = App_Dispatch(0x13572468U, g_warmup_rounds);

    /* 2. best case: the input is already sorted */
    for (uint32_t i = 0; i < APP_SORT_LEN; i++)
    {
        s_buf_ptr[i] = k_sorted[i];
    }
    g_app.sort_best = Routine_Sort((uint8_t *)s_buf_ptr, APP_SORT_LEN);

    /* 3. worst case: same routine, same length, reversed input */
    for (uint32_t i = 0; i < APP_SORT_LEN; i++)
    {
        s_buf_ptr[i] = k_reversed[i];
    }
    g_app.sort_worst = Routine_Sort((uint8_t *)s_buf_ptr, APP_SORT_LEN);

    /* 4. ask the peer for an answer */
    HAL_UART_Receive_IT(&huart1, &s_rx, 1);
    HAL_UART_Transmit(&huart1, &tx, 1, 100);

    /* 5. keep busy until it replies, bounded in control ticks */
    uint32_t t0 = g_app.ticks;
    while ((g_app.echo_ok == 0U) &&
           ((g_app.ticks - t0) < APP_ECHO_TIMEOUT_TICKS))
    {
        crc = Routine_Crc16(k_frame, APP_FRAME_LEN, crc);
    }
    g_app.bg_crc = crc;

    /* 6. one supervisor call */
    Svc_Trigger();

    HAL_TIM_Base_Stop_IT(&htim6);
}

void App_Finish(void)
{
    HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);

    HAL_UART_AbortReceive(&huart1);
    g_app.run_count++;

    HAL_Delay(250);                 /* let the button contacts settle */
    __HAL_GPIO_EXTI_CLEAR_IT(BTN_Pin);
    g_start_request = 0;
}
