"use client";
import { useState } from "react";
export function PasswordField({
  id,
  label,
  current = false,
}: {
  id: string;
  label: string;
  current?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id}
          name={id}
          type={show ? "text" : "password"}
          autoComplete={current ? "current-password" : "new-password"}
          minLength={current ? 1 : 12}
          maxLength={128}
          required
          aria-describedby={!current ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          className="text-button"
          aria-label={`${show ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={show}
          onClick={() => setShow(!show)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {!current && (
        <small id={`${id}-hint`}>
          12–128 characters. Spaces and password managers are welcome.
        </small>
      )}
    </div>
  );
}
