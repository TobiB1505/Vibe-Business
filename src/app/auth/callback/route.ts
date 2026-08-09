import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges the magic-link code for a session and redirects into the app.
 * Reached only via the link in the sign-in email; never called at build
 * time.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/app`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
