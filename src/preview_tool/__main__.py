"""`python -m preview_tool` entry point."""

from __future__ import annotations

import signal
import sys

from .cli import main


class _PreviewCancelled(BaseException):
    pass


def _cancel(_signum: int, _frame: object) -> None:
    # First TERM initiates cleanup; a supervisor can enforce its own KILL deadline.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    raise _PreviewCancelled


_previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM})
_previous_handler = signal.getsignal(signal.SIGTERM)
signal.signal(signal.SIGTERM, _cancel)
try:
    try:
        signal.pthread_sigmask(signal.SIG_SETMASK, _previous_mask)
        _exit_code = main()
    except _PreviewCancelled:
        print("preview: operation cancelled", file=sys.stderr)
        _exit_code = 128 + signal.SIGTERM
finally:
    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM})
    signal.signal(signal.SIGTERM, _previous_handler)
    signal.pthread_sigmask(signal.SIG_SETMASK, _previous_mask)

raise SystemExit(_exit_code)
