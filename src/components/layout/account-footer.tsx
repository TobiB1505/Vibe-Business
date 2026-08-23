import { TextAction } from "@/components/ui/button";
import { signOut } from "@/modules/auth/actions";

/**
 * Who is signed in, and the way out (CORE-6).
 *
 * This is the interim footer: the email and sign-out that `AppShell`'s top bar
 * carried, moved into the rail so the bar itself could go. The avatar and the
 * Profile / Settings / Billing menu replace it in the next commit — kept
 * separate so the shell move and the new menu are reviewable apart from each
 * other.
 *
 * The email is shown rather than a name because there is no name. Nothing in
 * this codebase stores one: no profile table, no `user_metadata`, no display
 * name anywhere. Inventing one from the email's local part would be a guess
 * presented as identity.
 */
export function AccountFooter({ email }: { email: string | null }) {
  return (
    <div className="border-line-1 flex flex-col gap-2 border-t pt-3 lg:pt-4">
      {email && (
        <span className="text-fg-meta truncate px-3 text-ui" title={email}>
          {email}
        </span>
      )}
      <form action={signOut} className="px-3">
        <TextAction type="submit" className="text-ui">
          Sign out
        </TextAction>
      </form>
    </div>
  );
}
