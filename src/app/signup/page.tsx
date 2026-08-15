import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthShell
      headline={
        <>
          You vibe-coded the product.
          <br />
          <span className="text-mint">Now vibe the business.</span>
        </>
      }
      intro="Create an account, connect a repository, and Vibe reads it once to work out how business-ready it is."
      assurances={["Read-only access to start", "Nothing merged without your approval"]}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-fg text-headline font-bold">Create account</h1>
        <p className="text-fg-muted text-sm">For development. No elaborate onboarding.</p>
      </div>

      <SignupForm />

      <p className="text-fg-muted text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-mint hover:text-mint-hover rounded-sm">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
