import type { BackupService } from "./BackupService";

export async function downloadBackup(service: BackupService): Promise<void> {
  const { envelope, json } = await service.createBackup();
  const blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `wolf-expansion-backup-${envelope.createdAt.slice(0, 10)}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

export async function readBackupFile(file: File): Promise<string> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("The selected backup is unexpectedly large.");
  }
  return file.text();
}
