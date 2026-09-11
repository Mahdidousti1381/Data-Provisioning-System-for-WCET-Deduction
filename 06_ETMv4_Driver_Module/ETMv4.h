/*
 * ETMv4.h - ARM CoreSight ETMv4 & Trace Path Header for STM32
 * Bundled with CoreSight Trace Studio
 */

#ifndef INC_ETMV4_H_
#define INC_ETMV4_H_

#include "stm32h7xx.h"
#include <stdint.h>

#define ETM_BASE 0xE0041000UL
#define ETM ((ETM_TypeDef *) ETM_BASE)

#define TPIU_BASE       ((uint32_t)0x5C015000)
#define TPIU            ((TPIU_TypeDef *) TPIU_BASE)

#define CSTF_BASE 0x5C013000
#define CSTF ((CSTF_TypeDef *) CSTF_BASE)

#define ETF_BASE 0x5C014000
#define ETF ((ETF_TypeDef *) ETF_BASE)

#define SWO_BASE 0x5C003000UL
#define SWO ((SWO_TypeDef *) SWO_BASE)

#define SWTF_BASE 0x5C004000UL
#define SWTF ((SWTF_TypeDef *) SWTF_BASE)

#define TSG_BASE 0x5C005000UL
#define TSG ((TSG_TypeDef *) TSG_BASE)

#define CORESIGHT_UNLOCK  0xC5ACCE55

#ifndef ETM_BRINGUP_TRACE_ALL
#define ETM_BRINGUP_TRACE_ALL  0
#endif

typedef struct {
    uint32_t etm_prgctl, etm_stat, etm_victl, etm_vipcssctl;
    uint32_t etm_traceid, etm_authstat;
    uint32_t etm_config, etm_syncp, etm_ccctl, etm_stallctl;
    uint32_t etm_idr0, etm_idr1, etm_idr2, etm_idr3, etm_idr4, etm_idr5;
    uint32_t etm_idr8, etm_idr9, etm_idr10, etm_idr11, etm_idr12, etm_idr13;
    uint32_t etf_ctl, etf_mode, etf_ffcr, etf_sts, etf_rwp, etf_cbuflvl;
    uint32_t cstf_ctrl;
    uint32_t tpiu_suppsize, tpiu_curpsize, tpiu_curtpm, tpiu_ffcr, tpiu_ffsr;
    uint32_t dwt_ctrl, dwt_func0, dwt_func1;
    uint32_t tsg_cntcr, tsg_cntsr, tsg_cvl, tsg_cvu;
} Trace_Status_t;

void Parallel_Trace_configure(void);
void Trace_Config_STM32H7(void);
void Configure_System_TPIU_Pipeline(void);
void TPIU_Configure(void);
void ETF_Configure(void);
void ETM_Configure(void);
void Disable_ETM(void);
void Enable_ETM(void);
void CSTF_Configure(void);
void TraceGPIO_Configure(void);
void DWT_Configure(void);
void TSG_Configure(void);
void SetupStartStopAddr(void);
void StartPoint(void);
void StopPoint(void);

typedef struct {
    uint32_t RESERVED_0[1];         // 0x000
    volatile uint32_t PRGCTL;       // Offset: 0x004
    volatile uint32_t PROCSEL;      // Offset: 0x008
    volatile uint32_t STAT;         // Offset: 0x00C
    volatile uint32_t CONFIG;       // Offset: 0x010
    uint32_t RESERVED_1[3];         // 0x014 - 0x01C
    volatile uint32_t EVENTCTL0;    // Offset: 0x020
    volatile uint32_t EVENTCTL1;    // Offset: 0x024
    uint32_t RESERVED_2[1];         // 0x028
    volatile uint32_t STALLCTL;     // Offset: 0x02C
    volatile uint32_t TSCTL;        // Offset: 0x030
    volatile uint32_t SYNCP;        // Offset: 0x034
    volatile uint32_t CCCTL;        // Offset: 0x038
    uint32_t RESERVED_3[1];         // 0x03C
    volatile uint32_t TRACEID;      // Offset: 0x040
    uint32_t RESERVED_4[15];        // 0x044 - 0x07C
    volatile uint32_t VICTL;        // Offset: 0x080
    uint32_t RESERVED_5[1];         // 0x084
    volatile uint32_t VISSCTL;      // Offset: 0x088
    volatile uint32_t VIPCSSCTL;    // Offset: 0x08C
    uint32_t RESERVED_6[44];        // 0x090 - 0x13C
    volatile uint32_t CNTRLDV;      // Offset: 0x140
    uint32_t RESERVED_7[15];        // 0x144 - 0x17C
    volatile uint32_t IDR8;         // Offset: 0x180
    volatile uint32_t IDR9;         // Offset: 0x184
    volatile uint32_t IDR10;        // Offset: 0x188
    volatile uint32_t IDR11;        // Offset: 0x18C
    volatile uint32_t IDR12;        // Offset: 0x190
    volatile uint32_t IDR13;        // Offset: 0x194
    uint32_t RESERVED_8[10];        // 0x198 - 0x1BC
    volatile uint32_t IMSPEC0;      // Offset: 0x1C0
    uint32_t RESERVED_9[7];         // 0x1C4 - 0x1DC
    volatile uint32_t IDR0;         // Offset: 0x1E0
    volatile uint32_t IDR1;         // Offset: 0x1E4
    volatile uint32_t IDR2;         // Offset: 0x1E8
    volatile uint32_t IDR3;         // Offset: 0x1EC
    volatile uint32_t IDR4;         // Offset: 0x1F0
    volatile uint32_t IDR5;         // Offset: 0x1F4
    uint32_t RESERVED_10[4];        // 0x1F8 - 0x204
    volatile uint32_t RSCTL2;       // Offset: 0x208
    volatile uint32_t RSCTL3;       // Offset: 0x20C
    uint32_t RESERVED_11[28];       // 0x210 - 0x27C
    volatile uint32_t SSCC0;        // Offset: 0x280
    uint32_t RESERVED_12[7];        // 0x284 - 0x29C
    volatile uint32_t SSCS0;        // Offset: 0x2A0
    uint32_t RESERVED_13[7];        // 0x2A4 - 0x2BC
    volatile uint32_t SSPCIC0;      // Offset: 0x2C0
    uint32_t RESERVED_14[19];       // 0x2C4 - 0x30C
    volatile uint32_t PDC;          // Offset: 0x310
    volatile uint32_t PDS;          // Offset: 0x314
    uint32_t RESERVED_15[802];      // 0x318 - 0xF9C
    volatile uint32_t CLAIMSET;     // Offset: 0xFA0
    volatile uint32_t CLAIMCLR;     // Offset: 0xFA4
    uint32_t RESERVED_16[2];        // 0xFA8 - 0xFAC
    volatile uint32_t LAR;          // Offset: 0xFB0
    volatile uint32_t LSR;          // Offset: 0xFB4
    volatile uint32_t AUTHSTAT;     // Offset: 0xFB8
    volatile uint32_t DEVARCH;      // Offset: 0xFBC
    uint32_t RESERVED_17[3];        // 0xFC0 - 0xFC8
    volatile uint32_t DEVTYPE;      // Offset: 0xFCC
    volatile uint32_t PIDR4;        // Offset: 0xFD0
    uint32_t RESERVED_18[3];        // 0xFD4 - 0xFDC
    volatile uint32_t PIDR0;        // Offset: 0xFE0
    volatile uint32_t PIDR1;        // Offset: 0xFE4
    volatile uint32_t PIDR2;        // Offset: 0xFE8
    volatile uint32_t PIDR3;        // Offset: 0xFEC
    volatile uint32_t CIDR0;        // Offset: 0xFF0
    volatile uint32_t CIDR1;        // Offset: 0xFF4
    volatile uint32_t CIDR2;        // Offset: 0xFF8
    volatile uint32_t CIDR3;        // Offset: 0xFFC
} ETM_TypeDef;

typedef struct {
    volatile uint32_t SUPPSIZE;     // 0x000: TPIU Supported Parallel Port Size Register
    volatile uint32_t CURPSIZE;     // 0x004: TPIU Current Parallel Port Size Register
    uint32_t RESERVED_0[62];        // 0x008 - 0x0FC (62 words)
    volatile uint32_t SUPTRGM;      // 0x100: TPIU Supported Trigger Modes Register
    volatile uint32_t TRGCNT;       // 0x104: TPIU Trigger Counter Register
    volatile uint32_t TRGMULT;      // 0x108: TPIU Trigger Multiplier Register
    uint32_t RESERVED_1[61];        // 0x10C - 0x1FC (61 words)
    volatile uint32_t SUPTPM;       // 0x200: TPIU Supported Test Pattern Modes Register
    volatile uint32_t CURTPM;       // 0x204: TPIU Current Test Pattern Mode Register
    volatile uint32_t TPRCR;        // 0x208: TPIU Test Pattern Repeat Counter Register
    uint32_t RESERVED_2[61];        // 0x20C - 0x2FC (61 words)
    volatile uint32_t FFSR;         // 0x300: Formatter and Flush Status Register
    volatile uint32_t FFCR;         // 0x304: Formatter and Flush Control Register
    volatile uint32_t FSCR;         // 0x308: Formatter Synchronization Counter Register
    uint32_t RESERVED_3[805];       // 0x30C - 0xF9C (805 words)
    volatile uint32_t CLAIMSET;     // 0xFA0: Claim Tag Set Register
    volatile uint32_t CLAIMCLR;     // 0xFA4: Claim Tag Clear Register
    uint32_t RESERVED_4[2];         // 0xFA8 - 0xFAC (2 words)
    volatile uint32_t LAR;          // 0xFB0: Lock Access Register
    volatile uint32_t LSR;          // 0xFB4: Lock Status Register
    volatile uint32_t AUTHSTAT;     // 0xFB8: Authentication Status Register
    uint32_t RESERVED_5[3];         // 0xFBC - 0xFC4 (3 words)
    volatile uint32_t DEVID;        // 0xFC8: Device ID Register
    volatile uint32_t DEVTYPE;      // 0xFCC: Device Type Register
    volatile uint32_t PIDR4;        // 0xFD0: Peripheral ID Register 4
    uint32_t RESERVED_6[3];         // 0xFD4 - 0xFDC (3 words)
    volatile uint32_t PIDR0;        // 0xFE0: Peripheral ID Register 0
    volatile uint32_t PIDR1;        // 0xFE4: Peripheral ID Register 1
    volatile uint32_t PIDR2;        // 0xFE8: Peripheral ID Register 2
    volatile uint32_t PIDR3;        // 0xFEC: Peripheral ID Register 3
    volatile uint32_t CIDR0;        // 0xFF0: Component ID Register 0
    volatile uint32_t CIDR1;        // 0xFF4: Component ID Register 1
    volatile uint32_t CIDR2;        // 0xFF8: Component ID Register 2
    volatile uint32_t CIDR3;        // 0xFFC: Component ID Register 3
} TPIU_TypeDef;

typedef struct {
    volatile uint32_t CTRL;         // 0x000: Funnel Control Register
    volatile uint32_t PRIORITY;     // 0x004: Funnel Priority Register
    uint32_t RESERVED_0[998];       // 0x008 - 0xF9C
    volatile uint32_t CLAIMSET;     // 0xFA0: Claim Tag Set Register
    volatile uint32_t CLAIMCLR;     // 0xFA4: Claim Tag Clear Register
    uint32_t RESERVED_1[2];         // 0xFA8 - 0xFAC
    volatile uint32_t LAR;          // 0xFB0: Lock Access Register
    volatile uint32_t LSR;          // 0xFB4: Lock Status Register
    volatile uint32_t AUTHSTATUS;   // 0xFB8: Authentication Status Register
    volatile uint32_t DEVARCH;      // 0xFBC: Device Architecture Register
    uint32_t RESERVED_2[2];         // 0xFC0 - 0xFC4
    volatile uint32_t DEVID;        // 0xFC8: Device ID Register
    volatile uint32_t DEVTYPE;      // 0xFCC: Device Type Register
    volatile uint32_t PIDR4;        // 0xFD0: Peripheral ID Register 4
    volatile uint32_t PIDR5;        // 0xFD4: Peripheral ID Register 5
    volatile uint32_t PIDR6;        // 0xFD8: Peripheral ID Register 6
    volatile uint32_t PIDR7;        // 0xFDC: Peripheral ID Register 7
    volatile uint32_t PIDR0;        // 0xFE0: Peripheral ID Register 0
    volatile uint32_t PIDR1;        // 0xFE4: Peripheral ID Register 1
    volatile uint32_t PIDR2;        // 0xFE8: Peripheral ID Register 2
    volatile uint32_t PIDR3;        // 0xFEC: Peripheral ID Register 3
    volatile uint32_t CIDR0;        // 0xFF0: Component ID Register 0
    volatile uint32_t CIDR1;        // 0xFF4: Component ID Register 1
    volatile uint32_t CIDR2;        // 0xFF8: Component ID Register 2
    volatile uint32_t CIDR3;        // 0xFFC: Component ID Register 3
} CSTF_TypeDef;

typedef struct {
    uint32_t RESERVED_0[1];         // 0x000
    volatile uint32_t RSZ;          // 0x004: RAM Size Register
    uint32_t RESERVED_1[1];         // 0x008
    volatile uint32_t STS;          // 0x00C: Status Register
    volatile uint32_t RRD;          // 0x010: RAM Read Data Register
    volatile uint32_t RRP;          // 0x014: RAM Read Pointer
    volatile uint32_t RWP;          // 0x018: RAM Write Pointer
    volatile uint32_t TRG;          // 0x01C: Trigger Counter
    volatile uint32_t CTL;          // 0x020: Control Register
    volatile uint32_t RWD;          // 0x024: RAM Write Data
    volatile uint32_t MODE;         // 0x028: Mode Register
    volatile uint32_t LBUFLVL;      // 0x02C: Latched Buffer Fill Level
    volatile uint32_t CBUFLVL;      // 0x030: Current Buffer Fill Level
    volatile uint32_t BUFWM;        // 0x034: Buffer Watermark
    uint32_t RESERVED_2[178];       // 0x038 - 0x2FC
    volatile uint32_t FFSR;         // 0x300: Formatter and Flush Status
    volatile uint32_t FFCR;         // 0x304: Formatter and Flush Control
    volatile uint32_t PSCR;         // 0x308: Periodic SR Control
    uint32_t RESERVED_3[805];       // 0x30C - 0xF9C
    volatile uint32_t CLAIMSET;     // 0xFA0: Claim Tag Set Register
    volatile uint32_t CLAIMCLR;     // 0xFA4: Claim Tag Clear Register
    uint32_t RESERVED_4[2];         // 0xFA8 - 0xFAC
    volatile uint32_t LAR;          // 0xFB0: Lock Access Register
    volatile uint32_t LSR;          // 0xFB4: Lock Status Register
    volatile uint32_t AUTHSTAT;     // 0xFB8: Authentication Status Register
    uint32_t RESERVED_5[3];         // 0xFBC - 0xFC4
    volatile uint32_t DEVID;        // 0xFC8: Device ID Register
    volatile uint32_t DEVTYPE;      // 0xFCC: Device Type Register
    volatile uint32_t PIDR4;        // 0xFD0: Peripheral ID Register 4
    uint32_t RESERVED_6[3];         // 0xFD4 - 0xFDC
    volatile uint32_t PIDR0;        // 0xFE0: Peripheral ID Register 0
    volatile uint32_t PIDR1;        // 0xFE4: Peripheral ID Register 1
    volatile uint32_t PIDR2;        // 0xFE8: Peripheral ID Register 2
    volatile uint32_t PIDR3;        // 0xFEC: Peripheral ID Register 3
    volatile uint32_t CIDR0;        // 0xFF0: Component ID Register 0
    volatile uint32_t CIDR1;        // 0xFF4: Component ID Register 1
    volatile uint32_t CIDR2;        // 0xFF8: Component ID Register 2
    volatile uint32_t CIDR3;        // 0xFFC: Component ID Register 3
} ETF_TypeDef;

typedef struct {
    uint32_t RESERVED0[4];          // 0x000 to 0x00F
    __IO uint32_t CODR;             // 0x010: SWO Clock Output Divider
    uint32_t RESERVED1[55];         // 0x014 to 0x0EC
    __IO uint32_t SPPR;             // 0x0F0: Selected Pin Protocol
    uint32_t RESERVED2[131];        // 0x0F4 to 0x2FC
    __I  uint32_t FFSR;             // 0x300: Formatter and Flush Status
    uint32_t RESERVED3[806];        // 0x304 to 0xF9C
    __IO uint32_t CLAIMSET;         // 0xFA0: Claim Tag Set
    __IO uint32_t CLAIMCLR;         // 0xFA4: Claim Tag Clear
    uint32_t RESERVED4[2];          // 0xFA8 to 0xFAC
    __O  uint32_t LAR;              // 0xFB0: Lock Access
    __I  uint32_t LSR;              // 0xFB4: Lock Status
    __I  uint32_t AUTHSTAT;         // 0xFB8: Authentication Status
    uint32_t RESERVED5[3];          // 0xFBC to 0xFC4
    __I  uint32_t DEVID;            // 0xFC8: Device ID
    __I  uint32_t DEVTYPE;          // 0xFCC: Device Type
    __I  uint32_t PIDR4;            // 0xFD0: Peripheral ID 4
    uint32_t RESERVED6[3];          // 0xFD4 to 0xFDC
    __I  uint32_t PIDR0;            // 0xFE0: Peripheral ID 0
    __I  uint32_t PIDR1;            // 0xFE4: Peripheral ID 1
    __I  uint32_t PIDR2;            // 0xFE8: Peripheral ID 2
    __I  uint32_t PIDR3;            // 0xFEC: Peripheral ID 3
    __I  uint32_t CIDR0;            // 0xFF0: Component ID 0
    __I  uint32_t CIDR1;            // 0xFF4: Component ID 1
    __I  uint32_t CIDR2;            // 0xFF8: Component ID 2
    __I  uint32_t CIDR3;            // 0xFFC: Component ID 3
} SWO_TypeDef;

typedef struct {
    __IO uint32_t CTRL;             // 0x000: SWTF Control
    __IO uint32_t PRIORITY;         // 0x004: SWTF Priority
    uint32_t RESERVED0[998];        // 0x008 to 0xF9C
    __IO uint32_t CLAIMSET;         // 0xFA0: Claim Tag Set
    __IO uint32_t CLAIMCLR;         // 0xFA4: Claim Tag Clear
    uint32_t RESERVED1[2];          // 0xFA8 to 0xFAC
    __O  uint32_t LAR;              // 0xFB0: Lock Access
    __I  uint32_t LSR;              // 0xFB4: Lock Status
    __I  uint32_t AUTHSTAT;         // 0xFB8: Authentication Status
    uint32_t RESERVED2[3];          // 0xFBC to 0xFC4
    __I  uint32_t DEVID;            // 0xFC8: Device ID
    __I  uint32_t DEVTYPE;          // 0xFCC: Device Type
    __I  uint32_t PIDR4;            // 0xFD0: Peripheral ID 4
    uint32_t RESERVED3[3];          // 0xFD4 to 0xFDC
    __I  uint32_t PIDR0;            // 0xFE0: Peripheral ID 0
    __I  uint32_t PIDR1;            // 0xFE4: Peripheral ID 1
    __I  uint32_t PIDR2;            // 0xFE8: Peripheral ID 2
    __I  uint32_t PIDR3;            // 0xFEC: Peripheral ID 3
    __I  uint32_t CIDR0;            // 0xFF0: Component ID 0
    __I  uint32_t CIDR1;            // 0xFF4: Component ID 1
    __I  uint32_t CIDR2;            // 0xFF8: Component ID 2
    __I  uint32_t CIDR3;            // 0xFFC: Component ID 3
} SWTF_TypeDef;

typedef struct {
    __IO uint32_t CNTCR;            // 0x000: Counter Control - bit0 EN
    __I  uint32_t CNTSR;            // 0x004: Counter Status
    __I  uint32_t CNTCVL;           // 0x008: Count Value, lower 32 bits
    __I  uint32_t CNTCVU;           // 0x00C: Count Value, upper 32 bits
    uint32_t RESERVED0[4];          // 0x010 to 0x01C
    __IO uint32_t CNTFID0;          // 0x020: Frequency ID 0
    uint32_t RESERVED1[990];        // 0x024 to 0xF9C
    __IO uint32_t CLAIMSET;         // 0xFA0: Claim Tag Set
    __IO uint32_t CLAIMCLR;         // 0xFA4: Claim Tag Clear
    uint32_t RESERVED2[2];          // 0xFA8 to 0xFAC
    __O  uint32_t LAR;              // 0xFB0: Lock Access
    __I  uint32_t LSR;              // 0xFB4: Lock Status
    __I  uint32_t AUTHSTAT;         // 0xFB8: Authentication Status
    uint32_t RESERVED3[3];          // 0xFBC to 0xFC4
    __I  uint32_t DEVID;            // 0xFC8: Device ID
    __I  uint32_t DEVTYPE;          // 0xFCC: Device Type
    __I  uint32_t PIDR4;            // 0xFD0: Peripheral ID 4
    uint32_t RESERVED4[3];          // 0xFD4 to 0xFDC
    __I  uint32_t PIDR0;            // 0xFE0: Peripheral ID 0
    __I  uint32_t PIDR1;            // 0xFE4: Peripheral ID 1
    __I  uint32_t PIDR2;            // 0xFE8: Peripheral ID 2
    __I  uint32_t PIDR3;            // 0xFEC: Peripheral ID 3
    __I  uint32_t CIDR0;            // 0xFF0: Component ID 0
    __I  uint32_t CIDR1;            // 0xFF4: Component ID 1
    __I  uint32_t CIDR2;            // 0xFF8: Component ID 2
    __I  uint32_t CIDR3;            // 0xFFC: Component ID 3
} TSG_TypeDef;

#endif /* INC_ETMV4_H_ */
