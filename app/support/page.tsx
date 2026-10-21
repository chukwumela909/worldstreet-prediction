import type { Metadata } from "next";
import { SupportView } from "@/components/support/support-view";

export const metadata: Metadata = { title: "Support | WorldStreet" };

export default function SupportPage() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
      <p className="mt-1 max-w-2xl text-sm text-secondary">
        Questions about deposits, withdrawals, a bet or your account? Send us a message and
        we&rsquo;ll reply here and by email.
      </p>
      <div className="mt-6">
        <SupportView />
      </div>
    </main>
  );
}
