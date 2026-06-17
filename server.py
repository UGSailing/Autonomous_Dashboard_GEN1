from __future__ import annotations

import argparse
import base64
import json
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FrameHandler(BaseHTTPRequestHandler):
    latest_frames: dict[str, bytes] = {}
    latest_lock = threading.Lock()

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_mjpeg_stream(self, label: str) -> None:
        boundary = b"frame"
        self.send_response(200)
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Connection", "close")
        self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={boundary.decode()}")
        self.end_headers()

        try:
            while True:
                with self.latest_lock:
                    frame = self.latest_frames.get(label)

                if frame is None:
                    time.sleep(0.05)
                    continue

                self.wfile.write(b"--" + boundary + b"\r\n")
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii"))
                self.wfile.write(frame)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return

    def do_GET(self) -> None:
        if self.path == "/stream/right":
            self._send_mjpeg_stream("right")
            return

        if self.path == "/stream/left":
            self._send_mjpeg_stream("left")
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/publish":
            self._send_json(404, {"error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
            label = str(payload.get("label", "frame"))
            frame_b64 = str(payload["frame"])
            frame_bytes = base64.b64decode(frame_b64)
        except (KeyError, ValueError, TypeError, json.JSONDecodeError, base64.binascii.Error) as error:
            self._send_json(400, {"error": f"invalid payload: {error}"})
            return

        if label not in {"right", "left"}:
            self._send_json(400, {"error": "label must be right or left"})
            return

        with self.latest_lock:
            self.latest_frames[label] = frame_bytes

        print(f"Updated {label} frame")
        self._send_json(200, {"status": "updated", "label": label})

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve left and right MJPEG camera streams over HTTP")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=9000)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), FrameHandler)
    print(f"Listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()