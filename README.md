# ChatGPT: The Wolf Expansion

<p align="center">
  <img src="assets/branding/wolf-expansion-logo.png" alt="The Wolf Expansion" width="520" />
</p>

ChatGPT: The Wolf Expansion is a free, open-source Firefox and Floorp extension that adds missing power-user features to ChatGPT while preserving ChatGPT's normal interface.

> **Development status:** `v0.2-dev.3` — Data Safety & Navigation Reliability. This is an early development build intended for manual testing. ChatGPT's DOM changes frequently, so integrations may need ongoing adapter updates.

This project is unofficial and is not affiliated with, endorsed by, or sponsored by OpenAI.

## Implemented in v0.2-dev.3

- **Create backup** downloads a versioned, checksummed JSON file containing global settings, legacy recovery metadata, and every opaque account-scoped organization namespace. The file contains saved conversation IDs/titles and folder names, so it should be kept somewhere private and user-controlled.
- **Restore backup** validates the complete file and checksum before replacing Wolf Expansion storage, retains an extension-local pre-restore safety snapshot, preserves account boundaries, and reconciles open ChatGPT tabs without a browser restart. It is a replace operation, not a merge.
- The versioned JSON envelope and restore guarantees are documented in [docs/BACKUP_FORMAT.md](docs/BACKUP_FORMAT.md).
- Storage health in both settings surfaces reports the schema, known opaque scope count, backup time, and—inside a resolved ChatGPT account—the active organization counts. Raw ChatGPT user IDs are never shown or exported.
- Conversation identities now preserve the validated route as well as the stable ID. Both `/c/<id>` and surviving `/g/<id>` conversations can be discovered, organized, dragged, and opened without being forced onto `/c/`.
- Confident route/title metadata changes update existing Quick Access and folder records by conversation ID, preserving membership, order, and Wolf folders when ChatGPT moves a chat beneath a Project.
- Nested folders can be dropped directly into root-level insertion gaps to reparent and position them. The artificial root drop strip was removed, drag feedback writes are idempotent, and root subtrees have restrained theme-aware separation.

- Account-owned organization now resolves only from the opaque stable `user-...` identifier carried by ChatGPT's rendered Estuary profile image payload. The full avatar URL/path, display name, username, and email never determine the Wolf storage scope.
- The stable identifier is decoded and validated in memory, namespaced as `chatgpt-user-id:...`, and SHA-256 hashed before it becomes a physical `storage.local` key. Malformed or unexpected carriers fail closed without an identity fallback.
- Existing dev.2.1 data under a known old avatar-derived scope can be copied through the existing explicit two-step **Restore previous Quick Access data** action. Rebinding requires an empty stable destination, copies all seven organization values together, retains the old scope and backup, and records only opaque source/destination scope hashes.

- In-ChatGPT settings now offers a one-time **Restore previous Quick Access data** action when an identified account has an empty scoped destination and a preserved pre-account-scoping backup exists. Restoration requires a second explicit confirmation, copies the complete organization record in one storage operation, and immediately reloads Quick Access.
- The legacy backup remains retained after restoration and is marked with only the opaque claimed account scope. It cannot be claimed twice or by another account, and an existing destination is never overwritten or merged automatically.

- Quick Access conversation actions now open in a Wolf-owned menu anchored to the selected Quick Access row. Rename, Pin/Unpin, Archive, and Delete are stored only as semantic action kinds; activation reacquires the exact live native row and current ChatGPT control/menu, so detached portal nodes are never reused.
- The exact current `/c/<conversation-id>` receives a subtle Quick Access highlight and `aria-current="page"`, including when it is nested in a folder.
- Compact title reveal keeps controls usable during its delay, then suppresses nonessential row controls and remeasures against the full title viewport while the title is moving. Controls and pointer interaction return when reveal ends.
- Native ChatGPT rename drafts are mirrored into the exact Quick Access row as runtime-only previews; completion returns authority to the existing persistent title synchronization flow.
- Stale title reconciliation now resolves the common old/new duplicate-row transition by preferring the one visible exact-ID title that differs from cached metadata.
- Quick Access has consistent section-level breathing room before native Pinned, and settings descriptions share the same content-column inset in both settings frontends.
- Account-owned Quick Access, folder membership, ordering, collapse state, and per-folder display overrides are isolated under opaque local account scopes. Logged-out or unresolved account state fails closed without deleting another account's data; global extension settings remain available.
- The complete sanitized ChatGPT DOM evidence pack lives under `tests/fixtures/chatgpt-dom/` and is guarded by an automated public-fixture privacy regression scan.

- Branch-aware file-explorer connectors now distinguish continuing and final children, carry only necessary ancestor lines through nested folders, and leave root conversations entirely unconnected.
- Every Quick Access conversation has a compact `...` action that delegates by exact conversation ID to the real mounted ChatGPT sidebar menu. ChatGPT continues to own Rename, Pin, Archive, Delete, confirmations, positioning, and menu lifecycle.
- Native action delegation is intentionally best-effort: if the exact native row is virtualized, missing, or ambiguous, Wolf Expansion fails closed and leaves core Quick Access organization fully operational.

- A cleaner file-explorer-style Quick Access hierarchy: root chats no longer reserve fake folder controls, while actual folder children receive restrained theme-aware relationship connectors.
- Redesigned, consistently grouped in-ChatGPT and Firefox/Floorp settings interfaces backed by the same versioned `SettingsService` record.
- Global Compact/Full chat-name display remains the default, with stable folder-ID overrides that inherit from the nearest configured ancestor.
- Folder menus provide direct per-folder chat-name display choices, while both settings interfaces include a lazy folder-override manager.
- Folder action menus close on an explicit outside click. Folder create/rename drafts now commit only with Enter and cancel on Escape or an explicit outside pointer click; focus changes and sidebar reconciliation do not save or cancel drafts.

- An unlimited extension-owned **Quick Access** system, internally backed by the proven Favorites repository and stable ChatGPT conversation IDs.
- One native-looking sidebar section containing nested folders, filed conversations, and loose Quick Access conversations. Folders are locations inside Quick Access, not a separate user-facing system.
- A consistent capped indentation system: root folders and root chats share the first level beneath Quick Access, while every nested folder/chat advances one level without changing text size.
- A quieter section-style Quick Access header with right-facing collapsed chevrons and downward-facing expanded chevrons.
- Wider flexible item-name regions with hidden action controls removed from normal row flow.
- Fade-based Compact overflow with a delayed, unobscured full-title hover reveal, plus a bounded two-line Full mode for long folder and conversation names.
- Literal conversation titles are preserved, including titles containing words such as `Pinned` or `OpenAI Pin`; native Pin metadata is excluded only through DOM structure, never title-string guesses.
- Existing Quick Access and folder title metadata refreshes now prefer rendered visible row text, reject blank or conflicting transitional snapshots, and use render generations that keep repository feedback from re-ingesting stale DOM titles.
- The supplied settings gear geometry rendered through a local `currentColor` mask for light/dark theme compatibility.
- One Wolf-owned sidebar block keeps **Wolf Expansion settings** above **Quick Access**, and places both immediately before ChatGPT's complete native Pinned section. Quick Access expansion remains independently owned by `wolfExpansion.quickAccessUiState`.
- Coordinated membership behavior: assigning any native conversation to a folder automatically adds it to Quick Access; moving it to the root preserves Quick Access; removing it from Quick Access also removes its folder assignment.
- A hard folders-above-chats ordering rule at the root and inside every folder, with separate manual ordering regions.
- Native drag/drop for ChatGPT Recent-chat rows into folders, Quick Access chats into folders, folder chats between folders, folder nesting, root movement, and sibling/chat reordering.
- Keyboard-accessible folder controls for New subfolder, Rename, Move into, Move to parent/root, Move up/down, and safe Delete.
- Stabilized shared create/rename editing with runtime draft state, explicit Enter/Escape/outside-click behavior, reconciliation-safe editor reuse, and narrowly scoped event/focus protection from ChatGPT's composer.
- Sidebar typography and editor density inherit ChatGPT's surrounding font metrics; nested depth changes indentation, never text size.
- Compact and Full item-name modes shared by both settings frontends. Compact names stay single-line and reveal genuine overflow on hover; Full names wrap safely.
- Outline/filled star actions for adding/removing the exact sidebar conversation from Quick Access without affecting ChatGPT's native Pin.
- Combined Quick Access and folder actions in both exact sidebar portal-menu contexts and strict current-conversation `/c/<id>` or `/g/<id>` contexts.
- Local original monochrome SVG icons using `currentColor`; no emoji icon set, remote assets, or runtime icon dependency.
- Local Wolf Expansion branding derived from the finalized repository artwork: the full wordmark remains a branding source/README asset, while Firefox metadata and settings use the wolf mark at appropriate compact sizes.
- Presentation-only deduplication: a Quick Access conversation assigned to a visible folder appears inside that folder without losing Quick Access state.
- Shared Quick Access and subordinate Folders settings in both the in-ChatGPT dialog and Firefox/Floorp Add-ons Preferences. Disabling Folders flattens starred chats without deleting membership; disabling Quick Access hides the whole organization system without deleting data.
- Plain conversation-identity normalization before every repository/storage handoff, including native-row drag payloads.
- Automatic visible-title refresh, persistent ordering/collapse state, safe folder deletion, typed events, debug logging, and feature lifecycle cleanup.
- A centralized ChatGPT DOM adapter, versioned namespaced `storage.local` data, and defensive migrations.

No AI, sync, native companion, tags, notes, Trash, or other later-roadmap features are implemented yet. See [ROADMAP.md](ROADMAP.md) for the locked long-term direction.

## Browser support

- Firefox 128 or newer
- Floorp versions based on Firefox 128 or newer

Chromium browsers are not supported in this milestone.

## Development setup

Requirements:

- Node.js 20 or newer
- npm

Install the development dependencies and build the extension:

```bash
npm install
npm run typecheck
npm test
npm run build
```

The unpacked development extension is generated in `dist/`. Node.js and npm are development tools only; the built extension has no external runtime or CDN dependencies.

For automatic TypeScript rebuilds during development:

```bash
npm run watch
```

Static manifest or options-page changes are also copied while the watcher is running.

## Load in Firefox or Floorp

1. Run `npm install` and `npm run build`.
2. Open `about:debugging`.
3. Select **This Firefox**.
4. Select **Load Temporary Add-on…**.
5. Choose `dist/manifest.json`.
6. Open or reload [chatgpt.com](https://chatgpt.com/).

Temporary extensions are removed when the browser exits. Rebuild and use **Reload** on the extension entry after source changes.

Open settings directly from the **Wolf Expansion** settings entry in ChatGPT's sidebar. The fallback page remains available from **Add-ons and themes** → **Extensions** → **ChatGPT: The Wolf Expansion** → **Preferences**.

## Manual Quick Access test

1. Test all four native **Pinned** / Wolf **Quick Access** expanded and collapsed combinations. Confirm each section retains its own state and the order remains **Wolf Expansion settings → Quick Access → Pinned → native history**.
2. Add a native conversation with its star, then drag another unstarred native conversation directly into a folder. Confirm both enter Quick Access and render once.
3. Move a foldered chat to Quick Access root, then unstar a foldered chat. Confirm the first keeps Quick Access membership while the second disappears from Wolf UI and leaves the native ChatGPT chat untouched.
4. Confirm root folders and loose chats align at one level beneath the quieter Quick Access header, nested content advances one indent per level, and expanded chevrons point down rather than left.
5. Switch the global Compact/Full default in both settings frontends, then use in-ChatGPT settings to set a parent folder to Full and a child to Inherit/Compact. Verify root chats use the global default and nested inheritance updates immediately. Folder-specific controls intentionally stay inside the resolved ChatGPT account context.
6. Enable reduced motion and verify title scrolling and expand/drag transitions stop without changing functionality.
7. Drag over folders and insertion boundaries; confirm only the current folder highlight or insertion line appears and no blank gaps remain afterward.
8. Disable Folders and confirm all starred chats appear flat at the root; re-enable it and confirm stored locations return. Disable Quick Access and confirm the entire Wolf organization UI hides without data loss.
9. Open a folder menu and click outside to close it. Start create/rename, type a draft, and click outside; confirm it cancels while Enter commits, Escape cancels, and ordinary sidebar reconciliation preserves the editor.
10. Rename both a root Quick Access chat and a foldered chat in ChatGPT without reloading. Confirm the title updates in place, membership/order remain unchanged, and Compact/Full overflow presentation follows the new title.
11. Rename a conversation to `Pinned: Test Chat` and confirm Wolf Expansion preserves that title literally in the row, tooltip, and accessible label.
12. Click `...` on a root and foldered Quick Access conversation whose native history row is mounted. Exercise Rename, direct Pin/Unpin, Archive, and Delete. Confirm each uses the exact conversation, ChatGPT still owns confirmation/editor behavior, and the newly opened live native control is invoked rather than a detached discovery menu.
13. Try `...` for a virtualized/unmounted native row and confirm the concise unavailable message appears without opening another chat's actions.
14. With account A signed in, create Quick Access/folder data; reload ChatGPT, restart Firefox/Floorp, and (if practical) change the account avatar. Confirm the same organization returns without creating a new Wolf namespace.
15. Log out, sign in as account B, then return to A. At every transition and reload, confirm no prior-account titles flash, B never sees A data, and A's original data returns only when A is resolved again.
16. On an upgrade that has dev.2.1 organization under an old account scope, open Wolf settings. Confirm data stays hidden until **Restore previous Quick Access data** is explicitly confirmed, then returns immediately. Confirm a nonempty destination is not overwritten and another account cannot claim the same backup.

Folder metadata lives in extension `storage.local`. Clearing ordinary ChatGPT site data or browser cache is not intended to remove it; explicitly clearing extension data or uninstalling the extension can.

## Architecture

The project uses strict TypeScript, native DOM APIs, CSS, Firefox WebExtension APIs, and esbuild. Runtime code is split into:

- `src/adapters/chatgpt/` — all ChatGPT-specific DOM discovery and SPA observation.
- `src/core/` — app startup, logging, and feature lifecycle.
- `src/storage/` — namespaced schemas, storage access, validation, and migrations.
- `src/settings/` — the shared typed settings service and browser-native options page.
- `src/features/settings/` — the lightweight in-ChatGPT settings frontend.
- `src/features/favorites/` — the preserved internal Favorites/Quick Access repository and identity events.
- `src/features/folders/` — the preserved folder repository and hierarchy rules.
- `src/features/quickAccess/` — unified projection, sidebar, drag/drop, menu integration, and lifecycle.

Current storage keys are:

- `wolfExpansion.schemaVersion`
- `wolfExpansion.settings`
- `wolfExpansion.favorites`
- `wolfExpansion.uiState`
- `wolfExpansion.folders`
- `wolfExpansion.folderMembership`
- `wolfExpansion.foldersUiState`
- `wolfExpansion.quickAccessUiState`
- `wolfExpansion.folderChatNameDisplayOverrides`
- `wolfExpansion.accounts.<opaque-hash>.*` for account-owned variants of the organization keys above
- `wolfExpansion.legacyAccountData` for conservatively preserved organization recovery data and opaque one-time claim/rebinding markers

## Privacy and security

- No telemetry, analytics, ads, subscriptions, or paid features.
- No extension account and no cloud service.
- No cookie, token, or browser-history access.
- No private or undocumented ChatGPT APIs.
- No remote scripts or runtime network dependencies.
- Host access is limited to `https://chatgpt.com/*`.
- Live extension data remains in Firefox `storage.local`; manual JSON backup creates an external user-controlled copy that can survive uninstall when the user stores it safely.
- The raw stable ChatGPT `user-...` identifier is decoded only from the rendered Estuary profile-image carrier, validated in memory, and locally hashed before it is used as a storage namespace. The decoded payload and raw user ID are not persisted. Avatar paths, display names, usernames, and email addresses are never identity fallbacks. No cookie, token, auth header, private API, or network request is involved.
- If the stable user ID cannot be resolved safely, Wolf hides account-owned organization data and blocks account-owned writes instead of guessing. Legacy/unbound data and known old opaque scopes are never silently assigned; recovery requires an explicit in-ChatGPT confirmation and an empty destination.
- Quick Access, folders, ordering, collapse state, and settings do not use ChatGPT storage, `window.localStorage`, `sessionStorage`, or the browser/site cache. Clearing ordinary ChatGPT site data or cache is not intended to clear extension storage. Explicitly clearing or uninstalling the extension can remove live data, so users should retain downloaded backup files outside the extension.

## Known limitations

- ChatGPT may change its sidebar or menu DOM. The adapter fails safely and keeps stored metadata untouched, but UI integration can temporarily stop appearing until selectors are updated.
- Row integration first targets native Pin/menu controls and then falls back to a smaller unambiguous row-owned sibling slot. It never uses fixed screen coordinates or overlays native controls.
- Menu integration requires either an exact sidebar-row opener identity or an overflow-style current-conversation opener on a real `/c/<id>` or `/g/<id>` page. Other ChatGPT menus remain untouched.
- A conversation deleted on ChatGPT remains in local Quick Access/folder metadata because absence from the visible sidebar is not proof of deletion. Opening it may lead to ChatGPT's missing-conversation page; it can still be removed locally.
- Conversation titles update only from exact-ID native rows ChatGPT currently exposes. A single changed title can supersede its cached duplicate; genuinely ambiguous conflicting observations are still ignored safely.
- Native actions in the local Quick Access menu require the exact matching ChatGPT history row and native menu trigger to be mounted. Wolf Expansion does not scroll history, navigate, or guess when the row is unavailable; Wolf-owned organization actions remain usable.
- Account resolution relies on the opaque stable user ID carried by ChatGPT's rendered Estuary profile image. If ChatGPT removes or changes that carrier, organization UI remains fail-closed until the adapter is updated.
- The v0.2-dev.3 backup/restore UI, natural root reparenting, and `/g/` DOM integration require signed-in Firefox/Floorp live verification.
- This milestone assigns each conversation to at most one folder. Folder references do not hide or move ChatGPT's native Recent-chat row.

## License

Copyright © 2026 Wolfy and contributors.

This project is licensed under the GNU General Public License version 3 only. See [LICENSE](LICENSE).
