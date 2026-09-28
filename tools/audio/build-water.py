"""Builds the pond sounds from CC0 sources (see README credits and assets.manifest.json).

  splash-0..4.mp3  wading footsteps: five short splashes from Rubberduck's
                   "40 CC0 water / splash / slime SFX" (OpenGameArt), trimmed, mono,
                   peak-normalised, faded out
  amb-water.mp3    the pond's lapping bed: loop_water_02 from the same pack, mono
  shake-0.mp3      a wet bear shaking off: Kenney's CC0 cloth flutters (RPG Audio,
                   already shipped as cloth-0/1) repeated like the twist of a shake,
                   over a burst of the pack's rain patter for the spray

Needs Python with soundfile, numpy and lameenc (tools/.audioenv at the collection root).
Run from the project folder:  python tools/audio/build-water.py
"""

import hashlib
import pathlib

import lameenc
import numpy as np
import soundfile as sf

SRC = pathlib.Path("assets-src/audio/water-splash-slime-sfx")
OUT = pathlib.Path("public/audio")
RATE = 48000


def load(path, rate=RATE):
    data, sr = sf.read(str(path), always_2d=True)
    mono = data.mean(axis=1)
    if sr != rate:
        t = np.arange(int(len(mono) * rate / sr)) * (sr / rate)
        mono = np.interp(t, np.arange(len(mono)), mono)
    return mono


def trim(x, floor=0.02, tail=0.12):
    peak = np.abs(x).max()
    idx = np.where(np.abs(x) > peak * floor)[0]
    start = max(0, idx[0] - int(0.005 * RATE))
    end = min(len(x), idx[-1] + int(tail * RATE))
    return x[start:end]


def fade(x, fin=0.004, fout=0.04):
    x = x.copy()
    a = int(fin * RATE)
    b = int(fout * RATE)
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b)
    return x


def normalise(x, peak_db=-4.0):
    return x * (10 ** (peak_db / 20) / max(1e-9, np.abs(x).max()))


def resample(x, rate):
    """Plays x back `rate` times faster (pitch rises with it)."""
    t = np.arange(0, len(x) - 1, rate)
    return np.interp(t, np.arange(len(x)), x)


def write(name, x, kbps=96):
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(RATE)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    data = enc.encode(pcm) + enc.flush()
    path = OUT / f"{name}.mp3"
    path.write_bytes(data)
    print(f"{path}  {len(data)} bytes  sha256 {hashlib.sha256(data).hexdigest()}")


for i, n in enumerate([2, 6, 8, 14, 15]):
    write(f"splash-{i}", fade(normalise(trim(load(SRC / f"splash_{n:02d}.ogg")))))

write("amb-water", normalise(load(SRC / "loop_water_02.ogg"), -6.0), kbps=64)

rain = load(SRC / "loop_rain.ogg")[: int(1.1 * RATE)]
rain = fade(normalise(rain, -9.0), fin=0.05, fout=0.35)
mix = np.zeros(int(1.2 * RATE))
mix[: len(rain)] += rain
cloth = [trim(load(OUT / "cloth-0.mp3")), trim(load(OUT / "cloth-1.mp3"))]
for k, (at, gain, rate) in enumerate([(0.0, 0.8, 1.3), (0.13, 0.7, 1.45), (0.26, 0.6, 1.35), (0.4, 0.42, 1.5)]):
    flap = resample(cloth[k % 2], rate)[: int(0.3 * RATE)]
    flap = fade(normalise(flap, -6.0), fout=0.08) * gain
    s = int(at * RATE)
    n = min(len(flap), len(mix) - s)
    mix[s : s + n] += flap[:n]
write("shake-0", fade(normalise(mix, -3.0), fout=0.25))
