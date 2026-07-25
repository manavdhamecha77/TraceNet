# Loitering Detection Guide

## Purpose

TraceNet’s loitering feature surfaces people who remain inside a **user-defined video zone** beyond a configured dwell threshold. It creates a review alert; it does not infer intent, identify a person, or make an enforcement decision.

## Operator workflow

1. Open a camera and choose **Ingest CCTV Stream**.
2. Select the video, enable **Configure loitering detection for this video**, and set a dwell threshold. Use a low value such as 2–10 seconds only for functional testing; use an operationally appropriate threshold for a demo.
3. Submit the upload. The standard ingestion pipeline transcodes, detects, tracks, embeds, and indexes the video.
4. The **Define loitering zone** editor opens. It waits until the standardized preview frame is ready.
5. Click at least three points on the preview to make a polygon. Use **Reset polygon** to redraw it, then choose **Save zone & run analysis**.
6. Go to **Alerts → Loitering Reviews**. A qualifying result provides the zone name, inside-zone observation count, entered/trigger timestamps, dwell timeline, and **Inspect track** action.
7. Review the video evidence and acknowledge the alert when appropriate.

## How it works

- Zones are **video-scoped**, not camera-scoped. This prevents a polygon from being reused incorrectly after a camera’s framing, crop, or physical position changes.
- Polygon coordinates are saved normalized to the standardized frame (`x` and `y` from 0 to 1).
- For each person detection, the system uses the **bottom-centre of the bounding box** as an approximation of the person’s standing location.
- The point must remain inside the polygon continuously for the threshold duration.
- A configurable grace period (default: 3 seconds) tolerates brief tracker/detector gaps. A longer gap resets the dwell window.
- Alerts are deduplicated per video and tracked person.

## Evidence available in an alert

Each loitering alert stores and displays:

- configured zone name;
- observation-start and alert-trigger timestamps in the video;
- measured dwell duration and configured threshold;
- number of detections inside the zone;
- the `bottom_center` point-selection rule;
- the associated person tracklet, which can be opened through **Inspect track**.

This evidence is for human review only. A dwell alert is not proof of wrongdoing or suspicious intent.

## API reference

| Endpoint | Use |
|---|---|
| `POST /api/v1/ingest` | Set multipart fields `enable_loitering=true` and `loitering_threshold_seconds` when creating a video-scoped zone request. |
| `GET /api/v1/videos/{video_id}/loitering-zone` | Poll for the preview frame and retrieve existing zone configuration. |
| `PUT /api/v1/videos/{video_id}/loitering-zone` | Save the polygon, threshold, and grace period. The request requires at least three normalized points. |
| `GET /api/v1/alerts?alert_type=loitering` | Retrieve generated loitering review alerts. |

## Developer and agent notes

- Keep all media, database, detection artifacts, and configuration under `backend/data/`, resolved through `app.config.get_data_path`.
- Do not add intent, threat, or predictive-policing classifications. The feature is strictly dwell-time evidence in an operator-selected region.
- A saved zone submitted before indexing finishes is analyzed automatically when processing reaches completion. A zone saved after completion triggers analysis immediately.
- If no alert appears, first check the video is `complete`, the zone is enabled, and a tracked person’s bottom-centre point actually remains inside it longer than the threshold. Tracking gaps beyond the grace period reset dwell time.
- The detection artifact contains `frame_width` and `frame_height`; retain these fields because the analyzer needs them to normalize bounding-box coordinates reliably.
