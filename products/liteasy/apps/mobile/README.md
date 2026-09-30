# Liteasy Mobile

Android client for collecting resources, reading and annotating PDFs, syncing with Liteasy desktop and delegating desktop tasks. The mobile shell is independent of desktop layout. Shared domain code belongs under `products/liteasy/packages/`; mobile features must not import `apps/desktop/src`.

## Development

Use the Node version in `../desktop/.nvmrc`. Run `npm ci`, `npm test`, `npm run build`. `npm run dev` serves the browser preview. Native Android features require the APK, not the browser preview.

Install an Android SDK/NDK, Java 17 and the Rust Android targets. Set `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME` to your local installations, then run `npm run android:build`. The native project under `src-tauri/gen/android` is version controlled, including custom Kotlin code; do not reinitialize it to update dependencies. Local SDK paths, signing material and build output are ignored.

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
