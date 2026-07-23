"""
Force LF newlines + UTF-8 text I/O for SWE-bench harness on Windows.

Without this:
- Path.write_text() emits CRLF → eval.sh breaks inside Linux containers
  (`activate\\r`, `pytest: command not found`) and Resolved becomes noise.
- open()/write of test_output uses locale GBK → UnicodeEncodeError on non-ASCII
  pytest ANSI / unicode in logs (e.g. django-10924 harness "error").

Loaded automatically when this directory is on PYTHONPATH (before swebench import).
"""
from __future__ import annotations

import builtins
import pathlib

_orig_write_text = pathlib.Path.write_text
_orig_open = builtins.open


def _write_text_lf(self, data, encoding=None, errors=None, newline=None):  # noqa: ANN001
    name = str(self).replace("\\", "/").lower()
    force_lf = newline is None and (
        name.endswith(".sh")
        or name.endswith(".diff")
        or name.endswith("/patch")
        or name.endswith("patch.diff")
        or name.endswith("model_patch")
        or (isinstance(data, str) and data.lstrip().startswith("#!"))
        or (isinstance(data, str) and "set -euxo pipefail" in data[:200])
    )
    if force_lf:
        newline = "\n"
    # Prefer UTF-8 so harness log dumps never hit Windows GBK.
    if encoding is None:
        encoding = "utf-8"
    return _orig_write_text(self, data, encoding=encoding, errors=errors, newline=newline)


def _open_utf8(
    file,
    mode="r",
    buffering=-1,
    encoding=None,
    errors=None,
    newline=None,
    closefd=True,
    opener=None,
):
    # Text modes without explicit encoding → UTF-8 (fixes f.write(test_output) GBK crash).
    if "b" not in str(mode) and encoding is None:
        encoding = "utf-8"
    return _orig_open(
        file,
        mode,
        buffering,
        encoding,
        errors,
        newline,
        closefd,
        opener,
    )


pathlib.Path.write_text = _write_text_lf  # type: ignore[method-assign]
builtins.open = _open_utf8  # type: ignore[assignment]
