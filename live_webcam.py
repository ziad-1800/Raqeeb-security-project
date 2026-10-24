"""On-demand browser webcam inference using the recorded-camera recognition pipeline."""
import base64
import copy
import json
import math
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

CAMERA_ID = "WEB-01"
MAX_FRAME_BYTES = 2 * 1024 * 1024


def unique_people(boxes):
    """Suppress competing detections of the same body before assigning public IDs."""
    from video_cameras import box_iou
    kept=[]
    for box in sorted(boxes,key=lambda b:-b["conf"]):
        if not any(box_iou(box["box"],old["box"])>.65 for old in kept):
            kept.append(box)
    return kept


def _scale_detection_boxes(detections, scale_x, scale_y):
    for det in {id(det): det for det in detections}.values():
        x1, y1, x2, y2 = det["box"]
        det["box"] = [round(x1*scale_x, 1), round(y1*scale_y, 1),
                      round(x2*scale_x, 1), round(y2*scale_y, 1)]


class WebcamError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class LiveConfirmation:
    """Confirm distinct analyzed frames, with a bounded window suitable for CPU inference."""
    def __init__(self, window=5.0, episode_gap=10.0):
        self.window = window
        self.episode_gap = episode_gap
        self.pending = {}
        self.active = {}

    def update(self, detections, timestamp):
        strongest = {}
        for det in detections:
            if det["class"] not in ("gun", "knife") or not det.get("person_id"):
                continue
            key = (det["class"], det["person_id"])
            if key not in strongest or strongest[key]["conf"] < det["conf"]:
                strongest[key] = det
        confirmed, visible = [], []
        for key, pending in list(self.pending.items()):
            pending["misses"] = 0 if key in strongest else pending["misses"] + 1
            if timestamp-pending["last"] > self.window or pending["misses"] >= 2:
                self.pending.pop(key)
        for key, det in strongest.items():
            old = self.active.get(key)
            if old and timestamp-old["last"] <= self.episode_gap:
                old["last"] = timestamp
                visible.append(det)
                continue
            pending = self.pending.setdefault(key, {"first": timestamp, "last": timestamp,
                                                   "count": 0, "misses": 0})
            # Duplicate boxes in one input frame count as one observation.
            pending["count"] += 1
            pending["last"] = timestamp
            if pending["count"] < (3 if key[0] == "knife" else 2):
                continue
            self.active[key] = {"last": timestamp}
            confirmed.append({"det": det, "first_seen": pending["first"]})
            visible.append(det)
            self.pending.pop(key)
        return confirmed, visible


class WebcamEngine:
    """One token-owned live session. No camera access occurs on the server."""
    def __init__(self, library):
        self.library = library
        self.lock = threading.RLock()
        self.processing = threading.Lock()
        self.token = None
        self.last_seen = 0
        self.models = None
        self.model_session = None
        self.tracker = None
        self.webcam_profile = None
        self.active_profile = None
        self.path = library.runtime / "webcam.json"
        self.data = {"camera": CAMERA_ID, "source_type": "webcam", "fingerprint": "",
                     "sample_fps": 1, "frames": [], "events": [], "tracks": []}
        if self.path.exists():
            try:
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                self.data.update(saved)
                self.publish_camera("paused")
            except (ValueError, KeyError, OSError):
                pass

    def publish_camera(self, status):
        with self.library.lock:
            self.library.cameras[CAMERA_ID] = {
                "id": CAMERA_ID, "source_type": "webcam", "name": "Live webcam",
                "filename": "Live webcam", "status": status, "error": None,
                "fps": self.data.get("inference_fps", 0), "duration": self.data.get("elapsed", 0),
                "width": self.data.get("width", 1280), "height": self.data.get("height", 720),
                "progress": 100 if status == "live" else 0,
                "samples": self.data.get("samples", 0), "weapon_events": len(self.data["events"]),
                "analysis_revision": self.data["fingerprint"], "video_url": "",
                "analysis_url": f"/api/cameras/{CAMERA_ID}/analysis",
                "thumbnail_url": f"/api/cameras/{CAMERA_ID}/thumbnail.jpg"}
            self.library.analyses[CAMERA_ID] = self.data

    def expire(self):
        with self.lock:
            if self.token and time.monotonic()-self.last_seen > 30:
                self.token = None
                self.publish_camera("paused")

    def start(self):
        self.expire()
        with self.lock:
            if self.token:
                raise WebcamError("A webcam session is already active. Stop it in its owning tab first.", 409)
            if self.processing.locked():
                raise WebcamError("The previous webcam frame is finishing. Try again shortly.", 409)
            self.token = secrets.token_urlsafe(32)
            self.session = secrets.token_hex(16)
            self.started = self.last_seen = time.monotonic()
            self.confirmation = LiveConfirmation()
            self.previous = []
            self.tracks = {}
            self.episodes = {}
            self.counter = 0
            # Retain past person snapshots and event provenance across sessions.
            self.historical_tracks = list(self.data["tracks"])
            self.data = {"camera": CAMERA_ID, "source_type": "webcam", "fingerprint": self.session,
                         "sample_fps": 1, "frames": [], "events": list(self.data["events"])[-500:],
                         "tracks": self.historical_tracks, "samples": 0}
            self.publish_camera("starting")
            return {"session": self.token, "camera": CAMERA_ID}

    def check(self, token):
        if not token or not self.token or not secrets.compare_digest(token, self.token):
            raise WebcamError("Webcam session ended or belongs to another tab.", 403)

    def stop(self, token):
        with self.lock:
            self.check(token)
            self.token = None
            self.publish_camera("paused")
            return {"status": "stopped"}

    def load_models(self):
        if self.models is not None:
            return self.models
        from ultralytics import YOLO
        from video_cameras import KnifeAugmentedModel, ROOT, WEBCAM_PROFILE, weapon_kind
        import yaml
        args = self.library.args
        general, weapon, pose = YOLO(args.model), YOLO(args.weapon_model), YOLO(args.pose_model)
        wanted = {name.strip().lower() for name in getattr(args, "live_weapons", "knife").split(",") if name.strip()}
        if not wanted or not wanted.issubset({"gun", "knife"}):
            raise WebcamError("--live-weapons must contain gun, knife, or both.", 400)
        classes = {int(i): kind for i, name in weapon.names.items()
                   if (kind := weapon_kind(name)) in wanted}
        if not classes:
            raise WebcamError(f"The weapon model has no classes matching: {', '.join(sorted(wanted))}.", 503)
        knife_class = next((class_id for class_id, kind in classes.items() if kind == "knife"), None)
        knife_path = Path(getattr(args, "knife_model", "") or "")
        if knife_class is not None and knife_path.is_file():
            weapon = KnifeAugmentedModel(weapon, YOLO(str(knife_path)), knife_class)
        with open(args.tracker, encoding="utf-8") as source:
            config = yaml.safe_load(source) or {}
        config.update(proximity_thresh=.35, model=str(ROOT / "yolo26n-cls.pt"),
                      with_reid=False, gmc_method="none", track_buffer=30)
        self.tracker = str(self.library.cache / "webcam-tracker.yaml")
        with open(self.tracker, "w", encoding="utf-8") as target:
            yaml.safe_dump(config, target)
        self.webcam_profile = {
            **WEBCAM_PROFILE,
            "knife_conf": getattr(args, "live_knife_conf", WEBCAM_PROFILE["knife_conf"]),
        }
        self.active_profile = self.webcam_profile
        self.models = general, weapon, pose, classes
        self.model_session = None
        return self.models

    def process(self, token, payload):
        with self.lock:
            self.check(token)
            if not self.processing.acquire(blocking=False):
                raise WebcamError("Webcam inference is busy; send only one frame at a time.", 429)
            self.last_seen = time.monotonic()
            session = self.session
        try:
            import cv2
            import numpy as np
            from video_cameras import (
                CCTV_PROFILE, KnifeAugmentedModel, SIZE_KEYS, WEBCAM_PROFILE,
                associate_hands, clothing_color, detect_weapons, json_write,
            )
            if len(payload) > MAX_FRAME_BYTES:
                raise WebcamError("Webcam frame is too large.", 413)
            image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None or image.shape[0] < 32 or image.shape[1] < 32:
                raise WebcamError("Expected a valid JPEG webcam frame of at least 32 by 32 pixels.")
            if image.shape[0]*image.shape[1] > 16_000_000:
                raise WebcamError("Webcam frame dimensions are too large.", 413)
            display_height, display_width = image.shape[:2]
            scale = min(1, 640/max(image.shape[:2]))
            analysis_image = image
            if scale < 1:
                analysis_image = cv2.resize(
                    image, (round(display_width*scale), round(display_height*scale)))
            general, weapon, pose, classes = self.load_models()
            if self.model_session != session:
                general.reset_callbacks()
                general.predictor = None
                self.model_session = session
            timestamp = time.monotonic()-self.started
            started = time.monotonic()
            profile = self.webcam_profile or WEBCAM_PROFILE
            result = general.track(analysis_image, persist=True, tracker=self.tracker, classes=[0],
                                   conf=.15, imgsz=profile["track_size"], verbose=False, device="cpu")[0]
            boxes = []
            for box in result.boxes:
                raw_id = int(box.id.item()) if box.id is not None else None
                if raw_id is None:
                    continue
                coords = [round(v, 1) for v in box.xyxy[0].tolist()]
                boxes.append({"raw_id":raw_id,"box":coords,"conf":round(float(box.conf.item()),4)})
            people=[]
            for box in unique_people(boxes):
                pid = self.library.person_ids.resolve("webcam:"+session, box["raw_id"])
                coords=box["box"]
                det = {"id": pid, "class": "person", "conf": box["conf"],
                       "box": coords, "color": clothing_color(analysis_image, coords), "weapon": False}
                people.append(det)
            if len(people) > profile.get("max_people", len(people)):
                profile = {**CCTV_PROFILE, **{key: value for key, value in profile.items() if key in SIZE_KEYS}}
            self.active_profile = profile
            rejected = []
            candidates = detect_weapons(weapon, analysis_image, people, classes, self.library.args.weapon_conf,
                                        profile, rejected)
            prior = [d for t, d in self.previous if timestamp-t <= 5]
            candidates = associate_hands(pose, weapon, analysis_image, candidates, people, classes,
                                         self.library.args.weapon_conf, prior, profile, rejected)
            self.previous = [(timestamp, copy.deepcopy(d)) for d in candidates]
            confirmed, visible = self.confirmation.update(candidates, timestamp)
            _scale_detection_boxes(
                [*people, *visible],
                display_width/analysis_image.shape[1],
                display_height/analysis_image.shape[0],
            )
            if isinstance(weapon, KnifeAugmentedModel):
                best_knife = weapon.best_knife
                weapon.best_knife = 0.0
                if best_knife >= .1 and time.monotonic() - getattr(self, "last_score_log", 0) >= 1:
                    print(
                        f"WEB-01 {timestamp:6.1f}s best knife score {best_knife:.0%} "
                        f"(needs {profile['knife_conf']:.0%})",
                        flush=True,
                    )
                    self.last_score_log = time.monotonic()
            for kind, confidence, reason in sorted(rejected, key=lambda item: -item[1])[:3]:
                print(f"WEB-01 {timestamp:6.1f}s {kind} {confidence:.0%} ignored: {reason}", flush=True)
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            with self.lock:
                self.check(token)  # Stop invalidates an in-flight result before publication.
                height, width = display_height, display_width
                for det in people:
                    pid = det["id"]
                    track = self.tracks.setdefault(pid, {"id": pid, "class": "person", "source_type": "webcam",
                        "session": session, "first_seen": timestamp, "first_seen_at": now, "frames": 0,
                        "snapshot_score": 0})
                    track.update(last_seen=timestamp, last_seen_at=now, frames=track["frames"]+1,
                                 color=det["color"], conf=det["conf"])
                    x1,y1,x2,y2 = map(int,det["box"])
                    quality = det["conf"]*math.sqrt(max(0,x2-x1)*max(0,y2-y1))
                    if quality > track["snapshot_score"]:
                        crop=image[max(0,y1-4):min(height,y2+4),max(0,x1-4):min(width,x2+4)]
                        if crop.size:
                            cv2.imwrite(str(self.library.evidence / f"person-{pid}.jpg"),crop)
                            track.update(snapshot_score=quality, snapshot_time=timestamp,
                                         snapshot_url=f"/api/people/{pid}/snapshot.jpg")
                new_events = []
                for item in confirmed:
                    det = item["det"]
                    self.counter += 1
                    kind = det["class"]
                    eid = f"{session[:16]}-{kind}-{self.counter}"
                    evidence_file = eid+".jpg"
                    evidence = image.copy()
                    x1,y1,x2,y2 = map(int,det["box"])
                    cv2.rectangle(evidence,(x1,y1),(x2,y2),(80,55,245),3)
                    cv2.putText(evidence,f"{kind.upper()} {det['conf']:.0%}",(max(5,x1),max(24,y1-8)),
                                cv2.FONT_HERSHEY_SIMPLEX,.7,(80,55,245),2)
                    cv2.imwrite(str(self.library.evidence/evidence_file),evidence)
                    event={"id":eid,"camera":CAMERA_ID,"filename":"Live webcam","source_type":"webcam",
                           "session":session,"class":kind,"type":f"{kind.title()} detected","severity":"CRITICAL",
                           "time":round(timestamp,4),"first_seen":round(item["first_seen"],4),"end":round(timestamp,4),
                           "conf":det["conf"],"box":det["box"],"person_id":det["person_id"],
                           "evidence_file":evidence_file,"snapshot_url":f"/api/evidence/{evidence_file}"}
                    self.data["events"].append(event)
                    self.episodes[(kind,det["person_id"])]=event
                    new_events.append(event)
                for det in visible:
                    episode=self.episodes.get((det["class"],det["person_id"]))
                    if episode: episode["end"]=round(timestamp,4)
                elapsed = max(.001,time.monotonic()-started)
                dets=people+visible
                self.data["frames"]=(self.data["frames"]+[{"time":round(timestamp,4),"dets":dets}])[-120:]
                self.data["tracks"]=self.historical_tracks+[{k:v for k,v in t.items() if k!='snapshot_score'} for t in self.tracks.values()]
                self.data.update(width=width,height=height,elapsed=timestamp,samples=self.data["samples"]+1,
                                 inference_fps=round(1/elapsed,2),sample_fps=1/elapsed)
                self.data["events"]=self.data["events"][-500:]
                cv2.imwrite(str(self.library.cache/f"{CAMERA_ID}-thumbnail.jpg"),image)
                self.publish_camera("live")
                # Confirmed live events persist even if the operator is viewing another screen.
                for event in new_events:
                    self.library.activate(CAMERA_ID,event["id"])
                json_write(self.path,self.data)
                ok,jpeg=cv2.imencode('.jpg',image,[cv2.IMWRITE_JPEG_QUALITY,82])
                if not ok: raise WebcamError("Could not encode the analyzed frame.",503)
                return {"camera":CAMERA_ID,"time":round(timestamp,4),"captured_at":now,
                        "width":width,"height":height,"dets":dets,"events":copy.deepcopy(new_events),
                        "tracks":copy.deepcopy(self.data["tracks"]),"samples":self.data["samples"],
                        "inference_ms":round(elapsed*1000),"inference_fps":self.data["inference_fps"],
                        "frame":"data:image/jpeg;base64,"+base64.b64encode(jpeg).decode()}
        finally:
            self.processing.release()
