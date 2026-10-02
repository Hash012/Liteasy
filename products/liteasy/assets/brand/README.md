# Liteasy brand assets

`liteasy-mark.svg` is the transparent book-and-ring mark used to generate the
Windows desktop icon. Its geometry matches `LiteasyMark.tsx` in the desktop
workbench; keep both in sync when changing the shape. The native icon uses a
fixed Fluent blue, while the in-app vector inherits the surrounding text color.

From `products/liteasy/apps/desktop`, run `npm run icons:windows` after changing
the SVG. This uses the locked Tauri CLI to regenerate `src-tauri/icons/icon.ico`
and the desktop/Windows PNG sizes. Commit the SVG and generated resources.

The executable, shortcuts, NSIS installer and uninstaller use `icons/icon.ico`.
The ICO includes multiple sizes for Windows scaling and has a transparent
background; it replaces the old solid blue gradient placeholder.
