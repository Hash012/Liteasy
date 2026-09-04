# File workflow test

This directory contains the real PDF used only by the `file-workflow-test`
desktop Vite workflow. The development server exposes the registered file at
`/file-workflow-test/larimar-episodic-memory.pdf`; production builds do not copy
it into `dist`.

- Title: *Larimar: Large Language Models with Episodic Memory Control*
- Pages: 18
- SHA-256: `891a3556b6c828b304d1bff0a63f96598970aa08091b4a679cf1133e5bf44755`

Run `npm run dev` in `products/liteasy/apps/desktop/`. Use `?plain-app` to skip
the branch-only fixture registration when comparing with the normal empty Vite
workspace.

The repository requires Node.js 20+. On the current test server, prepend
`/opt/node-v20.12.2-linux-x64/bin` to `PATH` before starting the combined Vite
and dev-cloud process.
