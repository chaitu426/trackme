package geo

import (
	"log"
	"net"
	"strings"
	"sync"

	"github.com/oschwald/geoip2-golang"
)

// Resolver derives country/city without persisting the IP.
// Priority: CDN headers → local MaxMind/DB-IP MMDB → empty.
type Resolver struct {
	mu   sync.RWMutex
	db   *geoip2.Reader
	path string
	// loopbackIP stands in for the client address when it is loopback or private,
	// which is every request in local development (browser -> localhost). Without it
	// there is nothing to look up and the audience map stays empty.
	loopbackIP net.IP
}

// WithLoopbackIP sets the address looked up for loopback/private clients. Development
// only: in production a private client address means a misconfigured proxy, and
// substituting one fixed location would be wrong data, so config rejects it there.
func (r *Resolver) WithLoopbackIP(ip string) *Resolver {
	r.loopbackIP = net.ParseIP(strings.TrimSpace(ip))
	if r.loopbackIP != nil {
		log.Printf("geo: loopback/private clients are located as %s (development setting)", r.loopbackIP)
	}
	return r
}

func New(mmdbPath string) *Resolver {
	r := &Resolver{path: strings.TrimSpace(mmdbPath)}
	if r.path == "" {
		return r
	}
	db, err := geoip2.Open(r.path)
	if err != nil {
		log.Printf("geo: unable to open MMDB %s: %v (CDN headers only)", r.path, err)
		return r
	}
	r.db = db
	log.Printf("geo: loaded MMDB %s", r.path)
	return r
}

func (r *Resolver) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.db != nil {
		_ = r.db.Close()
		r.db = nil
	}
}

// Lookup returns ISO country + city. IP is used transiently and never stored.
func (r *Resolver) Lookup(headers map[string]string, clientIP string) (country, city string) {
	if c, ci := fromCDN(headers); c != "" {
		return c, ci
	}

	ip := net.ParseIP(strings.TrimSpace(clientIP))
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() {
		if r.loopbackIP == nil {
			return "", ""
		}
		ip = r.loopbackIP
	}

	r.mu.RLock()
	db := r.db
	r.mu.RUnlock()
	if db == nil {
		return "", ""
	}

	record, err := db.City(ip)
	if err != nil {
		// Some DB-IP country-only files work better with Country()
		crec, err2 := db.Country(ip)
		if err2 != nil || crec.Country.IsoCode == "" {
			return "", ""
		}
		return strings.ToUpper(crec.Country.IsoCode), ""
	}
	country = strings.ToUpper(record.Country.IsoCode)
	if len(record.City.Names) > 0 {
		if name, ok := record.City.Names["en"]; ok {
			city = name
		}
	}
	return country, city
}

func fromCDN(headers map[string]string) (country, city string) {
	get := func(k string) string {
		if v, ok := headers[strings.ToLower(k)]; ok {
			return v
		}
		return ""
	}
	if cf := get("cf-ipcountry"); len(cf) == 2 && !strings.EqualFold(cf, "XX") {
		return strings.ToUpper(cf), get("cf-ipcity")
	}
	if cf := get("cloudfront-viewer-country"); len(cf) == 2 {
		return strings.ToUpper(cf), get("cloudfront-viewer-city")
	}
	if v := get("x-vercel-ip-country"); len(v) == 2 {
		return strings.ToUpper(v), get("x-vercel-ip-city")
	}
	if v := get("x-appengine-country"); len(v) == 2 && v != "ZZ" {
		return strings.ToUpper(v), get("x-appengine-city")
	}
	if v := get("x-country-code"); len(v) == 2 {
		return strings.ToUpper(v), ""
	}
	return "", ""
}
