# ==============================================================
# 1. TraceGPIO_Configure
# ==============================================================
# CoreDebug->DEMCR |= (1U << 24) (TRCENA)
set {int}0xE000EDFC = {int}0xE000EDFC | 0x01000000

# RCC->AHB4ENR |= RCC_AHB4ENR_GPIOEEN (Bit 4)
# Note: STM32H7 RCC_AHB4ENR is at 0x580244E0
set {int}0x580244E0 = {int}0x580244E0 | 0x00000010

# GPIOE Base is 0x58021000
# GPIOE->MODER: Clear and Set pins 2,3,4,5,6 to Alternate Function (10b)
set {int}0x58021000 = {int}0x58021000 & ~0x00003FF0
set {int}0x58021000 = {int}0x58021000 | 0x00002AA0

# GPIOE->OSPEEDR: Set pins 2,3,4,5,6 to Very High Speed (11b)
set {int}0x58021008 = {int}0x58021008 | 0x00003FF0

# GPIOE->AFR[0]: Clear Alternate Function for pins 2,3,4,5,6 (Sets to AF0)
set {int}0x58021020 = {int}0x58021020 & ~0x0FFFFF00

# DBGMCU->CR: Enable TRACECKEN, CKD1EN, CKD3EN
# Note: STM32H7 DBGMCU_CR is typically at 0x5C001004. 
# Assuming TRACECKEN(20), D1(21), D3(22) -> Mask: 0x00700000
set {int}0x5C001004 = {int}0x5C001004 | 0x00700000


# ==============================================================
# 2. Disable_ETM
# ==============================================================
# ETM->LAR = CORESIGHT_UNLOCK
set {int}(0xE0041000 + 0xFB0) = 0xC5ACCE55

# ETM->PRGCTL &= ~1U (Clear EN bit to disable)
set {int}(0xE0041000 + 0x004) = {int}(0xE0041000 + 0x004) & ~1
# Note: C code loops on ETM->STAT & 0x01 here. GDB will just proceed.


# ==============================================================
# 3. TPIU_Configure
# ==============================================================
# TPIU->LAR = CORESIGHT_UNLOCK
set {int}(0x5C015000 + 0xFB0) = 0xC5ACCE55

# TPIU->CURPSIZE = 8
set {int}(0x5C015000 + 0x004) = 8

# TPIU->CURTPM = (1<<17)
set {int}(0x5C015000 + 0x204) = 0x00020000

# TPIU->FFCR = 0x2
set {int}(0x5C015000 + 0x304) = 0x2

# TPIU->FSCR = 0x40
set {int}(0x5C015000 + 0x308) = 0x40


# ==============================================================
# 4. ETF_Configure
# ==============================================================
# ETF->LAR = CORESIGHT_UNLOCK
set {int}(0x5C014000 + 0xFB0) = 0xC5ACCE55

# ETF->CTL &= ~(1U << 0) (Disable trace capture)
set {int}(0x5C014000 + 0x020) = {int}(0x5C014000 + 0x020) & ~1
# Note: C code loops on ETF->STS & (1<<2) here.

# ETF->MODE = 0x2 (Software FIFO mode)
set {int}(0x5C014000 + 0x028) = 2

# ETF->FFCR = 0
set {int}(0x5C014000 + 0x304) = 0

# ETF->CTL |= (1U << 0) (Enable trace capture)
set {int}(0x5C014000 + 0x020) = {int}(0x5C014000 + 0x020) | 1


# ==============================================================
# 5. CSTF_Configure (Trace Funnel)
# ==============================================================
# CSTF->LAR = CORESIGHT_UNLOCK
set {int}(0x5C013000 + 0xFB0) = 0xC5ACCE55

# CSTF->CTRL = 0x01 (Enable Slave Port 0)
set {int}(0x5C013000 + 0x000) = 1


# ==============================================================
# 6. ETM_Configure
# ==============================================================
# ETM->CONFIG |= 0x18
set {int}(0xE0041000 + 0x010) = {int}(0xE0041000 + 0x010) | 0x18

# ETM->STALLCTL |= 0x30c
set {int}(0xE0041000 + 0x02C) = {int}(0xE0041000 + 0x02C) | 0x30C

# ETM->CCCTL |= 1
set {int}(0xE0041000 + 0x038) = {int}(0xE0041000 + 0x038) | 1

# ETM->TRACEID = 0x3E
set {int}(0xE0041000 + 0x040) = 0x3E

# ETM->VICTL = 0x00000001
set {int}(0xE0041000 + 0x080) = 1

# ETM->VIPCSSCTL = (1U << 17) | (1U << 0)
set {int}(0xE0041000 + 0x08C) = 0x00020001


# ==============================================================
# 7. DWT_Configure (Using GDB symbol evaluation for addresses)
# ==============================================================
# DWT Base is 0xE0001000
# DWT->LAR = CORESIGHT_UNLOCK
set {int}(0xE0001000 + 0xFB0) = 0xC5ACCE55

# DWT->CTRL = (1<<10)|(1<<0)
set {int}(0xE0001000 + 0x000) = 0x00000401

# DWT->COMP0 = (uint32_t)&StartPoint & ~1UL
set {int}(0xE0001000 + 0x020) = 0x8000564

# DWT->MASK0 = 0
set {int}(0xE0001000 + 0x024) = 0

# DWT->FUNCTION0 = 8
set {int}(0xE0001000 + 0x028) = 8

# DWT->COMP1 = (uint32_t)&StopPoint & ~1UL
set {int}(0xE0001000 + 0x030) = 0x8000574

# DWT->MASK1 = 0
set {int}(0xE0001000 + 0x034) = 0

# DWT->FUNCTION1 = 8
set {int}(0xE0001000 + 0x038) = 8


# ==============================================================
# 8. Enable_ETM
# ==============================================================
# ETM->PRGCTL |= 1U
set {int}(0xE0041000 + 0x004) = {int}(0xE0041000 + 0x004) | 1