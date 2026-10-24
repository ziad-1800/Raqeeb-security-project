# Raqeeb

Security presentation dashboard with recorded camera sources and actual local AI recognition.

## Start the presentation (Windows)

Double-click `start_raqeeb.cmd`, or run:

```powershell
.venv\Scripts\python.exe server.py
```

Open **http://localhost:8000**. Live Monitoring is the starting page. Wait for the camera tiles to show **AI READY**, then click **Start monitoring**. Use **Restart footage** to replay all clips and rearm presentation alerts. The first click also enables the alert sound; browser audio restrictions apply.

For a fresh installation:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe server.py
```

## Camera sources

The server discovers video files recursively in `examples/` and `samples/`. Each video becomes a camera with a persistent number. Deleting a source does not renumber the other cameras. `runtime/cameras.json` retains the assignments; `camera_sources.json` seeds CAM-01 and CAM-03 consistently on fresh installations. Add or replace videos and restart the server to refresh the list. Alternatively:

```powershell
.venv\Scripts\python.exe server.py --videos "Y:\your-videos"
```

Sources are labeled **RECORDED SOURCE**. There are no generated camera feeds, scripted incidents, random demo timers, simulated network logs, or fabricated analytics. Videos play muted and loop at their native frame rate. Other dashboard pages use these same camera sources, person tracks, and saved incidents.

## Recognition and alerts

- `yolo26n.pt` detects people and bags at 1280-pixel inference resolution. BoT-SORT uses motion and appearance features, with a longer track buffer, to retain person tracks through brief misses and occlusions.
- `weapon.pt` includes Pistol and Knife classes. These map to gun and knife critical alerts; Smartphone/Purse/Bill/Card classes do not trigger weapon alerts.
- Actual frames are analyzed locally at 12 samples per source second. Weapon detection uses a 1280-pixel full-frame pass, overlapping 960-pixel tiles, and enlarged person/hand regions in sparse scenes. All gun alerts require repeated observations of the same tracked holder; knife alerts require at least three observations and a higher score. Pose wrists and object size reject background objects and whole-body class confusion. Results are cached under `runtime/analysis/` to keep multi-camera playback smooth. Boxes and alerts follow the player's source timestamp, including after seeking.
- Person IDs such as `P-0001` are globally unique and stored in `runtime/person_ids.json`, independently of camera numbering. The same analyzed track keeps its ID across frames, replay, and server restarts. Appearance-assisted tracking reduces ID changes; these are anonymous tracking IDs, not verified identities or automatic cross-camera identity matches.
- `yolo26n-pose.pt` verifies visible wrists and assists holder association. Adjacent ambiguous hand overlaps retain a supported holder.
- People Tracking shows actual person crops with download and footage-review actions. Conservative appearance and motion matching consolidate nonoverlapping track fragments; simultaneously visible people stay separate. Boxes are smoothed and interpolated during playback.
- Weapon alerts include the associated anonymous person ID. Critical/high/medium/low severities have prominent distinct colors throughout notifications and review.
- A weapon box that substantially duplicates an independently detected whole person is rejected as a class confusion. A continuous weapon appearance produces one incident rather than a popup every frame.
- Alerts include the camera, source timestamp, confidence, and an actual annotated source-frame snapshot. Incidents and their review status persist in `runtime/incidents.json`; snapshots live in `runtime/evidence/`.
- Unsupported alerts from older analyses are archived as False Positive, preserving review history. They are excluded from live activity and notifications.
- Each weapon appearance alerts once per browser session. **Restart footage** rearms popups without duplicating saved incidents. The footage continues playing while an operator reviews an alert.
- The AI Camera Assistant answers questions about clothing, people, snapshots, incident priority, source times, and detected weapon types using Gemini. Answers link the related person snapshots and incident evidence when available. Clothing colors are approximate metadata; times refer to seconds in a recorded clip, not wall-clock time.
- To enable the assistant, copy `.env.example` to `.env` and set `GEMINI_API_KEY`; `GEMINI_MODEL` is optional. An existing server environment variable takes precedence, and `.env` is ignored by Git. The key remains on the server. Questions send camera-track/incident metadata and up to 12 snapshots to Google's Gemini API, so only enable this for footage you are permitted to share with Google. Without a key, the assistant reports that it is not configured.

Model scores are not guarantees. A small or briefly visible weapon may be missed, and false positives remain possible. Analysis samples are not every video frame. Tune sampling and confidence when needed:

```powershell
.venv\Scripts\python.exe server.py --analysis-fps 12 --weapon-conf 0.35 --imgsz 1280
```

Changing the models, source files, tracker, analysis resolution, sample rate, or threshold invalidates the corresponding analysis cache automatically.

## Files

| File | Purpose |
| --- | --- |
| `raqeeb.html` | Accessible dashboard shell and centered search |
| `ui.css` | Shared responsive dark/light design system |
| `dashboard-ui.js` | Navigation, metrics, charts, directories, and review layouts |
| `app.js` | Camera playback, synchronized boxes/alerts, search, and incident review |
| `server.py` | Server command-line entry point |
| `video_cameras.py` | Video discovery, YOLO analysis, evidence, HTTP range streaming, and persistence |
| `.env.example` | Optional Gemini assistant configuration template |
| `start_raqeeb.cmd` | Windows launch shortcut |
| `tracking_cleanup.py` | Fragment consolidation, unique track rows, and stable incident identifiers |
| `camera_sources.json` | Portable initial camera assignments |
| `yolo26n-pose.pt` | Wrist and holder validation |
| `knife.pt` | Dedicated live close-range knife detector |
| `person_tracker.yaml` | Appearance-assisted person tracking settings |
| `yolo26n-cls.pt` | Lightweight appearance encoder used by the tracker |
| `raqeeb.py` | Separate legacy webcam tracking script; not used by this dashboard |
| `samples/`, `examples/` | Input video folders (either may be absent) |
| `tests/test_video_cameras.py` | Incident provenance, persistence, source discovery, and HTTP tests |

The older root/sample CSV and JSON recordings are not loaded by the dashboard.

## Checks

```powershell
python -m unittest discover -s tests -v
node --check app.js
python -m py_compile server.py video_cameras.py tracking_cleanup.py
```

Detection uses the [Ultralytics prediction API](https://docs.ultralytics.com/modes/predict/); appearance-assisted association uses [BoT-SORT tracking](https://docs.ultralytics.com/modes/track/).

The supplied videos can also be checked in Chrome with Node.js 24+. Run the server in a separate terminal with an isolated runtime (the browser check creates test incidents):

```powershell
.venv\Scripts\python.exe server.py --port 8001 --runtime-dir runtime/validation
node tests/browser_monitoring.mjs
```

The browser check covers decoded playback, person screenshots, unique track rows, both CAM-03 gun holders, critical alerts and evidence, acknowledgement, replay deduplication, navigation, RTL, themes, search, and mobile overflow. Screenshots are saved in the system temporary directory under `raqeeb-browser-qa`. `CHROME_PATH`, `RAQEEB_QA_URL`, and `RAQEEB_QA_OUTPUT` can override the defaults.

## Professional dashboard UI

The console uses grouped navigation, a centered search field, consistent line icons, soft panel corners, and a dark palette inspired by the supplied dashboard reference. Every screen also supports a light theme and Arabic RTL layout.

Overview and Analytics show real person-track distribution, camera readiness, observed incident severity, per-camera incident counts, and sampled person counts over source time. Charts never invent activity for unobserved footage. People Tracking includes a paginated snapshot directory; alerts and incident history retain their existing review and evidence behavior. Camera playback, AI inference, tracking, IDs, weapon confirmation, and incident persistence are unchanged by this redesign.

The browser check captures each screen and verifies chart totals, all-screen mobile layout, Arabic mobile layout, and the existing camera/alert workflow. UI styling is in `ui.css`; reusable presentation components are in `dashboard-ui.js`.

## Live Webcam

Open **Live Webcam** in the sidebar, choose a camera, and click **Start webcam**. Allow the browser's camera permission prompt. The microphone is never requested. Use **Stop webcam** to release the device; closing the page also releases it. Browser camera access requires `localhost` or HTTPS. Recorded CAM-01 and CAM-03 remain available in Live Monitoring.

WEB-01 sends one current JPEG frame at a time to the local backend. Frames are sent and displayed at up to 960 pixels on the long edge. Person tracking and pose inference use a 416-pixel profile; dedicated close-range knife inference remains at 640 pixels. The webcam skips repeated hand-crop weapon inference while retaining wrist-based holder validation, and tracks without the recorded-camera appearance re-identification and camera-motion passes. These webcam optimizations do not change recorded-camera analysis. The close-range profile skips distant-CCTV tile passes. A dedicated `knife.pt` model is used when available. Knife alerts need three observations; the default knife threshold is 50%. The default live alert selection is knives only; pass `--live-weapons gun,knife` to include guns, or use `--live-knife-conf` to tune the threshold. This selection is independent of the recorded-camera weapon settings. Views with more than three people fall back to recorded-camera validation thresholds. The live confirmation window allows CPU processing intervals, and a continuous appearance produces one incident. Inference is not the native preview frame rate; its rate depends on the local hardware.

The **Live preview** shows unprocessed camera video. The **AI detection view** displays the exact analyzed frame with synchronized boxes, measured inference rate, and frame age. The next frame is captured after the current request completes, so frames do not build up in a queue. Live recognition continues when navigating to another dashboard screen until Stop is pressed.

WEB-01 uses global anonymous person IDs independent of camera numbering. Its tracks, screenshots, confirmed live incidents, evidence, and review status appear in the existing People Tracking, Alerts, Incidents, and Evidence pages. Snapshots and track/incident metadata persist under `runtime/`. A new webcam session receives new anonymous track IDs; this does not verify identity across sessions. Continuous webcam video is **not** recorded, so historical live alerts can be reviewed through snapshots, not video replay.

Files: `live_webcam.py` owns token-scoped sessions and inference; it uses the camera profiles and model helpers in `video_cameras.py`. `webcam.js` owns explicit video-only browser capture and the live UI. Only one webcam tab owns the active session. In-flight results are rejected after Stop, and inactive sessions expire after 30 seconds without frames.

### Webcam regression checks

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
.venv\Scripts\python.exe tests/make_webcam_fixture.py
.venv\Scripts\python.exe server.py --port 8002 --runtime-dir runtime/webcam-validation
```

In another terminal:

```powershell
$env:WEBCAM_TEST_VIDEO=(Resolve-Path runtime/webcam-test.y4m).Path
node tests/browser_webcam.mjs
```

The fixture is generated from the supplied video solely for the browser test. The test explicitly starts Chrome with its test camera flags; the production app has no simulated webcam or fallback feed. It verifies browser capture, actual gun-model inference, alert/evidence creation, person snapshots, cross-screen monitoring, camera release on Stop, permission-denied handling, and mobile/RTL layout. Knife confirmation is covered by unit tests; a physical webcam and a real knife scenario have not been validated in this environment.

Implementation references: [browser camera access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [releasing camera tracks](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop), and [persistent frame-by-frame tracking](https://docs.ultralytics.com/modes/track/).

## Expo 2030 3D map and detection markers

The map from `Y:/Raqeeb-expo2030-3d` is integrated into **Overview**, **Live Monitoring**, and **Live Webcam**, with its existing site geometry and camera placements preserved. `site-map-3d.js` renders the scene locally on a canvas; `site_map.json` contains the editable plan. No external 3D library or build step is required.

- Small blue dots represent people in the current analyzed frame, or the last viewed frame when a recording is paused. The map does not create dots from the full historical person directory. Each anonymous person ID appears once.
- A person linked to an open incident becomes red and pulses. When that person leaves view, a red incident marker remains at the saved person location. Multiple incidents for the same absent holder share one marker. Resolved and False Positive incidents stop highlighting the person and remove their standalone incident markers.
- Click a person dot to open its snapshot or review its incident evidence. Open alerts are review state, so red does not assert that a weapon is currently visible in the paused frame.
- WEB-01 has no assumed site location. Choose its station in **Webcam position** using an existing plan position; this browser's selection persists locally. Unplaced detections are disclosed rather than assigned arbitrary coordinates. Planned camera pins in your original map are planning positions, not added camera feeds.
- Drag to orbit, scroll or use +/- to zoom, shift-drag to pan, and use the view buttons. Keyboard arrow keys orbit the focused canvas; Home resets the view. Incident pulses respect reduced-motion preferences.

**Placement is camera-relative and approximate**, as selected for this integration. A person's image foot point is projected into the configured camera's heading, field of view, and range. These dots are not measured geographic or calibrated floor locations. A camera can optionally supply `floor_homography`: nine numbers forming a row-major 3x3 matrix mapping normalized image foot points `[u, v, 1]` to site `[x, z, w]`, with the result divided by `w`. Only supply this when you have calibrated that camera against the floor plan.

Paused recordings keep their last observed positions and the HUD identifies them as paused. Stale webcam observations disappear after five seconds, while saved open incidents remain available for review. Offline sources do not generate current person markers. The imported map does not replace any detection, tracking, webcam, or incident-persistence code.

Checks:

```powershell
node --test tests/test_site_map_tracking.cjs
.venv\Scripts\python.exe server.py --port 8002 --runtime-dir runtime/map-validation
```

Against an isolated runtime containing analyzed camera data and observed incidents:

```powershell
node tests/browser_site_map.mjs
```

The browser check covers actual recorded-source person dots, incident animation without map rotation, snapshot selection, placement persistence, resolution/false-positive transitions, map lifecycle, dark/light themes, and mobile/RTL layout. It restores the original review statuses after testing. The webcam browser regression also verifies webcam dots at the explicitly selected map station.
