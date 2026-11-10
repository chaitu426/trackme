# TrackMe documentation

Start here. Every document lives in one of five folders; pick by what you are trying to do.

## Architecture: how it is built
| Document | What it covers |
| --- | --- |
| [suite-foundation](architecture/suite-foundation.md) | The product suite and the shared foundation under it |
| [ARCHITECTURE_REVIEW](architecture/ARCHITECTURE_REVIEW.md) | Review findings (P0 to P3) and what has landed |
| [ARCHITECTURE_OPTIMIZATION_PLAN](architecture/ARCHITECTURE_OPTIMIZATION_PLAN.md) | Optimisation workstreams and their status |
| [INGESTION_SCALE_ARCHITECTURE](architecture/INGESTION_SCALE_ARCHITECTURE.md) | The ingestion path at scale |

Diagrams (Excalidraw, open at excalidraw.com): `trackme-architecture*.excalidraw` and `trackme-aws-system-design*.excalidraw`, in this folder.

## Features: what each part does
| Document | What it covers |
| --- | --- |
| [ask-agent](features/ask-agent.md) | Ask, the in-app agent: UI, backend, money trail |
| [errors](features/errors.md) | Error tracking and grouping |
| [payments](features/payments.md) | Payments, gateways and failure classification |
| [releases](features/releases.md), [release-impact](features/release-impact.md) | Deploys and what a release changed |
| [sourcemaps](features/sourcemaps.md) | Source map upload and symbolication |
| [sdk](features/sdk.md) | The browser SDK |
| [segments](features/segments.md), [retention](features/retention.md), [user360](features/user360.md) | Segments, cohorts, the per-person view |

## Operations: running it
| Document | What it covers |
| --- | --- |
| [DEPLOYMENT_AWS_GCP](operations/DEPLOYMENT_AWS_GCP.md) | Production deployment on AWS or GCP (a plan, not yet run) |
| [FREE_TEST_HOSTING](operations/FREE_TEST_HOSTING.md) | A low-cost test environment |
| [RUNBOOK](operations/RUNBOOK.md) | Alerts and what to do about them |
| [SECURITY_AUDIT](operations/SECURITY_AUDIT.md) | Security findings and the guards against them |
| [INGESTION_FAILURE_ANALYSIS](operations/INGESTION_FAILURE_ANALYSIS.md), [INGESTION_FIX_PLAN](operations/INGESTION_FIX_PLAN.md) | An ingestion incident and its fix |

## Design
| Document | What it covers |
| --- | --- |
| [design-system](design/design-system.md) | The palette (Graphite and Signal), components and the rules the tests enforce |

## Plans: what is next
[implementation-plan](plans/implementation-plan.md), [phase1-plan](plans/phase1-plan.md), [phase2-plan](plans/phase2-plan.md), [suite-foundation-plan](plans/suite-foundation-plan.md), [feature-ideas](plans/feature-ideas.md).

Also at the repository root: `README.md` (setup) and `SECURITY.md` (reporting a vulnerability).
