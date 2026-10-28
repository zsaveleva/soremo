// Package mail sends transactional email: the dev mailer writes to the log,
// the SMTP mailer is used in production.
package mail

import (
	"context"
	"fmt"
	"net/smtp"
	"strings"

	"github.com/rs/zerolog"
)

type Message struct {
	To      string
	Subject string
	Text    string
}

type Mailer interface {
	Send(ctx context.Context, m Message) error
}

type LogMailer struct{ Log zerolog.Logger }

func (l LogMailer) Send(_ context.Context, m Message) error {
	l.Log.Info().Str("to", m.To).Str("subject", m.Subject).Msg("mail (dev)\n" + m.Text)
	return nil
}

type SMTPMailer struct {
	Addr, User, Password, From string
}

func (s SMTPMailer) Send(_ context.Context, m Message) error {
	host := strings.Split(s.Addr, ":")[0]
	var auth smtp.Auth
	if s.User != "" {
		auth = smtp.PlainAuth("", s.User, s.Password, host)
	}
	body := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: =?UTF-8?B?%s?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		s.From, m.To, b64(m.Subject), m.Text)
	return smtp.SendMail(s.Addr, auth, s.From, []string{m.To}, []byte(body))
}

// VerifyEmail — письмо подтверждения регистрации. Тон тот же, что в интерфейсе:
// без восклицаний и маркетинговых слов (ТЗ 6.9).
func VerifyEmail(to, link string) Message {
	return Message{
		To:      to,
		Subject: "Подтвердите email для SOREMO CITY",
		Text: "Здравствуйте.\n\n" +
			"Вы зарегистрировались в SOREMO CITY с адресом " + to + ". Чтобы подтвердить адрес и войти, откройте ссылку:\n\n" +
			link + "\n\n" +
			"Ссылка действует 48 часов. Если вы не регистрировались, ничего делать не нужно — аккаунт без подтверждения не активен.\n\n" +
			"SOREMO CITY — сценарии реновации советских нежилых зданий Петербурга\n",
	}
}
