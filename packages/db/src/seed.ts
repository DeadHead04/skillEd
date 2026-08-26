import { ensureIdentityWorkspace } from "./repositories";
import { closeDb } from "./client";

const result = await ensureIdentityWorkspace({
  githubUserId: "dev-user",
  email: "dev@skilled.local",
  name: "Alex Smith",
});
console.log(`Seeded workspace ${result.workspace.id}`);
await closeDb();
