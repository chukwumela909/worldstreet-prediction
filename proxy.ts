import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  CLERK_DOMAIN,
  CLERK_ENABLED,
  CLERK_SIGN_IN_URL,
} from "@/lib/auth-config";

/**
 * Next 16 proxy (the renamed middleware convention). With Clerk keys present
 * it resolves the satellite session on every request; without them it's a
 * pass-through so the mock-auth dev setup keeps working. No routes are
 * protected — the whole site browses publicly and only trading actions
 * require a session, which the API enforces.
 */
const passthrough = () => NextResponse.next();

export default CLERK_ENABLED
  ? clerkMiddleware(async () => {}, {
      isSatellite: true,
      domain: CLERK_DOMAIN,
      signInUrl: CLERK_SIGN_IN_URL,
    })
  : passthrough;

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
