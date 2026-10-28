// Package auth handles sign-up, email verification and sessions:
// a short-lived JWT access token plus a rotating refresh token in an httpOnly cookie.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"

	"github.com/soremo/city/api/internal/mail"
	"github.com/soremo/city/api/internal/store"
)

const (
	AccessTTL  = 15 * time.Minute
	RefreshTTL = 30 * 24 * time.Hour
	verifyTTL  = 48 * time.Hour
)

var (
	ErrEmailTaken      = errors.New("email taken")
	ErrBadCredentials  = errors.New("bad credentials")
	ErrNotVerified     = errors.New("email not verified")
	ErrInvalidToken    = errors.New("invalid token")
	ErrSessionNotFound = errors.New("session not found")
)

type Service struct {
	q      *store.Queries
	mailer mail.Mailer
	secret []byte
	appURL string
}

func NewService(q *store.Queries, m mail.Mailer, secret, appURL string) *Service {
	return &Service{q: q, mailer: m, secret: []byte(secret), appURL: strings.TrimRight(appURL, "/")}
}

type SignupInput struct {
	Email       string  `json:"email" validate:"required,email,max=254"`
	Password    string  `json:"password" validate:"required,min=8,max=72"`
	Type        string  `json:"type" validate:"required,oneof=individual company"`
	Segment     string  `json:"segment" validate:"required,oneof=owner investor consultant government other"`
	CompanyName *string `json:"company_name" validate:"omitempty,max=200"`
	Phone       *string `json:"phone" validate:"omitempty,max=32"`
}

// Signup creates an unverified user and sends the confirmation link.
// The link is returned too, so dev mode can show it on the page.
func (s *Service) Signup(ctx context.Context, in SignupInput) (store.User, string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return store.User{}, "", err
	}
	u, err := s.q.CreateUser(ctx, store.CreateUserParams{
		Email: normEmail(in.Email), PasswordHash: string(hash), Type: in.Type, Segment: in.Segment,
		CompanyName: text(in.CompanyName), Phone: text(in.Phone),
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return store.User{}, "", ErrEmailTaken
	}
	if err != nil {
		return store.User{}, "", err
	}
	link, err := s.sendVerification(ctx, u)
	return u, link, err
}

func (s *Service) ResendVerification(ctx context.Context, email string) (string, error) {
	u, err := s.q.GetUserByEmail(ctx, normEmail(email))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && u.EmailVerifiedAt.Valid) {
		return "", nil // не раскрываем, есть ли такой адрес
	}
	if err != nil {
		return "", err
	}
	return s.sendVerification(ctx, u)
}

func (s *Service) sendVerification(ctx context.Context, u store.User) (string, error) {
	tok := randomToken()
	if err := s.q.CreateEmailToken(ctx, store.CreateEmailTokenParams{
		TokenHash: hashToken(tok), UserID: u.ID, ExpiresAt: ts(time.Now().Add(verifyTTL)),
	}); err != nil {
		return "", err
	}
	link := s.appURL + "/verify?token=" + tok
	return link, s.mailer.Send(ctx, mail.VerifyEmail(u.Email, link))
}

func (s *Service) Verify(ctx context.Context, token string) (store.User, error) {
	uid, err := s.q.UseEmailToken(ctx, hashToken(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return store.User{}, ErrInvalidToken
	}
	if err != nil {
		return store.User{}, err
	}
	if err := s.q.MarkEmailVerified(ctx, uid); err != nil {
		return store.User{}, err
	}
	return s.q.GetUser(ctx, uid)
}

func (s *Service) Login(ctx context.Context, email, password string) (store.User, error) {
	u, err := s.q.GetUserByEmail(ctx, normEmail(email))
	if errors.Is(err, pgx.ErrNoRows) {
		// Сравнение с фиктивным хэшем выравнивает время ответа.
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BWX4Z5u7l1T3oWnVH0s9e0o3Z0yW"), []byte(password))
		return store.User{}, ErrBadCredentials
	}
	if err != nil {
		return store.User{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return store.User{}, ErrBadCredentials
	}
	if !u.EmailVerifiedAt.Valid {
		return u, ErrNotVerified
	}
	return u, nil
}

type Tokens struct {
	Access  string
	Refresh string
}

// Issue creates a new access token and refresh token for the user.
func (s *Service) Issue(ctx context.Context, u store.User) (Tokens, error) {
	access, err := s.accessToken(u)
	if err != nil {
		return Tokens{}, err
	}
	refresh := randomToken()
	if err := s.q.CreateRefreshToken(ctx, store.CreateRefreshTokenParams{
		TokenHash: hashToken(refresh), UserID: u.ID, ExpiresAt: ts(time.Now().Add(RefreshTTL)),
	}); err != nil {
		return Tokens{}, err
	}
	return Tokens{Access: access, Refresh: refresh}, nil
}

// Refresh rotates the refresh token: the old one is revoked on use.
func (s *Service) Refresh(ctx context.Context, refresh string) (store.User, Tokens, error) {
	rt, err := s.q.GetRefreshToken(ctx, hashToken(refresh))
	if errors.Is(err, pgx.ErrNoRows) {
		return store.User{}, Tokens{}, ErrSessionNotFound
	}
	if err != nil {
		return store.User{}, Tokens{}, err
	}
	if err := s.q.RevokeRefreshToken(ctx, rt.TokenHash); err != nil {
		return store.User{}, Tokens{}, err
	}
	u, err := s.q.GetUser(ctx, rt.UserID)
	if err != nil {
		return store.User{}, Tokens{}, err
	}
	t, err := s.Issue(ctx, u)
	return u, t, err
}

func (s *Service) Logout(ctx context.Context, refresh string) error {
	return s.q.RevokeRefreshToken(ctx, hashToken(refresh))
}

// RolePrint marks a token that can read exactly one report (its subject) for PDF rendering.
const RolePrint = "print"

// PrintToken is a two-minute token that lets headless Chromium open one report.
func (s *Service) PrintToken(reportID string) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		Role: RolePrint,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: reportID, IssuedAt: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(2 * time.Minute)), Issuer: "soremo",
		},
	}).SignedString(s.secret)
}

type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func (s *Service) accessToken(u store.User) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		Role: u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   u.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTTL)),
			Issuer:    "soremo",
		},
	}).SignedString(s.secret)
}

// Principal is the authenticated caller.
type Principal struct {
	UserID uuid.UUID
	Role   string
	// ReportID is set for print tokens instead of UserID.
	ReportID uuid.UUID
}

func (p Principal) IsAdmin() bool { return p.Role == "admin" }

func (s *Service) Parse(token string) (Principal, error) {
	var c Claims
	_, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) { return s.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("soremo"))
	if err != nil {
		return Principal{}, ErrInvalidToken
	}
	id, err := uuid.Parse(c.Subject)
	if err != nil {
		return Principal{}, ErrInvalidToken
	}
	if c.Role == RolePrint {
		return Principal{Role: RolePrint, ReportID: id}, nil
	}
	return Principal{UserID: id, Role: c.Role}, nil
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func text(p *string) pgtype.Text {
	if p == nil || strings.TrimSpace(*p) == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: strings.TrimSpace(*p), Valid: true}
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
