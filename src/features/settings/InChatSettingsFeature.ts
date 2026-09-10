import type { ChatGPTAdapter } from "../../adapters/chatgpt/ChatGPTAdapter";
import type { Logger } from "../../core/logger";
import type { WolfSidebarRoot } from "../../core/WolfSidebarRoot";
import { debounce } from "../../shared/events";
import { createWolfElement } from "../../shared/dom";
import type { Feature, Unsubscribe } from "../../shared/types";
import { SettingsService } from "../../settings/settings";
import type {
  LegacyAccountRecoveryResult,
  LegacyAccountRecoveryService,
} from "../../storage/LegacyAccountRecoveryService";
import type {
  FolderRecord,
  ItemNameDisplayMode,
  WolfExpansionSettings,
} from "../../storage/schemas";
import { FoldersRepository } from "../folders/FoldersRepository";
import { FolderDisplayOverridesRepository } from "../folders/FolderDisplayOverridesRepository";
import type { BackupService } from "../../backup/BackupService";
import { downloadBackup, readBackupFile } from "../../backup/backupFile";

export class InChatSettingsFeature implements Feature {
  public readonly id = "in-chat-settings";

  private enabled = false;
  private settings: WolfExpansionSettings | null = null;
  private entry: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private opener: HTMLElement | null = null;
  private stopWatchingSidebar: Unsubscribe | null = null;
  private stopWatchingFolders: Unsubscribe | null = null;
  private stopWatchingFolderOverrides: Unsubscribe | null = null;
  private folderChatNameDisplayOverrides: Record<string, ItemNameDisplayMode> = {};
  private legacyRestoreConfirmationPending = false;
  private legacyRestoreScopeId: string | null = null;
  private readonly scheduleReconcile: () => void;

  public constructor(
    private readonly adapter: ChatGPTAdapter,
    private readonly settingsService: SettingsService,
    private readonly foldersRepository: FoldersRepository,
    private readonly folderDisplayOverridesRepository: FolderDisplayOverridesRepository,
    private readonly legacyAccountRecoveryService: LegacyAccountRecoveryService,
    private readonly restoreLegacyAccountData: (
      expectedScopeId: string,
    ) => Promise<LegacyAccountRecoveryResult>,
    private readonly backupService: BackupService,
    private readonly restoreBackup: (json: string) => Promise<void>,
    private readonly getActiveScopeId: () => string | null,
    private readonly sidebarRoot: WolfSidebarRoot,
    private readonly logger: Logger,
  ) {
    this.scheduleReconcile = debounce(() => this.reconcile(), 100);
  }

  public setSettings(settings: WolfExpansionSettings): void {
    this.settings = settings;
    this.renderFormValues();
  }

  public enable(): void {
    if (this.enabled) {
      return;
    }

    this.enabled = true;
    this.stopWatchingSidebar = this.adapter.watchSidebar(this.scheduleReconcile);
    this.stopWatchingFolders = this.foldersRepository.subscribe(() => {
      void this.renderFolderOverrides();
    });
    this.stopWatchingFolderOverrides = this.folderDisplayOverridesRepository.subscribe(() => {
      void this.renderFolderOverrides();
    });
    this.reconcile();
    this.logger.debug("In-ChatGPT settings enabled.");
  }

  public disable(): void {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    this.stopWatchingSidebar?.();
    this.stopWatchingSidebar = null;
    this.stopWatchingFolders?.();
    this.stopWatchingFolders = null;
    this.stopWatchingFolderOverrides?.();
    this.stopWatchingFolderOverrides = null;
    this.close();
    if (this.entry) {
      this.sidebarRoot.unmount("settings", this.entry);
    }
    this.entry = null;
    this.logger.debug("In-ChatGPT settings disabled.");
  }

  public destroy(): void {
    this.disable();
  }

  public resetAccountContext(): void {
    this.folderChatNameDisplayOverrides = {};
    this.legacyRestoreConfirmationPending = false;
    this.legacyRestoreScopeId = null;
    this.close();
  }

  private reconcile(): void {
    if (!this.enabled) {
      return;
    }

    if (!this.entry) {
      this.entry = createWolfElement("div", "settings-entry");
      this.entry.className = "wolf-settings-entry";

      const button = createWolfElement("button", "open-settings");
      button.type = "button";
      button.className = "wolf-open-settings";
      button.setAttribute("aria-label", "Open Wolf Expansion settings");

      const label = document.createElement("span");
      label.textContent = "Wolf Expansion settings";
      const icon = createWolfElement("span", "settings-gear-icon");
      icon.className = "wolf-settings-gear-icon";
      icon.style.setProperty(
        "--wolf-settings-gear-url",
        `url("${browser.runtime.getURL("icons/settings-gear.svg")}")`,
      );
      icon.setAttribute("aria-hidden", "true");
      button.append(label, icon);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.open(button);
      });
      this.entry.append(button);
    }

    this.sidebarRoot.mount("settings", this.entry);
  }

  private open(opener: HTMLElement): void {
    if (this.overlay) {
      this.overlay.querySelector<HTMLElement>(".wolf-settings-dialog")?.focus();
      return;
    }

    this.opener = opener;
    const overlay = createWolfElement("div", "settings-overlay");
    overlay.className = "wolf-settings-overlay";
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });

    const dialog = createWolfElement("section", "settings-dialog");
    dialog.className = "wolf-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "wolf-settings-title");
    dialog.tabIndex = -1;

    const header = document.createElement("header");
    header.className = "wolf-settings-dialog-header";
    const identity = document.createElement("div");
    identity.className = "wolf-settings-dialog-identity";
    const mark = document.createElement("img");
    mark.className = "wolf-settings-brand-mark";
    mark.src = browser.runtime.getURL("icons/wolf-expansion-mark-32.png");
    mark.alt = "";
    mark.width = 28;
    mark.height = 28;
    mark.setAttribute("aria-hidden", "true");
    const title = document.createElement("h2");
    title.id = "wolf-settings-title";
    title.textContent = "Wolf Expansion Settings";
    const closeButton = createWolfElement("button", "close-settings");
    closeButton.type = "button";
    closeButton.className = "wolf-settings-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close Wolf Expansion settings");
    closeButton.addEventListener("click", () => this.close());
    identity.append(mark, title);
    header.append(identity, closeButton);

    const form = createWolfElement("form", "settings-form");
    form.className = "wolf-settings-form";
    form.append(
      this.createSettingsGroup("General", "Core extension behavior.", [
        this.createCheckbox(
          "wolf-settings-enabled",
          "Enable Wolf Expansion",
          "Turn all Wolf Expansion features on or off without deleting data.",
        ),
      ]),
      this.createSettingsGroup("Quick Access", "Fast access to organized conversations.", [
        this.createCheckbox(
          "wolf-settings-favorites-enabled",
          "Enable Quick Access",
          "Show Wolf Expansion's chat organization system.",
        ),
        this.createCheckbox("wolf-settings-show-icon", "Show Quick Access star icons"),
        this.createCheckbox(
          "wolf-settings-remember-collapsed",
          "Remember Quick Access section collapsed state",
        ),
      ]),
      this.createSettingsGroup("Folders", "Control the Quick Access folder hierarchy.", [
        this.createCheckbox(
          "wolf-settings-folders-enabled",
          "Enable Folders",
          "Organize Quick Access chats into folders and subfolders.",
        ),
        this.createCheckbox(
          "wolf-settings-folders-remember-collapsed",
          "Remember folder collapse state",
        ),
        this.createCheckbox("wolf-settings-folders-show-icons", "Show folder icons"),
      ]),
      this.createSettingsGroup("Appearance", "Conversation-name presentation.", [
        this.createSelect(
          "wolf-settings-item-name-display",
          "Default chat-name display",
          [
            { value: "compact", label: "Compact" },
            { value: "full", label: "Full" },
          ],
          "Root chats and folders without an override use this default.",
        ),
        this.createFolderOverrideManager(),
      ]),
      this.createBackupManager(),
      this.createSettingsGroup("Advanced", "Local diagnostics for troubleshooting.", [
        this.createCheckbox(
          "wolf-settings-debug",
          "Debug logging",
          "Write local diagnostics to the ChatGPT tab console.",
        ),
      ]),
      this.createLegacyRecoveryManager(),
    );
    form.addEventListener("change", () => {
      void this.saveForm();
    });

    const status = createWolfElement("p", "settings-status");
    status.className = "wolf-settings-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    dialog.append(header, form, status);
    dialog.addEventListener("keydown", (event) => this.handleDialogKeydown(event));
    overlay.append(dialog);
    document.body.append(overlay);
    this.overlay = overlay;
    this.renderFormValues();
    void this.renderLegacyRecovery();
    void this.renderStorageHealth();
    dialog.focus();
  }

  private createBackupManager(): HTMLFieldSetElement {
    const fieldset = createWolfElement("fieldset", "backup-manager");
    const legend = document.createElement("legend");
    legend.textContent = "Data & Recovery";
    const description = document.createElement("p");
    description.className = "wolf-settings-group-description";
    description.textContent =
      "Backups are JSON files you control. They can contain conversation titles, IDs, folder names, and organization metadata.";
    const actions = document.createElement("div");
    actions.className = "wolf-legacy-recovery-actions";
    const createButton = document.createElement("button");
    createButton.type = "button";
    createButton.className = "wolf-settings-secondary-action";
    createButton.textContent = "Create backup";
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.className = "wolf-settings-secondary-action";
    restoreButton.textContent = "Restore backup (replace all Wolf data)";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.hidden = true;
    createButton.addEventListener("click", () => void this.runBackupAction(async () => {
      await downloadBackup(this.backupService);
      this.setStatus("Backup created. Keep the downloaded JSON file somewhere safe.");
      await this.renderStorageHealth();
    }));
    restoreButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => void this.runBackupAction(async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) {
        return;
      }
      restoreButton.disabled = true;
      try {
        await this.restoreBackup(await readBackupFile(file));
        this.setStatus("Backup restored. Wolf Expansion data has been reconciled.");
        await this.renderStorageHealth();
      } finally {
        restoreButton.disabled = false;
      }
    }));
    const health = createWolfElement("p", "storage-health");
    health.className = "wolf-settings-group-description";
    actions.append(createButton, restoreButton, fileInput);
    fieldset.append(legend, description, actions, health);
    return fieldset;
  }

  private async renderStorageHealth(): Promise<void> {
    const health = this.overlay?.querySelector<HTMLElement>(
      '[data-wolf-expansion="storage-health"]',
    );
    if (!health) {
      return;
    }
    const summary = await this.backupService.getStorageHealth(this.getActiveScopeId());
    if (!health.isConnected) {
      return;
    }
    const lastBackup = summary.lastBackupAt
      ? new Date(summary.lastBackupAt).toLocaleString()
      : "never";
    health.textContent =
      `Storage schema ${summary.schemaVersion}; ${summary.knownAccountScopes} known account scope${summary.knownAccountScopes === 1 ? "" : "s"}; ` +
      `${summary.activeScopeAvailable ? "active scope" : "no active scope"}; ` +
      `${summary.activeFavorites} Quick Access chats, ${summary.activeFolders} folders, ${summary.activeMemberships} memberships; last backup: ${lastBackup}.`;
  }

  private async runBackupAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.error("Backup operation failed.", error);
      this.setStatus(error instanceof Error ? error.message : "Backup operation failed.");
    }
  }

  private close(): void {
    this.overlay?.remove();
    this.overlay = null;
    if (this.opener?.isConnected) {
      this.opener.focus({ preventScroll: true });
    }
    this.opener = null;
  }

  private createSettingsGroup(
    title: string,
    description: string,
    rows: HTMLElement[],
  ): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    const details = document.createElement("p");
    details.className = "wolf-settings-group-description";
    details.textContent = description;
    fieldset.append(legend, details, ...rows);
    return fieldset;
  }

  private createFolderOverrideManager(): HTMLElement {
    const manager = createWolfElement("div", "folder-override-manager");
    manager.className = "wolf-folder-override-manager";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wolf-folder-override-toggle";
    button.textContent = "Manage folder overrides";
    button.setAttribute("aria-expanded", "false");
    const content = createWolfElement("div", "folder-override-content");
    content.className = "wolf-folder-override-content";
    content.hidden = true;
    button.addEventListener("click", () => {
      const open = content.hidden;
      content.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) {
        void this.renderFolderOverrides();
      }
    });
    manager.append(button, content);
    return manager;
  }

  private createLegacyRecoveryManager(): HTMLFieldSetElement {
    const fieldset = createWolfElement("fieldset", "legacy-recovery");
    fieldset.className = "wolf-legacy-recovery";
    fieldset.hidden = true;
    const legend = document.createElement("legend");
    legend.textContent = "Previous Quick Access data";
    const description = createWolfElement("p", "legacy-recovery-description");
    description.className = "wolf-settings-group-description";
    const actions = document.createElement("div");
    actions.className = "wolf-legacy-recovery-actions";
    const restoreButton = createWolfElement("button", "restore-legacy-data");
    restoreButton.type = "button";
    restoreButton.className = "wolf-settings-secondary-action";
    restoreButton.textContent = "Restore previous Quick Access data";
    const cancelButton = createWolfElement("button", "cancel-legacy-restore");
    cancelButton.type = "button";
    cancelButton.className = "wolf-settings-secondary-action";
    cancelButton.textContent = "Cancel";
    cancelButton.hidden = true;
    restoreButton.addEventListener("click", () => {
      if (!this.legacyRestoreConfirmationPending) {
        this.legacyRestoreConfirmationPending = true;
        description.textContent =
          "Confirm assigning the preserved pre-account-scoping Wolf data to this signed-in ChatGPT account. It cannot be claimed by another account afterward.";
        restoreButton.textContent = "Confirm restore to this account";
        cancelButton.hidden = false;
        return;
      }
      void this.performLegacyRestore(restoreButton, cancelButton);
    });
    cancelButton.addEventListener("click", () => {
      this.legacyRestoreConfirmationPending = false;
      void this.renderLegacyRecovery();
    });
    actions.append(restoreButton, cancelButton);
    fieldset.append(legend, description, actions);
    return fieldset;
  }

  private async renderLegacyRecovery(): Promise<void> {
    const fieldset = this.overlay?.querySelector<HTMLFieldSetElement>(
      '[data-wolf-expansion="legacy-recovery"]',
    );
    const description = fieldset?.querySelector<HTMLElement>(
      '[data-wolf-expansion="legacy-recovery-description"]',
    );
    const restoreButton = fieldset?.querySelector<HTMLButtonElement>(
      '[data-wolf-expansion="restore-legacy-data"]',
    );
    const cancelButton = fieldset?.querySelector<HTMLButtonElement>(
      '[data-wolf-expansion="cancel-legacy-restore"]',
    );
    if (!fieldset || !description || !restoreButton || !cancelButton) {
      return;
    }
    const status = await this.legacyAccountRecoveryService.getStatus();
    if (!fieldset.isConnected) {
      return;
    }
    this.legacyRestoreConfirmationPending = false;
    this.legacyRestoreScopeId = null;
    restoreButton.disabled = false;
    restoreButton.hidden = false;
    restoreButton.textContent = "Restore previous Quick Access data";
    cancelButton.hidden = true;
    if (status.state === "available" || status.state === "stable-rebind-available") {
      this.legacyRestoreScopeId = status.scopeId;
      fieldset.hidden = false;
      description.textContent = status.state === "stable-rebind-available"
        ? `Found ${status.favoriteCount} Quick Access chat${status.favoriteCount === 1 ? "" : "s"} and ${status.folderCount} folder${status.folderCount === 1 ? "" : "s"} under an older Wolf account identity. Restore copies them to this account's stable identity while retaining the old safety copy.`
        : `Found ${status.favoriteCount} previous Quick Access chat${status.favoriteCount === 1 ? "" : "s"} and ${status.folderCount} folder${status.folderCount === 1 ? "" : "s"}. Restore assigns this preserved data to the currently signed-in ChatGPT account.`;
      return;
    }
    if (status.state === "destination-not-empty") {
      fieldset.hidden = false;
      restoreButton.hidden = true;
      description.textContent =
        "Previous data was not restored because this account already has Wolf Expansion organization data. Neither data set was changed.";
      return;
    }
    if (status.state === "source-unavailable") {
      fieldset.hidden = false;
      restoreButton.hidden = true;
      description.textContent =
        "The previous account scope could not be recovered safely. No data was changed.";
      return;
    }
    fieldset.hidden = true;
  }

  private async performLegacyRestore(
    restoreButton: HTMLButtonElement,
    cancelButton: HTMLButtonElement,
  ): Promise<void> {
    restoreButton.disabled = true;
    cancelButton.disabled = true;
    try {
      const expectedScopeId = this.legacyRestoreScopeId;
      const result = expectedScopeId
        ? await this.restoreLegacyAccountData(expectedScopeId)
        : { state: "account-unresolved" } as const;
      this.setStatus(getLegacyRestoreMessage(result));
    } catch (error) {
      this.logger.error("Could not restore previous Quick Access data.", error);
      this.setStatus("Could not restore previous Quick Access data. Nothing was changed.");
    } finally {
      cancelButton.disabled = false;
      this.legacyRestoreConfirmationPending = false;
      await this.renderLegacyRecovery();
    }
  }

  private async renderFolderOverrides(): Promise<void> {
    const content = this.overlay?.querySelector<HTMLElement>(
      '[data-wolf-expansion="folder-override-content"]',
    );
    if (!content || content.hidden || !this.settings) {
      return;
    }
    const [folders, overrides] = await Promise.all([
      this.foldersRepository.listFolders(),
      this.folderDisplayOverridesRepository.get(),
    ]);
    if (!content.isConnected) {
      return;
    }
    this.folderChatNameDisplayOverrides = overrides;
    content.replaceChildren();
    if (folders.length === 0) {
      const empty = document.createElement("p");
      empty.className = "wolf-folder-override-empty";
      empty.textContent = "No folders yet.";
      content.append(empty);
      return;
    }
    if (Object.keys(overrides).length === 0) {
      const inherited = document.createElement("p");
      inherited.className = "wolf-folder-override-empty";
      inherited.textContent = "All folders currently inherit the default.";
      content.append(inherited);
    }
    for (const { folder, depth } of flattenFolders(folders)) {
      const row = document.createElement("label");
      row.className = "wolf-folder-override-row";
      row.style.setProperty("--wolf-folder-settings-depth", String(depth));
      const name = document.createElement("span");
      name.textContent = folder.name;
      name.title = folder.name;
      const select = this.createFolderOverrideSelect(folder);
      row.append(name, select);
      content.append(row);
    }
  }

  private createFolderOverrideSelect(folder: FolderRecord): HTMLSelectElement {
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Chat name display for ${folder.name}`);
    for (const [value, label] of [
      ["inherit", "Inherit"],
      ["compact", "Compact"],
      ["full", "Full"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    select.value = this.folderChatNameDisplayOverrides[folder.id] ?? "inherit";
    select.addEventListener("change", (event) => {
      event.stopPropagation();
      const mode: ItemNameDisplayMode | null = select.value === "compact" || select.value === "full"
        ? select.value
        : null;
      void this.saveFolderOverride(folder.id, mode);
    });
    return select;
  }

  private async saveFolderOverride(
    folderId: string,
    mode: ItemNameDisplayMode | null,
  ): Promise<void> {
    try {
      await this.folderDisplayOverridesRepository.set(folderId, mode);
      await this.renderFolderOverrides();
      this.setStatus("Folder display override saved.");
    } catch (error) {
      this.logger.error("Could not save folder display override.", error);
      this.setStatus("Could not save folder display override.");
    }
  }

  private createCheckbox(
    id: string,
    labelText: string,
    description?: string,
  ): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "wolf-settings-row";
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = labelText;
    text.append(title);
    if (description) {
      const details = document.createElement("small");
      details.textContent = description;
      text.append(details);
    }
    const input = document.createElement("input");
    input.id = id;
    input.type = "checkbox";
    label.append(text, input);
    return label;
  }

  private createSelect(
    id: string,
    labelText: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    description?: string,
  ): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "wolf-settings-row";
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = labelText;
    text.append(title);
    if (description) {
      const details = document.createElement("small");
      details.textContent = description;
      text.append(details);
    }
    const select = document.createElement("select");
    select.id = id;
    for (const optionData of options) {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.append(option);
    }
    label.append(text, select);
    return label;
  }

  private renderFormValues(): void {
    if (!this.overlay || !this.settings) {
      return;
    }

    this.setCheckbox("wolf-settings-enabled", this.settings.enabled);
    this.setCheckbox("wolf-settings-debug", this.settings.debug.enabled);
    this.setCheckbox("wolf-settings-favorites-enabled", this.settings.favorites.enabled);
    this.setCheckbox("wolf-settings-show-icon", this.settings.favorites.showIcon);
    this.setSelect(
      "wolf-settings-item-name-display",
      this.settings.favorites.itemNameDisplay,
    );
    this.setCheckbox(
      "wolf-settings-remember-collapsed",
      this.settings.favorites.rememberCollapsed,
    );
    this.setCheckbox("wolf-settings-folders-enabled", this.settings.folders.enabled);
    this.setCheckbox(
      "wolf-settings-folders-remember-collapsed",
      this.settings.folders.rememberCollapsed,
    );
    this.setCheckbox("wolf-settings-folders-show-icons", this.settings.folders.showIcons);
    void this.renderFolderOverrides();
  }

  private async saveForm(): Promise<void> {
    try {
      this.settings = await this.settingsService.update({
        enabled: this.getCheckbox("wolf-settings-enabled"),
        debug: {
          enabled: this.getCheckbox("wolf-settings-debug"),
        },
        favorites: {
          enabled: this.getCheckbox("wolf-settings-favorites-enabled"),
          showIcon: this.getCheckbox("wolf-settings-show-icon"),
          rememberCollapsed: this.getCheckbox("wolf-settings-remember-collapsed"),
          itemNameDisplay: this.getSelect("wolf-settings-item-name-display") === "full"
            ? "full"
            : "compact",
        },
        folders: {
          enabled: this.getCheckbox("wolf-settings-folders-enabled"),
          rememberCollapsed: this.getCheckbox("wolf-settings-folders-remember-collapsed"),
          showIcons: this.getCheckbox("wolf-settings-folders-show-icons"),
        },
      });
      this.setStatus("Settings saved.");
    } catch (error) {
      this.logger.error("Could not save in-ChatGPT settings.", error);
      this.setStatus("Could not save settings.");
    }
  }

  private setStatus(message: string): void {
    const status = this.overlay?.querySelector<HTMLElement>(
      '[data-wolf-expansion="settings-status"]',
    );
    if (status) {
      status.textContent = message;
    }
  }

  private getCheckbox(id: string): boolean {
    const input = this.overlay?.querySelector<HTMLInputElement>(`#${id}`);
    return input?.checked ?? false;
  }

  private setCheckbox(id: string, checked: boolean): void {
    const input = this.overlay?.querySelector<HTMLInputElement>(`#${id}`);
    if (input) {
      input.checked = checked;
    }
  }

  private getSelect(id: string): string {
    return this.overlay?.querySelector<HTMLSelectElement>(`#${id}`)?.value ?? "";
  }

  private setSelect(id: string, value: string): void {
    const select = this.overlay?.querySelector<HTMLSelectElement>(`#${id}`);
    if (select) {
      select.value = value;
    }
  }

  private handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key !== "Tab" || !this.overlay) {
      return;
    }

    const focusable = Array.from(
      this.overlay.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function flattenFolders(
  folders: readonly FolderRecord[],
): Array<{ folder: FolderRecord; depth: number }> {
  const byParent = new Map<string | null, FolderRecord[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt);
  }
  const flattened: Array<{ folder: FolderRecord; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number): void => {
    for (const folder of byParent.get(parentId) ?? []) {
      if (visited.has(folder.id)) {
        continue;
      }
      visited.add(folder.id);
      flattened.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return flattened;
}

function getLegacyRestoreMessage(result: LegacyAccountRecoveryResult): string {
  switch (result.state) {
    case "restored":
      return `Restored ${result.favoriteCount} Quick Access chat${result.favoriteCount === 1 ? "" : "s"} and ${result.folderCount} folder${result.folderCount === 1 ? "" : "s"}.`;
    case "destination-not-empty":
      return "Restore stopped because this account already has Wolf Expansion organization data. Nothing was overwritten.";
    case "already-claimed":
      return "This previous Quick Access backup has already been assigned and cannot be claimed again.";
    case "account-unresolved":
      return "Restore requires a confidently identified signed-in ChatGPT account.";
    case "no-legacy-data":
      return "No previous Quick Access data is available to restore.";
    case "source-unavailable":
      return "The previous account scope could not be recovered safely. Nothing was changed.";
  }
}
