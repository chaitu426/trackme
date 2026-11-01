package queue

import "testing"

func TestSecurityPlaintextHasNoTransport(t *testing.T) {
	tr, err := Security{}.Transport()
	if err != nil || tr != nil {
		t.Fatalf("got %v, %v; want nil, nil", tr, err)
	}
}

func TestSecurityScramOverTLS(t *testing.T) {
	tr, err := Security{SSL: true, SASLMechanism: "scram-sha-256", Username: "u", Password: "p"}.Transport()
	if err != nil || tr == nil || tr.TLS == nil || tr.SASL == nil {
		t.Fatalf("got %+v, %v; want TLS and SASL set", tr, err)
	}
}

func TestSecurityRefusesSASLWithoutTLS(t *testing.T) {
	if _, err := (Security{SASLMechanism: "plain", Username: "u", Password: "p"}).Transport(); err == nil {
		t.Fatal("SASL without TLS must be refused")
	}
}

func TestSecurityRejectsMissingCredentialsUnknownMechanismAndBadCA(t *testing.T) {
	cases := []Security{
		{SSL: true, SASLMechanism: "plain"},
		{SSL: true, SASLMechanism: "gssapi", Username: "u", Password: "p"},
		{SSL: true, CACertPath: "does-not-exist.pem"},
	}
	for _, c := range cases {
		if _, err := c.Transport(); err == nil {
			t.Fatalf("%+v: expected an error", c)
		}
	}
}
