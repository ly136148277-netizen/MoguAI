#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
UV_VENV="$HOME/mogu-swebench"
rm -rf "$UV_VENV"
uv venv "$UV_VENV" --python 3.12
# shellcheck disable=SC1091
source "$UV_VENV/bin/activate"
uv pip install -U pip swebench
python -c "import resource, swebench; print('SWEBENCH_OK', getattr(swebench, '__version__', '?'))"
docker info >/dev/null
echo DOCKER_OK
echo "VENV=$UV_VENV"
