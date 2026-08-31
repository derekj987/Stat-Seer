// Founder's out-of-pocket running costs, shown on the private Creator dashboard.
// EDIT `monthly` to match your real bills. `variable: true` = usage-based (estimated run-rate).
export interface Expense {
  name: string;
  monthly: number;      // USD / month
  variable?: boolean;   // usage-based (estimate), not a fixed subscription
  note?: string;
}

export const EXPENSES: Expense[] = [
  { name: "Claude subscription", monthly: 100, note: "Max plan" },
  { name: "The Odds API", monthly: 119, note: "odds + historical/props plan" },
  { name: "Supabase", monthly: 25, note: "Pro" },
  { name: "ChatGPT Plus", monthly: 20, note: "image help" },
  { name: "Resend", monthly: 20, note: "email" },
  { name: "Cloudflare", monthly: 5, note: "Workers paid" },
  { name: "Google Workspace", monthly: 7, note: "business email (1 user)" },
  { name: "GitHub", monthly: 4, note: "Pro" },
  { name: "Anthropic API", monthly: 0, variable: true, note: "usage-based — set your monthly run-rate" },
];

export const monthlyTotal = (): number => EXPENSES.reduce((s, e) => s + (e.monthly || 0), 0);
export const annualTotal = (): number => monthlyTotal() * 12;

// Usage-based plan limits, so you can see how much of each you're using and how much is left.
// `key` maps to a live-measured value the Creator dashboard fills in.
export interface UsageMeter {
  name: string;
  key: "storage" | "mau";
  limit: number;         // in `unit`
  unit: "GB" | "users";
  limitLabel: string;    // e.g. "100 GB (Supabase Pro)"
}
export const USAGE: UsageMeter[] = [
  { name: "File storage", key: "storage", limit: 100, unit: "GB", limitLabel: "100 GB · Supabase Pro" },
  { name: "Monthly active users", key: "mau", limit: 100000, unit: "users", limitLabel: "100,000 · Supabase Pro" },
];
