"""Recorded camera library with genuine YOLO inference and synchronized evidence.

Videos are analyzed locally once, then played at their native frame rate in the
browser. Detections are indexed by source timestamp, never by a demo timer.
"""

import base64
import csv
import hashlib
import io
import json
import math
import mimetypes
import os
os.environ.setdefault("YOLO_AUTOINSTALL", "false")
import re
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
ANALYSIS_VERSION = 11
CCTV_PROFILE = {"knife_conf": .8, "wrist_gap": .12, "compact": .3, "compact_moving": .45, "person_overlap": .5,
                "fallback_conf": None, "knife_observations": 3,
                "full_size": 1280, "tiles": True, "pose_size": 1280, "hand_size": 640}
WEBCAM_PROFILE = {"knife_conf": .5, "wrist_gap": .25, "compact": None, "compact_moving": None, "person_overlap": None,
                  "fallback_conf": .4, "knife_observations": 3,
                  "full_size": 640, "tiles": False, "pose_size": 416, "hand_size": 416, "track_size": 416,
                  "hand_refinement": False,
                  "max_people": 3}
SIZE_KEYS = ("full_size", "tiles", "pose_size", "hand_size", "track_size", "hand_refinement")


def weapon_kind(label):
    label = re.sub(r"[^a-z]+", " ", str(label).lower()).strip()
    if any(word in label.split() for word in ("knife", "knives", "dagger")):
        return "knife"
    if any(word in label.split() for word in
           ("gun", "guns", "pistol", "handgun", "rifle", "firearm", "revolver", "shotgun")):
        return "gun"
    return None


class _Box:
    """Expose the Ultralytics box attributes used by the weapon validation pipeline."""

    def __init__(self, xyxy, cls, conf):
        import torch
        self.xyxy, self.cls, self.conf = torch.tensor([xyxy]), torch.tensor(cls), torch.tensor(conf)


class KnifeAugmentedModel:
    """Combine the general weapon model with a dedicated close-range knife model."""

    def __init__(self, weapon, knife, knife_class):
        self.weapon, self.knife, self.knife_class = weapon, knife, knife_class
        self.names = weapon.names
        self.best_knife = 0.0

    def predict(self, source, classes, conf, imgsz, verbose=False, device="cpu"):
        from types import SimpleNamespace

        batch = source if isinstance(source, list) else [source]
        others = [class_id for class_id in classes if class_id != self.knife_class]
        weapons = (self.weapon.predict(batch, classes=others, conf=conf, imgsz=imgsz,
                                       verbose=verbose, device=device)
                   if others else [None] * len(batch))
        knives = (self.knife.predict(batch, conf=min(conf, .1), imgsz=min(imgsz, 640),
                                     verbose=verbose, device=device)
                  if self.knife_class in classes else [None] * len(batch))
        results = []
        for weapon_result, knife_result in zip(weapons, knives):
            boxes = [_Box(box.xyxy[0].tolist(), int(box.cls.item()), float(box.conf.item()))
                     for box in (weapon_result.boxes if weapon_result else [])]
            for box in (knife_result.boxes if knife_result else []):
                score = float(box.conf.item())
                self.best_knife = max(self.best_knife, score)
                if score >= conf:
                    boxes.append(_Box(box.xyxy[0].tolist(), self.knife_class, score))
            results.append(SimpleNamespace(boxes=boxes))
        return results


def box_iou(a, b):
    intersection = max(0, min(a[2], b[2])-max(a[0], b[0])) * max(0, min(a[3], b[3])-max(a[1], b[1]))
    area_a = max(0, a[2]-a[0]) * max(0, a[3]-a[1])
    area_b = max(0, b[2]-b[0]) * max(0, b[3]-b[1])
    return intersection / max(area_a + area_b - intersection, 1e-9)


def discover_videos(directory=None):
    folders = [Path(directory)] if directory else [ROOT / n for n in ("examples", "samples")]
    return sorted({p.resolve() for folder in folders if folder.is_dir()
                   for p in folder.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS},
                  key=lambda p: str(p).casefold())


def json_write(path, data):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    temp.replace(path)


class PersonIDs:
    """Persistent public pseudonyms. Camera numbers never enter a person's ID."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def resolve(self, source_hash, track_id):
        with self.lock:
            key = f"{source_hash}:{track_id}"
            if key not in self.data:
                number = max((int(v.split("-")[1]) for v in self.data.values()), default=0) + 1
                self.data[key] = f"P-{number:04d}"
                json_write(self.path, self.data)
            return self.data[key]

def detect_weapons(model, image, people, classes, confidence, profile=CCTV_PROFILE, rejected=None):
    """Magnify small objects, then merge overlapping predictions in source pixels."""
    height, width = image.shape[:2]
    candidates = []
    regions = [(0, 0, width, height)]
    # Overlapping tiles preserve weapons that are tiny in a full CCTV frame.
    for row in range(2 if profile["tiles"] else 0):
        for col in range(2):
            regions.append((int(width*col*.4), int(height*row*.4),
                            min(width, int(width*(col*.4+.6))),
                            min(height, int(height*(row*.4+.6)))))
    # In sparse scenes, inspect each person and their outstretched hands.
    if len(people) <= 6:
        for person in people:
            x1, y1, x2, y2 = person["box"]
            w, h = x2-x1, y2-y1
            region = (max(0, int(x1-w*.7)), max(0, int(y1-h*.1)),
                      min(width, int(x2+w*.7)), min(height, int(y2+h*.1)))
            if profile["tiles"] or (region[2]-region[0])*(region[3]-region[1]) < .6*width*height:
                regions.append(region)
    tiles = 5 if profile["tiles"] else 1
    for index, (left, top, right, bottom) in enumerate(regions):
        crop = image[top:bottom, left:right]
        if not crop.size:
            continue
        size = profile["full_size"] if index == 0 else 960 if index < tiles else 640
        result = model.predict(crop, classes=list(classes), conf=confidence,
                               imgsz=size, verbose=False, device="cpu")[0]
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            coords = [round(x1+left, 1), round(y1+top, 1), round(x2+left, 1), round(y2+top, 1)]
            # Reject the weapon model's occasional whole-person class confusion.
            if profile["person_overlap"] is not None and any(
                    box_iou(coords, person["box"]) > profile["person_overlap"] for person in people):
                if rejected is not None:
                    rejected.append((classes[int(box.cls.item())], float(box.conf.item()), "box covers a whole person"))
                continue
            candidates.append({"class": classes[int(box.cls.item())],
                               "conf": round(float(box.conf.item()), 4), "box": coords,
                               "id": None, "color": None, "weapon": True})
    merged = []
    for det in sorted(candidates, key=lambda d: -d["conf"]):
        if any(det["class"] == d["class"] and box_iou(det["box"], d["box"]) > .3 for d in merged):
            continue
        merged.append(det)
    plausible = []
    for det in merged:
        owner_id = weapon_owner(det, people)
        if det["class"] == "knife" and det["conf"] < max(profile["knife_conf"], confidence):
            if rejected is not None:
                rejected.append(("knife", det["conf"], f"below the {max(profile['knife_conf'], confidence):.0%} knife threshold"))
            continue
        det["person_id"] = owner_id
        plausible.append(det)
    return plausible


def associate_hands(pose_model, weapon_model, image, detections, people, classes, confidence, previous=(),
                    profile=CCTV_PROFILE, rejected=None):
    """Use visible wrists to distinguish the holder from a nearby bystander."""
    if not detections and not people:
        return []
    poses = pose_model.predict(image, imgsz=profile["pose_size"], conf=.2, verbose=False, device="cpu")[0]
    bodies = []
    for index, box in enumerate(poses.boxes.xyxy.tolist()):
        person = max(people, key=lambda p: box_iou(box, p["box"]), default=None)
        person_id = person["id"] if person and box_iou(box, person["box"]) > .2 else None
        wrists = [poses.keypoints.xy[index][k].tolist() for k in (9, 10)
                  if float(poses.keypoints.conf[index][k]) > .35]
        bodies.append({"box": box, "id": person_id, "wrists": wrists})
    # Inspect small hand regions even when the full-frame detector misses a
    # second weapon. This is especially useful for distant people in crowds.
    height, width = image.shape[:2]
    crops, offsets = [], []
    if profile.get("hand_refinement", True):
        for body in bodies:
            body_height = body["box"][3]-body["box"][1]
            if body_height < 120:
                continue
            centers = []
            for x, y in body["wrists"]:
                if any(math.hypot(x-px, y-py) < .15*body_height for px, py in centers):
                    continue
                centers.append((x, y))
                radius = max(48, int(body_height*.4))
                left, top = max(0, int(x-radius)), max(0, int(y-radius))
                right, bottom = min(width, int(x+radius)), min(height, int(y+radius))
                crop = image[top:bottom, left:right]
                if crop.size:
                    crops.append(crop)
                    offsets.append((left, top))
    candidates = list(detections)
    for start in range(0, len(crops), 4):
        results = weapon_model.predict(crops[start:start+4], classes=list(classes),
            imgsz=profile["hand_size"], conf=confidence, verbose=False, device="cpu")
        for result, (left, top) in zip(results, offsets[start:start+4]):
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                kind, score = classes[int(box.cls.item())], float(box.conf.item())
                if kind == "knife" and score < max(profile["knife_conf"], confidence):
                    if rejected is not None:
                        rejected.append(("knife", score, f"below the {max(profile['knife_conf'], confidence):.0%} knife threshold"))
                    continue
                candidates.append({"class": kind, "conf": round(score, 4),
                    "box": [round(x1+left, 1), round(y1+top, 1), round(x2+left, 1), round(y2+top, 1)],
                    "id": None, "color": None, "weapon": True})
    merged = []
    for det in sorted(candidates, key=lambda d: -d["conf"]):
        if not any(d["class"] == det["class"] and box_iou(d["box"], det["box"]) > .3 for d in merged):
            merged.append(det)
    verified = []
    for det in merged:
        x1, y1, x2, y2 = det["box"]
        best, distance = None, float("inf")
        for body in bodies:
            height = max(1, body["box"][3]-body["box"][1])
            for x, y in body["wrists"]:
                gap = math.hypot(max(x1-x, 0, x-x2), max(y1-y, 0, y-y2))/height
                if gap < distance:
                    best, distance = body, gap
        if best and distance < profile["wrist_gap"]:
            compact_limit = profile["compact"]
            for old in previous:
                if old["class"] == det["class"] and old.get("person_id") == best["id"]:
                    old_box = old["box"]
                    travel = math.hypot((x1+x2-old_box[0]-old_box[2])/2,
                                        (y1+y2-old_box[1]-old_box[3])/2)
                    if travel < .25*(best["box"][3]-best["box"][1]):
                        compact_limit = profile["compact_moving"]
            if compact_limit is not None and max(x2-x1, y2-y1) > compact_limit*(best["box"][3]-best["box"][1]):
                if rejected is not None:
                    rejected.append((det["class"], det["conf"], "too large for the holder's body"))
                continue
            if best["id"] is None:
                if profile["fallback_conf"] is not None and det["conf"] >= profile["fallback_conf"]:
                    best = {**best, "id": weapon_owner(det, people)}
                else:
                    if rejected is not None:
                        rejected.append((det["class"], det["conf"], "holder is not a tracked person"))
                    continue
            # Keep the holder through adjacent, ambiguous hand overlaps.
            # Continuity applies only if that person's visible wrist remains nearby.
            for old in previous:
                if old["class"] != det["class"]:
                    continue
                prior = next((b for b in bodies if b["id"] == old.get("person_id")), None)
                if prior is None:
                    continue
                h = max(1, prior["box"][3]-prior["box"][1])
                old_box = old["box"]
                travel = math.hypot((x1+x2-old_box[0]-old_box[2])/2,
                                    (y1+y2-old_box[1]-old_box[3])/2)/h
                wrist_gap = min((math.hypot(max(x1-x, 0, x-x2), max(y1-y, 0, y-y2))/h
                                 for x, y in prior["wrists"]), default=1)
                if travel < .25 and wrist_gap <= min(.08, distance+.04):
                    best = prior
                    break
            det["person_id"] = best["id"]
            verified.append(det)
        elif profile["fallback_conf"] is not None and det["conf"] >= profile["fallback_conf"]:
            det["person_id"] = weapon_owner(det, people)
            verified.append(det)
        elif rejected is not None:
            rejected.append((det["class"], det["conf"], "no visible wrist next to it"))
    return verified


def stabilize_boxes(frames):
    """Remove isolated box jitter with a short centered temporal filter."""
    for index in range(1, len(frames)-1):
        before, frame, after = frames[index-1:index+2]
        if after["time"]-before["time"] > .3:
            continue
        old = {d["id"]: d for d in before["dets"] if d["class"] == "person" and d["id"]}
        new = {d["id"]: d for d in after["dets"] if d["class"] == "person" and d["id"]}
        for det in frame["dets"]:
            if det["class"] != "person" or det["id"] not in old or det["id"] not in new:
                continue
            a, b = old[det["id"]], new[det["id"]]
            det["box"] = [round(.2*x+.6*y+.2*z, 2) for x, y, z in zip(a["box"], det["box"], b["box"])]


def weapon_owner(weapon, people):
    """Associate visible evidence spatially; do not infer identity across cameras."""
    x = (weapon["box"][0]+weapon["box"][2])/2
    y = (weapon["box"][1]+weapon["box"][3])/2
    nearest, best = None, float("inf")
    for person in people:
        x1, y1, x2, y2 = person["box"]
        distance = math.hypot(max(x1-x, 0, x-x2), max(y1-y, 0, y-y2))
        normalized = distance/max(y2-y1, 1)
        if normalized < min(best, .5):
            nearest, best = person.get("id"), normalized
    return nearest


def clothing_color(image, box):
    import cv2
    import numpy as np

    x1, y1, x2, y2 = map(int, box)
    h, w = image.shape[:2]
    # Center of the torso avoids most background and the subject's face.
    left, right = max(0, x1 + (x2-x1)//5), min(w, x2 - (x2-x1)//5)
    top, bottom = max(0, y1 + (y2-y1)//5), min(h, y1 + (y2-y1)//2)
    roi = image[top:bottom, left:right]
    if not roi.size:
        return "Unknown"
    hue, sat, value = np.median(cv2.cvtColor(roi, cv2.COLOR_BGR2HSV).reshape(-1, 3), axis=0)
    if value < 55:
        return "Black"
    if sat < 35:
        return "White" if value > 180 else "Gray"
    if hue < 10 or hue > 170:
        return "Red"
    if hue < 35:
        return "Yellow"
    if hue < 85:
        return "Green"
    if hue < 135:
        return "Blue"
    return "Purple"


class CameraLibrary:
    def __init__(self, args):
        import cv2

        self.args = args
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.started = time.monotonic()
        self.runtime = Path(args.runtime_dir).resolve() if getattr(args, "runtime_dir", None) else ROOT / "runtime"
        self.cache = self.runtime / "analysis"
        self.evidence = self.runtime / "evidence"
        self.cache.mkdir(parents=True, exist_ok=True)
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.person_ids = PersonIDs(self.runtime / "person_ids.json")
        camera_path = self.runtime / "cameras.json"
        camera_ids = json.loads(camera_path.read_text(encoding="utf-8")) if camera_path.exists() else {}
        seed_path = ROOT / "camera_sources.json"
        seeds = json.loads(seed_path.read_text()) if seed_path.exists() else {}
        for relative, cid in seeds.items():
            camera_ids.setdefault(str((ROOT / relative).resolve()), cid)
        self.cameras = {}
        self.analyses = {}
        self.capabilities = []
        self.model_error = None
        self.incidents = []
        self.incident_path = self.runtime / "incidents.json"
        if self.incident_path.exists():
            try:
                self.incidents = json.loads(self.incident_path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                pass
        for path in discover_videos(args.videos):
            cap = cv2.VideoCapture(str(path))
            fps = cap.get(cv2.CAP_PROP_FPS)
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            valid = cap.isOpened() and math.isfinite(fps) and fps > 0 and frames > 0
            key = str(path)
            if key not in camera_ids:
                number = max((int(cid.split("-")[1]) for cid in camera_ids.values()), default=0) + 1
                camera_ids[key] = f"CAM-{number:02d}"
            cid = camera_ids[key]
            camera = {"id": cid, "name": path.stem, "filename": path.name,
                      "path": path, "status": "queued" if valid else "error",
                      "error": None if valid else "Video cannot be decoded",
                      "fps": round(fps, 3) if valid else 0,
                      "duration": round(frames / fps, 3) if valid else 0,
                      "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                      "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                      "progress": 0, "samples": 0, "weapon_events": 0,
                      "video_url": f"/api/cameras/{cid}/video",
                      "analysis_url": f"/api/cameras/{cid}/analysis",
                      "thumbnail_url": f"/api/cameras/{cid}/thumbnail.jpg"}
            ok, frame = cap.read()
            if ok:
                thumb = self.cache / f"{cid}-thumbnail.jpg"
                cv2.imwrite(str(thumb), frame)
            cap.release()
            self.cameras[cid] = camera
        json_write(camera_path, camera_ids)
        from live_webcam import WebcamEngine
        self.webcam = WebcamEngine(self)
        # Keep persisted live evidence and the installed recorded sources.
        self.incidents = [e for e in self.incidents
                          if e.get("source_type") == "webcam" or (e.get("camera") in self.cameras and
                          e.get("filename") == self.cameras[e["camera"]]["filename"])]

    def catalog(self):
        self.webcam.expire()
        with self.lock:
            return {"cameras": [{k: v for k, v in c.items() if k != "path"}
                                for c in self.cameras.values()],
                    "capabilities": self.capabilities, "model_error": self.model_error,
                    "sample_fps": self.args.analysis_fps,
                    "weapon_conf": self.args.weapon_conf,
                    "incidents": list(self.incidents),
                    "uptime": round(time.monotonic() - self.started)}

    def fingerprint(self, camera):
        files = [camera["path"], Path(self.args.model), Path(self.args.weapon_model),
                 Path(self.args.pose_model), ROOT / "yolo26n-cls.pt"]
        parts = [str(ANALYSIS_VERSION), camera["id"], str(self.args.analysis_fps),
                 str(self.args.weapon_conf), self.args.tracker, str(self.args.imgsz)]
        for path in files:
            stat = path.stat()
            parts.extend((str(path.resolve()), str(stat.st_size), str(stat.st_mtime_ns)))
        tracker_path = Path(self.args.tracker)
        if tracker_path.is_file():
            parts.append(tracker_path.read_text(encoding="utf-8"))
        return hashlib.sha256("|".join(parts).encode()).hexdigest()

    def start(self):
        threading.Thread(target=self.analyze_all, daemon=True, name="video-analysis").start()

    def analyze_all(self):
        try:
            import torch
            from ultralytics import YOLO

            torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
            general = YOLO(self.args.model)
            weapon = YOLO(self.args.weapon_model)
            pose = YOLO(self.args.pose_model)
            weapon_classes = {int(i): weapon_kind(label) for i, label in weapon.names.items()
                              if weapon_kind(label)}
            self.capabilities = sorted(set(weapon_classes.values()))
            if not {"gun", "knife"}.issubset(self.capabilities):
                raise ValueError("Weapon model must include both gun/pistol and knife classes; "
                                 f"found {weapon.names}")
            print(f"Weapon classes: {weapon.names}; analyzing at {self.args.analysis_fps:g} FPS", flush=True)
            for camera in list(self.cameras.values()):
                if camera.get("source_type") == "webcam":
                    continue
                if self.stop.is_set():
                    break
                if camera["status"] == "error":
                    continue
                try:
                    self.analyze_camera(camera, general, weapon, weapon_classes, pose)
                except Exception as exc:
                    with self.lock:
                        camera.update(status="error", error=f"{type(exc).__name__}: {exc}")
                    print(f"{camera['id']} failed: {exc}", flush=True)
        except Exception as exc:
            with self.lock:
                self.model_error = f"{type(exc).__name__}: {exc}"
                for camera in list(self.cameras.values()):
                    if camera.get("source_type") == "webcam":
                        continue
                    if camera["status"] != "error":
                        camera.update(status="error", error=self.model_error)
            print(f"Analysis unavailable: {self.model_error}", flush=True)

    def analyze_camera(self, camera, general, weapon, weapon_classes, pose):
        import cv2

        from tracking_cleanup import consolidate
        with camera["path"].open("rb") as source:
            source_hash = hashlib.file_digest(source, "sha256").hexdigest()
        fingerprint = self.fingerprint(camera)
        cache_file = self.cache / f"{fingerprint}.json"
        if cache_file.exists():
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                if all((self.evidence / e["evidence_file"]).exists() for e in data["events"]) and all(
                    (self.evidence / f"person-{t['id']}.jpg").exists()
                    for t in data["tracks"] if t["class"] == "person"):
                    data = consolidate(data, self.evidence, self.person_ids, source_hash, ROOT / "yolo26n-cls.pt")
                    json_write(cache_file, data)
                    with self.lock:
                        self.reconcile_incidents(data)
                        self.analyses[camera["id"]] = data
                        camera.update(status="ready", progress=100, samples=len(data["frames"]),
                                      weapon_events=len(data["events"]), analysis_revision=fingerprint)
                    print(f"{camera['id']} ready (cached): {camera['filename']}", flush=True)
                    return
            except (ValueError, KeyError, OSError):
                pass
        with self.lock:
            camera.update(status="analyzing", progress=0)
        general.reset_callbacks()
        general.predictor = None  # Isolate tracker state; public person IDs remain persistent.
        with camera["path"].open("rb") as source:
            source_hash = hashlib.file_digest(source, "sha256").hexdigest()
        cap = cv2.VideoCapture(str(camera["path"]))
        # Sparse scenes can rebind by appearance after a person moves out of
        # view. Crowds retain a proximity gate to avoid swapping similar suits.
        import yaml
        tracker = self.args.tracker
        tracker_path = Path(tracker)
        if tracker_path.is_file():
            config = yaml.safe_load(tracker_path.read_text(encoding="utf-8"))
            if config.get("tracker_type") == "botsort" and config.get("with_reid"):
                ok, probe = cap.read()
                if ok:
                    count = len(general.predict(probe, classes=[0], imgsz=self.args.imgsz,
                                                conf=.25, verbose=False, device="cpu")[0].boxes)
                    config["proximity_thresh"] = .35
                config["model"] = str(ROOT / "yolo26n-cls.pt")
                tracker = str(self.cache / f"{camera['id']}-tracker.yaml")
                Path(tracker).write_text(yaml.safe_dump(config), encoding="utf-8")
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        sample_step = 1 / self.args.analysis_fps
        frames, events, tracks = [], [], {}
        active_weapons = {}
        previous_weapons = []
        pending_weapons = {}
        frame_number, next_sample = 0, 0.0
        selected_classes = [i for i, name in general.names.items()
                            if name in ("person", "backpack", "handbag", "suitcase")]
        try:
            while not self.stop.is_set():
                ok = cap.grab()
                if not ok:
                    break
                source_time = frame_number / camera["fps"]
                frame_number += 1
                if source_time + 1e-6 < next_sample:
                    continue
                ok, image = cap.retrieve()
                if not ok:
                    break
                next_sample += sample_step
                result = general.track(image, persist=True, tracker=tracker,
                                       classes=selected_classes, imgsz=self.args.imgsz, conf=0.15,
                                       verbose=False, device="cpu")[0]
                detections = []
                for box in result.boxes:
                    label = general.names[int(box.cls.item())]
                    coords = [round(v, 1) for v in box.xyxy[0].tolist()]
                    confidence = round(float(box.conf.item()), 4)
                    track_id = int(box.id.item()) if box.id is not None else None
                    public_id = self.person_ids.resolve(source_hash, track_id) if label == "person" and track_id is not None else track_id
                    color = clothing_color(image, coords) if label == "person" else None
                    detection = {"class": label, "conf": confidence, "box": coords,
                                 "id": public_id, "color": color, "weapon": False}
                    detections.append(detection)
                    if track_id is not None:
                        track = tracks.setdefault(track_id, {"id": public_id, "class": label,
                            "first_seen": source_time, "last_seen": source_time,
                            "color": color, "frames": 0, "conf": confidence, "snapshot_score": 0})
                        track.update(last_seen=source_time, frames=track["frames"]+1,
                                     color=color or track["color"], conf=confidence)
                        if label == "person":
                            left, top, right, bottom = map(int, coords)
                            h, w = image.shape[:2]
                            quality = confidence * math.sqrt(max(0, right-left)*max(0, bottom-top))
                            if left <= 2 or right >= w-2 or top <= 2 or bottom >= h-2:
                                quality *= .6
                            if quality > track["snapshot_score"]:
                                px, py = max(4, (right-left)//12), max(4, (bottom-top)//20)
                                crop = image[max(0, top-py):min(h, bottom+py), max(0, left-px):min(w, right+px)]
                                if crop.size:
                                    cv2.imwrite(str(self.evidence / f"person-{public_id}.jpg"), crop,
                                                [cv2.IMWRITE_JPEG_QUALITY, 92])
                                    track.update(snapshot_score=quality, snapshot_time=round(source_time, 4),
                                                 snapshot_url=f"/api/people/{public_id}/snapshot.jpg")
                people = [d for d in detections if d["class"] == "person"]
                weapon_dets = detect_weapons(weapon, image, people, weapon_classes, self.args.weapon_conf)
                weapon_dets = associate_hands(pose, weapon, image, weapon_dets, people,
                                             weapon_classes, self.args.weapon_conf,
                                             [d for t, d in previous_weapons if source_time-t <= .4])
                previous_weapons = [(t,d) for t,d in previous_weapons if source_time-t <= .4]
                previous_weapons.extend((source_time,d) for d in weapon_dets)
                strongest = {}
                for det in weapon_dets:
                    key = (det["class"], det.get("person_id"))
                    detections.append(det)
                    if key not in strongest or det["conf"] > strongest[key]["conf"]:
                        strongest[key] = det
                for key, det in strongest.items():
                    kind = det["class"]
                    active = active_weapons.get(key)
                    if active is None or source_time - active["last"] > 5.0:
                        pending = pending_weapons.get(key)
                        if pending is None or source_time - pending["last"] > .6 :
                            pending = {"time": source_time, "last": source_time,
                                       "det": dict(det), "image": image.copy(), "count": 1}
                            pending_weapons[key] = pending
                        else:
                            pending["last"] = source_time
                            pending["count"] += 1
                        # Require repeated observations of the same class and holder.
                        # Moving hands can shift the small box between samples.
                        if pending["count"] < (3 if kind == "knife" else 2):
                            continue
                        first = pending["det"]
                        eid = f"{fingerprint[:16]}-{kind}-{len(events)+1}"
                        evidence_file = f"{eid}.jpg"
                        annotated = pending["image"]
                        x1, y1, x2, y2 = map(int, first["box"])
                        cv2.rectangle(annotated, (x1, y1), (x2, y2), (80, 55, 245), 3)
                        cv2.putText(annotated, f"{kind.upper()} {first['conf']:.0%}",
                                    (max(5, x1), max(24, y1-8)), cv2.FONT_HERSHEY_SIMPLEX,
                                    .7, (80, 55, 245), 2)
                        cv2.imwrite(str(self.evidence / evidence_file), annotated)
                        event = {"id": eid, "camera": camera["id"], "filename": camera["filename"],
                                 "class": kind, "type": f"{kind.title()} detected", "severity": "CRITICAL",
                                 "time": round(pending["time"], 4), "end": round(source_time, 4),
                                 "conf": first["conf"], "box": first["box"], "person_id": first.get("person_id"), "evidence_file": evidence_file,
                                 "snapshot_url": f"/api/evidence/{eid}.jpg"}
                        events.append(event)
                        active_weapons[key] = {"last": source_time, "event": event}
                        pending_weapons.pop(key, None)
                    else:
                        active["last"] = source_time
                        active["event"]["end"] = round(source_time, 4)
                frames.append({"time": round(source_time, 4), "dets": detections})
                with self.lock:
                    camera.update(progress=min(99, round(source_time / camera["duration"] * 100)),
                                  samples=len(frames), weapon_events=len(events))
        finally:
            cap.release()
        if self.stop.is_set():
            return
        # Discard isolated, unconfirmed low-score candidates from playback.
        for frame in frames:
            frame["dets"] = [d for d in frame["dets"] if not d["weapon"] or any(
                e["class"] == d["class"] and e.get("person_id") == d.get("person_id")
                and e["time"] <= frame["time"] <= e["end"] + .0001
                for e in events)]
        stabilize_boxes(frames)
        for track in tracks.values():
            track.pop("snapshot_score", None)
        data = {"camera": camera["id"], "fingerprint": fingerprint,
                "sample_fps": self.args.analysis_fps, "frames": frames,
                "events": events, "tracks": list(tracks.values())}
        data = consolidate(data, self.evidence, self.person_ids, source_hash, ROOT / "yolo26n-cls.pt")
        json_write(cache_file, data)
        with self.lock:
            self.reconcile_incidents(data)
            self.analyses[camera["id"]] = data
            camera.update(status="ready", progress=100, samples=len(frames), weapon_events=len(events), analysis_revision=fingerprint)
        print(f"{camera['id']} ready: {camera['filename']}; {len(frames)} samples; "
              f"{len(events)} weapon appearances", flush=True)

    def reconcile_incidents(self, data):
        """Retain review history while archiving unsupported old model alerts."""
        updated = []
        for incident in self.incidents:
            if incident["camera"] != data["camera"]:
                updated.append(incident)
                continue
            candidates = [e for e in data["events"] if e["class"] == incident["class"] and
                          e["time"] <= incident.get("end", incident["time"]) + .35 and
                          incident["time"] <= e["end"] + .35 and (
                              e["id"] == incident["id"] or (
                              e["time"]-.35 <= incident["time"] <= e["end"]+.35 and (
                              box_iou(e.get("box", [0]*4), incident.get("box", [0]*4)) > .05 or
                              any(abs(frame["time"]-incident["time"]) < .5 and any(
                                  d.get("weapon") and d["class"] == e["class"] and
                                  d.get("person_id") == e.get("person_id") and
                                  box_iou(d["box"], incident.get("box", [0]*4)) > .05
                                  for d in frame["dets"]) for frame in data.get("frames", [])))))]
            event = max(candidates, key=lambda e: box_iou(e.get("box", [0]*4),
                        incident.get("box", [0]*4)), default=None)
            if event:
                incident = {**incident, **event}
            elif incident.get("status") != "Confirmed":
                incident = {**incident, "status": "False Positive",
                            "review_note": "Unsupported by current validated analysis"}
            existing = next((e for e in updated if e["id"] == incident["id"]), None)
            if existing is None:
                updated.append(incident)
        self.incidents = updated
        json_write(self.incident_path, self.incidents)

    def activate(self, cid, event_id):
        with self.lock:
            event = next((e for e in self.analyses.get(cid, {}).get("events", [])
                          if e["id"] == event_id), None)
            if event is None:
                raise ValueError("Unknown detection event")
            existing = next((e for e in self.incidents if e["id"] == event_id), None)
            if existing:
                return existing
            incident = {**event, "status": "New", "detected_at": datetime.now().isoformat(timespec="seconds")}
            self.incidents.insert(0, incident)
            json_write(self.incident_path, self.incidents)
            return incident


def make_video_handler(library):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body, ctype="application/json", headers=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            for key, value in (headers or {}).items():
                self.send_header(key, str(value))
            self.end_headers()
            if self.command != "HEAD":
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        def file(self, path, ctype=None):
            if not path.is_file():
                return self.reply(404, {"error": "File unavailable"})
            size = path.stat().st_size
            start, end = 0, size - 1
            range_header = self.headers.get("Range")
            if range_header:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
                if not match or not any(match.groups()):
                    return self.reply(416, b"", headers={"Content-Range": f"bytes */{size}"})
                a, b = match.groups()
                start = int(a) if a else max(0, size - int(b))
                end = min(size - 1, int(b)) if a and b else size - 1
                if start >= size or end < start:
                    return self.reply(416, b"", headers={"Content-Range": f"bytes */{size}"})
            self.send_response(206 if range_header else 200)
            self.send_header("Content-Type", ctype or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            if range_header:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if self.command == "HEAD":
                return
            try:
                with path.open("rb") as source:
                    source.seek(start)
                    remaining = end - start + 1
                    while remaining > 0:
                        chunk = source.read(min(256 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def gemini_chat(self, question):
            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                return self.reply(503, {"error": "Set GEMINI_API_KEY in the server environment or .env file to enable the assistant."})

            with library.lock:
                analyses = list(library.analyses.items())
                incidents = list(library.incidents)
            incidents_by_id = {incident.get("id"): incident for incident in incidents}

            records = []
            seen_people = set()
            seen_events = set()
            for camera_id, analysis in analyses:
                for track in analysis.get("tracks", []):
                    person_id = track.get("id")
                    if track.get("class") != "person" or not re.fullmatch(r"P-\d{4,}", str(person_id)) or person_id in seen_people:
                        continue
                    seen_people.add(person_id)
                    records.append({
                        "kind": "person", "id": person_id, "camera": camera_id,
                        "color": track.get("color"), "first_seen": track.get("first_seen"),
                        "last_seen": track.get("last_seen"), "snapshot_time": track.get("snapshot_time"),
                        "path": library.evidence / f"person-{person_id}.jpg",
                        "url": f"/api/people/{person_id}/snapshot.jpg",
                    })
                for event in analysis.get("events", []):
                    evidence_name = event.get("evidence_file")
                    if not evidence_name or not re.fullmatch(r"[a-f0-9]{16}-(gun|knife)-\d+\.jpg", evidence_name):
                        continue
                    event_id = event.get("id")
                    if event_id in seen_events:
                        continue
                    seen_events.add(event_id)
                    saved_incident = incidents_by_id.get(event_id, {})
                    records.append({
                        "kind": "incident", "id": event_id, "camera": camera_id,
                        "type": saved_incident.get("type", event.get("type")),
                        "severity": saved_incident.get("severity", event.get("severity", "CRITICAL")),
                        "status": saved_incident.get("status", "Detected"),
                        "time": event.get("time"), "person_id": event.get("person_id"),
                        "path": library.evidence / evidence_name,
                        "url": f"/api/evidence/{evidence_name}",
                    })
            for incident in incidents:
                evidence_name = incident.get("evidence_file")
                if not evidence_name or not re.fullmatch(r"[a-f0-9]{16}-(gun|knife)-\d+\.jpg", evidence_name):
                    continue
                if incident.get("id") in seen_events:
                    continue
                seen_events.add(incident.get("id"))
                records.append({
                    "kind": "incident", "id": incident.get("id"), "camera": incident.get("camera"),
                    "type": incident.get("type"), "severity": incident.get("severity"), "status": incident.get("status"),
                    "time": incident.get("time"), "person_id": incident.get("person_id"),
                    "path": library.evidence / evidence_name,
                    "url": f"/api/evidence/{evidence_name}",
                })

            people = [record for record in records if record["kind"] == "person"]
            events = [record for record in records if record["kind"] == "incident"]
            records = [group[index] for index in range(max(len(people), len(events)))
                       for group in (people, events) if index < len(group)]
            record_data = [{key: value for key, value in record.items() if key not in ("path", "url")} for record in records]
            prompt = (
                "Answer in the same language as the user's question. Use only the provided camera records and images; "
                "never guess a person's identity or details. Distinguish recorded metadata from visual observations, "
                "state when an image is unclear, and cite person IDs, camera IDs, and source times when relevant. "
                "Clothing colors are approximate automated metadata. Times are seconds from the recorded clip; "
                "no wall-clock recording time is available, so do not infer one. A detected weapon event is a model alert, not proof of intent.\n"
                f"User question: {question}\nCamera records (JSON): {json.dumps(record_data, ensure_ascii=False)}"
            )
            parts = [{"text": prompt}]
            attached = []
            for record in records:
                if len(attached) >= 12 or not record["path"].is_file():
                    continue
                try:
                    image = record["path"].read_bytes()
                except OSError:
                    continue
                if len(image) > 4 * 1024 * 1024:
                    continue
                label = f"{record['kind']} {record['id']} from {record['camera']}"
                parts.extend(({"text": f"Snapshot: {label}"}, {
                    "inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode("ascii")}
                }))
                attached.append({"kind": record["kind"], "id": record["id"], "camera": record["camera"], "url": record["url"]})

            model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent"
            payload = json.dumps({"contents": [{"role": "user", "parts": parts}]}).encode()
            request = Request(endpoint, data=payload, headers={
                "Content-Type": "application/json", "x-goog-api-key": api_key
            }, method="POST")
            try:
                with urlopen(request, timeout=45) as response:
                    response_body = response.read(1_000_001)
                if len(response_body) > 1_000_000:
                    raise ValueError("Gemini response exceeded the size limit")
                result = json.loads(response_body)
                answer = "".join(part.get("text", "") for part in result["candidates"][0]["content"]["parts"])
                if not answer:
                    raise ValueError("Gemini returned an empty response")
            except (HTTPError, URLError, TimeoutError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
                detail = getattr(exc, "reason", None) or str(exc)
                return self.reply(502, {"error": f"Gemini request failed: {detail}"})
            return self.reply(200, {"answer": answer, "images": attached})

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            url = urlparse(self.path)
            path = url.path
            if path in ("/", "/raqeeb.html"):
                return self.file(ROOT / "raqeeb.html", "text/html; charset=utf-8")
            if path == "/sentinelops-dashboard.html":
                return self.file(ROOT / "sentinelops-dashboard.html", "text/html; charset=utf-8")
            if path == "/app.js":
                return self.file(ROOT / "app.js", "text/javascript; charset=utf-8")
            if path in ("/ui.css", "/dashboard-ui.js", "/webcam.js", "/site-map-tracking.js", "/site-map-3d.js"):
                return self.file(ROOT / path[1:], "text/css; charset=utf-8" if path.endswith(".css") else "text/javascript; charset=utf-8")
            if path == "/site_map.json":
                return self.file(ROOT / "site_map.json", "application/json; charset=utf-8")
            if path in ("/api/cameras", "/api/state"):
                return self.reply(200, library.catalog())
            if path == "/api/incidents":
                return self.reply(200, library.catalog()["incidents"])
            if path.startswith("/api/evidence/"):
                name = path.rsplit("/", 1)[-1]
                if not re.fullmatch(r"[a-f0-9]{16}-(gun|knife)-\d+\.jpg", name):
                    return self.reply(404, {"error": "Evidence unavailable"})
                return self.file(library.evidence / name, "image/jpeg")
            person_match = re.fullmatch(r"/api/people/(P-\d{4,})/snapshot\.jpg", path)
            if person_match:
                return self.file(library.evidence / f"person-{person_match.group(1)}.jpg", "image/jpeg")
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[:2] == ["api", "cameras"]:
                cid, action = parts[2:]
                camera = library.cameras.get(cid)
                if camera is None:
                    return self.reply(404, {"error": "Unknown camera"})
                if action == "video":
                    if camera.get("source_type") == "webcam":
                        return self.reply(400, {"error": "Live webcams do not have recorded video playback"})
                    return self.file(camera["path"])
                if action == "thumbnail.jpg":
                    return self.file(library.cache / f"{cid}-thumbnail.jpg", "image/jpeg")
                if action == "analysis":
                    with library.lock:
                        analysis = library.analyses.get(cid)
                    return self.reply(200, analysis) if analysis else self.reply(202, {"status": camera["status"]})
                if action == "detections.csv":
                    with library.lock:
                        data = library.analyses.get(cid, {})
                    output = io.StringIO()
                    writer = csv.writer(output)
                    writer.writerow(["camera", "source_seconds", "track_id", "class", "confidence", "x1", "y1", "x2", "y2", "color"])
                    for frame in data.get("frames", []):
                        for det in frame["dets"]:
                            writer.writerow([cid, frame["time"], det["id"], det["class"], det["conf"], *det["box"], det["color"]])
                    return self.reply(200, output.getvalue(), "text/csv", {"Content-Disposition": f'attachment; filename="{cid}-detections.csv"'})
            return self.reply(404, {"error": "Not found"})

        def do_OPTIONS(self):
            return self.reply(204, b"", headers={"Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-Webcam-Session"})

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if self.path == "/api/webcam/frame":
                    from live_webcam import MAX_FRAME_BYTES
                    if length <= 0 or length > MAX_FRAME_BYTES:
                        return self.reply(413, {"error": "Invalid webcam frame size"})
                    if self.headers.get("Content-Type", "").split(";")[0] != "image/jpeg":
                        return self.reply(415, {"error": "Webcam frames must be JPEG images"})
                    return self.reply(200, library.webcam.process(
                        self.headers.get("X-Webcam-Session"), self.rfile.read(length)))
                if length <= 0 or length > 16384:
                    return self.reply(400, {"error": "Invalid request size"})
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    return self.reply(400, {"error": "Expected a JSON object"})
                if self.path == "/api/chat":
                    question = data.get("message")
                    if not isinstance(question, str) or not question.strip() or len(question) > 2000:
                        return self.reply(400, {"error": "Message must be between 1 and 2000 characters."})
                    return self.gemini_chat(question.strip())
                if self.path == "/api/webcam/start":
                    return self.reply(200, library.webcam.start())
                if self.path == "/api/webcam/stop":
                    return self.reply(200, library.webcam.stop(data.get("session")))
                if self.path == "/api/incidents":
                    return self.reply(200, library.activate(data["camera"], data["event_id"]))
                if self.path == "/api/incidents/status":
                    if data["status"] not in ("New", "Under Review", "Investigating", "Confirmed", "False Positive", "Resolved"):
                        raise ValueError("Invalid status")
                    with library.lock:
                        incident = next((e for e in library.incidents if e["id"] == data["id"]), None)
                        if incident is None:
                            return self.reply(404, {"error": "Unknown incident"})
                        incident["status"] = data["status"]
                        json_write(library.incident_path, library.incidents)
                    return self.reply(200, incident)
                return self.reply(404, {"error": "Not found"})
            except (ValueError, KeyError, TypeError) as exc:
                return self.reply(getattr(exc, "status", 400), {"error": str(exc)})
            except Exception as exc:
                print(f"Request failed: {type(exc).__name__}: {exc}", flush=True)
                return self.reply(503, {"error": "Webcam processing unavailable. Check the server log."})
    return Handler


def serve_video_cameras(args):
    if not math.isfinite(args.analysis_fps) or not 1 <= args.analysis_fps <= 30:
        raise ValueError("--analysis-fps must be between 1 and 30")
    if not 0 < args.weapon_conf <= 1:
        raise ValueError("--weapon-conf must be between 0 and 1")
    live_knife_conf = getattr(args, "live_knife_conf", WEBCAM_PROFILE["knife_conf"])
    if not math.isfinite(live_knife_conf) or not 0 < live_knife_conf <= 1:
        raise ValueError("--live-knife-conf must be between 0 and 1")
    live_weapons = {name.strip().lower() for name in
                    str(getattr(args, "live_weapons", "knife")).split(",") if name.strip()}
    if not live_weapons or not live_weapons.issubset({"gun", "knife"}):
        raise ValueError("--live-weapons must contain gun, knife, or both")
    library = CameraLibrary(args)
    server = ThreadingHTTPServer((args.host, args.port), make_video_handler(library))
    server.daemon_threads = True
    library.start()
    print(f"Raqeeb: http://{args.host}:{args.port} — {len(library.cameras)} recorded cameras", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        library.stop.set()
        server.shutdown()
        server.server_close()
