// Package config reads service settings from environment variables.
package config

import (
	"os"
	"strings"
)

type Config struct {
	Env         string // dev | prod
	HTTPAddr    string
	DatabaseURL string
	CORSOrigins []string
	SeedDir     string
	JWTSecret   string
	AppURL      string
	SMTPAddr    string
	SMTPUser    string
	SMTPPass    string
	MailFrom    string
	FilesDir    string
	S3Endpoint  string
	S3Bucket    string
	S3Key       string
	S3Secret    string
	ChromeURL   string
	// PrintBaseURL — адрес фронтенда для headless Chromium (в compose — http://web).
	PrintBaseURL string
}

func Load() Config {
	c := Config{
		Env:         get("APP_ENV", "dev"),
		HTTPAddr:    get("HTTP_ADDR", ":8080"),
		DatabaseURL: get("DATABASE_URL", "postgres://soremo:soremo@localhost:5433/soremo?sslmode=disable"),
		CORSOrigins: strings.Split(get("CORS_ORIGIN", "http://localhost:5173"), ","),
		SeedDir:     get("SEED_DIR", "../seed"),
		JWTSecret:   get("JWT_SECRET", "dev-only-secret-change-me"),
		AppURL:      get("APP_URL", "http://localhost:5173"),
		SMTPAddr:    get("SMTP_ADDR", ""),
		SMTPUser:    get("SMTP_USER", ""),
		SMTPPass:    get("SMTP_PASSWORD", ""),
		MailFrom:    get("MAIL_FROM", "SOREMO CITY <no-reply@soremo.city>"),
		FilesDir:    get("FILES_DIR", "../.cache/files"),
		S3Endpoint:  get("S3_ENDPOINT", ""),
		S3Bucket:    get("S3_BUCKET", "soremo"),
		S3Key:       get("S3_ACCESS_KEY", ""),
		S3Secret:    get("S3_SECRET_KEY", ""),
		ChromeURL:   get("CHROME_URL", ""),
	}
	c.PrintBaseURL = get("PRINT_BASE_URL", c.AppURL)
	return c
}

func (c Config) IsDev() bool { return c.Env == "dev" }

func get(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}
