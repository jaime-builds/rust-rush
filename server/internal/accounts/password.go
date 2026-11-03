package accounts

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters: OWASP's recommended minimum (19 MiB memory, 2 passes,
// 1 lane). Each hash costs about 19 MiB for a few tens of milliseconds, which
// is what makes a stolen hash expensive to crack; login is rate limited per
// visitor so it can't be turned into a memory flood. The parameters are
// stored inside each hash, so raising them later only affects new hashes
// (and rehashOnLogin upgrades old ones the next time their owner logs in).
const (
	argonMemoryKiB = 19 * 1024
	argonTime      = 2
	argonThreads   = 1
	argonKeyLen    = 32
	argonSaltLen   = 16
)

// hashPassword returns a PHC-format string:
// $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>.
func hashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

var errBadHash = errors.New("unrecognised password hash")

// checkPassword reports whether password matches the stored PHC hash, using
// the parameters recorded in the hash. The comparison is constant time.
// needsRehash is true when the hash used weaker parameters than today's.
func checkPassword(stored, password string) (ok, needsRehash bool, err error) {
	parts := strings.Split(stored, "$")
	// "", "argon2id", "v=19", "m=..,t=..,p=..", salt, hash
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, false, errBadHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, false, errBadHash
	}
	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false, false, errBadHash
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false, false, errBadHash
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil {
		return false, false, errBadHash
	}
	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	ok = subtle.ConstantTimeCompare(got, want) == 1
	needsRehash = memory < argonMemoryKiB || time < argonTime
	return ok, needsRehash, nil
}

// dummyHash is checked against when a username doesn't exist, so a login
// for a missing account takes as long as one with a wrong password and the
// response time doesn't reveal which usernames exist.
var dummyHash = func() string {
	h, err := hashPassword("not-a-real-password-just-timing")
	if err != nil {
		panic(err)
	}
	return h
}()
