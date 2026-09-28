#!/usr/bin/env bash
# Landscape bake at full resolution, the land first (the sky follows in run-sky.sh):
# droplet erosion and talus (A2) → materials and light (B) → the game's assets (export).
set -euo pipefail
cd "$(dirname "$0")/../.."
P=tools/bake/.venv/Scripts/python.exe
log=bake/work/bake.log
stamp() { echo "[$(date -u +%T)] $*" | tee -a "$log"; }
stamp "A2 droplets and talus"
$P tools/bake/erode_gpu.py --droplets=40 >> "$log" 2>&1
stamp "B materials and light"
$P tools/bake/light_gpu.py --sky-rays=4096 >> "$log" 2>&1
stamp "export"
$P tools/bake/export.py >> "$log" 2>&1
stamp "land done"
