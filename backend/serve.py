"""
Run the TraceNet backend on plain HTTP (port 8000, dashboard + MediaMTX hooks) and HTTPS (port 8443,
phones / edge cameras on the LAN) from ONE process, so live-stream state is shared.

    cd backend
    ..\\.venv\\Scripts\\python.exe serve.py            # http://0.0.0.0:8000 + https://0.0.0.0:8443
    ..\\.venv\\Scripts\\python.exe serve.py --no-tls   # http only (same as plain uvicorn)

The HTTPS listener runs in a daemon thread with its own event loop; uvicorn only installs signal
handlers on the main thread, so Ctrl+C stops the HTTP server and we then stop the HTTPS one.
Environment overrides: TRACENET_HTTP_PORT, TRACENET_HTTPS_PORT, TRACENET_TLS_EXTRA_HOSTS (comma list).
"""
import os
import sys
import threading

import uvicorn

HTTP_PORT = int(os.getenv("TRACENET_HTTP_PORT", "8000"))
HTTPS_PORT = int(os.getenv("TRACENET_HTTPS_PORT", "8443"))


def main() -> None:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    use_tls = "--no-tls" not in sys.argv

    from app.main import app  # one app instance shared by both listeners
    from app.tls import ensure_dev_cert, lan_ipv4_addresses

    https_server = None
    https_thread = None
    if use_tls:
        extra = [h.strip() for h in os.getenv("TRACENET_TLS_EXTRA_HOSTS", "").split(",") if h.strip()]
        cert, key = ensure_dev_cert(extra_hosts=extra)
        if cert and key:
            https_cfg = uvicorn.Config(app, host="0.0.0.0", port=HTTPS_PORT, ssl_certfile=cert, ssl_keyfile=key,
                                       log_level="info", ws_ping_interval=20, ws_ping_timeout=20)
            https_server = uvicorn.Server(https_cfg)
            https_thread = threading.Thread(target=https_server.run, name="uvicorn-https", daemon=True)
            https_thread.start()
            for ip in lan_ipv4_addresses():
                print(f"Edge camera app (phones): https://{ip}:{HTTPS_PORT}/camera-app   (accept the self-signed certificate once)")
        else:
            print("TLS disabled: the 'cryptography' package is not installed, so no certificate could be generated.")

    http_server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=HTTP_PORT, log_level="info",
                                                ws_ping_interval=20, ws_ping_timeout=20))
    try:
        http_server.run()
    finally:
        if https_server is not None:
            https_server.should_exit = True
            if https_thread is not None:
                https_thread.join(timeout=5)


if __name__ == "__main__":
    main()
