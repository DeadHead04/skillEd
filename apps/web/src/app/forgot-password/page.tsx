import Link from "next/link";
import { AuthShell } from "../../components/auth-shell";
export default function ForgotPassword() {
  return (
    <AuthShell
      title="Recover your account"
      description="Your administrator can give you a private password reset link."
    >
      <ol className="recovery-steps">
        <li>
          Tell your administrator your SkillEd login ID. If you forgot it, ask
          them to find your display name in Users.
        </li>
        <li>
          They open Users, select your account, and choose Create reset link.
        </li>
        <li>
          Open the link within one hour and choose a new password. Then sign in
          again.
        </li>
      </ol>
      <p className="notice">
        Reset links are shared directly by your administrator. SkillEd does not
        send recovery emails.
      </p>
      <Link href="/reset-password" className="btn auth-primary">
        I have a reset link or code
      </Link>
      <p className="auth-links">
        <Link href="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
