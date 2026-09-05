import { db } from "@skilled/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UserManagement } from "../../components/user-management";
import { Status, Verdict, Work } from "../../components/ui";
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
  const active = users.filter((user) => user.active).length;

  return (
    <Work>
      <Verdict
        title="Control who can operate the workbench"
        lede="Everyone signs in with their own login ID. Operators share the same Skill packages; only administrators can change accounts."
        status={
          <Status
            value="pass"
            label={`${active} active ${active === 1 ? "account" : "accounts"}`}
          />
        }
      />
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
    </Work>
  );
}
