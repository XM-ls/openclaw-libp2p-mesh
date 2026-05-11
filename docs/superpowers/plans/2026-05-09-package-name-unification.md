# Package Name Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin's public name consistent everywhere and align installation docs with the actual npm package `openclaw-libp2p-mesh`.

**Architecture:** Keep the runtime plugin IDs and channel IDs unchanged. Update only the package metadata and user-facing docs so OpenClaw installs the same package name the registry serves. This avoids a breaking rename while removing confusing scoped-package references.

**Tech Stack:** npm package metadata, Markdown docs, OpenClaw plugin metadata.

---

### Task 1: Verify the canonical package name

**Files:**
- Modify: `package.json:1-85`
- Modify: `README.md:1-260`

- [ ] **Step 1: Confirm the package name in metadata**

```json
{
  "name": "openclaw-libp2p-mesh",
  "openclaw": {
    "install": {
      "npmSpec": "openclaw-libp2p-mesh"
    }
  }
}
```

- [ ] **Step 2: Confirm README installation commands use the same name**

```bash
openclaw install openclaw-libp2p-mesh
cd ~/.openclaw/extensions
npm install openclaw-libp2p-mesh
```

### Task 2: Remove stale scoped-package references

**Files:**
- Modify: `README.md:1-260`

- [ ] **Step 1: Replace the title and install examples**

```md
# openclaw-libp2p-mesh

openclaw install openclaw-libp2p-mesh
```

- [ ] **Step 2: Ensure no scoped-package references remain**

```bash
rg -n "@.*libp2p-mesh" README.md
```

Expected: no matches.

### Task 3: Validate package metadata for publishing

**Files:**
- Modify: `package.json:1-85`

- [ ] **Step 1: Check the publish configuration**

```json
{
  "openclaw": {
    "release": {
      "publishToNpm": true
    }
  }
}
```

- [ ] **Step 2: Dry-run the npm package**

```bash
npm pack --dry-run
```

Expected: package includes `index.ts`, `src/`, `README.md`, `LICENSE`, and `openclaw.plugin.json`.

### Task 4: Publish the new version to npm

**Files:**
- Modify: `package.json:1-85` if version bump is needed before publishing

- [ ] **Step 1: Confirm the next version number**

```json
{
  "version": "2026.5.9"
}
```

- [ ] **Step 2: Publish**

```bash
npm publish
```

Expected: npm returns a successful publish with the canonical package name `openclaw-libp2p-mesh`.
