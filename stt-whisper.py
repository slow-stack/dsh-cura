# -*- coding: utf-8 -*-
"""dsh-onebot STT custom 引擎包装器：ffmpeg 转好的 16kHz WAV → faster-whisper 转写。

用法: python stt-whisper.py --file <wav路径> --out <文本输出路径>
转写文本写入 --out 文件并打印到 stdout；失败时写空字符串（dsh-onebot 会降级为 [语音] 占位）。
"""
import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()

    text = ""
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel("small", device="auto", compute_type="int8")
        segments, _ = model.transcribe(
            args.file, language=args.language,
            initial_prompt="以下是普通话的句子，使用简体中文。",
            condition_on_previous_text=False, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        text = "".join(s.text for s in segments).strip()
    except Exception as exc:  # noqa: BLE001 — 转写失败必须降级而不是抛出
        print(f"STT failed: {exc}", file=sys.stderr)
    finally:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        # dsh-onebot 的 custom 引擎只从工作目录里收第一个 *.txt（stt.js:284-291
        # readFirstTxt），而 {out} 展开出来是无扩展名的 <workDir>/out，
        # 所以必须再补一份 .txt 才算被读到；只写 args.out 的话转写永远是空。
        if not args.out.lower().endswith(".txt"):
            with open(args.out + ".txt", "w", encoding="utf-8") as fh:
                fh.write(text)
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
