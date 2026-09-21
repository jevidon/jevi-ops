# Shared editors — issue #72 rollout

## First delivery: task editing

The task detail editor now uses the shared editor shell. Save closes to the underlying task detail; Delete is visible in the header, requires confirmation and returns to the actual originating page. Direct-entry deletion falls back through a valid parent task, project or domain and then All Tasks. Failed mutations leave the editor and draft open.

The shell uses a native modal dialog, full mobile width and a 440px desktop panel, a fixed header, focus containment/restoration, background scroll locking, and guarded Cancel/Escape/backdrop/Back behavior. While a mutation is pending, header actions cannot be submitted again and form controls are disabled. A native reset listener preserves uncontrolled inputs when a React form action returns an error.

An explicit primary-form adapter supplies the header's form ID, pending state, dirty check and optional deletion. `EditDrawer managed` opts a consumer into the new shell. Other drawers keep their existing behavior until their forms are deliberately adapted.

Navigation context is recorded per browser history entry and user. Tab-scoped storage contains list state, not record drafts. All Tasks restores its search, view, domain/priority selections and completed visibility when the origin remounts. Return paths preserve query/hash, reject unsafe destinations and skip unavailable task ancestry. Task mutations invalidate related detail routes as well as overview pages. Floating notifications are suppressed on detail/editor surfaces; project/domain workspaces and overview pages retain them. Search and Capture keyboard shortcuts do not navigate out from under an open modal.

## Validation

- Web component/action tests cover successful save, failed-save draft preservation and retry, clean/dirty dismissal, deletion confirmation and failure, pending-state serialization, Back protection, return destination validation, unavailable parents, view-state restoration, user isolation and repeated navigation events.
- The production web build succeeds with the existing `jose` Edge-runtime warnings. TypeScript and changed-file lint are checked separately because the repository skips them during builds.
- Browser preview exercises the actual TaskForm, EditorShell and EditorProvider with synthetic records and mocked navigation/server actions. Checked at 320px, 375px and 1440px: mobile width and header actions, desktop 440px panel, retained failed-save draft, discard confirmation, save/close/fresh detail values, delete confirmation, origin query preservation and scroll restoration, keyboard focus wrapping, and dirty Back with Keep editing.
- A project origin scrolled to 590px returned to 566px after deleting its last link: the shorter document's maximum scroll position. Focus fell back to the project heading because the deleted link no longer existed.
- This preview is not an authenticated production-data end-to-end test. Physical iPhone/WKWebView and installed-web-app validation remain pending. Do not treat the web checks as proof of native gesture/keyboard behavior.

## Remaining deliveries

1. Task creation overlay/direct-entry fallback and complete creation-origin adoption (plan delivery 2).
2. Projects/areas, domains, assets and content, with entity-specific delete rules (delivery 3).
3. People, companies and library editors, preserving upload and versioned-content semantics (delivery 4).
4. Audit and adopt remaining maintenance/routine/health editors or record justified exceptions; integrate Markdown presentation without changing conflict handling (delivery 5).
5. Validate physical iPhone behavior and authenticated routing before closing #72.

Save + new remains #66; quick-add placement/Create and open editor remains #69; app-wide visible Back remains #93. This first delivery references #72 and does not close it.
