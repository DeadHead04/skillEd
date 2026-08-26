import { Github, Layers3 } from "lucide-react";
import { redirect } from "next/navigation";
import { currentUserWorkspace, devBypassEnabled } from "../../lib/authz";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUserWorkspace()) redirect("/");
  const dev = devBypassEnabled();
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="empty-icon">
          <Layers3 size={28} />
        </div>
        <h1>Welcome to SkillEd</h1>
        <p>
          Import, validate, search, and safely inspect Agent Skills from one
          workspace.
        </p>
        <a
          className="button primary"
          href={dev ? "/api/dev/login" : "/api/auth/signin/github"}
        >
          <Github size={18} />{" "}
          {dev ? "Continue in local mode" : "Continue with GitHub"}
        </a>
      </section>
    </main>
  );
}
