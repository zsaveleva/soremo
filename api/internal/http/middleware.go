package httpapi

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/soremo/city/api/internal/auth"
)

type ctxKey int

const principalKey ctxKey = 1

// authenticate reads the Bearer token if present; handlers decide whether it is required.
func authenticate(a *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if t, ok := strings.CutPrefix(h, "Bearer "); ok {
				if p, err := a.Parse(t); err == nil && allowed(p, r) {
					r = r.WithContext(context.WithValue(r.Context(), principalKey, p))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// allowed limits print tokens to reading their own report.
func allowed(p auth.Principal, r *http.Request) bool {
	if p.Role != auth.RolePrint {
		return true
	}
	return r.Method == http.MethodGet && r.URL.Path == "/api/v1/reports/"+p.ReportID.String()
}

func principal(r *http.Request) (auth.Principal, bool) {
	p, ok := r.Context().Value(principalKey).(auth.Principal)
	return p, ok
}

func requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := principal(r); !ok || p.Role == auth.RolePrint {
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, "Войдите, чтобы продолжить.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requireReader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := principal(r); !ok {
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, "Войдите, чтобы открыть отчёт.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := principal(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, "Войдите, чтобы продолжить.", nil)
			return
		}
		if !p.IsAdmin() {
			writeError(w, http.StatusForbidden, CodeForbidden, "Раздел доступен только команде SOREMO.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP trusts X-Real-IP only from a proxy on a private or loopback address
// (our nginx); otherwise a client could spoof its IP and bypass rate limits.
func clientIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if ip := net.ParseIP(host); err == nil && ip != nil && (ip.IsPrivate() || ip.IsLoopback()) {
			if real := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); real != nil {
				r.RemoteAddr = net.JoinHostPort(real.String(), "0")
			}
		}
		next.ServeHTTP(w, r)
	})
}

// rateLimit keeps a token bucket per client IP (ТЗ 8.5). In-memory is enough
// for a single API instance.
func rateLimit(perMinute int, burst int) func(http.Handler) http.Handler {
	var mu sync.Mutex
	type entry struct {
		l    *rate.Limiter
		seen time.Time
	}
	clients := map[string]*entry{}
	go func() {
		for range time.Tick(5 * time.Minute) {
			mu.Lock()
			for k, e := range clients {
				if time.Since(e.seen) > 10*time.Minute {
					delete(clients, k)
				}
			}
			mu.Unlock()
		}
	}()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}
			mu.Lock()
			e, ok := clients[ip]
			if !ok {
				e = &entry{l: rate.NewLimiter(rate.Limit(float64(perMinute)/60), burst)}
				clients[ip] = e
			}
			e.seen = time.Now()
			allowed := e.l.Allow()
			mu.Unlock()
			if !allowed {
				w.Header().Set("Retry-After", "30")
				writeError(w, http.StatusTooManyRequests, CodeRateLimited, "Слишком много запросов. Повторите через полминуты.", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
