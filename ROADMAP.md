# ChatGPT: The Wolf Expansion — Roadmap

> **Status:** Planning / pre-development  
> **Primary browsers:** Firefox, Floorp  
> **Possible later support:** Chromium-based browsers  
> **License goal:** Fully free and open source  
> **Paid features:** None  
> **Subscriptions:** None  
> **Accounts required by the extension:** None

## Project Principle

**ChatGPT: The Wolf Expansion** is a power-user quality-of-life extension for ChatGPT.

The goal is to enhance ChatGPT without replacing it with a giant dashboard or separate productivity platform. Features should feel native where possible, remain modular, and be individually configurable.

A user should be able to enable everything and get a powerful ChatGPT workspace, or disable almost everything and keep only a few lightweight features such as Favorites and Folders.

### Hard Rules

- Fully free and open source.
- No paid tier.
- No subscriptions.
- No feature paywalls.
- No artificial usage limits.
- No ads.
- No telemetry by default.
- No extension account requirement.
- No mandatory cloud service.
- Firefox and Floorp are the only supported browsers initially.
- Chrome/Chromium support may be considered later.
- Existing planned features are considered **locked baseline features** unless explicitly changed.
- Future ideas are additions by default, not replacements/removals.
- All major features and UI elements must be toggleable/configurable where practical.
- Core functionality must work without AI.
- Core functionality must work without the optional native companion.
- AI must never automatically send a prompt without user action.
- The extension should enhance ChatGPT rather than recreate ChatGPT.

---

# Planned Technology

## Browser Extension

Primary language:

- **TypeScript**
- HTML
- CSS

Primary responsibilities:

- ChatGPT DOM integration
- Sidebar enhancements
- Organization
- Search
- Notes
- Bookmarks
- Export
- Settings
- Dashboard
- Local storage
- Local AI integration
- Keyboard shortcuts
- Chat/message QoL

## Optional Native Companion

Primary language:

- **Rust**

Possible name:

- `Wolf Expansion Bridge`

Responsibilities:

- Native filesystem access
- Local cloud-folder synchronization
- Codex CLI integration
- Heavier local model integrations if ever needed
- Future native desktop integrations

The browser extension must remain usable without the native companion.

## Local AI

Possible technologies:

- Transformers.js
- WebGPU
- WASM
- Small embedding models
- Small local instruction models

Local AI must be optional and must not be downloaded or initialized unless enabled.

---

# 1. Favorites / Enhanced Pinning

The extension will provide its own unlimited Favorites system instead of depending on ChatGPT's native pin limit.

Planned features:

- Unlimited favorite chats.
- Favorite/unfavorite directly from ChatGPT's normal chat menu.
- Favorites section near the top of the ChatGPT sidebar.
- Manual favorite ordering.
- Drag-and-drop ordering.
- Favorite folders.
- Multiple favorite groups.
- Rename favorite groups.
- Collapse/expand favorite groups.
- Optional favorite indicator beside chat titles.
- Hide/show Favorites section.
- Optional native pin integration.
- Optional handling of duplicate native ChatGPT pins.
- Possible options:
  - Show native pins and Wolf Expansion favorites.
  - Hide duplicate native pins.
  - Merge/native-display behavior where technically practical.

Example:

```text
⭐ Active
├── WGH
├── Extension Development
└── Current Project

⭐ Keep Around
├── Hardware
└── Linux
```

---

# 2. Folders

Folders are one of the core features of the extension.

Planned features:

- Unlimited folders.
- Unlimited nested subfolders.
- Drag chats into folders.
- Drag folders into other folders.
- Manual folder ordering.
- Rename folders.
- Delete folders without deleting chats.
- Duplicate folders where useful.
- Collapse/expand folders.
- Folder icons.
- Optional folder colors.
- Chat count display.
- Recently used folder shortcuts.
- Add/move chat to folder from ChatGPT's normal chat menu.
- Multi-select chats and move them together.
- Favorite/pin folders.
- Folder-specific sorting:
  - Manual
  - Newest
  - Oldest
  - Alphabetical
  - Last used
- Smart folders later.
- AI-generated folder suggestions later.

Folder membership is extension-side metadata and should not require moving or deleting the underlying ChatGPT conversation.

---

# 3. Tags

Planned features:

- Unlimited tags.
- Multiple tags per chat.
- Tag colors.
- Tag search.
- Tag filtering.
- Favorite tags.
- Rename tags globally.
- Merge tags.
- Bulk tagging.
- Manual tags.
- AI-created tags.
- System tags.
- Tag origin metadata:
  - `manual`
  - `ai`
  - `system`
- AI tags may optionally display a `✨` indicator.

Example:

```text
Folder:
Development / WolfComms

Tags:
#rust
#discord
#translation
#asr
```

---

# 4. Better Conversation Search

Planned search targets:

- Chat title.
- Folder.
- Tags.
- Notes.
- Conversation text where locally indexed.
- Date.
- Favorites.
- Trash state.
- AI-generated summaries.
- Message bookmarks.

Possible advanced filters:

```text
folder:Development
tag:rust
favorite:true
after:2026-08-01
```

A GUI should exist so advanced syntax is optional.

---

# 5. Semantic Search

Optional local-AI feature.

Goal:

Allow natural-language searches such as:

> that PCBS recovery chat where the save was mostly zeros

without needing the exact conversation title or exact wording.

Possible implementation:

- Local embedding model.
- Local vector index.
- Conversation summaries and/or indexed chunks.
- Similarity search.

No external AI service should be required.

---

# 6. Chat Notes

Planned features:

- Private local note per conversation.
- Markdown support.
- Search notes.
- Optional note indicator in sidebar.
- Notes included in backup/export.
- Notes never sent to ChatGPT unless explicitly inserted by the user.

---

# 7. Message Bookmarks

Planned features:

- Bookmark individual user or assistant messages.
- Custom bookmark title.
- Bookmark notes.
- Bookmark tags.
- Search bookmarks.
- Jump directly to bookmarked message.
- Bookmark manager/dashboard view.

---

# 8. Conversation Navigator

Designed for very long chats.

Planned features:

- List user prompts within the current conversation.
- Jump to any prompt.
- Search within current conversation.
- Previous/next user prompt.
- Previous/next assistant response.
- Show bookmarked messages.
- Detect useful headings in assistant responses where practical.
- Optional right-side panel or popup.
- Fully collapsible and disableable.

---

# 9. Message and Conversation Timestamps

Planned features:

- Exact message timestamps where detectable.
- Relative time optionally.
- Conversation creation date where available.
- Last updated date.
- Configurable date/time format.

Examples:

```text
30-08-2026 22:16
2026-08-30 22:16
10:16 PM
```

---

# 10. Better Copying

Planned features:

- Copy complete assistant response.
- Copy complete conversation.
- Copy only user messages.
- Copy only assistant messages.
- Copy selected message range.
- Markdown-preserving copy.
- Plain-text copy.
- Copy individual code block.
- Copy all code blocks.
- Copy conversation title + link.
- Optional removal of UI-only junk/citation artifacts where possible.

---

# 11. Export

Planned export formats:

- Markdown
- HTML
- JSON
- TXT
- PDF later
- ZIP conversation bundle later

Possible export options:

- Include timestamps.
- Include images.
- Include attachments where accessible.
- Include folder/tag/favorite metadata.
- Include notes.
- Include bookmarks.
- Export selected chats.
- Export folder.
- Export everything.
- Export extension metadata separately.

---

# 12. Import

Planned features:

- Import Wolf Expansion configuration.
- Import folders.
- Import tags.
- Import notes.
- Import bookmarks.
- Import prompt library.
- Import settings.
- Import backups.
- Validate imported data before applying it.
- Prevent duplicate/corrupt metadata where possible.

---

# 13. Image Quality-of-Life Tools

Planned features:

- Download individual generated image.
- Download all images from current chat.
- Download images from selected chats.
- Sensible filenames.
- Preserve best/original available resolution where possible.
- Copy image.
- Show accessible image metadata where available.
- Image assets may be included in local sync/backups later.

---

# 14. Code Quality-of-Life Tools

Planned features:

- Copy code block.
- Download code block.
- Detect/suggest filename where possible.
- Language indicator.
- Collapse long code blocks.
- Toggle line wrapping.
- Optional line numbers.
- Copy all code blocks.
- Diff-friendly copy options.
- Send selected code to optional Codex bridge later.

---

# 15. Prompt Library

Fully local prompt management.

Planned features:

- Prompt folders.
- Prompt tags.
- Prompt favorites.
- Prompt search.
- Insert prompt without sending.
- Keyboard shortcuts.
- Context-menu integration.
- Prompt variables.

Example:

```text
Review this {{language}} code for:
{{goal}}
```

The extension can ask for:

```text
language: Rust
goal: memory safety
```

before inserting the prompt.

---

# 16. Draft Protection

Planned features:

- Autosave unsent ChatGPT composer text locally.
- Separate draft per conversation.
- Restore draft after accidental refresh/crash.
- Draft history.
- Optional clipboard-related recovery.
- Configurable retention.
- Clear drafts manually.

---

# 17. Sidebar Improvements

Planned features:

- Resizable sidebar.
- Optional wider sidebar.
- More title lines.
- Compact mode.
- Show dates.
- Show folder/tag badges.
- Hover preview.
- Manual sorting.
- Filter archived/project chats where possible.
- Hide unwanted ChatGPT sidebar sections where practical.
- Custom section ordering.
- Collapse ChatGPT sections.
- Favorites/folders near the top.
- Native-looking UI.

Example:

```text
New Chat
Search

⭐ Favorites
📁 Folders
🏷 Tags

Projects
GPTs

Recent
```

---

# 18. Bulk Actions

Planned features:

- Multi-select chats.
- Favorite/unfavorite.
- Move to folder.
- Add/remove tags.
- Archive.
- Move to Trash.
- Export.
- Add note.
- Download media.
- Bulk restore from Trash.

Destructive operations must require appropriate confirmation.

---

# 19. Trashcan / Safe Deletion

Wolf Expansion should not immediately delete chats when the user chooses its delete action.

Planned behavior:

- Extension delete action becomes **Move to Trash**.
- Trashed chats receive a protected system tag:
  - `Trashed`
- The `Trashed` tag:
  - Cannot be manually deleted.
  - Cannot be renamed.
  - Cannot be applied manually to normal chats.
- Trashed chats disappear from normal views by default.
- Dedicated Trash view.
- Default retention: **30 days**.
- Retention period configurable.
- Automatic permanent deletion configurable.
- Manual Restore.
- Moving a chat out of Trash restores it.
- Sending a new message in a trashed conversation automatically restores it.
- Merely opening/reading a trashed chat does not restore it.
- Restore removes the `Trashed` system tag.
- Optional final local backup before permanent purge.
- If permanent ChatGPT deletion cannot be performed safely due to a site change, mark the item as purge-pending rather than risking deletion of the wrong conversation.

---

# 20. Archive Improvements

Planned features:

- Better local archive filtering.
- Archive categories.
- Restore shortcuts.
- Bulk archive.
- Archive by age later.
- Exclude favorites from automatic archival.
- Optional future rules such as:
  - Archive chats untouched for X months.

Automatic archival should be disabled by default.

---

# 21. Counters

Optional utilities:

- Character count.
- Word count.
- Code line count.
- Approximate token count.
- Selected-text statistics.
- Conversation size estimate.

Counters should be individually toggleable.

---

# 22. Message Collapsing

Planned features:

- Collapse individual assistant messages.
- Collapse individual user messages.
- Collapse code blocks.
- Collapse images.
- Collapse tool outputs where detectable.
- Store collapse state locally.
- Optional auto-collapse rules.

---

# 23. Keyboard Shortcuts

Planned features:

- Fully configurable shortcuts.
- Detect shortcut conflicts.
- Enable/disable individual shortcuts.

Possible defaults:

```text
Ctrl+Alt+F  Favorite chat
Ctrl+Alt+M  Move to folder
Ctrl+Alt+P  Open prompt library
Alt+Up      Previous prompt
Alt+Down    Next prompt
```

---

# 24. Settings

All major features must be configurable.

Possible sections:

```text
Organization
[x] Favorites
[x] Folders
[x] Tags

Messages
[x] Timestamps
[x] Message bookmarks
[ ] Word counter

AI
[ ] Local AI
[ ] Codex Bridge

Sync
[ ] Local Cloud Folder Sync
```

A user should be able to install the extension and use only:

- Favorites
- Folders

with everything else disabled.

---

# 25. Dashboard

A small dashboard is planned, but it must not become the main product.

Purpose:

- Settings.
- Global search.
- Folder/tag management.
- Prompt library.
- Bookmark manager.
- Trash.
- Backup/restore.
- Sync status.
- AI configuration.
- Extension data overview.

Normal daily usage should remain inside ChatGPT itself.

---

# 26. Backup System

Backup is a dedicated subsystem, not just an Export button.

Planned features:

- Automatic versioned metadata snapshots.
- Backup before destructive operations.
- Full extension-state backup.
- Partial restore where practical.
- Manual backup.
- Manual restore.
- Backup retention settings.
- Backup corruption detection where practical.
- Keep backups logically separate from live sync state.

---

# 27. Local Cloud Folder Sync

This feature means synchronization through a folder chosen by the user.

Examples:

- OneDrive local synced folder.
- Google Drive for Desktop folder.
- Dropbox folder.
- Syncthing folder.
- NAS-mounted folder.
- Ordinary local folder.

The extension does not need to operate its own cloud server.

## Goals

Synchronize extension metadata such as:

- Settings.
- Favorites.
- Folders/subfolders.
- Tags.
- Notes.
- Bookmarks.
- Prompt library.
- Trash state.
- Smart folders.
- Smart tags.
- AI metadata.
- Dashboard configuration.
- Search/index metadata where appropriate.

Possible assets:

- Saved/generated images.
- Other media.
- Export bundles.

## Conflict Handling

Do not rely on every device repeatedly overwriting one large `data.json`.

Prefer a device-aware operation journal or merge-friendly structure.

Example:

```text
WolfExpansion/
├── manifest.json
├── devices/
│   ├── desktop-7f2a/
│   │   └── operations/
│   └── laptop-a41c/
│       └── operations/
├── snapshots/
├── assets/
│   └── <sha256>...
└── backup/
```

Goals:

- Avoid OneDrive/Google Drive conflict-copy chaos.
- Allow two devices to make changes independently.
- Deterministically merge compatible updates.
- Detect actual conflicts.
- Preserve recent known-good snapshots.
- Use unique device IDs.

The optional Rust native companion may provide filesystem access.

## Fallback

Even if automatic local cloud-folder sync is delayed or not implemented immediately:

- Full data export must exist.
- Full data import must exist.
- Backup/restore must exist.

---

# 

```
# 27A. Multi-Account / Account Switching

Wolf Expansion may provide optional multi-account support for ChatGPT, inspired by account-switching extensions such as RoSeal.

This feature must remain optional. Wolf Expansion itself does **not** require a separate extension account.

## Goals

Allow the user to keep multiple ChatGPT accounts available and switch between them without repeatedly logging out and manually signing back in.

Planned features:

- Multiple saved account slots.
- One-click account switching.
- Account-specific display name/avatar where safely available.
- Clear indication of which ChatGPT account is currently active.
- Add a currently signed-in ChatGPT account as an account slot.
- Remove an individual account slot without affecting other saved accounts.
- Log out an individual account.
- Optional account ordering.
- Optional account nicknames for easier identification.
- Account-management UI in Wolf Expansion settings.
- Quick account switcher accessible from ChatGPT where practical.
- Support many account slots.
- Initial design target of up to roughly 100 account slots where browser capabilities permit.
- No artificial paid/account-count limits imposed by Wolf Expansion.

## Session Isolation

Do not implement account switching by copying raw ChatGPT authentication tokens into normal Wolf Expansion storage.

Prefer browser-supported isolation.

For Firefox/Floorp, a likely architecture is:

```text
Wolf Expansion Account Manager
│
├── Account Slot A
│   ├── isolated browser/container session
│   └── Wolf account scope A
│
├── Account Slot B
│   ├── isolated browser/container session
│   └── Wolf account scope B
│
└── Account Slot C
    ├── isolated browser/container session
    └── Wolf account scope C
```

Possible technologies:

- Firefox contextual identities / containers.
- Separate browser cookie stores.
- Browser-supported session isolation.

The browser should retain the actual ChatGPT login session where possible.

Wolf Expansion should retain only the metadata needed to associate an account slot with its isolated browser session.

Do not persist:

- ChatGPT access tokens.
- ChatGPT session tokens.
- Authentication headers.
- Copied login cookies inside normal extension metadata.
- Private API credentials.

## Account-Scoped Wolf Data

All ChatGPT-account-specific Wolf Expansion data must remain isolated between accounts.

Examples:

- Quick Access membership.
- Folders and subfolders.
- Conversation metadata.
- Tags.
- Notes.
- Message bookmarks.
- Trash state.
- Prompt/chat-specific metadata.
- Account-specific sidebar state.
- Account-specific organizational settings where appropriate.
- Search/index metadata tied to conversations.
- AI-generated metadata tied to conversations.

Example:

```
Account A
├── Quick Access A
├── Folders A
└── Tags A

Account B
├── Quick Access B
├── Folders B
└── Tags B
```

Account B must never display Account A's conversation-specific data.

## Logged-Out State

When ChatGPT is logged out:

- Do not display conversation-specific Quick Access data from the previously active account.
- Do not expose folders containing inaccessible conversations.
- Do not delete the previous account's Wolf metadata merely because the user logged out.
- Global Wolf Expansion settings may remain available.
- Account-specific data should return when the matching account becomes active again.

If the active ChatGPT account cannot be identified safely and confidently:

**fail closed and do not display account-owned conversation data.**

## Account Switching

Switching accounts should:

1. Resolve the requested saved account slot.
2. Open/switch to its isolated ChatGPT browser session.
3. Reset transient Wolf Expansion state from the previous account.
4. Load the selected account's Wolf metadata scope.
5. Reconcile that account's currently available conversations.
6. Render only data belonging to that account.

Transient state that must not cross account boundaries includes:

- Open Wolf menus.
- Native action targets.
- Rename drafts.
- Active conversation state.
- Drag/drop state.
- Temporary title previews.
- Pending native-menu delegation.

No account switch should briefly render the previous account's Quick Access data.

## Data Safety

Account identity must be treated separately from conversation identity.

Conceptually:

```
account scope
    └── conversation ID
            └── Wolf metadata
```

A conversation ID by itself must not be assumed to belong to whichever account happens to be active.

Account removal should not silently destroy local Wolf data unless the user explicitly chooses to remove that account's stored extension data.

Where practical, offer separate choices such as:

```
Remove account session
Remove account session + Wolf data
```

Destructive account-data removal must require confirmation.

## Backup and Sync

Backup/export should preserve account boundaries.

Example:

```
WolfExpansion/
├── global/
├── accounts/
│   ├── <account-scope-a>/
│   └── <account-scope-b>/
└── devices/
```

Local Cloud Folder Sync must not merge conversation metadata from different ChatGPT accounts into one undifferentiated namespace.

Account/session credentials themselves should not be included in normal Wolf Expansion backups or cloud-folder synchronization.

## Privacy

Multi-account support must preserve the existing Wolf Expansion privacy principles:

- No Wolf Expansion account required.
- No extension-operated account server.
- No mandatory cloud service.
- No telemetry requirement.
- No advertising.
- No selling or sharing account-session data.
- No private ChatGPT API dependency.
- No raw authentication-token storage for account switching.

The feature should use browser-supported session isolation wherever practical.

---

# 28. Privacy Controls

Planned privacy page/status display.

Example:

```text
Stored locally:
✓ Folders
✓ Favorites
✓ Tags
✓ Notes
✓ Search index

Sent externally:
Nothing
```

If Codex is enabled:

```text
Codex Bridge:
Only explicitly submitted content is sent.
```

If Local AI is enabled:

```text
Local AI:
Runs on-device.
```

Principles:

- No hidden telemetry.
- No advertising.
- No remote tracking.
- No mandatory analytics.
- No account required.

---

# 29. Local AI

Local AI is optional.

Possible uses:

- Suggest folder.
- Suggest tags.
- Automatically create tags.
- Automatically apply tags.
- Suggest conversation title.
- Summarize conversation.
- Related-chat discovery.
- Semantic search.
- Duplicate/near-duplicate detection.
- Smart folder suggestions.
- Smart tag suggestions.
- Prompt enhancement.
- Prompt generation.
- Idea generation.

The model must not load unless the user enables the feature.

---

# 30. Automatic AI Tagging

Planned features:

- AI automatically suggests tags.
- AI can automatically apply tags.
- AI can create new tags.
- Confidence threshold configurable.
- Auto-create tags independently toggleable.
- Auto-apply tags independently toggleable.
- AI should not silently remove manual tags.
- AI and manual tags can coexist.
- AI-created tags store `origin: ai`.

---

# 31. AI-Generated Indicator

Generated organization objects may display:

```text
✨
```

Examples:

- `✨ Rust`
- `✨ Related Projects`
- `✨ Coding`

Planned behavior:

- AI-created tags can display `✨`.
- AI-created smart folders can display `✨`.
- AI-created organizational objects can display `✨`.
- Indicator can be disabled globally.
- The actual origin must still be stored internally even if the visual indicator is disabled.

---

# 32. Local Embedding Model

Embeddings should be separate from the generative local model.

Possible uses:

- Semantic conversation search.
- Related conversations.
- Conversation clustering.
- Smart folders.
- Duplicate detection.
- Similarity matching.

A small local embedding model may be preferable to a full LLM for these tasks.

---

# 33. Smart Folders

Possible examples:

```text
✨ Recently Active
✨ Coding
✨ WGH
✨ Chats With Images
✨ Chats From Last 7 Days
```

Smart folders may be based on:

- Manual rules.
- Tags.
- Dates.
- Favorites.
- Content type.
- AI classification.
- Embedding similarity.

Possible rule example:

```text
tag = rust
AND
updated < 30 days
```

Smart folders should be optional.

---

# 34. Smart Tags

Possible features:

- Rule-generated tags.
- AI-generated tags.
- Automatically updated tags.
- Generated indicator.
- Manual override.
- Disable per tag.
- Convert generated tag to manual tag.

---

# 35. Local Mini LLM

Optional downloadable model.

Possible modes:

```text
Local Model

○ Off
● Lightweight
○ Balanced
○ Custom
```

Potential use cases:

- Short summaries.
- Folder suggestions.
- Tag suggestions.
- Chat title suggestions.
- Prompt improvement.
- Prompt writing.
- Idea generation.

Do not bundle a large model into the base extension package.

---

# 36. Enhance Prompt

AI-assisted composer feature.

Workflow:

1. User writes a prompt.
2. User clicks **Enhance Prompt**.
3. AI improves structure, clarity, specificity, or formatting.
4. The improved version is shown/inserted.
5. User chooses whether to use it.
6. The extension never sends it automatically.

Planned features:

- Local AI support.
- Optional Codex support.
- Undo to original.
- Preview/diff mode.
- Accept/reject.
- Enhancement styles:
  - Concise
  - Detailed
  - Coding
  - Research
  - Creative
  - Preserve wording
- Custom enhancement instructions later.

---

# 37. AI Write Prompt

AI can build a full prompt from a rough idea.

Example input:

```text
find why my Rust app leaks memory
```

Possible output:

```text
Review the following Rust application for likely memory-retention or resource-lifetime issues...
```

Behavior:

- Insert into composer.
- Never auto-send.
- User can edit before sending.
- Local AI or optional Codex provider.

---

# 38. AI Suggestions / Idea Generator

Optional manually opened AI helper.

Possible uses:

- Prompt ideas.
- Follow-up ideas.
- Project brainstorming.
- Alternative approaches.
- Organization suggestions.
- Context-aware suggestions for the current conversation when enabled.

It should not permanently clutter the ChatGPT interface.

---

# 39. AI Provider Architecture

AI features should not be tightly coupled to one provider.

Possible internal design:

```text
AIProvider
├── NoneProvider
├── LocalModelProvider
└── CodexProvider
```

Possible later providers:

- Ollama
- LM Studio
- Other fully local/open integrations

No provider should be required for core features.

---

# 40. Codex Bridge

Optional advanced feature.

Possible architecture:

```text
Firefox Extension
      ↓
Firefox Native Messaging
      ↓
Wolf Expansion Bridge (Rust)
      ↓
Codex CLI
```

Possible features:

- Analyze selected conversation.
- Deep organization suggestions.
- Code-heavy conversation summaries.
- Send selected code to Codex.
- Advanced prompt enhancement.
- Advanced prompt writing.
- Create files/project output where explicitly requested.
- Future workspace integrations.

The extension should use supported Codex interfaces only.

Do not build around:

- scraping private ChatGPT APIs,
- stealing session tokens,
- undocumented browser-auth tricks.

---

# 41. Provider Fallback

Possible optional configuration:

```text
AI Provider

○ None
● Local AI
○ Codex
○ Local + Codex fallback
```

For fallback mode:

- Try local AI first.
- Use Codex only when explicitly allowed.
- Clearly show when content will leave the device.
- Never silently send entire chats externally.

---

# 42. Native-Looking ChatGPT Integration

Where possible, features should appear in existing ChatGPT UI.

Example chat menu:

```text
Share
Rename
Archive
────────────
⭐ Add to Favorites
📁 Add to Folder >
🏷 Tags >
📝 Add Note
────────────
🗑 Move to Trash
```

The extension should avoid requiring a separate management screen for ordinary actions.

---

# 43. DOM Resilience

ChatGPT is a React application and its DOM/CSS can change frequently.

Use a dedicated adapter layer rather than spreading fragile selectors across the codebase.

Possible design:

```text
ChatGPTAdapter
├── findSidebar()
├── findConversationMenu()
├── getConversationId()
├── getConversationLink()
├── getMessageElements()
├── findComposer()
└── watchNavigation()
```

Principles:

- Prefer stable URLs and semantic attributes.
- Avoid relying on generated CSS class names.
- Use `MutationObserver` where needed.
- Centralize ChatGPT-specific DOM logic.
- Fail safely when ChatGPT changes.

---

# 44. Modular Feature System

Possible source structure:

```text
src/
├── core/
├── adapters/
├── storage/
├── sync/
├── dashboard/
├── settings/
├── features/
│   ├── favorites/
│   ├── folders/
│   ├── tags/
│   ├── notes/
│   ├── bookmarks/
│   ├── timestamps/
│   ├── navigator/
│   ├── drafts/
│   ├── trash/
│   ├── export/
│   ├── prompts/
│   └── ai/
└── native/
```

Each major feature should be possible to disable independently where practical.

---

# 45. Storage Model

Extension metadata should be keyed to stable ChatGPT conversation IDs whenever possible.

Example conceptual record:

```text
conversation
├── favorite state
├── folders
├── tags
├── notes
├── bookmarks
├── trash metadata
├── timestamps
├── AI metadata
├── summary
└── sync revision
```

Possible storage technologies:

- WebExtension `storage.local`
- IndexedDB for larger/indexed data
- Optional native sync directory via Rust companion

---

# 46. Settings Portability

Settings should be included in:

- Manual export.
- Full backup.
- Local cloud sync when enabled.

Settings should support sensible migration between extension versions.

---

# 47. Feature Backing / Recovery Support

Important features should have backing data so that one broken UI state does not destroy user organization.

Examples:

- Versioned metadata.
- Backup before destructive changes.
- Sync revisions.
- Import validation.
- Trash retention metadata.
- AI-origin metadata.
- Stable IDs.
- Migration support.

---

# 48. Error Handling

Planned principles:

- Never silently lose metadata.
- Never delete a ChatGPT conversation if the extension is unsure which chat is targeted.
- Show recoverable errors.
- Keep failed sync operations queued.
- Preserve last known-good state.
- Detect incompatible/corrupt backup files.
- Prefer safe failure over destructive guesses.

---

# 49. Performance

The extension must stay lightweight even with many features.

Principles:

- Disabled features should consume effectively no ongoing work.
- Avoid scanning the entire DOM unnecessarily.
- Lazy-load expensive modules.
- Lazy-load AI models.
- Index chats incrementally.
- Avoid enormous UI frameworks unless genuinely justified.
- Avoid unnecessary background polling.
- Use caching intelligently.
- Keep the normal ChatGPT experience responsive.

---

# 50. Accessibility

Planned considerations:

- Keyboard navigation.
- Screen-reader-friendly controls where practical.
- Proper labels.
- Avoid color-only status indicators.
- Configurable animations.
- Respect reduced-motion settings.
- Maintain usable contrast.

---

# 51. UI Customization

Possible configurable UI options:

- Section ordering.
- Sidebar section visibility.
- Compact/comfortable density.
- Folder icons.
- Folder colors.
- Tag colors.
- Generated `✨` marker.
- Dashboard modules.
- Hover previews.
- Number of title lines.
- Sidebar width.
- Animation toggles.

The extension should avoid forcing a custom theme.

---

# 52. Browser Support

Initial supported browsers:

- Firefox
- Floorp

Later consideration:

- Chrome
- Chromium browsers

Initial development should prioritize Firefox-native WebExtension APIs rather than introducing unnecessary cross-browser abstraction immediately.

---

# 53. Publishing

Planned distribution:

- Mozilla Add-ons (AMO)
- GitHub source repository
- GitHub releases if useful

The project should not require paying to publish.

---

# 54. Licensing

Preferred direction:

- GPL-3.0

Reason:

Keep redistributed modified versions open source and discourage closed-source paid forks based directly on the project.

Final license can still be decided before public release.

---

# 55. Explicit Non-Goals

Do **not** add:

- Paid plans.
- Subscriptions.
- Feature paywalls.
- Ads.
- Crypto.
- Prompt marketplace.
- Social network.
- Mandatory account.
- Mandatory cloud sync.
- Forced AI.
- Giant replacement dashboard.
- Custom chatbot replacing ChatGPT.
- Hidden telemetry.
- Remote tracking.
- Unnecessary all-sites browser permissions.
- Heavy UI frameworks without a real need.
- Automatic AI submission without user confirmation.

---

# Development Phases

## v0.1 — Sidebar Foundation

Target:

- Favorites.
- Folders.
- Nested folders.
- Drag-and-drop.
- Chat menu integration.
- Manual ordering.
- Local persistence.
- Backup/export foundation.
- Settings foundation.
- Native-looking sidebar UI.

## v0.2 — Data Safety & Portability / Organization Reliability

Target:

- Versioned, integrity-checked manual backup/export/import.
- Storage migration and account-boundary resilience.
- Reliable folder movement and hierarchy interaction.
- Route-aware conversation navigation, including surviving `/g/` chats.
- Tags, notes, better search, bulk selection, and the dashboard remain planned after this reliability layer is stable.

## v0.3 — Conversation QoL

Target:

- Timestamps.
- Message bookmarks.
- Conversation navigator.
- Message/code collapsing.
- Draft recovery.
- Keyboard shortcuts.
- Better copying.

## v0.4 — Power Tools

Target:

- Prompt library.
- Better exports.
- Code tools.
- Image/media tools.
- Full conversation manager.
- Backup improvements.
- Trashcan.

## v0.5 — Local Intelligence

Target:

- Local embeddings.
- Semantic search.
- Related chats.
- Duplicate detection.
- Smart folders.
- Smart tags.

## v0.6 — Local Generative AI

Target:

- Optional mini LLM.
- AI summaries.
- AI titles.
- Automatic tag suggestions.
- Automatic tag creation.
- Folder suggestions.
- Enhance Prompt.
- AI Write Prompt.
- AI Suggestions / Idea Generator.

## v0.7 — Native Companion / Sync / Codex

Target:

- Rust Wolf Expansion Bridge.
- Local cloud-folder sync.
- Conflict-safe multi-device synchronization.
- Asset-folder support.
- Codex CLI bridge.
- Optional local + Codex fallback.

---

# Final Design Goal

**Powerful when enabled. Almost invisible when disabled.**

A minimal user should be able to run only:

```text
⭐ Favorites
📁 Folders
```

A power user should eventually be able to run:

```text
Organization
Search
Notes
Bookmarks
Trash
Backups
Local Cloud Sync
Prompt Library
Semantic Search
Local AI
Smart Folders
Smart Tags
Codex Integration
```

without any feature being locked behind payment.

---

# Working Name

## ChatGPT: The Wolf Expansion

Firefox/Floorp-first. Free. Open source. Modular. Local-first where possible.
