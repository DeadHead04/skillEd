export function Spinner({ label }: { label?: string }) {
  return (
    <span
      className="spinner"
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
