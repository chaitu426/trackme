/** Colour per marketing channel, shared by the channel mix and anything that lists channels. */
export const CHANNEL_COLORS: Record<string, string> = {
  "Organic Search": "#ededed",
  "Organic Social": "#ededed",
  Referral: "#c6c6c6",
  Paid: "#b4b4ba",
  Email: "#8b8b92",
  Affiliate: "#6e6e74",
  "Other campaign": "#55555b",
  Direct: "#71717a",
};

export const CHANNEL_HINTS: Record<string, string> = {
  "Organic Search": "Google, Bing, DuckDuckGo and other search engines",
  "Organic Social": "Social networks, without paid tags",
  Referral: "Links from other websites",
  Paid: "Tagged ads (cpc, ppc, display, paid social)",
  Email: "Newsletters and webmail",
  Affiliate: "Affiliate partner links",
  "Other campaign": "Tagged links that fit no other channel",
  Direct: "Typed the address, bookmarks, or no referrer was sent",
};

/** The name a traffic source is shown under. The database stores an unknown source as "(direct / none)". */
export function sourceLabel(name: string | null | undefined): string {
  if (!name || name === "(direct / none)") return "Direct / None";
  return name;
}
