# V2 Command Center Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the side panel from a port list into a first command-center slice with project profiles, safer process actions, runtime status, logs, and browser cleanup controls.

**Architecture:** Keep the existing extension/native-host split. Store project profiles in the existing settings object, derive runtime profile state from current scan entries, and keep destructive native actions behind an explicit confirmation dialog. Browser cleanup uses extension APIs when present and reports unavailable capabilities without broadening native-host power.

**Tech Stack:** React 18, Vite, Vitest, shared TypeScript protocol/types, Chrome/Firefox WebExtension APIs, Rust native host.

---

### Task 1: Profile Model And Matching

**Files:**
- Modify: `packages/extension/src/lib/settings.ts`
- Modify: `packages/extension/src/lib/settings.test.ts`
- Create: `packages/extension/src/lib/projectProfiles.ts`
- Create: `packages/extension/src/lib/projectProfiles.test.ts`

- [ ] **Step 1: Write failing settings tests**

Add coverage that saved `projectProfiles` survive sanitization when valid and invalid profile fields are removed.

- [ ] **Step 2: Run focused test to verify RED**

Run: `pnpm --filter @localhost-control/extension test:run -- src/lib/settings.test.ts src/lib/projectProfiles.test.ts`

Expected: FAIL because profile types/helpers do not exist yet.

- [ ] **Step 3: Implement profile types, sanitizer, and matcher**

Use a compact `ProjectProfile` type with id, name, optional icon, projectPath, startCommand, expectedPort, mainUrl, extraUrls, healthUrl, preferredOpenMode, notes, and logLines. Add `matchProfileForEntry` that scores project path, expected port, and URL.

- [ ] **Step 4: Run focused test to verify GREEN**

Run: `pnpm --filter @localhost-control/extension test:run -- src/lib/settings.test.ts src/lib/projectProfiles.test.ts`

Expected: PASS.

### Task 2: Command Center UI

**Files:**
- Modify: `packages/extension/src/App.tsx`
- Modify: `packages/extension/src/App.test.tsx`
- Modify: `packages/extension/src/components/DetailPanel.tsx`
- Modify: `packages/extension/src/components/PortList.tsx`
- Modify: `packages/extension/src/styles.css`
- Create: `packages/extension/src/components/SafeActionDialog.tsx`

- [ ] **Step 1: Write failing App tests**

Add tests that a saved profile is shown as the primary project entity, a matched running port is labeled with the profile, health/check/log metadata render in details, and kill opens a confirmation dialog before calling the host.

- [ ] **Step 2: Run focused test to verify RED**

Run: `pnpm --filter @localhost-control/extension test:run -- src/App.test.tsx`

Expected: FAIL because the UI still kills immediately and has no profile panels.

- [ ] **Step 3: Implement profile summary, matched labels, and dialog**

Derive `profileStates` from settings plus scan entries. Replace immediate kill actions with `pendingKillEntry` and a `SafeActionDialog` showing PID, process, command, port, parent PID, path, uptime/resources, and project/profile estimate. Confirm performs current `force-tree` host action.

- [ ] **Step 4: Run focused test to verify GREEN**

Run: `pnpm --filter @localhost-control/extension test:run -- src/App.test.tsx`

Expected: PASS.

### Task 3: Browser Cleanup

**Files:**
- Modify: `packages/extension/src/lib/extensionApi.ts`
- Create: `packages/extension/src/lib/browserCleanup.ts`
- Create: `packages/extension/src/lib/browserCleanup.test.ts`
- Modify: `packages/extension/src/App.tsx`
- Modify: `packages/extension/src/App.test.tsx`
- Modify: `packages/extension/public/manifest.json`
- Modify: `packages/extension/src/manifest.test.ts`

- [ ] **Step 1: Write failing cleanup tests**

Cover origin resolution, unavailable APIs, and a successful cleanup call for cookies, local storage, cache storage, service workers, and indexedDB.

- [ ] **Step 2: Run focused test to verify RED**

Run: `pnpm --filter @localhost-control/extension test:run -- src/lib/browserCleanup.test.ts src/App.test.tsx src/manifest.test.ts`

Expected: FAIL because cleanup wrapper and permission do not exist.

- [ ] **Step 3: Implement browser cleanup wrapper and UI action**

Add minimal `browsingData` types to `extensionApi.ts`, add `"browsingData"` permission, and expose a detail-panel cleanup button that reports success or unavailable permission.

- [ ] **Step 4: Run focused test to verify GREEN**

Run: `pnpm --filter @localhost-control/extension test:run -- src/lib/browserCleanup.test.ts src/App.test.tsx src/manifest.test.ts`

Expected: PASS.

### Task 4: Verification And Cleanup

**Files:**
- Review all changed files.

- [ ] **Step 1: Run full checks**

Run: `pnpm test:run`
Run: `pnpm typecheck`
Run: `cargo test -p localhost-control-host`

- [ ] **Step 2: Build/packaging checks**

Run: `pnpm extension:package:chrome`
Run: `pnpm extension:package:firefox`

- [ ] **Step 3: Review CSS and git diff**

Check for dead selectors, duplicate CSS, hard-coded token drift, and hidden old UI state.

- [ ] **Step 4: Commit**

Stage only requested files and commit with `feat: add v2 command center profiles`.
