package site

import "testing"

// Produced by apps/web/src/lib/secret-box.ts (encryptSecret) with the key below: proves the two services agree
// on the format, not just that Go can read what Go wrote.
const (
	nodeKey    = "0123456789abcdef0123456789abcdef"
	nodeSealed = "enc:v2:3eb1bd43:GS6HO_fHVRY5LljPTAN-5muTLQAE0VTi_osMGptZG5pnJ2d8o7pmgfaqrpod5inLsZ2B5i0"
)

func TestDecryptsWhatTheWebAppEncrypts(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("SITE_SIGNING_SECRET_KEY", nodeKey)
	got, err := decryptStoredSecret(nodeSealed)
	if err != nil || got != "gis_cross_language_secret" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestRotationKeepsOldValuesReadable(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("SITE_SIGNING_SECRET_KEY", "fedcba9876543210fedcba9876543210")
	t.Setenv("SITE_SIGNING_SECRET_KEY_PREVIOUS", nodeKey)
	if got, err := decryptStoredSecret(nodeSealed); err != nil || got != "gis_cross_language_secret" {
		t.Fatalf("old key in the ring should still decrypt: %q, %v", got, err)
	}
	t.Setenv("SITE_SIGNING_SECRET_KEY_PREVIOUS", "")
	if _, err := decryptStoredSecret(nodeSealed); err == nil {
		t.Fatal("once the old key is retired, its values must fail, not return garbage")
	}
}

func TestProductionNeverFallsBackToTheDevelopmentKey(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("SITE_SIGNING_SECRET_KEY", "")
	t.Setenv("SITE_SIGNING_SECRET_KEY_PREVIOUS", "")
	if ring := secretKeyRing(); len(ring) != 0 {
		t.Fatalf("expected no keys, got %d", len(ring))
	}
	t.Setenv("SITE_SIGNING_SECRET_KEY", "too-short")
	if ring := secretKeyRing(); len(ring) != 0 {
		t.Fatal("a short key must be ignored, not replaced by a default")
	}
	if _, err := decryptStoredSecret(nodeSealed); err == nil {
		t.Fatal("with no usable key a stored secret must fail to decrypt (the request is then refused)")
	}
}

func TestDevelopmentMayUseTheDocumentedKey(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("SITE_SIGNING_SECRET_KEY", "")
	if ring := secretKeyRing(); len(ring) != 1 || ring[0] != devSecretKey {
		t.Fatalf("unexpected ring %v", ring)
	}
}

func TestPlaintextAndTamperedValues(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("SITE_SIGNING_SECRET_KEY", nodeKey)
	if got, err := decryptStoredSecret("never-encrypted"); err != nil || got != "never-encrypted" {
		t.Fatalf("plaintext should pass through: %q, %v", got, err)
	}
	tampered := nodeSealed[:len(nodeSealed)-2] + "AA"
	if _, err := decryptStoredSecret(tampered); err == nil {
		t.Fatal("a modified value must not decrypt")
	}
}
