"use client";

import { useEffect, useRef, useState } from "react";
import { MailOpen, X } from "lucide-react";
import { LogoMark } from "@/components/home/hero/shared";
import { useAuth } from "./auth-context";

/**
 * Auth modal cloned from the real flow: step 1 "Welcome" (Google + email),
 * step 2 six-digit code entry (grouped 3+3, phishing warning). Mock only —
 * Google signs in immediately, any 6-digit code completes email sign-in.
 */
export function AuthModal() {
  const { closeAuth, signIn } = useAuth();
  const [step, setStep] = useState<"welcome" | "code">("welcome");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAuth();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAuth]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={step === "welcome" ? "Sign up or log in" : "Enter verification code"}
      onClick={closeAuth}
      className="fixed inset-0 z-50 flex items-center justify-center bg-alpha-black-600 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[440px] rounded-2xl border border-border bg-surface px-7 pb-7 pt-8 shadow-popover"
      >
        <button
          aria-label="Close"
          onClick={closeAuth}
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-element-2 text-secondary transition-colors duration-150 ease-in-out hover:bg-element-3 hover:text-primary"
        >
          <X className="size-4" />
        </button>

        {step === "welcome" ? (
          <WelcomeStep
            email={email}
            setEmail={setEmail}
            onGoogle={() => signIn("trader@gmail.com")}
            onContinue={() => setStep("code")}
          />
        ) : (
          <CodeStep email={email} onComplete={() => signIn(email)} />
        )}
      </div>
    </div>
  );
}

/* ---------- step 1: welcome ---------- */

function WelcomeStep({
  email,
  setEmail,
  onGoogle,
  onContinue,
}: {
  email: string;
  setEmail: (v: string) => void;
  onGoogle: () => void;
  onContinue: () => void;
}) {
  const valid = /.+@.+\..+/.test(email);
  return (
    <div>
      <h2 className="text-center text-xl font-semibold">
        Welcome to Worldstreet
      </h2>

      <button
        onClick={onGoogle}
        className="mt-6 flex h-13 w-full items-center justify-center gap-2.5 rounded-xl bg-blue-500 text-base font-semibold text-white transition-colors duration-[120ms] ease-out hover:bg-blue-400"
      >
        <GoogleG />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-sm font-medium tracking-wide text-secondary">
          OR
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onContinue();
        }}
        className="flex items-center rounded-xl border border-border bg-element-2/40 p-1.5 transition-colors focus-within:border-border-active"
      >
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-secondary"
        />
        <button
          type="submit"
          disabled={!valid}
          className="h-10 shrink-0 rounded-lg bg-blue-500 px-4 text-sm font-semibold text-white transition-colors duration-[120ms] ease-out hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-blue-500"
        >
          Continue
        </button>
      </form>

      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-secondary">
        <button className="hover:text-primary">Terms</button>
        <span className="text-tertiary">•</span>
        <button className="hover:text-primary">Privacy</button>
      </p>
    </div>
  );
}

/** Single-color Google "G" mark (no brand asset in the mock phase). */
function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M21.6 12.2c0-.7-.1-1.3-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
      <path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.9 5.9 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22z" />
      <path d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.2a10 10 0 0 0 0 9L6.5 14z" />
      <path d="M12 6c1.5 0 2.8.5 3.8 1.5L18.7 5A10 10 0 0 0 3.2 7.5L6.5 10A5.9 5.9 0 0 1 12 6z" />
    </svg>
  );
}

/* ---------- step 2: code ---------- */

function CodeStep({
  email,
  onComplete,
}: {
  email: string;
  onComplete: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const commit = (next: string[]) => {
    setDigits(next);
    if (next.every((d) => d !== "")) {
      // tiny pause so the last digit is visible before the modal closes
      setTimeout(onComplete, 250);
    }
  };

  // distribute every typed digit from slot i onward, so fast typing
  // (multiple chars landing in one box) still fills the row correctly
  const handleChange = (i: number, value: string) => {
    const chars = value.replace(/\D/g, "");
    const next = [...digits];
    if (!chars) {
      next[i] = "";
      commit(next);
      return;
    }
    for (let k = 0; k < chars.length && i + k < 6; k++) next[i + k] = chars[k];
    commit(next);
    refs.current[Math.min(i + chars.length, 5)]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(6)
      .fill("")
      .map((_, i) => pasted[i] ?? "");
    commit(next);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="text-center">
      <MailOpen className="mx-auto size-10 text-accent" strokeWidth={1.8} />
      <h2 className="mt-4 text-lg font-medium leading-7">
        Please enter the code sent to
        <br />
        <span className="font-semibold">{email}</span>
      </h2>

      <div className="mt-6 flex items-center justify-center gap-2" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <span key={i} className="flex items-center">
            {i === 3 && <span className="w-2" aria-hidden />}
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={`Digit ${i + 1}`}
              className="size-12 rounded-lg border border-border bg-transparent text-center text-xl font-semibold outline-none transition-colors focus:border-accent"
            />
          </span>
        ))}
      </div>

      <p className="mx-auto mt-6 max-w-[340px] text-[13px] leading-5 text-secondary">
        The Worldstreet staff will NEVER give you a code to enter. If someone
        gives you a code to enter this is a{" "}
        <b className="text-primary">phishing</b> attempt and should be{" "}
        <b className="text-primary">reported</b> to Worldstreet.
      </p>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-sm text-tertiary">
        Secured by
        <span className="flex items-center gap-1 font-semibold text-secondary">
          <LogoMark />
          Worldstreet
        </span>
      </p>
    </div>
  );
}
