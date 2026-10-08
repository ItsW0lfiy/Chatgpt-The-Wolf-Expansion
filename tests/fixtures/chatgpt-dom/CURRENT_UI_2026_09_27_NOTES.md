# Current ChatGPT UI fixture notes (2026-09-27)

These sanitized fixtures supplement the older ChatGPT DOM generation already kept in this directory.

- The sidebar still has `nav[aria-label="Chat history"]`, with its scroll body marked by `data-app-action-sidebar-scroll`.
- Current conversation rows use `role="listitem"`, `data-thread-title-trigger="true"`, `a[data-interactive-row-link="true"]`, and `button[aria-label="Chat actions"][aria-haspopup="menu"]`.
- Current project conversations use `/g/g-p-<project-id>/c/<conversation-id>`; the final `/c/` segment owns the conversation identity.
- Current native menus remain Radix-style: `[role="menu"][data-radix-menu-content]` with `[role="menuitem"]` descendants. Older action-specific test IDs are not assumed.
- Settings is a routed application under `/settings/*`, not only the older modal form.
- The current profile opener is `button[aria-label="Open profile menu"][aria-haspopup="menu"]`; the open profile menu includes `[data-testid="workspace-switcher-trigger"]`.
- These captures do not establish a safe stable account identifier. Display name, plan text, data-image bytes, generated IDs, and mutable profile text must not determine storage scope.

The accompanying userscript from the source evidence pack is deliberately not committed. It is behavioral evidence for the separately implemented, opt-in navigation compatibility module.
