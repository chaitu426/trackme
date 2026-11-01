/**
 * Marketing channel for a hit, from its referrer and UTM tags. Same buckets as GA4's default
 * channel grouping, kept short enough to read: Paid, Email, Affiliate, Organic Search,
 * Organic Social, Referral, Direct.
 *
 * Reads only `referrer`, `campaign_medium` and `campaign_source`, which exist under the same
 * names in events_raw and events_v2, so one expression serves both.
 */
const DOMAIN = "domainWithoutWWW(referrer)";

const SEARCH =
  "(^|[.])(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave|startpage|qwant|naver|seznam|ask|aol)[.][a-z.]+$";
const SOCIAL =
  "(^|[.])(facebook|fb|instagram|twitter|x|t|linkedin|lnkd|reddit|pinterest|youtube|youtu|tiktok|snapchat|whatsapp|telegram|quora|tumblr|mastodon|threads)[.][a-z.]+$";
const WEBMAIL = "^(mail[.]google[.]com|outlook[.](live|office)[.]com|mail[.]yahoo[.]com)$";

export const CHANNEL_SQL = `multiIf(
  lower(campaign_medium) IN ('cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search', 'paidsocial', 'paid_social', 'paid-social', 'display', 'cpm', 'retargeting', 'banner'), 'Paid',
  lower(campaign_medium) IN ('email', 'e-mail', 'newsletter'), 'Email',
  lower(campaign_medium) IN ('affiliate', 'affiliates'), 'Affiliate',
  lower(campaign_medium) IN ('social', 'social-network', 'social-media', 'sm', 'social network', 'social media'), 'Organic Social',
  lower(campaign_medium) = 'organic', 'Organic Search',
  referrer != '' AND match(${DOMAIN}, '${WEBMAIL}'), 'Email',
  referrer != '' AND match(${DOMAIN}, '${SEARCH}'), 'Organic Search',
  referrer != '' AND match(${DOMAIN}, '${SOCIAL}'), 'Organic Social',
  referrer != '', 'Referral',
  campaign_source != '', 'Other campaign',
  'Direct'
)`;
