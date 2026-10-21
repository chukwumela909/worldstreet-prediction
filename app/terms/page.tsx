import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms and Conditions | WorldStreet Predict",
  description:
    "The terms for betting on WorldStreet Predict: fair play, what isn't allowed, and when bets can be refunded, voided or reversed.",
};

/**
 * The Terms and Conditions for WorldStreet Predict. Sections 4 (what
 * isn't allowed) and 5 (our right to refund, void or reverse bets) are
 * the ones the desk acts on — suspensions and Recovery reversals point
 * here. Bump UPDATED with every change to the wording.
 */

const UPDATED = "21 October 2026";

const SECTIONS = [
  { id: "agreeing", title: "Agreeing to these terms" },
  { id: "account", title: "Your account" },
  { id: "betting", title: "How betting works" },
  { id: "fair-play", title: "Fair play: what is not allowed" },
  { id: "refunds", title: "Errors, glitches and our right to refund or reverse bets" },
  { id: "breaches", title: "What we can do if we find a breach" },
  { id: "settlement", title: "How markets settle" },
  { id: "credit", title: "Credit, deposits and withdrawals" },
  { id: "suspension", title: "Suspending or closing accounts" },
  { id: "responsibility", title: "Our responsibility to you" },
  { id: "changes", title: "Changes to these terms" },
  { id: "contact", title: "Questions and complaints" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <article className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
          WorldStreet Predict
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Terms and Conditions</h1>
        <p className="mt-2 text-sm text-secondary">Last updated {UPDATED}</p>

        <p className="mt-6 text-base leading-7 text-secondary">
          These terms apply to WorldStreet Predict, the prediction markets on WorldStreet
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). Please read them in full,
          especially <a href="#fair-play" className={LINK}>section 4</a>, which explains what is
          not allowed, and <a href="#refunds" className={LINK}>section 5</a>, which explains when
          we can refund, void or reverse bets.
        </p>

        <div className="mt-6 rounded-xl border border-border-active bg-element-2 p-4 sm:p-5">
          <h2 className="text-base font-semibold">The short version</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-primary">
            <li>By using WorldStreet Predict or placing a bet, you accept these terms in full.</li>
            <li>
              Our markets are for genuine predictions on outcomes that are still uncertain.
              Exploiting glitches, wrong or late prices, or results that are already known —
              including by placing the same kind of bet over and over — is not allowed.
            </li>
            <li>
              If we find a glitch, an error, or prohibited or illegal activity, we have the absolute
              right to refund, void or reverse any bet — even one that has already settled and been
              paid — and to correct your balance.
            </li>
            <li>When we do, we return your stake and tell you why by email.</li>
          </ul>
        </div>

        <nav aria-label="On this page" className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-tertiary">On this page</h2>
          <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-secondary hover:text-primary hover:underline">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="agreeing">
          <P>
            These terms are a binding agreement between you and us. You accept them in full when you
            create an account, sign in, add credit or place a bet on WorldStreet Predict. If you
            don&rsquo;t accept them, don&rsquo;t use the service.
          </P>
          <P>
            They apply to every bet you have placed or will place, and to every market, open or
            settled. They sit alongside the terms of your WorldStreet account; where the two differ on
            WorldStreet Predict, these terms apply.
          </P>
        </Section>

        <Section id="account">
          <List
            items={[
              "You must be 18 or older and allowed by the law where you live to take part.",
              "One account per person. Use your own account, your own money and your own details, and keep your login safe. You are responsible for everything done through your account.",
              "We may ask you to confirm who you are, or where your money came from, at any time.",
            ]}
          />
        </Section>

        <Section id="betting">
          <List
            items={[
              "WorldStreet is the other side of every bet you place. Each share in an outcome pays ₦100 if that outcome wins and ₦0 if it loses.",
              "We set the prices. Many follow outside sources (such as Bayse or Polymarket) and include our margin. Prices can change at any moment, and may rise as more money is bet on one side.",
              "A bet is placed only when we confirm it. We may refuse any bet, limit stakes, pause or close any market, and stop taking bets before a market closes, at any time and without giving a reason.",
              "Bets are held until the market settles. Apart from what section 5 allows, a confirmed bet can't be cancelled.",
            ]}
          />
        </Section>

        <Section id="fair-play">
          <P>
            Our markets are for genuine predictions about outcomes that are still uncertain. The
            following are not allowed, whether done once or repeatedly, alone or with others:
          </P>
          <ol className="mt-4 space-y-4">
            <Rule letter="a" title="Exploiting a glitch or error.">
              Placing bets you know, or should reasonably know, are wrongly priced or accepted by
              mistake — for example because a price is stale, delayed or wrong, a market stayed open
              when it should have closed, or our system has a fault.
            </Rule>
            <Rule letter="b" title="Betting on results that are already known.">
              Betting when the outcome is already decided or as good as decided while our price
              hasn&rsquo;t caught up — for example after kick-off or during a live game, after a count
              or figure can already be seen in public, or in the last moments of a short market when
              the result is already clear.
            </Rule>
            <Rule letter="c" title="Repetitive betting to take advantage of a weakness.">
              Placing the same or similar bets again and again to collect a near-certain profit from
              a pricing or timing gap — for example the maximum stake, round after round, on the side
              of a 15-minute &ldquo;Up or Down&rdquo; market that is already all but decided, or bet
              after bet on a count market once the count can be seen. One such bet can look
              ordinary; a repeated pattern of them is a way of exploiting the platform, not a
              prediction. We treat the pattern as prohibited even where each single bet would
              otherwise be allowed.
            </Rule>
            <Rule letter="d" title="Automated betting.">
              Using bots, scripts, scrapers or any automated tool to watch prices or place bets,
              without our written permission.
            </Rule>
            <Rule letter="e" title="More than one account, or someone else’s.">
              Opening several accounts, using another person&rsquo;s account or details, or working
              with other users to get round our limits or share an advantage.
            </Rule>
            <Rule letter="f" title="Inside information or fixing outcomes.">
              Betting on an event whose result you can influence, or about which you have
              information that isn&rsquo;t public.
            </Rule>
            <Rule letter="g" title="Fraud and illegal activity.">
              Using stolen or borrowed funds, money laundering, chargeback fraud, or anything else
              that breaks the law.
            </Rule>
            <Rule letter="h" title="Interfering with the service.">
              Probing for weaknesses, getting round limits or checks, repeating or tampering with
              requests, or anything else that harms the platform or other users.
            </Rule>
          </ol>
          <P>
            If you aren&rsquo;t sure whether something is allowed, ask us first through{" "}
            <Link href="/support" className={LINK}>Support</Link>. If you spot a glitch or a wrong
            price, tell us — don&rsquo;t use it.
          </P>
        </Section>

        <Section id="refunds">
          <div className="mt-3 rounded-xl border border-border-active bg-element-2 p-4 sm:p-5">
            <p className="text-base font-semibold leading-7 text-primary">
              We have the absolute right, at our sole discretion and to the fullest extent the law
              allows, to cancel, void or reverse any bet, and to refund stakes, take back winnings and
              correct balances, whenever we find or reasonably suspect:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-primary">
              <li>
                a technical glitch, system fault, or a pricing, data or settlement error — ours or one
                of our data providers&rsquo;;
              </li>
              <li>a market that took bets after its result was known, or when it should have been closed;</li>
              <li>
                any activity that <a href="#fair-play" className={LINK}>section 4</a> does not allow,
                or any illegal activity.
              </li>
            </ul>
          </div>

          <h3 className={H3}>This applies to</h3>
          <List
            items={[
              "bets that are still open, and bets that have already settled and been paid;",
              "winnings you have already received, spent, converted or withdrawn;",
              "every bet on an affected market — not only bets placed by the people involved — where we need to correct the market as a whole.",
            ]}
          />

          <h3 className={H3}>What happens to your money</h3>
          <List
            items={[
              "A refunded or voided bet: your stake goes back to your credit balance.",
              "A reversed bet that had already settled: your stake goes back, and any winnings paid on it are taken back.",
              "If the winnings taken back are more than your balance, your balance can go below zero. Any new credit or winnings go towards it first, and you can't bet or withdraw until it is back above zero. We may, at our discretion, waive what you owe.",
              "We will email you to say what we did and why.",
            ]}
          />

          <P>
            <strong className="text-primary">
              By using WorldStreet Predict you accept this in full.
            </strong>{" "}
            Where we refund, void or reverse a bet under this section, your only entitlement is the
            return of your stake on that bet: you have no claim to its winnings or to any other
            compensation for it. Our decision is final, to the extent the law allows.
          </P>
        </Section>

        <Section id="breaches">
          <P>
            If we find or reasonably suspect a breach of these terms, we may, without notice and as
            well as anything section 5 allows:
          </P>
          <List
            items={[
              "refuse or limit your bets;",
              "cancel, void or reverse your bets, and keep or take back the winnings on them;",
              "suspend or close your account;",
              "hold your balance and withdrawals while we look into it;",
              "recover from you any money you owe us;",
              "report the matter to the relevant authorities.",
            ]}
          />
        </Section>

        <Section id="settlement">
          <List
            items={[
              "Each market settles on the result given by its source or its rules, as we determine it.",
              "If an event is cancelled, its result can't be determined, or the market was set up or settled wrongly, we may void it and return stakes, or settle it again correctly.",
              "Winnings are paid as credit to your balance when the market settles.",
            ]}
          />
        </Section>

        <Section id="credit">
          <List
            items={[
              "Credit is naira value for betting on WorldStreet Predict. You add it by converting from your WorldStreet wallet and withdraw it the same way, at the rates shown at the time.",
              "We may delay or refuse a conversion or withdrawal while we check an account, while an account is suspended, or while a balance is below zero.",
              "We will correct any credit added to your balance by mistake.",
            ]}
          />
        </Section>

        <Section id="suspension">
          <P>
            We may suspend or close any account at our discretion — for example for a breach of these
            terms, to look into unusual activity, or where the law requires it. While your account is
            suspended you can sign in, see your bets and contact support, but you can&rsquo;t place
            bets or move money. Bets already open still settle, subject to section 5.
          </P>
        </Section>

        <Section id="responsibility">
          <List
            items={[
              "We work to keep WorldStreet Predict accurate and available, but we can't promise it will always be free of errors, delays or interruptions.",
              "To the fullest extent the law allows, we are not responsible for losses caused by events outside our control, by outside data sources, or by use of the service against these terms, and our total responsibility for any bet is limited to the stake placed on it.",
              "Nothing in these terms takes away any right you have by law that can't be excluded.",
            ]}
          />
        </Section>

        <Section id="changes">
          <P>
            We may update these terms at any time; the date at the top shows the latest version.
            Changes apply from the moment they are published here. If you keep using WorldStreet
            Predict after a change, you accept the updated terms.
          </P>
        </Section>

        <Section id="contact">
          <P>
            Write to us through the <Link href="/support" className={LINK}>Support page</Link>.
            We&rsquo;ll reply there and by email.
          </P>
        </Section>
      </article>
    </main>
  );
}

const LINK = "font-semibold text-primary underline underline-offset-2 hover:text-accent-ink";
const H3 = "mt-5 text-sm font-semibold text-primary";

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const n = SECTIONS.findIndex((s) => s.id === id) + 1;
  const title = SECTIONS[n - 1]!.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-28">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-base leading-7 text-secondary">{children}</p>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-secondary">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Rule({
  letter,
  title,
  children,
}: {
  letter: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-element-2 text-xs font-semibold text-primary">
        {letter}
      </span>
      <p className="text-base leading-7 text-secondary">
        <strong className="text-primary">{title}</strong> {children}
      </p>
    </li>
  );
}
