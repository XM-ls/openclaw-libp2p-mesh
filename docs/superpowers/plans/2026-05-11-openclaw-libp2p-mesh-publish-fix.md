# openclaw-libp2p-mesh Publish Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `openclaw-libp2p-mesh` as a runtime-ready npm package with compiled JS entrypoints so OpenClaw and acpx can load it without TypeScript source handling.

**Architecture:** Keep the plugin code and OpenClaw metadata intact, but introduce a small TypeScript build step that emits `dist/index.js`, `dist/api.js`, and matching declaration files. Point package metadata and OpenClaw plugin discovery at the compiled entrypoint, while preserving the source tree for local development.

**Tech Stack:** npm scripts, TypeScript compiler (`tsc`), OpenClaw plugin metadata, Markdown docs.

---

### Task 1: Add a build pipeline that emits `dist/`

**Files:**
- Create: `tsconfig.json`
- Modify: `package.json`

- [ ] **Step 1: Write the build config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "declarationMap": false,
    "sourceMap": false,
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["index.ts", "api.ts", "src/**/*.ts"]
}
```

- [ ] **Step 2: Wire npm scripts**

```json
{
  "devDependencies": {
    "openclaw": "^2026.5.7",
    "tsx": "^4.0.0",
    "typescript": "^5.9.3"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepack": "npm run build"
  }
}
```

- [ ] **Step 3: Verify the build emits JS and d.ts**

Run: `npm run build`
Expected: `dist/index.js`, `dist/api.js`, `dist/src/*.js`, and matching `.d.ts` files are created.

### Task 2: Point OpenClaw and npm consumers at compiled entrypoints

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package metadata**

```json
{
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist",
    "index.ts",
    "api.ts",
    "src",
    "openclaw.plugin.json",
    "README.md",
    "LICENSE"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./api": {
      "types": "./dist/api.d.ts",
      "default": "./dist/api.js"
    }
  },
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "install": {
      "npmSpec": "openclaw-libp2p-mesh",
      "defaultChoice": "npm",
      "minHostVersion": ">=2026.3.24"
    }
  }
}
```

- [ ] **Step 2: Verify the pack list contains the runtime artifacts**

Run: `npm pack --dry-run`
Expected: the tarball includes `dist/index.js`, `dist/api.js`, `dist/src/**`, and `openclaw.plugin.json`.

### Task 3: Update install guidance for the compiled package

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Clarify the published package is compiled**

```md
The published npm package includes compiled JavaScript under `dist/`, so OpenClaw and acpx can load it directly without TypeScript transpilation.
```

- [ ] **Step 2: Keep the install commands aligned with the package name**

```bash
openclaw install openclaw-libp2p-mesh
npm install openclaw-libp2p-mesh
```

- [ ] **Step 3: Verify the README no longer implies source-only publishing**

Run: `rg -n "index.ts|source-only|dist/" README.md`
Expected: the install docs describe the runtime-ready npm package clearly.

### Task 4: Validate the publishable package shape end to end

**Files:**
- Modify: none

- [ ] **Step 1: Rebuild and inspect the compiled entry**

Run: `npm run build && node -e "import('./dist/index.js').then(() => console.log('ok'))"`
Expected: the compiled plugin entry loads without syntax errors.

- [ ] **Step 2: Inspect npm metadata**

Run: `npm pack --dry-run`
Expected: no publishable entry points point at `.ts` files.

- [ ] **Step 3: Commit the release fix**

```bash
git add package.json tsconfig.json README.md docs/superpowers/plans/2026-05-11-openclaw-libp2p-mesh-publish-fix.md
git commit -m "fix: publish compiled libp2p mesh plugin"
```
