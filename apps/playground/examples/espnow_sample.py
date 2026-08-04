# MicroPython - ESP-NOW Communication
from time import sleep

import espnow
from machine import Pin

BROADCAST = b"\xff\xff\xff\xff\xff\xff"

# Initialize ESP-NOW
e = espnow.ESPNow()

# Define peer MAC address (replace with actual MAC address of the peer device)
# peer_mac = b'\x24\x6F\x28\xAA\xBB\xCC'  # Example MAC address
peer_mac = BROADCAST
e.add_peer(peer_mac)
# Setup LED on pin 2 for status indication
led = Pin(2, Pin.OUT)


def send_message(message):
    """Send a message via ESP-NOW and indicate status with LED."""
    try:
        e.send(peer_mac, message)
        print(f"Sent: {message}")
        led.value(1)  # Turn on LED to indicate success
        sleep(0.2)
        led.value(0)  # Turn off LED
    except Exception as ex:
        print(f"Error sending message: {ex}")
        led.value(1)  # Turn on LED to indicate error
        sleep(0.5)
        led.value(0)  # Turn off LED


# Main execution
if __name__ == "__main__":
    messages = [b"Hello", b"ESP-NOW", b"Test Message"]
    for msg in messages:
        send_message(msg)
        sleep(2)  # Wait before sending the next message
