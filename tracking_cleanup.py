"""Consolidate well-supported track fragments without merging simultaneous people."""
import collections
import math
import shutil

VERSION = 3


def similarity(a, b):
    denominator = math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
    return sum(x*y for x, y in zip(a, b))/max(denominator, 1e-9)


def consolidate(data, evidence, registry, source_hash, encoder_path=None, features=None):
    with registry.lock:
        return _consolidate(data, evidence, registry, source_hash, encoder_path, features)


def _consolidate(data, evidence, registry, source_hash, encoder_path=None, features=None):
    if data.get("consolidation_version") == VERSION:
        return data
    observations = collections.defaultdict(list)
    for frame in data["frames"]:
        for det in frame["dets"]:
            if det["class"] == "person" and det["id"]:
                observations[det["id"]].append((frame["time"], det["box"], det["conf"]))
    records = {t["id"]: t for t in data["tracks"] if t["class"] == "person"}
    if features is None:
        features = {}
        if encoder_path and records:
            import cv2
            from ultralytics import YOLO
            ids, crops = [], []
            for pid in records:
                crop = cv2.imread(str(evidence / f"person-{pid}.jpg"))
                if crop is not None:
                    ids.append(pid)
                    crops.append(crop)
            encoder = YOLO(str(encoder_path))
            for start in range(0, len(crops), 8):
                vectors = encoder.embed(crops[start:start+8], imgsz=224, verbose=False, device="cpu")
                features.update({pid: vector.flatten().cpu().tolist()
                                 for pid, vector in zip(ids[start:start+8], vectors)})
    aliases = {pid: pid for pid in observations}

    def canonical(pid):
        while aliases.get(pid, pid) != pid:
            pid = aliases[pid]
        return pid

    ordered = sorted(observations, key=lambda pid: observations[pid][0][0])
    for later_id in ordered:
        later = observations[later_id]
        if len(later) < 4 or later_id not in features:
            continue
        candidates = []
        for earlier_id in ordered:
            earlier = observations[earlier_id]
            if earlier_id == later_id or len(earlier) < 4 or earlier_id not in features:
                continue
            gap = later[0][0] - earlier[-1][0]
            if not 0 < gap <= 2:
                continue  # Never combine people visible at the same time.
            group = [p for p in observations if canonical(p) == canonical(earlier_id)]
            if any(observations[p][0][0] <= later[-1][0] and
                   later[0][0] <= observations[p][-1][0] for p in group):
                continue
            appearance = similarity(features[earlier_id], features[later_id])
            if appearance < .84:
                continue
            a, b = earlier[-1][1], later[0][1]
            height = ((a[3]-a[1])+(b[3]-b[1]))/2
            partial = a[0] <= 2 or b[0] <= 2
            ratio = (a[3]-a[1])/max(1, b[3]-b[1])
            if not ((.3 <= ratio <= 3) if partial else (.6 <= ratio <= 1.7)):
                continue
            ax, ay = (a[0]+a[2])/2, (a[1]+a[3])/2
            direct = math.hypot(ax-(b[0]+b[2])/2, ay-(b[1]+b[3])/2)/max(height, 1)
            if len(earlier) > 2:
                previous = earlier[-3]
                dt = max(.05, earlier[-1][0]-previous[0])
                vx = (ax-(previous[1][0]+previous[1][2])/2)/dt
                vy = (ay-(previous[1][1]+previous[1][3])/2)/dt
                ax += vx*min(gap, .5)
                ay += vy*min(gap, .5)
            distance = math.hypot(ax-(b[0]+b[2])/2, ay-(b[1]+b[3])/2)/max(height, 1)
            distance = min(distance, direct) if partial else distance
            if distance > .55 + .65*gap:
                continue
            candidates.append((appearance-.12*distance, earlier_id))
        candidates.sort(reverse=True)
        if candidates and (len(candidates) == 1 or candidates[0][0]-candidates[1][0] > .04):
            aliases[later_id] = canonical(candidates[0][1])

    weapon_people = {canonical(e["person_id"]) for e in data["events"] if e.get("person_id")}
    members = collections.defaultdict(list)
    for pid in observations:
        members[canonical(pid)].append(pid)
    keep = {pid for pid, group in members.items()
            if sum(len(observations[m]) for m in group) >= 4 or pid in weapon_people}
    for frame in data["frames"]:
        unique, others = {}, []
        for det in frame["dets"]:
            if det["class"] == "person":
                det["id"] = canonical(det["id"])
                if det["id"] in keep and (det["id"] not in unique or det["conf"] > unique[det["id"]]["conf"]):
                    unique[det["id"]] = det
            else:
                if det.get("person_id"):
                    det["person_id"] = canonical(det["person_id"])
                others.append(det)
        frame["dets"] = list(unique.values()) + others
    cleaned = [t for t in data["tracks"] if t["class"] != "person"]
    for pid, group in members.items():
        if pid not in keep:
            continue
        visible = [entry for m in group for entry in observations[m]]
        record = dict(records[pid])
        record.update(first_seen=min(v[0] for v in visible), last_seen=max(v[0] for v in visible),
                      frames=len({v[0] for v in visible}), conf=round(sum(v[2] for v in visible)/len(visible), 4))
        best = max(group, key=lambda m: sum(v[2] for v in observations[m])/len(observations[m]))
        if best != pid and (evidence / f"person-{best}.jpg").exists():
            shutil.copyfile(evidence / f"person-{best}.jpg", evidence / f"person-{pid}.jpg")
            record["snapshot_time"] = records[best].get("snapshot_time", record.get("snapshot_time"))
        record["snapshot_url"] = f"/api/people/{pid}/snapshot.jpg"
        cleaned.append(record)
    data["tracks"] = cleaned
    retired = {}
    for key, pid in registry.data.items():
        if not key.startswith("__retired__:") and pid in aliases:
            target = canonical(pid)
            if target != pid:
                retired["__retired__:"+pid] = pid
            registry.data[key] = target
    registry.data.update(retired)
    from video_cameras import json_write
    json_write(registry.path, registry.data)
    events = []
    for event in sorted(data["events"], key=lambda e: e["time"]):
        event["person_id"] = canonical(event.get("person_id"))
        previous = next((e for e in reversed(events) if e["class"] == event["class"] and
                         e.get("person_id") == event.get("person_id") and event["time"]-e["end"] <= 5), None)
        if previous:
            previous["end"] = max(previous["end"], event["end"])
            continue
        number = 1+sum(e["class"] == event["class"] for e in events)
        eid = f"{source_hash[:16]}-{event['class']}-{number}"
        filename = f"{eid}.jpg"
        if event["evidence_file"] != filename:
            shutil.copyfile(evidence / event["evidence_file"], evidence / filename)
        event.update(id=eid, evidence_file=filename, snapshot_url=f"/api/evidence/{filename}")
        events.append(event)
    data["events"] = events
    data["source_hash"] = source_hash
    data["consolidation_version"] = VERSION
    return data
