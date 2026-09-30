# Liteasy Mobile

Android client for collecting resources, reading and annotating PDFs, syncing with Liteasy desktop and delegating desktop tasks. The mobile shell is independent of desktop layout. Shared domain code belongs under `products/liteasy/packages/`; mobile features must not import `apps/desktop/src`.

## Development

Use the Node version in `../desktop/.nvmrc`. Run `npm ci`, `npm test`, `npm run build`. `npm run dev` serves the browser preview. Native Android features require the APK, not the browser preview.

Install an Android SDK/NDK, Java 17 and the Rust Android targets. Set `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME` to your local installations, then run `npm run android:build`. The native project under `src-tauri/gen/android` is version controlled, including custom Kotlin code; do not reinitialize it to update dependencies. Local SDK paths, signing material and build output are ignored.

The Android baseline is API 26+, platform 36 / Build Tools 35.0.0 / NDK 27.2.12479018. The default build targets ARM64 and produces `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. Install with `adb install -r <apk>`; retaining the same signing key allows upgrades without clearing the private library. This is a debug build, not a signed public release. When switching ABI targets in one checkout, remove stale generated `app/src/main/jniLibs/<abi>` links before packaging, or build from a clean checkout.

Android native linking enables 16 KiB LOAD/RELRO alignment with NDK r27. Check the packaged libraries and ZIP alignment with `python3 scripts/verify-android-apk.py <apk> "$ANDROID_HOME/build-tools/35.0.0/zipalign"`; CI runs this against the ARM64 artifact. This binary check does not replace execution on a 16 KiB device.

## Use and acceptance

- Guest mode works offline. Share text, links, PDFs or images to Liteasy, review the destination and metadata, then save. Pending captures survive app restarts.
- PDF reading includes page/search/outline navigation, reflow of page text, highlights, underline, notes, text boxes, ink and undo/redo. Reflow does not preserve page geometry; scanned PDFs need desktop OCR outside this release.
- Configure an HTTPS WebDAV endpoint independently in each library to synchronize files, portable metadata and annotations. Conflicting edits stay visible; shared storage is not an account credential store.
- [Configure mobile login](docs/accounts.md) before using account features. [Pair the desktop](docs/device-control.md) to open matching documents, extract embedded text, request a permitted summary or start desktop WebDAV sync. Login/remote tasks need a reachable configured API; local reading and capture do not.

Run `npx playwright install chromium` then `npm run test:browser` for browser reading/ink/navigation flows. Android JVM and device tests are under `src-tauri/gen/android/app/src/{test,androidTest}`. After a native build, compile/run JVM checks with:

```sh
cd src-tauri/gen/android
./gradlew :app:testUniversalDebugUnitTest :app:assembleUniversalDebugAndroidTest \
  -x rustBuildArm64Debug -x rustBuildArmDebug -x rustBuildX86Debug -x rustBuildX86_64Debug
adb install -r app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb install -r app/build/outputs/apk/androidTest/universal/debug/app-universal-debug-androidTest.apk
adb shell am instrument -w com.liteasy.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

For an x86_64 emulator first build with `npm run tauri -- android build --apk --debug --target x86_64 -- --locked`. The Gradle exclusions reuse that already-built native library; they do not skip tests. Check the instrumentation output for `OK`, not just the adb exit code. CI runs frontend/browser/shared-Rust/JVM checks and compiles instrumentation tests; device tests and real Android UI acceptance are separate. [Implementation and validation evidence](../../../../docs/agent-dev/2026-09-30-mobile-implementation.md) records actual results and outstanding deployment/device checks.

## Implementation checkpoints

Each checkpoint is independently committed after its affected checks. Native testing and target service acceptance are recorded separately from web/unit tests.

1. Android project, frontend shell, build and CI baseline.
2. Shared literature and annotation domain code.
3. Durable offline library.
4. Android share receiver.
5. Mobile PDF reader.
6. Annotations and ink.
7. WebDAV file synchronization.
8. Concurrent annotation merge.
9. Mobile account and session lifecycle.
10. Device pairing and durable remote task service.
11. Desktop execution and mobile result delivery.
12. Phone/tablet and reading UX refinement.
13. End-to-end verification and APK delivery.

The initial release covers text/URL/PDF/image capture, local PDF reading and annotation, file and annotation sync, and scoped desktop tasks. Full webpage capture behind sign-in, unrestricted desktop control and complete desktop editor parity are outside that release.
