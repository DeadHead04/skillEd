import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@skilled/core";
import { authenticatedUser } from "../../lib/auth";
import { ChangePassword } from "../../components/change-password";
import { Work, Verdict } from "../../components/ui";
const sql = db();
export default async function AccountPage() {
  const actor = authenticatedUser(
    new Request("http://skilled.local", { headers: await headers() }),
  );
  if (!actor) redirect("/login");
  const [user] =
    await sql`SELECT password_change_required FROM users WHERE id=${actor.id}`;
  return (
    <Work>
      <Verdict
        title="Your account"
        lede={`${actor.displayName} · @${actor.loginId} · ${actor.role === "administrator" ? "Administrator" : "Operator"}`}
      />
      {user?.password_change_required && (
        <p className="notice" role="status">
          Choose your own password before opening the workbench. Enter the
          temporary password your administrator gave you as your current
          password.
        </p>
      )}
      <section className="section">
        <div className="section-head">
          <h2>Change password</h2>
        </div>
        <ChangePassword />
      </section>
    </Work>
  );
}
