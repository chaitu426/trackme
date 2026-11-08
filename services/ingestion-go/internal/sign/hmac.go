package sign

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// MaxSkew is how far a signed timestamp may be from the server's clock. Generous enough for ordinary client
// clock drift, short enough that a captured request is useless soon after.
const MaxSkew = 5 * time.Minute

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

// ValidTimestamped checks the replay-resistant form: signatureHex is HMAC-SHA256(secret, timestamp + "." + body),
// where timestamp is Unix seconds sent in X-GI-Timestamp. The signature covers the timestamp, so it cannot be
// changed to make an old request look fresh, and a request more than maxSkew from now is refused even if its
// signature is correct. The legacy form (Valid) signs the body alone, so anyone who captures one signed request
// can replay it indefinitely.
func ValidTimestamped(secretPlaintext string, body []byte, timestamp, signatureHex string, now time.Time, maxSkew time.Duration) bool {
	if secretPlaintext == "" || signatureHex == "" {
		return false
	}
	seconds, err := strconv.ParseInt(strings.TrimSpace(timestamp), 10, 64)
	if err != nil {
		return false
	}
	age := now.Sub(time.Unix(seconds, 0))
	if age < 0 {
		age = -age
	}
	if age > maxSkew {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secretPlaintext))
	_, _ = mac.Write([]byte(strings.TrimSpace(timestamp) + "."))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	sig := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(signatureHex)), "sha256=")
	return subtle.ConstantTimeCompare([]byte(expected), []byte(sig)) == 1
}
