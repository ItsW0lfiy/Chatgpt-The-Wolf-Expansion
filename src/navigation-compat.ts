import { NavigationCompatibilityController } from "./compatibility/navigationFixes";
import { SettingsService } from "./settings/settings";
import { StorageService } from "./storage/StorageService";

const controller = new NavigationCompatibilityController(new SettingsService(new StorageService()));
controller.start();

window.addEventListener("pagehide", () => controller.stop(), { once: true });
