/**
 * The identity providers' own marks (UI-20).
 *
 * ## Why these are not in either icon file
 *
 * `icons.generated.tsx` is Lucide path data in Vibe's frame and
 * `dashboard-icons.tsx` is Vibe's own hand-drawn set ([ADR 0097](../../../docs/decisions/0097-icon-paths-come-from-lucide-the-frame-stays-vibes.md)).
 * A brand mark is neither: it is not ours to draw and not Lucide's to supply.
 * It belongs to the company it identifies, is reproduced here exactly rather
 * than restyled, and keeps its own colours — which is why it also ignores
 * `currentColor` and the size scale the rest of the icon system shares.
 *
 * ## Why they are drawn at all
 *
 * Sprint 0155 shipped the provider buttons as words alone, arguing that an
 * approximated mark is worse than none. That argument holds for an
 * approximation; it is not an argument against the real thing. Both companies
 * publish these marks for exactly this use and ask that they be shown
 * unmodified — Google's sign-in branding guidance requires its own "G",
 * not a monochrome stand-in — so the correct answer is the official artwork,
 * unaltered, at a size that keeps it legible.
 *
 * They are `aria-hidden`: the button already says which provider it is, and a
 * screen reader announcing "Google logo Continue with Google" says it twice.
 */

/** Google's four-colour "G", as published. Do not recolour or flatten it. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 18 18"
      className="shrink-0"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
      />
    </svg>
  );
}

/**
 * GitHub's mark.
 *
 * Monochrome by design — GitHub publishes it as a single-colour mark, so
 * `currentColor` here is the mark as issued rather than a recolouring of it.
 */
export function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className="shrink-0"
      focusable="false"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
