import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <section className="empty-state">
        <h1>Workspace content not found</h1>
        <p>This item does not exist or is outside your authorized workspace.</p>
        <Link className="button" href="/">
          Return to your workspace
        </Link>
      </section>
    </main>
  );
}
