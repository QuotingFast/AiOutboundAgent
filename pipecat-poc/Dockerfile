# Pipecat POC voice bot — Twilio Media Streams + Smart Turn v3.
# Separate Python service; does NOT replace the Node app. Used to evaluate
# Pipecat's semantic turn-taking on a single test number.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.hf

WORKDIR /app

# build-essential: some audio/onnx deps build native wheels.
# ffmpeg/libsndfile: audio resampling/decoding used by the pipeline.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Pre-fetch the Smart Turn v3 + Silero VAD model weights into the image so the
# first call doesn't pay the cold download. Best-effort: don't fail the build
# if the cache warm-up can't run.
RUN python warmup.py || true

EXPOSE 8080
CMD ["python", "server.py"]
