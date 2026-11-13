import type { AccessLevel, Feature } from "@trackme/contracts";

/**
 * Starting points for the teams most products have. A preset is only a suggestion of what each team usually needs: it
 * fills the access matrix for one site, which an admin then reviews and saves. Nothing is granted until they do.
 */
export interface TeamPreset {
  name: string;
  description: string;
  grants: Partial<Record<Feature, AccessLevel>>;
}

export const TEAM_PRESETS: TeamPreset[] = [
  {
    name: "Marketing",
    description: "Traffic, campaigns, funnels and goals",
    grants: { acquisition: "manage", funnels: "manage", ask: "view" },
  },
  {
    name: "Engineering",
    description: "Errors, releases, performance and the tracking setup",
    grants: { errors: "manage", releases: "manage", acquisition: "view", site_settings: "manage", ask: "view" },
  },
  {
    name: "QA",
    description: "Verify fixes against errors and releases",
    grants: { errors: "manage", releases: "view", ask: "view" },
  },
  {
    name: "Finance",
    description: "Revenue, failed payments and refunds",
    grants: { payments: "manage", acquisition: "view" },
  },
  {
    name: "Support",
    description: "Look up a person's history and the errors they hit",
    grants: { people: "manage", errors: "view" },
  },
];
