export type BotClassification = {
  isBot: boolean;
  botStatus: "human" | "known_bot" | "heuristic_bot";
  device: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  browser: string;
  os: string;
};

const KNOWN_BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /yandex/i,
  /baiduspider/i,
  /duckduckbot/i,
  /slurp/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /embedly/i,
  /quora link preview/i,
  /showyoubot/i,
  /outbrain/i,
  /pinterest/i,
  /slackbot/i,
  /vkshare/i,
  /w3c_validator/i,
  /semrushbot/i,
  /ahrefsbot/i,
  /mj12bot/i,
  /dotbot/i,
  /curl\//i,
  /python-requests/i,
  /node-fetch/i,
  /axios/i,
  /go-http-client/i,
];

/**
 * Classify user agent and classify bot vs human traffic
 */
export function classifyRequest(userAgent: string | undefined): BotClassification {
  if (!userAgent || userAgent.trim().length === 0) {
    return {
      isBot: true,
      botStatus: "heuristic_bot",
      device: "bot",
      browser: "unknown",
      os: "unknown",
    };
  }

  // Check known bot patterns
  for (const pattern of KNOWN_BOT_PATTERNS) {
    if (pattern.test(userAgent)) {
      return {
        isBot: true,
        botStatus: "known_bot",
        device: "bot",
        browser: "bot",
        os: "bot",
      };
    }
  }

  // Basic device and OS heuristics
  let device: BotClassification["device"] = "desktop";
  let os = "other";
  let browser = "other";

  if (/mobile/i.test(userAgent)) {
    device = "mobile";
  } else if (/tablet|ipad/i.test(userAgent)) {
    device = "tablet";
  }

  if (/windows/i.test(userAgent)) os = "Windows";
  else if (/macintosh|mac os x/i.test(userAgent)) os = "macOS";
  else if (/android/i.test(userAgent)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(userAgent)) os = "iOS";
  else if (/linux/i.test(userAgent)) os = "Linux";

  if (/chrome|crios/i.test(userAgent) && !/edg/i.test(userAgent)) browser = "Chrome";
  else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = "Safari";
  else if (/firefox|fxios/i.test(userAgent)) browser = "Firefox";
  else if (/edg/i.test(userAgent)) browser = "Edge";

  return {
    isBot: false,
    botStatus: "human",
    device,
    browser,
    os,
  };
}

