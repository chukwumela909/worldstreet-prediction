import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AuthProvider } from "@/components/auth/auth-context";
import { MobileDock } from "@/components/nav/mobile-dock";
import { SiteChrome } from "@/components/nav/site-chrome";
import { SuspendedNotice } from "@/components/account/suspended-notice";
import { SiteHeader } from "@/components/nav/site-header";
import { Toaster } from "@/components/toaster";
import { BookPricingProvider } from "@/components/book-pricing";
import { getBookPricing } from "@/lib/book-pricing";
import { SiteFooter } from "@/components/nav/site-footer";
import {
  CLERK_DOMAIN,
  CLERK_ENABLED,
  CLERK_SIGN_IN_URL,
} from "@/lib/auth-config";
import "./globals.css";

/** Apply the persisted theme before first paint (inline, FOUC-safe). */
const THEME_INIT = `try{var t=localStorage.getItem("ws-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

// The reference type pair: Instrument Sans for everything, IBM Plex Mono
// for figures that need a fixed width. Neither carries ₦, so the stack in
// globals.css falls back to Noto Sans / the system face for that glyph.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "WorldStreet Prediction Markets",
  description:
    "WorldStreet Prediction Markets - High-precision probability desk, active forecasting, and binary contract settlement.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The API's pricing and its international-trading switch, cached for a
  // minute (lib/book-pricing.ts) — what every quoted price and stake limit
  // on the site reads. Null (no API, an older one, an error) keeps
  // international markets display-only.
  const pricing = await getBookPricing();

  const page = (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <AuthProvider>
          <BookPricingProvider pricing={pricing}>
            {/* in the layout, not each page: it stays mounted across every
                navigation, so only the page below it swaps */}
            <SiteChrome>
              <SiteHeader />
              <SuspendedNotice />
            </SiteChrome>
            {children}
            <SiteFooter />
            <MobileDock />
            <Toaster />
          </BookPricingProvider>
        </AuthProvider>
      </body>
    </html>
  );

  // Satellite of the central worldstreetgold.com Clerk app — one login shared
  // across all WorldStreet platforms. Without keys (local dev) the tree renders
  // bare and the app is permanently signed out.
  if (!CLERK_ENABLED) return page;
  return (
    <ClerkProvider
      domain={CLERK_DOMAIN}
      isSatellite={true}
      signInUrl={CLERK_SIGN_IN_URL}
    >
      {page}
    </ClerkProvider>
  );
}
