"""
pico_echo.py - Raspberry Pi Pico side of the Projects Day scenario.

Save this on the Pico as main.py so it starts on power-up with no laptop
attached. MicroPython only; nothing else is needed on the Pico.

What it does
------------
Echoes every byte it receives on UART1 straight back, as fast as it can, and
blinks the on-board LED so you can see at a glance that it is alive. That is
the entire contract: the STM32 sends 0x5A, the Pico sends it back, and the
returning byte raises USART1_IRQHandler on the STM32 at a moment neither side
chose - which is exactly what makes it a genuinely asynchronous interrupt
rather than a scheduled one.

The turnaround must stay short and, more importantly, must not vary wildly.
A slow or jittery echo does not break the capture - the STM32 bounds its wait
in TIM6 ticks and closes the window regardless - but it does move where in the
window the nested preemption lands.

Wiring (both parts are 3.3 V - do NOT cross to 5 V)
---------------------------------------------------
    Pico GP4 / UART1 TX  (pin 6)  ->  STM32 PA10 / USART1 RX
    Pico GP5 / UART1 RX  (pin 7)  <-  STM32 PA9  / USART1 TX
    Pico GND             (pin 8)  --  STM32 GND  (and the DSLogic ground clip)

9600 8N1 on both sides. The STM32's PCLK2 is 1 MHz in this build, so 9600 is
already fck/104 - do not raise it.

Sanity check before the demo
----------------------------
Open a REPL on the Pico and watch `n` climb by exactly one per button press on
the STM32. If it does not move, the two TX/RX lines are almost certainly
swapped - that is the failure this costs the least time to find.
"""

from machine import UART, Pin
import time

UART_ID = 1
TX_PIN = 4          # GP4 -> STM32 PA10 (USART1 RX)
RX_PIN = 5          # GP5 <- STM32 PA9  (USART1 TX)
BAUD = 9600

uart = UART(UART_ID, baudrate=BAUD, bits=8, parity=None, stop=1,
            tx=Pin(TX_PIN), rx=Pin(RX_PIN))

led = Pin("LED", Pin.OUT)

# Three quick blinks at power-up: "I booted, I am the echo peer."
for _ in range(3):
    led.on()
    time.sleep_ms(60)
    led.off()
    time.sleep_ms(60)

n = 0
print("pico_echo: UART{} @ {} baud, TX=GP{} RX=GP{}".format(
    UART_ID, BAUD, TX_PIN, RX_PIN))
print("waiting for bytes from the STM32...")

while True:
    if uart.any():
        data = uart.read()
        if data:
            # Straight back out, no processing - the turnaround is the whole
            # point and anything done here only adds to it.
            uart.write(data)
            n += len(data)
            led.toggle()
            print("echoed", " ".join("0x{:02X}".format(b) for b in data),
                  " total n =", n)
    else:
        # Short sleep rather than a hard spin: keeps the REPL responsive
        # without adding meaningful latency at 9600 baud, where one byte
        # occupies the line for about 1.04 ms anyway.
        time.sleep_us(200)
