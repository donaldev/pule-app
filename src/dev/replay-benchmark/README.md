# Local replay compression benchmark

This standalone page runs the production MediaRecorder encoder and an experimental
WebCodecs worker against the same local file. It has no upload controls, backend
client, or service worker. The normal app build does not use this entry point.
The benchmark build writes only its own static assets to the OS temporary directory.

## Desktop

From the repository root, with the locked development dependencies installed, run:

```sh
npx vite build --config src/dev/replay-benchmark/vite.config.mts
npx vite preview --config src/dev/replay-benchmark/vite.config.mts
```

Open `http://127.0.0.1:5186/`. Chrome treats loopback as a secure context.

## Physical Pixel over HTTPS

1. Connect the Pixel and Mac to the same trusted Wi-Fi network. Set `pixel_host_ip`
   below to the Mac's Wi-Fi IPv4 address. The address must match the certificate.
2. Generate a temporary certificate using [mkcert](https://github.com/FiloSottile/mkcert).
   If it is missing, install it on the Mac first, for example with
   `brew install mkcert`.

   ```sh
   pixel_host_ip=192.168.1.23
   tls_dir=$(mktemp -d)
   CAROOT="$tls_dir" mkcert -cert-file "$tls_dir/cert.pem" -key-file "$tls_dir/key.pem" "$pixel_host_ip"
   npx vite build --config src/dev/replay-benchmark/vite.config.mts
   PULE_BENCHMARK_CERT="$tls_dir/cert.pem" PULE_BENCHMARK_KEY="$tls_dir/key.pem" \
     npx vite preview --config src/dev/replay-benchmark/vite.config.mts
   ```

3. Transfer only `rootCA.pem` from that temporary directory to the Pixel, for
   example by USB. Install it as a **CA certificate** under **Settings → Security
   & privacy → More security settings → Encryption & credentials → Install a
   certificate**. Keep both private keys on the Mac. Open
   `https://<pixel_host_ip>:5186/` in Chrome and continue once the certificate is
   trusted. If Chrome shows a certificate error, check the address and CA trust.
   [Pixel certificate settings](https://support.google.com/pixelphone/answer/2844832)
4. Select a small H.264/AAC MP4 and run both encoders. Then use a real recording
   around 1 GB, ideally seven minutes long, and repeat on the same device. Keep
   Chrome visible and the screen awake. Check playback and save both outputs.
   Record the Pixel model, Android and Chrome versions, encode time, output size,
   and heat or battery changes across repeat runs. Try **Cancel** and rerun the
   benchmark. A cancelled or backgrounded run starts again from the source.
5. Stop the preview and remove the temporary CA from the Pixel after testing.

## Encoder and dependency

[Mediabunny](https://mediabunny.dev/guide/converting-media-files) is pinned as one
development dependency with type-only transitive dependencies. It handles both MP4
demuxing and muxing, reads the source in bounded slices, and applies backpressure
to the WebCodecs queues. The conversion closes decoded samples as it advances.
[MP4Box.js](https://github.com/gpac/mp4box.js) can extract MP4 samples but would
require more glue for transcode, timestamps and writing. The standalone
[mp4-muxer](https://github.com/Vanilagy/mp4-muxer/blob/main/MIGRATION-GUIDE.md) is
deprecated and only covers writing.

MediaRecorder keeps its production budget. WebCodecs keeps the previous
output dimensions and 30 fps, but requests constant bitrate using a 175 MB
model, minus the actual AAC packet bytes and a 4 MB MP4 allowance. The hard
limit remains 200 MB. The original Pixel run wrote 200.21 MB after 476.91 s of
source time, around 3.36 Mbps total. Before this experiment Mediabunny passed
the requested bitrate through with variable rate control. Android documents a
quality floor in that mode that can produce a higher bitrate. The run did
not expose a native driver bitrate or prove that the floor caused the overshoot.
[Android MediaCodec rate control](https://developer.android.com/reference/android/media/MediaCodec#minimum-quality-floor-for-video-encoding)

The result shows the configuration submitted to `VideoEncoder.configure()`,
the observed encoded video bytes, and the source AAC packet bytes reserved.
Completed MP4s also show the exact copied audio payload. The configured mode
and bitrate are browser settings. Actual throughput, rate control and
hardware use can vary by device.

The worker samples the source presentation timeline onto a constant-rate grid
because replay shot timing uses frame index divided by FPS. This retains the
overall timeline with frame-grid rounding. The primary AAC track is copied. Unsupported audio
is rejected instead of being dropped. The same source-to-display transform and
output scaling used by replay compression apply to the baked orientation.

The output sink rejects writes past 200,000,000 bytes. Output pages and the final
Blob can overlap briefly in memory. Chrome's main-page sampled JS heap metric
excludes worker and native codec buffers. A supported codec configuration and
an accepted hardware preference do not establish which hardware actually ran.

## Local verification

During initial development, desktop Chrome with a 22.74-second H.264/AAC source produced these results:

| Path | Encode and mux | Output | Duration |
| --- | ---: | ---: | ---: |
| MediaRecorder | 23.11 s | 1.62 MB | 22.81 s |
| WebCodecs | 1.66 s | 4.20 MB | 22.73 s |

FFmpeg decoded the experimental output, and the AAC packet hash matched the
source. A rotated VFR fixture padded with an MP4 free-space box to 1 GB produced
an upright 1280 × 720, 30 fps H.264/AAC file in 1.22 s. Its duration was
8.00 s versus 8.02 s for the source, and AAC packets were unchanged. The
padding exercises large-file access with short media content. A separate
35-second local shot sample yielded three replay clips from both the original
and experimental encodes, with clip boundaries moving by up to about 0.54 s.
OpenCV and the existing worker accepted the output dimensions, codec and corner
coordinates. These are desktop fixtures. A real seven-minute Pixel recording
still needs sustained speed, memory, audiovisual quality and thermal checks.
