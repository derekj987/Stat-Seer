// Founder's out-of-pocket running costs, shown on the private Creator dashboard.
//
// EDIT THESE to match your real bills. `monthly` is the recurring cost in USD.
// Set `variable: true` for usage-based costs (put your estimated monthly run-rate).
// These numbers are placeholders/estimates until you confirm them — nothing reads them
// but your own dashboard.
export interface Expense {
  name: string;
  monthly: number;      // USD / month
  variable?: boolean;   // usage-based (estimate), not a fixed subscription
  note?: string;
}

export const EXPENSES: Expense[] = [
  { name: "Claude subscription", monthly: 100, note: "set to your plan — Pro $20 / Max $100 / $200" },
  { name: "ChatGPT Plus", monthly: 20, note: "image help" },
  { name: "Anthropic API", monthly: 0, variable: true, note: "usage-based — set your monthly run-rate" },
  { name: "The Odds API", monthly: 119, note: "odds + historical/props plan" },
  { name: "Supabase", monthly: 25, note: "Pro — set 0 if on the free tier" },
  { name: "Google Workspace", monthly: 7, note: "business email (1 user)" },
  { name: "Resend", monthly: 0, note: "email — free tier for now" },
  { name: "Cloudflare", monthly: 0, note: "free plan" },
  { name: "GitHub", monthly: 0, note: "free" },
];

export const monthlyTotal = (): number => EXPENSES.reduce((s, e) => s + (e.monthly || 0), 0);
export const annualTotal = (): number => monthlyTotal() * 12;
