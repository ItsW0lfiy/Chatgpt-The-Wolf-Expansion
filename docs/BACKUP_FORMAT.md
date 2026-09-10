# Wolf Expansion backup format

Wolf Expansion backup files use the format identifier
`chatgpt-the-wolf-expansion-backup` and format version `1`. The JSON document is
fully local and is generated without reading ChatGPT authentication state.

The top-level envelope contains:

- `format` and `formatVersion` for compatibility checks;
- `createdAt`, `wolfExpansionVersion`, and the storage `schemaVersion`;
- `data`, containing normalized settings, legacy recovery metadata, unscoped
  legacy organization data, and every opaque account-scoped namespace;
- `integrity`, a SHA-256 hash of the canonical JSON representation of every
  top-level field except `integrity`.

Each account namespace contains the seven account-owned values as one unit:
Quick Access membership, its UI state, folders, folder membership, folder UI
state, unified Quick Access UI state, and per-folder chat-name display
overrides. Scope names are already one-way SHA-256 identifiers. Raw ChatGPT
user IDs and authentication data are never exported.

Restore validates the complete envelope, checksum, account scope names, field
types, folder relationships, and conversation routes before writing anything.
Format version 1 uses replace semantics: all Wolf Expansion storage is replaced
with the validated backup while account boundaries remain intact. A snapshot of
the pre-restore Wolf Expansion state is retained in extension storage as an
immediate safety copy. If applying the restore fails, the previous values are
restored instead of leaving a partial import.

Backups may contain private organization data such as conversation IDs, saved
conversation titles, folder names, and ordering metadata. Users should store
the file somewhere they trust. Keeping it in a user-controlled synced folder is
supported; Wolf Expansion does not upload it or provide cloud sync.
