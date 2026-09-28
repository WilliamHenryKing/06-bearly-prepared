"""Thermal and memory governor for long GPU bakes on this laptop (docs/visual/LOCAL_MACHINE_BUDGET.md).

The collection's measured limits: stop at 85 °C GPU temperature, and keep at least 1 GiB of
dedicated GPU memory free. Long bakes run in short kernel batches; between batches `pace()` reads
nvidia-smi (at most every two seconds) and, above the soft limit, idles the GPU until it has cooled
to the resume temperature. Every reading is logged to CSV as evidence that the bake stayed inside
the budget.
"""

from __future__ import annotations

import csv
import subprocess
import time
from pathlib import Path

SOFT_LIMIT_C = 81  # start idling here: comfortably below the 85 °C hard stop
RESUME_C = 76
HARD_LIMIT_C = 85
MIN_FREE_MIB = 1024


def read_gpu() -> tuple[int, int, int, int]:
    """Temperature (°C), memory used and total (MiB), utilisation (%)."""
    out = subprocess.run(
        [
            "nvidia-smi",
            "--query-gpu=temperature.gpu,memory.used,memory.total,utilization.gpu",
            "--format=csv,noheader,nounits",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip().splitlines()[0]
    t, used, total, util = (int(v.strip()) for v in out.split(","))
    return t, used, total, util


class Governor:
    def __init__(self, log_path: str | Path, label: str):
        self.path = Path(log_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.label = label
        self.last = 0.0
        self.start = time.time()
        self.idle_s = 0.0
        self.peak_c = 0
        self.min_free = 1 << 30
        new = not self.path.exists()
        self.file = open(self.path, "a", newline="")
        self.csv = csv.writer(self.file)
        if new:
            self.csv.writerow(["time", "label", "elapsed_s", "temp_c", "used_mib", "total_mib", "util", "state"])

    def _log(self, t: int, used: int, total: int, util: int, state: str) -> None:
        self.peak_c = max(self.peak_c, t)
        self.min_free = min(self.min_free, total - used)
        self.csv.writerow(
            [time.strftime("%H:%M:%S"), self.label, round(time.time() - self.start, 1), t, used, total, util, state]
        )
        self.file.flush()

    def pace(self) -> None:
        """Call between kernel batches (after synchronising)."""
        now = time.time()
        if now - self.last < 2.0:
            return
        self.last = now
        t, used, total, util = read_gpu()
        if total - used < MIN_FREE_MIB:
            self._log(t, used, total, util, "memory-low")
            raise RuntimeError(f"GPU memory headroom below {MIN_FREE_MIB} MiB ({total - used} MiB free)")
        if t < SOFT_LIMIT_C:
            self._log(t, used, total, util, "run")
            return
        self._log(t, used, total, util, "cooling")
        began = time.time()
        while t > RESUME_C:
            if t >= HARD_LIMIT_C:
                self._log(t, used, total, util, "hard-limit")
            time.sleep(3.0)
            t, used, total, util = read_gpu()
        self.idle_s += time.time() - began
        self._log(t, used, total, util, "resume")
        self.last = time.time()

    def summary(self) -> str:
        return (
            f"{self.label}: {time.time() - self.start:.0f} s, idled {self.idle_s:.0f} s for heat, "
            f"peak {self.peak_c} °C, least free {self.min_free} MiB"
        )

    def close(self) -> None:
        self.file.close()
