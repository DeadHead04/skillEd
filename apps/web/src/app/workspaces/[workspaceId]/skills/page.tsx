import Link from "next/link";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Github,
  Search,
  Upload,
} from "lucide-react";
import { listSkills } from "@skilled/db";
import { parseCatalogQuery } from "../../../../lib/catalog";
import { ImportSkillDialog } from "../../../../components/import-skill-dialog";
import { StatusBadge } from "../../../../components/status-badge";

export const metadata = { title: "Skill catalog" };
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pageHref(
  workspaceId: string,
  query: ReturnType<typeof parseCatalogQuery>,
  page: number,
) {
  const search = new URLSearchParams();
  if (query.q) search.set("q", query.q);
  if (query.validation) search.set("validation", query.validation);
  if (query.source) search.set("source", query.source);
  if (query.sort !== "recent") search.set("sort", query.sort);
  if (query.pageSize !== 12) search.set("pageSize", String(query.pageSize));
  if (page !== 1) search.set("page", String(page));
  const suffix = search.toString();
  return `/workspaces/${workspaceId}/skills${suffix ? `?${suffix}` : ""}`;
}

export default async function SkillCatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { workspaceId } = await params;
  const query = parseCatalogQuery(await searchParams);
  const result = await listSkills(workspaceId, query);
  const pageCount = Math.max(1, Math.ceil(result.total / query.pageSize));
  const start = result.total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const end = Math.min(result.total, query.page * query.pageSize);

  return (
    <main className="page">
      <div className="breadcrumb">
        <span>Workspace</span>
        <span>/</span>
        <span>Skills</span>
      </div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Skill catalog</h1>
          <p className="page-subtitle">
            Import, validate, and inspect Agent Skills.
          </p>
        </div>
        <ImportSkillDialog workspaceId={workspaceId} />
      </header>

      <form
        className="catalog-toolbar"
        method="get"
        key={`${query.q}|${query.validation ?? ""}|${query.source ?? ""}|${query.sort}|${query.pageSize}`}
      >
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search Skills</span>
          <input
            className="field"
            name="q"
            defaultValue={query.q}
            placeholder="Search skills by name, description, or path"
          />
        </label>
        <select
          className="select"
          name="validation"
          defaultValue={query.validation ?? ""}
          aria-label="Validation status"
        >
          <option value="">All validation</option>
          <option value="valid">Valid</option>
          <option value="warning">Warnings</option>
          <option value="invalid">Invalid</option>
        </select>
        <select
          className="select"
          name="source"
          defaultValue={query.source ?? ""}
          aria-label="Source type"
        >
          <option value="">All sources</option>
          <option value="github">GitHub</option>
          <option value="upload">Upload</option>
        </select>
        <select
          className="select"
          name="sort"
          defaultValue={query.sort}
          aria-label="Sort Skills"
        >
          <option value="recent">Recently imported</option>
          <option value="name_asc">Name A–Z</option>
          <option value="name_desc">Name Z–A</option>
        </select>
        <select
          className="select"
          name="pageSize"
          defaultValue={query.pageSize}
          aria-label="Skills per page"
        >
          <option value="12">12 per page</option>
          <option value="24">24 per page</option>
          <option value="48">48 per page</option>
        </select>
        <button className="button" type="submit">
          Apply
        </button>
        <div className="result-count" aria-live="polite">
          {start}–{end} of {result.total}
        </div>
      </form>

      {result.items.length === 0 ? (
        <section className="empty-state">
          <div className="empty-icon">
            <Boxes />
          </div>
          <h2>
            {query.q || query.validation || query.source
              ? "No Skills match these filters"
              : "Import your first Skill"}
          </h2>
          <p>
            {query.q || query.validation || query.source
              ? "Adjust the search or clear filters to see more Skills."
              : "Connect GitHub, upload a ZIP, or choose a folder. Packages are never executed during import."}
          </p>
          {(query.q || query.validation || query.source) && (
            <Link className="button" href={`/workspaces/${workspaceId}/skills`}>
              Clear filters
            </Link>
          )}
        </section>
      ) : (
        <section className="skill-grid" aria-label="Skills">
          {result.items.map(({ skill, version }) => (
            <Link
              className="skill-card"
              href={`/workspaces/${workspaceId}/skills/${skill.id}`}
              key={skill.id}
            >
              <h2>{skill.name}</h2>
              <p className="skill-description">{skill.description}</p>
              <div className="meta-list">
                <div className="meta-row">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {skill.sourceType === "github" ? (
                      <Github size={14} />
                    ) : (
                      <Upload size={14} />
                    )}
                    {skill.sourceType === "github" ? "GitHub" : "Upload"}
                  </span>
                  <strong title={skill.sourcePath}>{skill.sourcePath}</strong>
                </div>
                <div className="meta-row">
                  <span>Immutable version</span>
                  <strong>{version.versionKey.slice(0, 10)}</strong>
                </div>
              </div>
              <div className="card-footer">
                <StatusBadge status={version.validationStatus} />
              </div>
            </Link>
          ))}
        </section>
      )}

      {result.total > 0 && (
        <nav className="pagination" aria-label="Catalog pagination">
          {query.page > 1 ? (
            <Link
              className="page-link"
              href={pageHref(workspaceId, query, query.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={17} />
            </Link>
          ) : (
            <span className="page-link" aria-hidden="true">
              <ChevronLeft size={17} />
            </span>
          )}
          {Array.from(
            { length: Math.min(pageCount, 5) },
            (_, index) => index + 1,
          ).map((page) => (
            <Link
              className={`page-link ${page === query.page ? "current" : ""}`}
              href={pageHref(workspaceId, query, page)}
              key={page}
              aria-current={page === query.page ? "page" : undefined}
            >
              {page}
            </Link>
          ))}
          {query.page < pageCount ? (
            <Link
              className="page-link"
              href={pageHref(workspaceId, query, query.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={17} />
            </Link>
          ) : (
            <span className="page-link" aria-hidden="true">
              <ChevronRight size={17} />
            </span>
          )}
        </nav>
      )}
    </main>
  );
}
