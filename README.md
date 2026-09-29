# RockClimbBeta

An interactive demo of a computer-vision pipeline that watches a bouldering wall, finds the holds, tracks a climber's pose, and suggests the next move. Static frontend (no build step) calling three real AWS Lambda functions directly from the browser.

**Live:** https://d1saxieoomngvj.cloudfront.net/ (custom domain rockclimbbeta.ca pending DNS propagation)

## Try it

- **Example photos** — one click runs the full pipeline against two bundled real photos from an actual climbing session (an empty-wall scan and a matching climber shot). No camera or wall required.
- **Live camera** — enable your webcam, scan a wall, pick a route, and get a suggestion every couple of seconds as you climb. Photo upload is also available here as an alternative to the camera.

First call after idle time can take 10–30s while the Lambdas cold-start; everything after that is a couple seconds.

## How it works

1. **Hold detection** — YOLOv8, trained on ~300 hand-labeled photos, finds every bolt-on hold. Each hold is cropped and K-means finds its dominant color; a second K-means pass clusters holds into color-coded "tracks" (routes).
2. **Pose tracking** — HRNet estimates a 17-point COCO skeleton for the climber, cropped to a YOLOv6-detected person first so joints stay sharp on a full-frame photo.
3. **Hold matching** — each hand/foot is matched to its nearest hold on the chosen track; every other same-track hold within roughly one body-length becomes a candidate next move.
4. **Move scoring** — a regularized linear regression (Ridge) scores every candidate and the highest-scored one gets suggested.

## Files

```
index.html   Page structure — hero, demo (example + camera modes), pipeline explainer, stack section
style.css    Styling
app.js       Demo logic — camera capture, file upload, API calls, canvas overlay drawing
assets/      Two bundled example photos (wall + climber, same session)
```

No build step — open `index.html` directly or serve the folder with any static file server.

## Backend

This page calls three deployed Lambda functions (via API Gateway HTTP APIs) directly from the browser:

- [rockDetectionLambda](https://github.com/victorialu0515/rockDetectionLambda) — hold detection
- [HRNET](https://github.com/victorialu0515/HRNET) — pose tracking
- [poseScore](https://github.com/victorialu0515/poseScore) — move scoring
- [humanPoseEstimation](https://github.com/victorialu0515/humanPoseEstimation) — reference models and training data

Infra: S3 (static hosting, private + CloudFront OAC), CloudFront (CDN/HTTPS), Route53 + ACM (custom domain, in progress), API Gateway (CORS-enabled HTTP APIs fronting each Lambda), DynamoDB (per-session run history).

## Known limitations

- The move-scoring model was still in early data collection when the underlying project paused — no hand-graded "good move" labels were ever collected, so it's trained on a heuristic stand-in (reward upward progress, prefer a comfortable reach) rather than real supervision. Treat suggestions as directional, not precise.
- The person detector (YOLOv6-s, generic COCO-trained) reliably finds climbers in clear poses but can miss unusual or heavily occluded ones; pose tracking falls back to whole-image estimation in that case.
