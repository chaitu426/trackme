package sign

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

// HashSecret returns the SHA-256 hex digest (for "configured?" checks / audit).
func HashSecret(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// Valid reports whether signatureHex is HMAC-SHA256(secret, body) in hex
// (constant-time). Accepts an optional "sha256=" prefix.
func Valid(secretPlaintext string, body []byte, signatureHex string) bool {
	if secretPlaintext == "" || signatureHex == "" {
		return false
	}
	sig := strings.TrimSpace(signatureHex)
	sig = strings.TrimPrefix(strings.ToLower(sig), "sha256=")

	mac := hmac.New(sha256.New, []byte(secretPlaintext))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))

	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(sig))) == 1
}
