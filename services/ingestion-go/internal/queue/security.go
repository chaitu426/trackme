package queue

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/plain"
	"github.com/segmentio/kafka-go/sasl/scram"
)

// Security is the TLS/SASL setup for a managed Kafka cluster. The zero value means
// the plaintext local broker.
type Security struct {
	SSL           bool
	SASLMechanism string // "", plain, scram-sha-256, scram-sha-512
	Username      string
	Password      string
	CACertPath    string
}

// Transport returns nil for a plaintext, unauthenticated broker. SASL without TLS
// is refused because it would send the password in clear text.
func (s Security) Transport() (*kafka.Transport, error) {
	mech, err := s.mechanism()
	if err != nil {
		return nil, err
	}
	if mech != nil && !s.SSL {
		return nil, fmt.Errorf("KAFKA_SASL_MECHANISM requires KAFKA_SSL=true")
	}
	if !s.SSL {
		return nil, nil
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if s.CACertPath != "" {
		pem, err := os.ReadFile(s.CACertPath)
		if err != nil {
			return nil, fmt.Errorf("read KAFKA_CA_CERT_PATH: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("KAFKA_CA_CERT_PATH contains no valid certificate")
		}
		tlsConfig.RootCAs = pool
	}
	return &kafka.Transport{TLS: tlsConfig, SASL: mech}, nil
}

func (s Security) mechanism() (sasl.Mechanism, error) {
	name := strings.ToLower(strings.TrimSpace(s.SASLMechanism))
	if name == "" {
		return nil, nil
	}
	if s.Username == "" || s.Password == "" {
		return nil, fmt.Errorf("KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required when KAFKA_SASL_MECHANISM is set")
	}
	switch name {
	case "plain":
		return plain.Mechanism{Username: s.Username, Password: s.Password}, nil
	case "scram-sha-256":
		return scram.Mechanism(scram.SHA256, s.Username, s.Password)
	case "scram-sha-512":
		return scram.Mechanism(scram.SHA512, s.Username, s.Password)
	}
	return nil, fmt.Errorf("unsupported KAFKA_SASL_MECHANISM %q", s.SASLMechanism)
}

// WithTransport makes the publisher use t (TLS/SASL). A nil t keeps the default.
func (p *Publisher) WithTransport(t *kafka.Transport) *Publisher {
	if t != nil {
		p.writer.Transport = t
	}
	return p
}
