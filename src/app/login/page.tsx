import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell
      headline={
        <>
          You vibe-coded the product.
          <br />
          <span className="text-mint">Now vibe the business.</span>
        </>
      }
      intro="Sign in to see what Vibe found in your product and what it wants to do about it."
      // Both of these are properties of the system as built: the GitHub App
      // holds read permissions only, and a merge requires an explicit approval
      // of one specific commit. Neither is a marketing claim.
      assurances={["Read-only access to start", "Nothing merged without your approval"]}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-fg text-headline font-bold">Sign in</h1>
        <p className="text-fg-muted text-sm">With the email and password you signed up with.</p>
      </div>

      <LoginForm />

      <p className="text-fg-muted text-sm">
        No account yet?{" "}
        <Link href="/signup" className="text-mint hover:text-mint-hover rounded-sm">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
