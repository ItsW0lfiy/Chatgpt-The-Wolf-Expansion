import { STORAGE_SCHEMA_VERSION, type WolfExpansionSettings } from "../storage/schemas";

export const DEFAULT_SETTINGS: WolfExpansionSettings = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  enabled: true,
  debug: {
    enabled: false,
  },
  compatibility: {
    navigationFixes: false,
  },
  favorites: {
    enabled: true,
    showIcon: true,
    rememberCollapsed: true,
    itemNameDisplay: "compact",
  },
  folders: {
    enabled: true,
    rememberCollapsed: true,
    showIcons: true,
    chatNameDisplayOverrides: {},
  },
};
