/*
 * App.h
 *
 * Test application: a small periodic control task sharing a CPU with a serial
 * link, plus a routine whose run time depends on its input.
 *
 * Interrupt priorities (0 = highest, preempts):
 *   TIM6      0   1 ms control tick
 *   USART1    1   serial RX
 *   EXTI9_5   2   start button on PC5
 */

#ifndef INC_APP_H_
#define INC_APP_H_

#include "main.h"
#include <stdint.h>

/* Jobs run at the head of every task cycle. Counted in jobs rather than in
 * time, so the amount of work done is the same whatever the compiler does
 * with it. */
#define APP_WARMUP_ROUNDS       64U

#define APP_SORT_LEN            16U     /* vector length for Routine_Sort   */
#define APP_FRAME_LEN           32U     /* bytes Routine_Crc16 runs over    */
#define APP_TX_BYTE             0x5AU   /* byte sent to the serial peer     */
#define APP_ECHO_TIMEOUT_TICKS  8U      /* give up on the echo after 8 ms   */

typedef struct {
    volatile uint32_t ticks;      /* control ticks in the current run */
    volatile uint8_t  echo_ok;    /* peer answered                    */
    volatile uint8_t  rx_byte;    /* byte the peer sent back          */
    uint32_t sort_best;           /* result for the sorted input      */
    uint32_t sort_worst;          /* result for the reversed input    */
    uint32_t jobs_done;           /* jobs the dispatcher ran          */
    uint32_t job_acc;             /* dispatcher accumulator           */
    uint32_t rx_crc;              /* CRC computed in the RX callback  */
    uint32_t bg_crc;              /* CRC computed while waiting       */
    uint32_t run_count;
} App_State_t;

extern App_State_t g_app;

/* Set by the button, cleared by main(). */
extern volatile uint8_t g_start_request;

/* CRC passes done in the RX callback. Volatile so it can be raised from the
 * debugger to lengthen the handler. */
extern volatile uint32_t g_rx_crc_passes;

/* Jobs run per task cycle. Volatile for the same reason. */
extern volatile uint32_t g_warmup_rounds;

void     App_Init(void);        /* once, at start-up            */
void     App_Prepare(void);     /* set up one run               */
void     App_Run(void);         /* the task under test          */
void     App_Finish(void);      /* debounce, wrap up            */

uint32_t App_Dispatch(uint32_t seed, uint32_t rounds);
uint32_t Routine_Sort(uint8_t *data, uint32_t len);
uint32_t Routine_Crc16(const uint8_t *data, uint32_t len, uint32_t seed);

void     App_SvcHandler(void);  /* body of SVC_Handler          */

#endif /* INC_APP_H_ */
