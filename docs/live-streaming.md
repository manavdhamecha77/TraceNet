# Live Streaming: phones and edge cameras → TraceNet

## 1. What runs where

```
Phone / edge camera (browser)                      TraceNet backend (one process, serve.py)                 Dashboard
──────────────────────────────                     ─────────────────────────────────────────                ─────────
https://<LAN-IP>:8443/camera-app                   :8443 HTTPS  ─┐                                           :5173 (dev) / :8000
  1. enter 6-digit pair code  ── pair/verify ──►   :8000 HTTP   ─┴─ FastAPI  ── /api/v1/stream/whip|whep ──► MediaMTX :8889 (internal)
  2. getUserMedia (needs HTTPS)                                     │                                            │ RTSP :8554
  3. WebRTC WHIP publish ──────────────────────►  WHIP proxy ───────┘                                            ▼
                                                   InferenceWorker: vehicle_detector.pt + ByteTrack @ N fps ──► WebSocket /ws/stream/{cam}
                                                   StreamChunker:   ffmpeg segments (N s) ──► check-in as VideoAsset ──► full upload pipeline
                                                                                                                             (transcode, detection, plates,
                                                                                                                              CLIP index, faces, accidents)
Operator: /cameras/<id>/live  ◄── WHEP proxy (video) + WebSocket (boxes) ──────────────────────────────────────────────────────
```

Design rules:

- **Live loop = detection + tracking only.** The live overlay always runs `data/models/vehicle_detector.pt`
  (cars, buses, LCV/HCV, two/three-wheelers, pedestrians) through ByteTrack at the configured FPS. Pose and
  assault/theft rules are **off** on the live loop (`StreamConfig.live_alert_rules=False`).
- **Everything else runs at check-in.** Every finished chunk (default 30 s) is checked into the camera node as a
  normal video (`is_live_recording=true`) and goes through the *same* `process_video_background` an uploaded file
  gets. Nothing is duplicated in the chunker any more.
- **One origin for phones.** WHIP/WHEP signalling is proxied through the backend (`/api/v1/stream/whip/{cam}`,
  `/api/v1/stream/whep/{cam}`), so a phone only trusts one self-signed certificate. MediaMTX stays internal.
- **No broadcaster in the dashboard.** The old `/live-connect` page is gone; the only broadcaster is the backend-served
  edge camera app at `/camera-app`.

## 2. Run it

```powershell
cd D:\CODING\TraceNet\backend
..\.venv\Scripts\python.exe serve.py        # HTTP :8000 + HTTPS :8443 (self-signed cert auto-generated under data/certs)
```

`serve.py` prints the LAN URLs, e.g. `https://192.168.1.23:8443/camera-app`. Plain `uvicorn app.main:app --port 8000`
still works for localhost-only use (no HTTPS listener; phones cannot open their camera on a LAN http:// origin).

The certificate covers `localhost`, `127.0.0.1` and every IPv4 of the machine and is regenerated automatically when
the address list changes. Extra names: `TRACENET_TLS_EXTRA_HOSTS=my-laptop.local,10.0.0.5`.

## 3. Pair a phone (operator flow)

1. **Cameras → ⋮ on a camera → Pair device** (or the pair-code box on `/cameras/<id>/live`).
   Choose chunk length (15/30/60/120 s), live FPS (2/4/8) and whether chunks are archived through the full pipeline
   (default **on**). These settings are stored with the code and applied when the phone verifies it.
2. On the phone open the **https://** URL shown in the dialog, accept the certificate warning once, enter the code,
   allow the camera, press **Start streaming**.
3. The dashboard's `/cameras/<id>/live` attaches automatically (it retries WHEP every few seconds until the publisher
   is up and re-attaches after a disconnect). Boxes arrive over the WebSocket; the "Live pipeline logs" panel shows each
   chunk being recorded and checked in; the camera's video list fills with `is_live_recording` assets as they process.

## 4. API summary (`/api/v1/stream`)

| Method | Path | Notes |
|---|---|---|
| GET | `/access-urls` | LAN IPs, recommended `https://…:8443/camera-app` URL, whether HTTPS is available |
| POST | `/pair/generate` | `{camera_id, device_label?, config?}` → code, expiry, `camera_app_url`, stored config |
| POST | `/pair/verify` | phone: `{code, device_label?}` → device token, proxied `whip_url`, `whep_url`, `ws_telemetry_url`, config |
| POST | `/pair/stop`, GET `/pair/status` | phone, header `X-Device-Token` |
| POST | `/whip/{camera_id}?token&stream_key` | SDP offer → answer (proxied to MediaMTX; auth hook validates token) |
| PATCH/DELETE | `/whip/{camera_id}/{session_id}` | trickle-ICE / teardown passthrough |
| POST | `/whep/{camera_id}` | SDP offer → answer; `404` "No publisher is streaming to this camera yet." |
| PATCH/DELETE | `/whep/{camera_id}/{session_id}` | passthrough |
| POST | `/start`, `/stop/{camera_id}`, GET `/status/{camera_id}` | dashboard/test control; status includes `config`, `chunks_recorded`, `live_scope` |
| WS | `/ws/stream/{camera_id}` | per-frame `{detections[], fps, inference_ms, model, live_scope}` |
| GET | `/mediamtx-status` | probes MediaMTX's WebRTC port |

`StreamConfig` keys accepted in `config`: `target_fps`, `confidence_threshold`, `live_detector` (`vehicle`|`camera`),
`live_alert_rules`, `enable_pose`, `max_chunk_duration_sec`, `auto_import_chunks`. Unknown keys are ignored.

## 5. Testing without a phone

```powershell
# 1. start a session for a camera
$s = Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"camera_id":"TEST_CAM_001","config":{"max_chunk_duration_sec":15}}' http://localhost:8000/api/v1/stream/start
# 2. publish any clip into MediaMTX over RTSP with the session's credentials (the auth hook validates them)
ffmpeg -re -stream_loop -1 -i some_clip.mp4 -c:v libx264 -preset ultrafast -tune zerolatency -g 30 -pix_fmt yuv420p `
  -f rtsp -rtsp_transport tcp "rtsp://localhost:8554/TEST_CAM_001?token=$($s.token)&stream_key=$($s.stream_key)"
# 3. open http://localhost:5173/cameras/TEST_CAM_001/live  → video + live boxes; chunks appear as videos after 15 s
```

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Boxes but black video | Fixed (2026-10-08): the page never started WHEP after React's dev double-mount, and the proxy deadlocked on the auth hook. If it recurs, check the browser console for `WHEP error` and `GET /api/v1/stream/mediamtx-status`. |
| Phone: "camera not available / permission denied" | Opened over `http://` on a LAN IP. Use the `https://…:8443/camera-app` link from the pair dialog (requires `serve.py`). |
| Phone: certificate warning | Expected for the self-signed dev certificate; accept once per device. |
| WHIP returns 401 | Pair code expired or reused; generate a new one. |
| WHEP 404 "No publisher" | Phone has not pressed Start streaming yet; the dashboard retries automatically. |
| Chunks recorded but no videos appear | `auto_import_chunks` was off for this session (toggle in the pair dialog / live page). |
| `mediamtx-status` false | MediaMTX binary missing: `POST /api/v1/stream/mediamtx-start` downloads and starts it. |
