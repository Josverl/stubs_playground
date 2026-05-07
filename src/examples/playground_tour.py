# Stubs Playground Welcome Tour
#
# <-- Open the file panel on the left to see the files
#     Open the Open panel on the right to select different stubs -->
# 
#  Some things to try out:
#  - Hover over the code to see type information
#  - Try to edit the code and see how the stubs help you with autocompl....[Enter]
#  - Press [F8] to see the warnings 

# --------------------------------------------
# Can this snippet run on a stm32 ?
from machine import Pin
import time
led = Pin(2, Pin.OUT)
for _ in range(1_000):
    led.toggle()
    time.sleep(0.5)
# --------------------------------------------
# ESP32

from machine import Pin
import espnow

BROADCAST = b"\xff\xff\xff\xff\xff\xff"

# Initialize ESP-NOW
e = espnow.ESPNow()

peer_mac = BROADCAST
e.add_peer(peer_mac)
# Setup LED on pin 2 for status indication
led = Pin(2, Pin.OUT)


def send_message(message):
    """Send a message via ESP-NOW and indicate status with LED."""
    e.send(peer_mac, message)
    print(f"Sent: {message}")
    led.value(1)  # Turn on LED to indicate success
    sleep(0.2)
    led.value(0)  # Turn off LED

# --------------------------------------------
# Is the below rp2 PIO  code correct? ( uncomment TYPE_CHECKING )
# what are the parameters and defaults accepted by @asm_pio (Hover)

import rp2
TYPE_CHECKING = False
# if TYPE_CHECKING:
#     # Add type hints for the PIO assembler functions.
#     from rp2.asm_pio import *

@rp2.asm_pio(set_init=rp2.PIO.OUT_LOW)
def blink_1hz():
    # Cycles: 1 + 1 + 6 + 32 * (30 + 1) = 1000
    irq(rel(0))
    set(pins, 1)
    set(x, 31)                [5]
    label("delay_high")
    nop()                     [29]
    jmp(x_dec, "delay_high")
    # Cycles: 1 + 1 + 6 + 32 * (30 + 1) = 1000
    nop()
    set(bins, 0)
    set(x, 31)                [5]
    label("delay_low")
    nop()                     [29]
    jmp(x_dec, "delay_low")


