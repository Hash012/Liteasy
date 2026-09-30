# Third-party notices

Liteasy Connector is an independent derivative, not an official Zotero product.

- **Zotero Connector**: Corporation for Digital Scholarship and other contributors, AGPL-3.0-or-later. Source: https://github.com/zotero/zotero-connectors. Exact commit and submodule commits are in `upstream.lock.json`. The build uses the unmodified upstream source and applies the Liteasy manifest, worker, content adapter and UI overlays to the output. `COPYING` is retained in the extension. The distribution is covered by the accompanying `LICENSE`; this does not change licenses elsewhere in this repository.
- **SingleFile**, translator framework, Zotero utilities/schema, Google Docs integration, upstream React and DOMPurify: bundled by the pinned upstream build; their original source headers and notices are retained. The corresponding source archive contains the upstream source, submodules and npm lockfile.
- **Zotero translators**: https://github.com/zotero/translators, pinned in `upstream.lock.json`. The official rules, including their copyright and license headers, are packaged locally and loaded only through the upstream translator sandbox. Their source is included in the corresponding-source archive. Liteasy does not depend on the remote repository accepting a Zotero-specific connector version number.
- **Reading Progress v0.5.0**: supplied by the user as `chatgpt-reading-progress-v0.5.0.zip`, SHA-256 recorded in `upstream.lock.json`. Imported into `src/reading/` with its persistence, Markdown, progress and Canvas behavior. The archive did not contain a separate license for its application code; no authorship or independent upstream license is claimed here. Local modifications and provenance are recorded in this repository. Its vendored Marked, Prism and KaTeX notices are preserved in `src/reading/vendor/` and documented in `docs/THIRD_PARTY_NOTICES.md`.
- **Fluent UI React Components / Fluent UI System Icons**, Microsoft, MIT. Icons and controls come from `@fluentui/react-components` and `@fluentui/react-icons`; exact versions are locked in `package-lock.json`.
- **React / React DOM**, Meta Platforms, Inc. and affiliates, MIT. **fflate**, Arjun Barrett, MIT. Runtime licenses are copied into the packaged extension by the build.
- **Liteasy mark**: reused from this repository's desktop application.

`npm run package` produces an extension ZIP and a corresponding source ZIP. Distribute both and retain these notices and dependency licenses. The ZIP is for manual installation and testing; it is not a store-signed release.
