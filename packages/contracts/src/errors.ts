import { z } from "zod";

export const ProblemDetailsSchema = z.object({
  type: z.string().url().default("https://trackme.internal/errors/bad-request"),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string().optional(),
  code: z.string().optional(),
  /** Present on PLAN_LIMIT errors: what was hit, so the UI can show an upgrade prompt. */
  plan: z
    .object({
      plan: z.string(),
      resource: z.string(),
      limit: z.number().nullable(),
      current: z.number(),
      upgradeTo: z.string().nullable(),
    })
    .optional(),
  invalidParams: z
    .array(
      z.object({
        name: z.string(),
        reason: z.string(),
      })
    )
    .optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly detail: string;
  public readonly plan: ProblemDetails["plan"];

  constructor(status: number, code: string, detail: string, plan?: ProblemDetails["plan"]) {
    super(detail);
    this.plan = plan;
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  toProblemDetails(instance?: string): ProblemDetails {
    return {
      type: `https://trackme.internal/errors/${this.code.toLowerCase()}`,
      title: this.name,
      status: this.status,
      detail: this.detail,
      code: this.code,
      ...(this.plan ? { plan: this.plan } : {}),
      instance,
    };
  }
}

