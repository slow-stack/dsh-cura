# -*- coding: utf-8 -*-
"""复现：子线程里调用 soundcard 是否稳定（COM 初始化边界测试）"""
import threading
import time
import traceback

import ctypes


def probe(tag: str):
    try:
        import soundcard as sc
        mics = [d.name for d in sc.all_microphones()]
        print(f"[{tag}] all_microphones OK: {len(mics)} 个")
    except Exception as e:
        print(f"[{tag}] FAIL: {e}")


def thread_plain():
    probe("plain-thread")


def thread_com_init():
    ctypes.windll.ole32.CoInitializeEx(None, 0x0)  # COINIT_MULTITHREADED
    probe("com-init-thread")


def main():
    print("== 主线程 ==")
    probe("main")
    t1 = threading.Thread(target=thread_plain)
    t1.start()
    t1.join()
    t2 = threading.Thread(target=thread_com_init)
    t2.start()
    t2.join()
    # 第二轮：同一进程里再开线程（模拟第二通电话）
    t3 = threading.Thread(target=thread_plain)
    t3.start()
    t3.join()


if __name__ == "__main__":
    main()
