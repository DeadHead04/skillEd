import { db } from "@skilled/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UserManagement } from "../../components/user-management";
import { authenticatedUser } from "../../lib/auth";

export const dynamic = "force-dynamic";
const sql = db();

export default async function UsersPage() {
  const requestHeaders = await headers();
  const currentUser = authenticatedUser(
    new Request("http://skilled.local", { headers: requestHeaders }),
  );
  if (currentUser?.role !== "administrator") redirect("/skill");
  const users =
    await sql`SELECT id,login_id,display_name,role,active,last_login_at,password_changed_at,created_at,updated_at
      FROM users ORDER BY active DESC,role,display_name,login_id`;
  const activeAdministrators = users.filter(
    (user) => user.active && user.role === "administrator",
  ).length;

  return (
    <div className="content users-page">
      <section className="hero compact-hero">
        <div>
          <div className="eyebrow">Access management · local accounts</div>
          <h1>Control who can operate the workbench</h1>
          <p className="lede">
            Every person signs in with an individual login ID. Operators share
            the Skill workspace; only administrators can manage accounts.
          </p>
        </div>
        <span className="badge grounded">
          {users.filter((user) => user.active).length} active
        </span>
      </section>
      <UserManagement
        initialUsers={users.map((user) => ({
          id: String(user.id),
          loginId: String(user.login_id),
          displayName: String(user.display_name),
          role: user.role as "administrator" | "operator",
          active: Boolean(user.active),
          lastLoginAt: user.last_login_at
            ? new Date(user.last_login_at).toISOString()
            : null,
          passwordChangedAt: new Date(user.password_changed_at).toISOString(),
          createdAt: new Date(user.created_at).toISOString(),
        }))}
        currentUserId={currentUser.id}
        activeAdministrators={activeAdministrators}
      />
    </div>
  );
}
