# stream.py — realtime word captions (GPU preferred) with silence gate + stricter VAD
import argparse, asyncio, json, time
from collections import deque

import numpy as np
import sounddevice as sd
import websockets
from faster_whisper import WhisperModel

# ===== Tunables (override via CLI) =====
SAMPLE_RATE = 16000
CHUNK_MS    = 250          # lower = snappier, higher = lighter
WINDOW_SEC  = 6            # rolling window that we transcribe
VAD_SIL_MS  = 500          # min silence to split segments (stricter than before)

def list_devices():
    print("Input devices:")
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0:
            print(f"  [{i}] {d['name']}  {d['default_samplerate']} Hz")
    print("\nRun:  python stream.py --device <index>")

async def run(ws_url, device_index=None, model_size="small", prefer_gpu=True,
              lang=None, beam=3, min_conf=0.6, rms_thresh=0.008, silence_hold_ms=600,
              vad_threshold=0.6):
    # Prefer GPU; fall back to CPU
    use_gpu = False
    if prefer_gpu:
        try:
            from ctranslate2 import get_cuda_device_count
            use_gpu = get_cuda_device_count() > 0
        except Exception:
            pass

    if use_gpu:
        try:
            print(f"Loading model '{model_size}' (GPU, float16)…")
            model = WhisperModel(model_size, device="cuda", compute_type="float16")
        except Exception as e:
            print(f"GPU load failed ({e}); retrying on GPU with int8_float16…")
            model = WhisperModel(model_size, device="cuda", compute_type="int8_float16")
    else:
        print(f"Loading model '{model_size}' (CPU, int8)…")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print("Model ready for streaming.")

    # Rolling mono buffer + absolute time tracking
    buf = deque(maxlen=int(SAMPLE_RATE * WINDOW_SEC))
    samples_seen = 0
    last_abs_t0_sent = 0.0
    quiet_ms = 0  # how long we've been below rms_thresh
    last_word_text = None
    last_word_time = -1.0

    def audio_cb(indata, frames, t, status):
        nonlocal samples_seen
        if frames:
            buf.extend(indata[:, 0].tolist())
            samples_seen += frames

    while True:
        ws = None
        try:
            print(f"Connecting to relay: {ws_url}")
            ws = await websockets.connect(ws_url, ping_interval=20, ping_timeout=20)
            print("Connected. Opening input stream…")

            blocksize = int(SAMPLE_RATE * CHUNK_MS / 1000)
            with sd.InputStream(device=device_index, channels=1, samplerate=SAMPLE_RATE,
                                dtype="float32", callback=audio_cb, blocksize=blocksize):
                print("Streaming…  (Ctrl+C to stop)")
                while True:
                    await asyncio.sleep(CHUNK_MS / 1000.0)
                    if not buf:
                        continue

                    audio = np.fromiter(buf, dtype=np.float32, count=-1)
                    if audio.size == 0:
                        continue

                    window_len_s = audio.size / SAMPLE_RATE
                    t0_offset = max(0.0, (samples_seen / SAMPLE_RATE) - window_len_s)

                    # Energy gate: skip ASR if quiet for long enough
                    rms = float(np.sqrt(np.mean(np.square(audio))))
                    if rms < rms_thresh:
                        quiet_ms = min(silence_hold_ms, quiet_ms + CHUNK_MS)
                    else:
                        quiet_ms = 0

                    if quiet_ms >= silence_hold_ms:
                        # Stay connected but do not transcribe; prevents “repeats during silence”
                        # Optional: send a tiny heartbeat if you want
                        # print(f"(quiet {quiet_ms}ms) RMS {rms:.3f}")
                        continue

                    segments, _ = model.transcribe(
                        audio,
                        beam_size=beam,                    # 1–5 is sensible; 3 is a good default
                        temperature=0.0,
                        vad_filter=True,
                        vad_parameters=dict(
                            threshold=vad_threshold,       # stricter than default
                            min_silence_duration_ms=VAD_SIL_MS,
                            speech_pad_ms=100
                        ),
                        word_timestamps=True,
                        condition_on_previous_text=False,  # avoid cross-window drift
                        language=lang
                    )

                    words_out = []
                    for seg in segments:
                        # If the backend exposed no_speech_prob and it's high, skip segment entirely
                        if hasattr(seg, "no_speech_prob") and seg.no_speech_prob and seg.no_speech_prob > 0.6:
                            continue
                        for w in seg.words:
                            if not w.start:
                                continue
                            conf = float(getattr(w, "probability", 1.0))
                            if conf < min_conf:
                                continue
                            abs_t0 = t0_offset + float(w.start)

                            # Drop immediate repeats like "go go", "bro bro" within 0.5s
                            text = (w.word or "")
                            if last_word_text and text.strip().lower() == last_word_text and abs_t0 - last_word_time < 0.5:
                                continue

                            # Dedup against previously emitted absolute time
                            if abs_t0 > last_abs_t0_sent + 1e-3:
                                words_out.append({
                                    "id": f"w{int(abs_t0 * 1000)}",
                                    "text": text,
                                    "t0": abs_t0,
                                    "conf": conf
                                })
                                last_word_text = text.strip().lower()
                                last_word_time = abs_t0

                    if words_out:
                        payload = {
                            "type": "CAPTION",
                            "segmentId": f"s{int(time.time() * 1000)}",
                            "final": False,
                            "words": words_out
                        }
                        await ws.send(json.dumps(payload))
                        last_abs_t0_sent = max(last_abs_t0_sent, max(w["t0"] for w in words_out))
                        print(f"↑ sent {len(words_out):2d} words | RMS {rms:.3f}")

        except KeyboardInterrupt:
            print("Stopping.")
            return
        except Exception as e:
            print(f"[WARN] Stream error: {e}. Reconnecting in 2s…")
            await asyncio.sleep(2)
        finally:
            if ws:
                try:
                    await ws.close()
                except:
                    pass

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ws", default="ws://localhost:3000/?role=presenter")
    ap.add_argument("--device", type=int, default=None)
    ap.add_argument("--model", default="medium")          # you’re testing medium now
    ap.add_argument("--cpu", action="store_true")         # force CPU if needed
    ap.add_argument("--lang", default="en")               # lock language
    ap.add_argument("--beam", type=int, default=3)
    ap.add_argument("--min-conf", type=float, default=0.6)
    ap.add_argument("--rms-thresh", type=float, default=0.008)
    ap.add_argument("--silence-hold", type=int, default=600)  # ms of quiet before gating
    ap.add_argument("--vad-threshold", type=float, default=0.6)
    ap.add_argument("--list-devices", action="store_true")
    args = ap.parse_args()

    if args.list_devices:
        list_devices()
    else:
        asyncio.run(
            run(
                ws_url=args.ws,
                device_index=args.device,
                model_size=args.model,
                prefer_gpu=not args.cpu,
                lang=args.lang,
                beam=args.beam,
                min_conf=args.min_conf,
                rms_thresh=args.rms_thresh,
                silence_hold_ms=args.silence_hold,
                vad_threshold=args.vad_threshold,
            )
        )
