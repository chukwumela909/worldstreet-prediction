import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-context";
import { SiteFooter } from "@/components/nav/site-footer";
import "./globals.css";

/** Apply the persisted theme before first paint (inline, FOUC-safe). */
const THEME_INIT = `try{var t=localStorage.getItem("ws-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Worldstreet | Prediction Markets",
  description: "Trade on the world's most debated outcomes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <AuthProvider>
          {children}
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
