# -*- coding: utf-8 -*-
"""播放音频文件（阻塞直到播完）。
用法: python play-audio.py --file "音频路径" """
import argparse

import soundcard as sc
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("--file", required=True)
args = parser.parse_args()

data, sr = sf.read(args.file, dtype="float32")
if data.ndim > 1:
    data = data.mean(axis=1)
spk = sc.default_speaker()
spk.play(data.reshape(-1, 1), samplerate=sr, channels=1)
