import "./options.css";
import { SettingsService } from "../settings";
import { migrateStorage } from "../../storage/migrations";
import { StorageService } from "../../storage/StorageService";
import { BackupService } from "../../backup/BackupService";
import { downloadBackup, readBackupFile } from "../../backup/backupFile";
import { WOLF_EXPANSION_PACKAGE_VERSION } from "../../core/version";

function requireCheckbox(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") {
    throw new Error(`Missing checkbox: ${id}`);
  }
  return element;
}

function requireSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Missing select: ${id}`);
  }
  return element;
}

async function initializeOptions(): Promise<void> {
  const storage = new StorageService();
  const settingsService = new SettingsService(storage);
  const backupService = new BackupService(storage, WOLF_EXPANSION_PACKAGE_VERSION);
  await migrateStorage(storage);

  const form = document.getElementById("settings-form");
  const status = document.getElementById("status");
  if (!(form instanceof HTMLFormElement) || !status) {
    throw new Error("The settings page markup is incomplete.");
  }

  const enabled = requireCheckbox("enabled");
  const debugEnabled = requireCheckbox("debug-enabled");
  const favoritesEnabled = requireCheckbox("favorites-enabled");
  const showIcon = requireCheckbox("favorites-show-icon");
  const rememberCollapsed = requireCheckbox("favorites-remember-collapsed");
  const itemNameDisplay = requireSelect("favorites-item-name-display");
  const foldersEnabled = requireCheckbox("folders-enabled");
  const foldersRememberCollapsed = requireCheckbox("folders-remember-collapsed");
  const foldersShowIcons = requireCheckbox("folders-show-icons");
  const renderSettings = async (): Promise<void> => {
    const settings = await settingsService.get();
    enabled.checked = settings.enabled;
    debugEnabled.checked = settings.debug.enabled;
    favoritesEnabled.checked = settings.favorites.enabled;
    showIcon.checked = settings.favorites.showIcon;
    rememberCollapsed.checked = settings.favorites.rememberCollapsed;
    itemNameDisplay.value = settings.favorites.itemNameDisplay;
    foldersEnabled.checked = settings.folders.enabled;
    foldersRememberCollapsed.checked = settings.folders.rememberCollapsed;
    foldersShowIcons.checked = settings.folders.showIcons;
  };
  await renderSettings();

  const createBackup = document.getElementById("create-backup");
  const restoreBackup = document.getElementById("restore-backup");
  const restoreFile = document.getElementById("restore-backup-file");
  const storageHealth = document.getElementById("storage-health");
  if (!(createBackup instanceof HTMLButtonElement) ||
    !(restoreBackup instanceof HTMLButtonElement) ||
    !(restoreFile instanceof HTMLInputElement) || !storageHealth) {
    throw new Error("The backup settings markup is incomplete.");
  }
  const renderStorageHealth = async (): Promise<void> => {
    const summary = await backupService.getStorageHealth(null);
    const lastBackup = summary.lastBackupAt
      ? new Date(summary.lastBackupAt).toLocaleString()
      : "never";
    storageHealth.textContent =
      `Storage schema ${summary.schemaVersion}; ${summary.knownAccountScopes} known account scope${summary.knownAccountScopes === 1 ? "" : "s"}; last backup: ${lastBackup}. Active account details are available inside ChatGPT.`;
  };
  await renderStorageHealth();
  createBackup.addEventListener("click", async () => {
    try {
      await downloadBackup(backupService);
      status.textContent = "Backup created. Keep the downloaded JSON file somewhere safe.";
      await renderStorageHealth();
    } catch (error) {
      console.error("[Wolf Expansion] Could not create backup.", error);
      status.textContent = error instanceof Error ? error.message : "Could not create backup.";
    }
  });
  restoreBackup.addEventListener("click", () => restoreFile.click());
  restoreFile.addEventListener("change", async () => {
    const file = restoreFile.files?.[0];
    restoreFile.value = "";
    if (!file) {
      return;
    }
    restoreBackup.disabled = true;
    try {
      await backupService.restoreBackup(await readBackupFile(file));
      await migrateStorage(storage);
      await renderSettings();
      await renderStorageHealth();
      status.textContent = "Backup restored. Open ChatGPT tabs will reconcile automatically.";
    } catch (error) {
      console.error("[Wolf Expansion] Could not restore backup.", error);
      status.textContent = error instanceof Error ? error.message : "Could not restore backup.";
    } finally {
      restoreBackup.disabled = false;
    }
  });

  const unsubscribe = settingsService.subscribe(() => {
    void renderSettings().catch((error: unknown) => {
      console.error("[Wolf Expansion] Could not synchronize settings.", error);
    });
  });
  window.addEventListener("unload", () => {
    unsubscribe();
  }, { once: true });

  form.addEventListener("change", async () => {
    try {
      await settingsService.update({
        enabled: enabled.checked,
        debug: {
          enabled: debugEnabled.checked,
        },
        favorites: {
          enabled: favoritesEnabled.checked,
          showIcon: showIcon.checked,
          rememberCollapsed: rememberCollapsed.checked,
          itemNameDisplay: itemNameDisplay.value === "full" ? "full" : "compact",
        },
        folders: {
          enabled: foldersEnabled.checked,
          rememberCollapsed: foldersRememberCollapsed.checked,
          showIcons: foldersShowIcons.checked,
        },
      });
      status.textContent = "Settings saved.";
    } catch (error) {
      console.error("[Wolf Expansion] Could not save settings.", error);
      status.textContent = "Could not save settings.";
    }
  });
}

void initializeOptions().catch((error: unknown) => {
  console.error("[Wolf Expansion] Could not load settings.", error);
  const status = document.getElementById("status");
  if (status) {
    status.textContent = "Could not load settings.";
  }
});
