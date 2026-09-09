import Link from "next/link";
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="login-shell">
      <section className="login-aside">
        <Link href="/login" className="brand">
          <span className="brand-mark">S</span>SkillEd
        </Link>
        <div>
          <h2>Your work, backed by evidence.</h2>
          <p>
            Upload a Skill, agree on the tests, review the results, and verify
            every improvement before you activate it.
          </p>
          <div className="login-legend">
            <div>
              <b>01</b>Choose what good work looks like.
            </div>
            <div>
              <b>02</b>Inspect what actually happened.
            </div>
            <div>
              <b>03</b>Approve the changes you trust.
            </div>
          </div>
        </div>
      </section>
      <section className="login-main">
        <div className="login-panel">
          <h1>{title}</h1>
          <p className="lede">{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
