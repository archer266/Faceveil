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

The `npm.cmd` form works in PowerShell even when `.ps1` scripts are disabled. The web app works with Node.js 18 or later; building the Android app with Capacitor 8 requires Node.js 22 or later. To make a web production build, run `npm.cmd run build`; its output is in `dist`.

## Run the Android app on your phone

Install [Node.js 22 or later](https://nodejs.org/en/download) and [Android Studio](https://developer.android.com/studio), including the Android SDK. Android Studio's **Tools → SDK Manager** should have Android 16 (API 36) installed. You do not need to install Java separately.

1. In VS Code, open the **Faceveil repo folder** (the one containing `package.json`). If you already have an older checkout, run `git pull origin main` first.
2. In a new PowerShell terminal, run:

   ```powershell
   npm.cmd install
   npm.cmd run android:sync
   npm.cmd run android:open
   ```

3. Let Android Studio finish Gradle sync and install any SDK components it requests. On your Android phone, enable **Developer options → USB debugging**, plug it into the computer, and accept the debugging prompt on the phone.
4. Select the phone in Android Studio's device selector and press **Run** (the green triangle). Android Studio builds and installs a debug app called Faceveil. If Windows does not see your phone, see [Google's device setup guide](https://developer.android.com/studio/run/device).

After a web code change, run `npm.cmd run android:sync` again, then **Run** in Android Studio. The `android/` folder is the tracked native project. `android:sync` rebuilds the site and copies it into the app; it does not install it on your phone.

Test a small photo and a short MP4 first: choose a file, check the detected faces, export, and confirm that the saved result actually opens. The Android WebView may handle canvas recording and Blob downloads differently from Chrome. An Android build is not verified for video export until this device test succeeds.

## Test on a phone

Connect your phone and computer to the same Wi-Fi, run `npm.cmd run dev` on the computer, and open the **Network** URL printed by Vite in your phone's browser (for example, `http://192.168.1.42:5173`). Keep the terminal running. If the page will not load, allow Node.js through the Windows firewall on private networks and make sure neither device is on a guest Wi-Fi network. After replacing the app files, refresh the phone tab to load the new version.

On phones, large photos are reduced to at most 4096 pixels on the long side and 16 megapixels before editing and export so the browser is less likely to run out of memory. Smaller photos keep their original resolution. If automatic detection is unavailable, use **Add face area** for photos or **Add fixed area** for videos. Fixed video areas do not follow moving faces. Video export requires browser support for canvas recording; try a short MP4 in Chrome on Android first.

## Use it

### Photos

1. Drop or choose a photo. Face detection starts automatically.
2. Check every face. Use **Add face area** to drag a new area over a missed face. Click and drag a marked area to move it; select it and drag its bottom-right handle to resize. The list can disable or remove areas. Press Delete to remove a selected area.
3. Choose **Blur**, **Pixelate**, or **Cover**. Adjust strength and padding. Use **Show original** to compare.
4. Download a PNG at the processed resolution.

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
