import io
import types
from _typeshed import Incomplete
from typing import NamedTuple

OP_CONT: Incomplete
OP_TEXT: Incomplete
OP_BYTES: Incomplete
OP_CLOSE: Incomplete
OP_PING: Incomplete
OP_PONG: Incomplete
CLOSE_OK: Incomplete
CLOSE_GOING_AWAY: Incomplete
CLOSE_PROTOCOL_ERROR: Incomplete
CLOSE_DATA_NOT_SUPPORTED: Incomplete
CLOSE_BAD_DATA: Incomplete
CLOSE_POLICY_VIOLATION: Incomplete
CLOSE_TOO_BIG: Incomplete
CLOSE_MISSING_EXTN: Incomplete
CLOSE_BAD_CONDITION: Incomplete
URL_RE: Incomplete

class URI(NamedTuple):
    scheme: Incomplete
    hostname: Incomplete
    port: Incomplete
    path: Incomplete

def urlparse(uri): ...

class WebSocket(io.IOBase):
    is_client: bool
    _sock: Incomplete
    open: bool
    _rbuff: Incomplete
    def __init__(self, sock) -> None: ...
    def __enter__(self): ...
    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: types.TracebackType | None) -> None: ...
    def settimeout(self, timeout) -> None: ...
    def read_frame(self, max_size=None): ...
    def write_frame(self, opcode, data: bytes = b'') -> None: ...
    def recv(self): ...
    def ping(self, data: bytes = b'') -> None: ...
    def send(self, buf) -> None: ...
    def write(self, buf): ...
    def readinto(self, buf): ...
    def ioctl(self, kind, arg): ...
    def close(self, code=..., reason: str = '') -> None: ...
    def _close(self) -> None: ...

class WebSocketClient(WebSocket):
    is_client: bool

def connect(uri, ssl=None):
    """
    Connect a websocket.
    """
