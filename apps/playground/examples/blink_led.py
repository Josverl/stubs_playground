# MicroPython - Blink LED
from time import sleep_ms

from machine import Pin

# Setup LED on GPIO2 (built-in LED on ESP32)
led = Pin(2, Pin.OUT, value=0)


def blink(times=10, delay=500):
    """Blink the LED a specified number of times."""
    for i in range(times):
        led.on()
        sleep_ms(delay)
        led.off()
        sleep_ms(delay)
    print(f"Blinked {times} times!")


# Main loop
if __name__ == "__main__":
    print("Starting blink sequence...")
    blink()
    print("Done!")
