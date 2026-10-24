import csv, json, time
from datetime import datetime
from ultralytics import YOLO

model = YOLO("yolo26n.pt")
names = model.names

entities = {}   # track_id -> summary of that object

with open("detections.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["timestamp", "frame", "track_id", "class", "conf", "x1", "y1", "x2", "y2"])

    frame_idx = 0
    try:
        for r in model.track(source=0, persist=True,
                             tracker="tracktrac.yaml", show=True, stream=True):
            frame_idx += 1
            boxes = r.boxes
            if boxes is None or boxes.id is None:   # no tracked objects this frame
                continue

            now = datetime.now().isoformat(timespec="seconds")
            ids = boxes.id.int().tolist()
            clss = boxes.cls.int().tolist()
            confs = boxes.conf.tolist()
            xyxy = boxes.xyxy.tolist()

            for tid, c, cf, b in zip(ids, clss, confs, xyxy):
                label = names[c]
                writer.writerow([now, frame_idx, tid, label, round(cf, 3),
                                 *[round(v, 1) for v in b]])

                if tid not in entities:
                    entities[tid] = {"class": label, "first_seen": now,
                                     "last_seen": now, "frames": 0}
                entities[tid]["last_seen"] = now
                entities[tid]["frames"] += 1
    except KeyboardInterrupt:
        pass
    finally:
        with open("entities.json", "w") as jf:
            json.dump(entities, jf, indent=2)
        print(f"Saved {len(entities)} unique objects")