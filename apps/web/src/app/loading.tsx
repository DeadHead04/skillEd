export default function Loading() {
  return (
    <div className="work">
      <div className="content">
        <div className="empty" role="status">
          <h2>Reading the authoritative state</h2>
          <p>
            SkillEd renders from the database rather than a cache, so a page
            never shows a result the worker has not committed.
          </p>
        </div>
      </div>
    </div>
  );
}
