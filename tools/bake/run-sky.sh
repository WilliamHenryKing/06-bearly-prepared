#!/usr/bin/env bash
# The long render: the 8K path-traced sky (C), then the land relit under it (B) and re-exported.
set -euo pipefail
cd "$(dirname "$0")/../.."
P=tools/bake/.venv/Scripts/python.exe
log=bake/work/bake.log
stamp() { echo "[$(date -u +%T)] $*" | tee -a "$log"; }
stamp "C sky ${1:-768} spp"
$P tools/bake/render_sky.py --width=8192 --spp="${1:-768}" --resume >> "$log" 2>&1
stamp "B light under the final sky"
$P tools/bake/light_gpu.py --sky-rays=4096 >> "$log" 2>&1
stamp "export"
$P tools/bake/export.py >> "$log" 2>&1
stamp "sky done"
