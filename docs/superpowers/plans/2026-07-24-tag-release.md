# Tag Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish the macOS DMG as a GitHub Release when a semantic version Tag is pushed.

**Architecture:** A single GitHub Actions workflow runs on macOS, validates the Tag against
`package.json`, executes the existing tests and build command, then publishes `dist/*.dmg` with
GitHub CLI. A Node source-level test protects the workflow contract.

**Tech Stack:** GitHub Actions, Node.js 20, npm, electron-builder, GitHub CLI.

## Global Constraints

- Trigger only for pushed Tags matching `v*.*.*`.
- Keep `package.json` as the authoritative application version.
- Do not add dependencies or change application code.
- Do not add Apple signing, notarization, Windows, or Linux builds.

---

### Task 1: Tag release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `test/release-workflow.test.js`

**Interfaces:**
- Consumes: `package.json` version, `npm test`, and `npm run dist:mac`.
- Produces: a GitHub Release containing every `dist/*.dmg` artifact.

- [ ] **Step 1: Write a failing source-level test**

Assert that the workflow exists and contains the approved trigger, permission, version validation,
test, build, and `gh release create` commands.

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test test/release-workflow.test.js`

Expected: FAIL because `.github/workflows/release.yml` does not exist.

- [ ] **Step 3: Add the minimal workflow**

Use `actions/checkout`, `actions/setup-node` with npm caching, `npm ci`, a Node version comparison,
`npm test`, `npm run dist:mac`, and `gh release create` authenticated by `GITHUB_TOKEN`.

- [ ] **Step 4: Verify GREEN and the full suite**

Run: `node --test test/release-workflow.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

Run: `git diff --check`

Expected: no output.
