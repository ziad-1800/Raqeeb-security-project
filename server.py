"""Serve Raqeeb and analyze the videos in examples/ and samples/ as cameras."""

import argparse
import os
from pathlib import Path
from video_cameras import serve_video_cameras

ROOT = Path(__file__).resolve().parent


def load_local_env(path):
    allowed = {"GEMINI_API_KEY", "GEMINI_MODEL"}
    for raw_line in path.read_text(encoding="utf-8").splitlines() if path.is_file() else []:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = (part.strip() for part in line.split("=", 1))
        if name not in allowed:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value:
            os.environ.setdefault(name, value)


def main():
    load_local_env(ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--videos", help="video directory; defaults to examples/ and samples/")
    parser.add_argument("--model", default=str(ROOT / "yolo26n.pt"))
    parser.add_argument("--weapon-model", "--weapon_model", dest="weapon_model", default=str(ROOT / "weapon.pt"))
    parser.add_argument("--pose-model", dest="pose_model", default=str(ROOT / "yolo26n-pose.pt"))
    parser.add_argument("--runtime-dir", help="alternate directory for analysis, evidence, and incidents")
    parser.add_argument("--tracker", default=str(ROOT / "person_tracker.yaml"), help="Ultralytics tracker configuration")
    parser.add_argument("--imgsz", type=int, default=1280, help="person detection resolution (default: 1280)")
    parser.add_argument("--analysis-fps", type=float, default=12, help="weapon samples per source second (default: 12)")
    parser.add_argument("--weapon-conf", type=float, default=0.35, help="minimum weapon candidate score; lower-score candidates require repeated evidence (default: 0.35)")
    parser.add_argument("--knife-model", dest="knife_model", default=str(ROOT / "knife.pt"),
                        help="dedicated close-range knife model for the live webcam; falls back to weapon-model when missing")
    parser.add_argument("--live-weapons", default="knife",
                        help="weapon classes the live webcam alerts on: knife, gun, or gun,knife (default: knife)")
    parser.add_argument("--live-knife-conf", type=float, default=0.5,
                        help="minimum live knife score (default: 0.5; recorded cameras use 0.8)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    serve_video_cameras(parser.parse_args())


if __name__ == "__main__":
    main()
