# stream.py — realtime word captions (GPU preferred) with silence gate + stricter VAD
import argparse, asyncio, json, time
from collections import deque

import numpy as np
import sounddevice as sd
import websockets
from faster_whisper import WhisperModel

# ===== Tunables (override via CLI) =====
SAMPLE_RATE = 16000
CHUNK_MS    = 300          # Increased for more stable chunks
WINDOW_SEC  = 6            # Larger window to avoid cutting off words
VAD_SIL_MS  = 500          # Longer silence threshold for better segment splitting

def list_devices():
    print("Input devices:")
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0:
            print(f"  [{i}] {d['name']}  {d['default_samplerate']} Hz")
    print("\nRun:  python stream.py --device <index>")

async def run(ws_url, device_index=None, model_size="small", prefer_gpu=True,
              lang=None, beam=5, min_conf=0.6, rms_thresh=0.01, silence_hold_ms=500,
              vad_threshold=0.5):
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

    # Simplified duplicate prevention
    sent_words = {}  # Track words by text and approximate time: {word_text: timestamp}
    last_segment_end = 0.0  # Track when last segment ended

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

                    # Enhanced energy gate: skip ASR if quiet for long enough
                    rms = float(np.sqrt(np.mean(np.square(audio))))

                    # Calculate additional silence metrics
                    # Peak amplitude check
                    peak = float(np.max(np.abs(audio)))

                    # Zero-crossing rate (helps detect silence vs background noise)
                    zero_crossings = np.sum(np.abs(np.diff(np.signbit(audio)))) / len(audio)

                    # More aggressive silence detection
                    is_silent = (rms < rms_thresh) and (peak < 0.02) and (zero_crossings < 0.05)

                    if is_silent:
                        quiet_ms = min(silence_hold_ms, quiet_ms + CHUNK_MS)
                    else:
                        quiet_ms = 0

                    # Stricter silence gating - skip transcription during silence
                    current_time = samples_seen / SAMPLE_RATE
                    # Less strict at the beginning (first 10 seconds) to catch initial speech
                    effective_silence_hold = silence_hold_ms * 1.5 if current_time < 10.0 else silence_hold_ms

                    if quiet_ms >= effective_silence_hold:
                        # Stay connected but do not transcribe; prevents hallucinations during silence
                        # print(f"(quiet {quiet_ms}ms) RMS {rms:.4f} Peak {peak:.4f}")
                        continue

                    # Additional check: skip if audio is too quiet even if not meeting silence_hold
                    if rms < rms_thresh * 0.5:  # Much quieter than threshold
                        # print(f"(very quiet) RMS {rms:.4f} < {rms_thresh * 0.5:.4f}")
                        continue

                    segments, _ = model.transcribe(
                        audio,
                        beam_size=beam,                    # Higher beam = better accuracy
                        temperature=0.0,                   # Deterministic output
                        vad_filter=False,                  # Disabled VAD due to corrupted model file
                        word_timestamps=True,              # Essential for deduplication
                        condition_on_previous_text=False,  # IMPORTANT: Disable to prevent hallucinations
                        language=lang,
                        # Anti-hallucination settings
                        initial_prompt=None,               # No initial prompt to avoid bias
                        suppress_blank=True,               # Suppress blank outputs
                        suppress_tokens=[-1],              # Suppress end token
                        without_timestamps=False,          # Keep timestamps
                        max_initial_timestamp=1.0,         # Allow some delay in word start
                        compression_ratio_threshold=2.0,   # Lower threshold = more aggressive repetition detection
                        log_prob_threshold=-0.8,           # Higher threshold = reject low probability words
                        no_speech_threshold=0.5,           # Lower = more aggressive silence detection
                        repetition_penalty=1.5,            # Higher penalty for repetitions
                        no_repeat_ngram_size=2             # Prevent 2-word repetitions (stricter)
                    )

                    words_out = []
                    for seg in segments:
                        # Stricter no-speech detection - skip segments with high no_speech_prob
                        if hasattr(seg, "no_speech_prob") and seg.no_speech_prob and seg.no_speech_prob > 0.5:
                            # print(f"Skipping segment with no_speech_prob: {seg.no_speech_prob:.2f}")
                            continue

                        # Additional check: skip segments that are suspiciously short (likely hallucinations)
                        seg_duration = 0
                        if hasattr(seg, "end") and hasattr(seg, "start"):
                            seg_duration = seg.end - seg.start
                            if seg_duration < 0.1:  # Less than 100ms is suspicious
                                continue

                        for w in seg.words:
                            if not w.start:
                                continue
                            conf = float(getattr(w, "probability", 1.0))
                            if conf < min_conf:
                                continue
                            abs_t0 = t0_offset + float(w.start)

                            # Get word text and skip if empty
                            text = (w.word or "").strip()
                            if not text:
                                continue

                            # Skip single character words that are likely noise
                            if len(text) == 1 and text not in ['a', 'i', 'I']:
                                continue

                            # Simplified deduplication: check if same word appeared very recently
                            text_lower = text.lower()
                            is_duplicate = False

                            # Stricter duplicate detection within a 2-second window
                            if text_lower in sent_words:
                                time_diff = abs_t0 - sent_words[text_lower]
                                # Block duplicates within 1.5 seconds (stricter)
                                if time_diff < 1.5:
                                    is_duplicate = True
                                    # print(f"Blocking duplicate '{text}' (time_diff: {time_diff:.2f}s)")

                            if is_duplicate:
                                continue

                            # Only send words that are chronologically after the last sent word
                            if abs_t0 >= last_abs_t0_sent - 0.1:  # Small overlap allowed
                                word_id = f"w{int(abs_t0 * 1000)}_{text_lower}"
                                word_data = {
                                    "id": word_id,
                                    "text": text + " ",  # Add space for proper formatting
                                    "t0": abs_t0,
                                    "conf": conf
                                }
                                words_out.append(word_data)

                                # Update sent_words tracker
                                sent_words[text_lower] = abs_t0

                                # Clean up old entries (keep only last 100 unique words)
                                if len(sent_words) > 100:
                                    # Remove words older than 10 seconds
                                    old_words = [k for k, v in sent_words.items() if abs_t0 - v > 10.0]
                                    for old_word in old_words:
                                        del sent_words[old_word]

                    if words_out:
                        payload = {
                            "type": "CAPTION",
                            "segmentId": f"s{int(time.time() * 1000)}",
                            "final": False,
                            "words": words_out
                        }
                        await ws.send(json.dumps(payload))
                        last_abs_t0_sent = max(last_abs_t0_sent, max(w["t0"] for w in words_out))

                        # Improved logging for debugging
                        session_time = samples_seen / SAMPLE_RATE
                        first_word_time = min(w["t0"] for w in words_out)
                        words_text = " ".join([w["text"].strip() for w in words_out])
                        avg_conf = sum(w["conf"] for w in words_out) / len(words_out)
                        print(f"↑ sent {len(words_out):2d} words | Session: {session_time:.1f}s | First: {first_word_time:.2f}s | Avg conf: {avg_conf:.2f} | RMS {rms:.3f}")
                        print(f"   Words: {words_text}")
                        print(f"   Tracked words: {len(sent_words)}")

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
    ap.add_argument("--beam", type=int, default=5)
    ap.add_argument("--min-conf", type=float, default=0.6)
    ap.add_argument("--rms-thresh", type=float, default=0.01)
    ap.add_argument("--silence-hold", type=int, default=500)  # ms of quiet before gating
    ap.add_argument("--vad-threshold", type=float, default=0.5)
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
