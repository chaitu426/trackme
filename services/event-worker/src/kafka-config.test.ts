import assert from "node:assert/strict";
import test from "node:test";
import { kafkaConnection } from "./kafka-config";

const base = { KAFKA_BROKERS: "a:1, b:2 ,", KAFKA_SSL: false };

test("local config stays plaintext with no auth", () => {
  const c = kafkaConnection(base);
  assert.deepEqual(c.brokers, ["a:1", "b:2"]);
  assert.equal(c.ssl, undefined);
  assert.equal(c.sasl, undefined);
});

test("managed config enables TLS and SASL, loading the CA", () => {
  const c = kafkaConnection(
    {
      ...base,
      KAFKA_SSL: true,
      KAFKA_SASL_MECHANISM: "scram-sha-256",
      KAFKA_SASL_USERNAME: "u",
      KAFKA_SASL_PASSWORD: "p",
      KAFKA_CA_CERT_PATH: "/ca.pem",
    },
    (path) => `PEM:${path}`
  );
  assert.deepEqual(c.ssl, { ca: ["PEM:/ca.pem"] });
  assert.deepEqual(c.sasl, { mechanism: "scram-sha-256", username: "u", password: "p" });
});

test("TLS without a CA path trusts the system roots", () => {
  assert.equal(kafkaConnection({ ...base, KAFKA_SSL: true }).ssl, true);
});

test("SASL without credentials, or without TLS, is refused", () => {
  assert.throws(() => kafkaConnection({ ...base, KAFKA_SSL: true, KAFKA_SASL_MECHANISM: "plain" }), /USERNAME/);
  assert.throws(
    () => kafkaConnection({ ...base, KAFKA_SASL_MECHANISM: "plain", KAFKA_SASL_USERNAME: "u", KAFKA_SASL_PASSWORD: "p" }),
    /KAFKA_SSL/
  );
});
