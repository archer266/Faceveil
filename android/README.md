# Faceveil on Android

Faceveil is an installable web app designed for Android Chrome. It opens the device camera or file picker, edits photos and videos locally, and lets the user review, save, or share an edited file. The production build includes a web manifest and an offline app shell.

The Play Store package uses a **Trusted Web Activity (TWA)**. The TWA opens this same web app in the user's Android browser. The Android wrapper cannot be finalized until the app is served at an HTTPS origin you control: its manifest URL, Android package name, and signing certificate must agree with the site's Digital Asset Links file. See the [Chrome TWA guide](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start) and [signing guide](https://developer.chrome.com/docs/android/trusted-web-activity/android-for-web-devs).

## Try the installable web app first

1. Run `npm.cmd install` and `npm.cmd run build` in PowerShell. Upload the **contents** of `dist/` to a static HTTPS site, with `index.html` at the app's chosen URL. Serve `.webmanifest` as `application/manifest+json`, `.js` as JavaScript, `.wasm` as `application/wasm`, and `.tflite` as a binary asset. Avoid routing these asset URLs to `index.html`.
2. In Chrome on an Android phone, open the HTTPS site and use **Install app** from Chrome's menu. Choose a photo or video, or tap **Take photo** / **Record video**. Check the edited result, then tap **Save file** or **Share**.
3. Test a short Android camera clip with sound and a photo from the camera. Video export runs in real time; keep the app open and the screen awake until it finishes. Chrome chooses the supported output format, often WebM. Verify playback, sound, redaction, and file saving on the target phone.

The worker caches application assets after the first successful online load, including the face models and MediaPipe runtime. Available device storage determines whether every asset is retained. Keep the public site reachable for updates and fresh installs. Files selected by the user stay in device memory during editing; this app does not upload them.

## Package the TWA

After choosing and publishing the HTTPS URL:

```powershell
npm.cmd install -g @bubblewrap/cli
mkdir android\twa
cd android\twa
bubblewrap.cmd init --manifest=https://YOUR-DOMAIN/manifest.webmanifest
bubblewrap.cmd build
bubblewrap.cmd install
```

Bubblewrap can guide installation of its Android SDK and JDK requirements. During `init`, choose the final package ID (for example, `com.yourname.faceveil`) and a secure signing key. Keep the keystore and its passwords private and backed up. `build` produces `app-release-signed.apk` for local testing and `app-release-bundle.aab` for Play Console. The commands above need an Android device or emulator for `install`.

The browser only verifies the TWA as an owned site if `https://YOUR-DOMAIN/.well-known/assetlinks.json` includes the **exact** package ID and signing certificate fingerprint. Run this from the Faceveil repository root after finding the local certificate SHA-256 fingerprint (e.g. `keytool -printcert -jarfile android/twa/app-release-signed.apk`):

```powershell
npm.cmd run android:assetlinks -- com.yourname.faceveil AA:BB:CC:...:FF
npm.cmd run build
```

Replace the abbreviated sample with all 32 colon-separated hex pairs. The script writes `public/.well-known/assetlinks.json`; the next build copies it into `dist/.well-known/assetlinks.json`. Deploy it **at the HTTPS origin root**, even if the app itself is under a path. Confirm the public URL returns JSON directly. With Play App Signing, add the **Play app signing certificate** fingerprint from Play Console → App integrity too; the local upload certificate and the Play distribution certificate may differ. Pass both fingerprints to the script after the package name. If this validation fails, the TWA opens as a Custom Tab with a browser bar.

## Release checks

- Open the installed package on a real Android phone with current Chrome. Check camera capture, gallery import, touch area editing, the complete photo and video exports, source audio, downloads and sharing.
- Run a second test offline after one full online load to verify that the required model and runtime assets were cached.
- Test small and longer clips on a midrange phone; memory, codecs, and background recording behavior vary by device. Review every frame before sharing; face detection can miss faces.
- Only submit the app to Play Console after the HTTPS origin and Digital Asset Links are working. Add the store listing, privacy disclosure, and release signing details there.
