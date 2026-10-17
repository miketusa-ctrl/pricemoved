/* AUTO from landing/content.json — npm run gen:landing (do not edit by hand) */
export type LandingContent = {
  badge?: string; hero: string; subhead: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  benefits: { title: string; body: string }[];
  how: string[]; howHeading?: string;
  wedgeTitle: string; wedgeBody: string; wedgeNote: string;
  pricingHeading: string; pricingNote: string;
  pricingNoteWaitlist?: string; pricingNoteFull?: string;
  plans: { headers: string[]; rows: string[][] };
  faq: { q: string; a: string }[];
  waitlistTitle: string; waitlistBlurb: string; consent: string; footer: string;
};
export const LANDING_CONTENT: LandingContent = {
  "hero": "Know when competitors change pricing, before your customers do.",
  "subhead": "Coming soon: watch public pricing pages. PriceMoved will fingerprint content, ignore noisy page chrome, and email you a readable diff plus a short summary when something meaningful changes. Slack on Pro.",
  "primaryCta": {
    "label": "Join the waitlist",
    "href": "#waitlist"
  },
  "secondaryCta": {
    "label": "Sign in",
    "href": "/auth/login"
  },
  "benefits": [
    {
      "title": "Pricing-page focus",
      "body": "For indie SaaS and agencies tracking plan and price moves — not an SEO audit suite."
    },
    {
      "title": "Signal over noise",
      "body": "Scripts, nav, and ephemeral tokens will be stripped so trivial UI churn doesn’t alert you."
    },
    {
      "title": "Readable alerts",
      "body": "A unified text diff plus a short 2–4 sentence summary. Decide in one glance."
    },
    {
      "title": "Public URLs only",
      "body": "PriceMoved will respect robots.txt and polite rate limits. No login-walled scraping."
    }
  ],
  "how": [
    "Add a public URL you already check by hand.",
    "Pick an interval — daily, 6-hour, or hourly (by plan).",
    "Get an alert by email, plus a Slack webhook on Pro. Mute anytime."
  ],
  "wedgeTitle": "No check-quota meter, just pages and your plan’s check interval.",
  "wedgeBody": "Most monitors sell you pages and then burn a separate monthly check allowance. Run hourly on a handful of competitors and you can hit the wall mid-month. PriceMoved will bill by how many URLs you watch—within your plan’s allowed intervals—not by a separate check-count meter.",
  "wedgeNote": "Comp context (live 2026-09-24, USD): Visualping Personal 1K is $14/mo monthly (10 pages, 1,000 checks/mo). Distill Starter is $15/mo (50 monitors, 30,000 cloud checks/mo). Different products; PriceMoved will stay on a simple page + interval model.",
  "pricingHeading": "Early pricing, subject to change",
  "pricingNote": "Checkout via Polar when live. Prices in USD.",
  "plans": {
    "headers": [
      "",
      "Free",
      "Starter",
      "Pro"
    ],
    "rows": [
      [
        "Price",
        "$0",
        "$15/mo",
        "$39/mo"
      ],
      [
        "Pages",
        "2",
        "15",
        "50"
      ],
      [
        "Intervals",
        "Daily",
        "Daily + 6h",
        "+ Hourly"
      ],
      [
        "Email",
        "✓",
        "✓",
        "✓"
      ],
      [
        "Slack webhook",
        "—",
        "—",
        "✓"
      ],
      [
        "History",
        "14 days",
        "60 days",
        "90 days"
      ]
    ]
  },
  "faq": [
    {
      "q": "What do you store?",
      "a": "Once monitoring launches: a fingerprint and a minimal text snapshot for diffs. Snapshots will be deleted after your plan’s retention window (Free 14 days, Starter 60, Pro 90). Change summaries may be kept for your history."
    },
    {
      "q": "Do you respect robots.txt?",
      "a": "Yes. Our crawler identifies itself as PriceMovedBot and checks robots.txt before every fetch. If robots.txt disallows a URL, PriceMoved will not fetch it. If robots.txt returns a server error or can’t be reached, the URL is skipped for that run."
    },
    {
      "q": "Login-walled pages?",
      "a": "No. Public URLs only — out of scope for this product."
    },
    {
      "q": "Screenshots / visual diffs?",
      "a": "Not planned for launch. Text change detection only."
    },
    {
      "q": "Payments",
      "a": "Paid plans will use Polar as Merchant of Record for checkout, tax, and billing."
    }
  ],
  "waitlistTitle": "Join the waitlist",
  "waitlistBlurb": "Leave your email and we’ll invite you when checkout opens. No spam; you can ask to be removed anytime.",
  "consent": "By joining, you agree we may store your email to contact you about PriceMoved early access. We don’t sell your email. To be removed, email {CONTACT_EMAIL}.",
  "footer": "{OPERATOR_NAME} · public URLs only · <a href=\"/privacy\">Privacy</a> · <a href=\"/terms\">Terms</a> · <a href=\"/bot\">Our crawler</a>",
  "pricingNoteWaitlist": "Checkout opens when early access launches. Prices in USD.",
  "pricingNoteFull": "Checkout via Polar when live. Prices in USD.",
  "howHeading": "How it will work"
} as LandingContent;
