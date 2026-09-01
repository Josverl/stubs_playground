from _typeshed import Incomplete

_IRQ_CENTRAL_CONNECT: Incomplete
_IRQ_CENTRAL_DISCONNECT: Incomplete
_IRQ_GATTS_WRITE: Incomplete
_FLAG_WRITE: Incomplete
_FLAG_NOTIFY: Incomplete
_UART_UUID: Incomplete
_UART_TX: Incomplete
_UART_RX: Incomplete
_UART_SERVICE: Incomplete
_ADV_APPEARANCE_GENERIC_COMPUTER: Incomplete
_ADV_TYPE_FLAGS: Incomplete
_ADV_TYPE_NAME: Incomplete
_ADV_TYPE_UUID16_COMPLETE: Incomplete
_ADV_TYPE_UUID32_COMPLETE: Incomplete
_ADV_TYPE_UUID128_COMPLETE: Incomplete
_ADV_TYPE_APPEARANCE: Incomplete
_ADV_MAX_PAYLOAD: Incomplete

def advertising_payload(limited_disc: bool = False, br_edr: bool = False, name=None, services=None, appearance: int = 0): ...

class BLEUART:
    _ble: Incomplete
    _connections: Incomplete
    _rx_buffer: Incomplete
    _handler: Incomplete
    def __init__(self, ble, name: str = 'mpy-uart', rxbuf: int = 256) -> None: ...
    def irq(self, handler) -> None: ...
    def _irq(self, event, data) -> None: ...
    def any(self): ...
    def read(self, sz=None): ...
    def write(self, data) -> None: ...
    def close(self) -> None: ...
    def _advertise(self, interval_us: int = 500000) -> None: ...
