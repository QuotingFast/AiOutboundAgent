# Audio Assets

Drop runtime audio files here. The app currently looks for:

## `office-ambience.wav` — background noise loop

If this file is present, it replaces the synthetic office-noise generator
in `src/audio/noise.ts` and plays continuously under every call (looped
seamlessly with a 100 ms cross-fade).

**How to add yours:**

1. Generate or export a short office-ambience clip (10–60 seconds works
   best for a natural loop) from ElevenLabs Sound Effects or Voice Studio.
2. In ElevenLabs' download dialog, choose **WAV** as the output format.
   Any sample rate / bit depth works — the loader downmixes to mono and
   resamples to 8 kHz mulaw automatically. PCM 16-bit is the safest choice.
3. Save the file as `assets/office-ambience.wav` in this repo.
4. `git add assets/office-ambience.wav && git commit && git push` —
   Render redeploys with the new sound on next push.

**Override path:** set `BACKGROUND_NOISE_FILE=/absolute/path/to/file.wav`
in env if you'd rather load it from elsewhere (e.g. Render persistent disk).

**Volume:** controlled by the `Background noise volume` setting in the
dashboard (default ~0.07). Lower = quieter ambience. The loader leaves
~15% headroom so a hot WAV peak won't slam the line.

**Fallback:** if the file is missing, malformed, or fails to decode, the
app silently falls back to the built-in synthetic noise generator and
logs an error tagged `noise`.
