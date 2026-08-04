# MicroPython - Temperature Sensor
from time import sleep

from machine import ADC, Pin

# Setup temperature sensor on ADC pin
sensor = ADC(Pin(34))
sensor.atten(ADC.ATTN_11DB)  # Full range: 3.3V


def read_temperature():
    """Read temperature from sensor and convert to Celsius."""
    # Read raw ADC value (0-4095)
    raw_value = sensor.read()

    # Convert to voltage (0-3.3V)
    voltage = raw_value * (3.3 / 4095)

    # Convert voltage to temperature (example formula)
    # Adjust this based on your specific sensor
    temperature = (voltage - 0.5) * 100

    return temperature


def monitor_temperature(interval=2, samples=10):
    """Monitor temperature at regular intervals."""
    print("Starting temperature monitoring...")
    print(f"Sampling every {interval} seconds")
    print("-" * 40)

    for i in range(samples):
        temp = read_temperature()
        print(f"Sample {i + 1:2d}: {temp:6.2f}°C")
        sleep(interval)

    print("-" * 40)
    print("Monitoring complete!")


# Main execution
if __name__ == "__main__":
    monitor_temperature(interval=1, samples=5)
