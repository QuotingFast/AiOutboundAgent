"""Pre-download model weights at image-build time so the first call doesn't
pay the cold-start download (Smart Turn v3 + Silero VAD). Best-effort only —
the Dockerfile runs this with `|| true`."""

try:
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
    LocalSmartTurnAnalyzerV3()
    print("warmup: smart-turn-v3 weights cached")
except Exception as e:  # pragma: no cover
    print(f"warmup: smart-turn skipped ({e})")

try:
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    SileroVADAnalyzer()
    print("warmup: silero VAD cached")
except Exception as e:  # pragma: no cover
    print(f"warmup: silero skipped ({e})")
