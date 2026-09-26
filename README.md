# Faceveil

A browser app for automatically detecting and hiding faces in photos and videos. It uses MediaPipe Face Detector with two bundled BlazeFace models. Files are processed on your device and are not uploaded by this app.

## Run in VS Code

1. Extract this folder and open `faceveil` in VS Code.
2. Open **Terminal → New Terminal**.
3. Run:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

4. Open the local URL shown in the terminal, usually `http://localhost:5173`.

The `npm.cmd` form works in PowerShell even when `.ps1` scripts are disabled. Use Node.js 18 or Node.js 20+. To make a production build, run `npm.cmd run build`; its output is in `dist`.

## Use it

### Photos

1. Drop or choose a photo. Face detection starts automatically.
2. Check every face. Use **Add face area** to drag a new area over a missed face. Click and drag a marked area to move it; select it and drag its bottom-right handle to resize. The list can disable or remove areas. Press Delete to remove a selected area.
3. Choose **Blur**, **Pixelate**, or **Cover**. Adjust strength and padding. Use **Show original** to compare.
4. Download a full-resolution PNG.

### Videos

1. Choose an MP4 or WebM video. Playback starts only when you press Play, and faces are detected as frames play.
2. Play or scrub through the clip to check for missed faces. **Add fixed area** marks one part of the frame for the entire video; fixed areas do not follow moving faces. You can move or resize a fixed area after adding it.
3. Choose Blur, Pixelate, or Cover and adjust the strength and padding.
4. Press **Download edited video**. The app starts at the beginning, processes frames while the clip plays, combines the edited video with the source audio, and downloads WebM or MP4 depending on browser support. Keep the tab open until the download begins. Export takes about the video's running time.

Video output is scaled to at most 1280 × 720 for browser performance. Videos up to 500 MB are accepted; actual limits also depend on available browser memory and codec support. Chrome or Edge with MP4/WebM input is recommended.

**Review the complete output before sharing it.** Automatic detection can miss side profiles, very small faces, faces that are partly hidden, or individual video frames. Blur and pixelation may leave recognizable details at low strength; Cover hides each marked area fully.

## How it works

- `src/faceDetection.ts` loads the bundled models and WebAssembly files, scans the whole image plus overlapping tiles, and removes duplicate boxes.
- `src/geometry.ts` keeps areas inside the image and calculates overlap.
- `src/processImage.ts` draws the redacted regions to a canvas, including at export resolution.
- `src/videoDetection.ts` uses MediaPipe's video mode on each processed frame.
- `src/videoTracking.ts` holds boxes briefly when detection drops for a frame.
- `src/VideoEditor.tsx` handles playback, fixed areas, per-frame rendering, audio routing, and MediaRecorder export.
- `src/App.tsx` handles uploads and the photo editor.
- `public/models` and `public/wasm` contain the local model and runtime files, so using the app requires no remote model download.

The app does not have a backend, account system, or analytics of its own. MediaPipe's package documentation says its tasks process input on-device and may send performance and usage metrics to Google. See [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) and the [Face Detector guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js).

This version edits one photo or one video at a time. Browser memory limits may affect very large images; photo uploads are limited to 40 MB and 40 megapixels.
