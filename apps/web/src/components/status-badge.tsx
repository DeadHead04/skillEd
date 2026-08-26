import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { ValidationStatus } from "@skilled/domain";

export function StatusBadge({ status }: { status: ValidationStatus }) {
  if (status === "valid") {
    return (
      <span className="status valid">
        <CheckCircle2 size={15} />
        Valid
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span className="status invalid">
        <XCircle size={15} />
        Invalid
      </span>
    );
  }
  return (
    <span className="status warning">
      <AlertTriangle size={15} />
      Warnings
    </span>
  );
}
