
import sys, json
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
import numpy as np
import engine as E
cfg=json.loads(open(ROOT / "config.json", encoding="utf-8").read()); cfg["token"]="x"
base=cfg["audio"]
cfg["audio"]={**base,"captureDevice":"__real_mic__","renderDevice":"__real_spk__",
              "adaptiveThreshold":True,"bargeThreshold":0.02,
              "trailingSilenceSec":1.2,"minSpeechSec":0.6}
s=E.CallSession(cfg, None, {"id":"t1","phase":"connected"})
mic,spk=s._find_real_devices()
print("mic",mic,"gain",mic.gain)
s._calibrate_thresholds(mic, cfg["audio"]["samplerate"], cfg["audio"]["channels"], cfg["audio"]["samplerate"]*50//1000)
print("th", cfg["audio"]["startThreshold"], cfg["audio"]["stopThreshold"])
