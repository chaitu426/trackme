import { razorpay } from "./razorpay.js";
import { stripe } from "./stripe.js";
import { GATEWAY_IDS, type GatewayId, type PaymentGateway } from "./types.js";

export * from "./types.js";
export { razorpay } from "./razorpay.js";
export { stripe, STRIPE_TOLERANCE_SECONDS } from "./stripe.js";
export { hmacHex, signaturesMatch } from "./common.js";

const GATEWAYS: Record<GatewayId, PaymentGateway> = { razorpay, stripe };

/** The adapter for a gateway id, or null for one that is not supported. Adding a gateway is one adapter file and one line here. */
export function getGateway(id: string): PaymentGateway | null {
  return (GATEWAY_IDS as readonly string[]).includes(id) ? GATEWAYS[id as GatewayId] : null;
}
export * from "./failure-doctor.js";
