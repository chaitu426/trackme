package sign

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

func sig(secret, message string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(message))
	return hex.EncodeToString(m.Sum(nil))
}

func TestLegacySignatureStillWorks(t *testing.T) {
	body := []byte(`{"events":[]}`)
	if !Valid("secret", body, sig("secret", string(body))) {
		t.Fatal("body-only signature should verify")
	}
	if Valid("secret", body, sig("other", string(body))) {
		t.Fatal("wrong secret must not verify")
	}
}

func TestTimestampedSignature(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"events":[1]}`)
	ts := strconv.FormatInt(now.Unix(), 10)
	good := sig("secret", ts+"."+string(body))

	if !ValidTimestamped("secret", body, ts, good, now, MaxSkew) {
		t.Fatal("a fresh, correctly signed request must verify")
	}
	if !ValidTimestamped("secret", body, ts, "sha256="+good, now, MaxSkew) {
		t.Fatal("the sha256= prefix is accepted, as for the legacy form")
	}
	if ValidTimestamped("secret", body, ts, sig("secret", string(body)), now, MaxSkew) {
		t.Fatal("a body-only signature must not satisfy the timestamped form")
	}
	if ValidTimestamped("secret", append([]byte{}, body[:len(body)-1]...), ts, good, now, MaxSkew) {
		t.Fatal("a changed body must not verify")
	}
}

func TestReplayedAndForgedTimestampsAreRefused(t *testing.T) {
	body := []byte(`{"events":[1]}`)
	signedAt := time.Unix(1_800_000_000, 0)
	ts := strconv.FormatInt(signedAt.Unix(), 10)
	good := sig("secret", ts+"."+string(body))

	if ValidTimestamped("secret", body, ts, good, signedAt.Add(MaxSkew+time.Second), MaxSkew) {
		t.Fatal("a captured request replayed later must be refused")
	}
	if ValidTimestamped("secret", body, ts, good, signedAt.Add(-MaxSkew-time.Second), MaxSkew) {
		t.Fatal("a timestamp too far in the future must be refused")
	}
	if !ValidTimestamped("secret", body, ts, good, signedAt.Add(MaxSkew-time.Second), MaxSkew) {
		t.Fatal("ordinary clock drift must be tolerated")
	}
	// An attacker who captured the request cannot make it look fresh: the timestamp is inside the signature.
	fresh := strconv.FormatInt(signedAt.Add(time.Hour).Unix(), 10)
	if ValidTimestamped("secret", body, fresh, good, signedAt.Add(time.Hour), MaxSkew) {
		t.Fatal("changing the timestamp must invalidate the signature")
	}
	for _, bad := range []string{"", "abc", "1.5", "99999999999999999999"} {
		if ValidTimestamped("secret", body, bad, good, signedAt, MaxSkew) {
			t.Fatalf("timestamp %q must be refused", bad)
		}
	}
	if ValidTimestamped("", body, ts, good, signedAt, MaxSkew) || ValidTimestamped("secret", body, ts, "", signedAt, MaxSkew) {
		t.Fatal("an empty secret or signature never verifies")
	}
}
