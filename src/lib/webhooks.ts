import { storeInstallation } from "./installations";
import { handlePush, type PushPayload } from "./submissions";

type InstallationPayload = { action: string; installation: { id: number } };

/** Runs after the webhook has already been acknowledged (see the in-process queue). */
export async function handleWebhook(event: string, payload: unknown) {
  switch (event) {
    case "installation": {
      const p = payload as InstallationPayload;
      if (p.action === "created" || p.action === "new_permissions_accepted" || p.action === "unsuspend") {
        await storeInstallation(p.installation.id);
      } else if (p.action === "deleted") {
        // Classrooms keep their FK to the installation; nothing to delete. Logged for visibility.
        console.info(`[webhook] installation ${p.installation.id} deleted`);
      }
      return;
    }
    case "installation_repositories":
      // Repo selection changed; we look repos up on demand, so nothing to sync.
      return;
    case "push":
      await handlePush(payload as PushPayload);
      return;
    default:
      return;
  }
}
