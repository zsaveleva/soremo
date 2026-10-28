package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/soremo/city/api/internal/access"
	"github.com/soremo/city/api/internal/auth"
	"github.com/soremo/city/api/internal/store"
)

const refreshCookie = "soremo_refresh"

type authHandler struct {
	auth   *auth.Service
	access *access.Service
	q      *store.Queries
	dev    bool
	// showLinks — письма не отправляются (dev или не задан SMTP): ссылка подтверждения
	// возвращается в ответе и показывается на странице «Проверьте почту».
	showLinks bool
}

type userJSON struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	Type        string  `json:"type"`
	Segment     string  `json:"segment"`
	CompanyName *string `json:"company_name"`
	Phone       *string `json:"phone"`
	Role        string  `json:"role"`
}

func toUserJSON(u store.User) userJSON {
	j := userJSON{ID: u.ID.String(), Email: u.Email, Type: u.Type, Segment: u.Segment, Role: u.Role}
	if u.CompanyName.Valid {
		j.CompanyName = &u.CompanyName.String
	}
	if u.Phone.Valid {
		j.Phone = &u.Phone.String
	}
	return j
}

func (h *authHandler) setRefresh(w http.ResponseWriter, token string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: token, Path: "/api/v1/auth", HttpOnly: true,
		Secure: !h.dev, SameSite: http.SameSiteLaxMode, MaxAge: int(ttl.Seconds()),
	})
	// Флаг без секрета, видимый фронтенду: есть ли смысл вызывать refresh при загрузке.
	// Гость без флага не делает лишний запрос и не получает 401 в консоли.
	flag := "1"
	if token == "" {
		flag = ""
	}
	http.SetCookie(w, &http.Cookie{
		Name: "soremo_session", Value: flag, Path: "/", Secure: !h.dev, SameSite: http.SameSiteLaxMode, MaxAge: int(ttl.Seconds()),
	})
}

// session writes the access token and the user; the refresh token goes to the cookie.
func (h *authHandler) session(w http.ResponseWriter, r *http.Request, u store.User) {
	t, err := h.auth.Issue(r.Context(), u)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	h.setRefresh(w, t.Refresh, auth.RefreshTTL)
	h.writeSession(w, r, u, t.Access)
}

func (h *authHandler) writeSession(w http.ResponseWriter, r *http.Request, u store.User, accessToken string) {
	cur, err := h.access.Current(r.Context(), u.ID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": accessToken, "expires_in": int(auth.AccessTTL.Seconds()),
		"user": toUserJSON(u), "access": cur,
	})
}

func (h *authHandler) signup(w http.ResponseWriter, r *http.Request) {
	var in auth.SignupInput
	if !decode(w, r, &in) {
		return
	}
	u, link, err := h.auth.Signup(r.Context(), in)
	if errors.Is(err, auth.ErrEmailTaken) {
		writeError(w, http.StatusConflict, CodeConflict, "Этот email уже зарегистрирован.",
			map[string]string{"email": "Этот email уже зарегистрирован — войдите или восстановите доступ"})
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	resp := map[string]any{"email": u.Email}
	if h.showLinks {
		resp["dev_verify_url"] = link
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (h *authHandler) resend(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email" validate:"required,email"`
	}
	if !decode(w, r, &in) {
		return
	}
	link, err := h.auth.ResendVerification(r.Context(), in.Email)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	resp := map[string]any{"sent": true}
	if h.showLinks && link != "" {
		resp["dev_verify_url"] = link
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *authHandler) verify(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token" validate:"required"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, err := h.auth.Verify(r.Context(), in.Token)
	if errors.Is(err, auth.ErrInvalidToken) {
		writeError(w, http.StatusBadRequest, "token_invalid", "Ссылка устарела или уже использована. Запросите новую.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	h.session(w, r, u)
}

func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email" validate:"required,email"`
		Password string `json:"password" validate:"required"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, err := h.auth.Login(r.Context(), in.Email, in.Password)
	switch {
	case errors.Is(err, auth.ErrBadCredentials):
		writeError(w, http.StatusUnauthorized, "bad_credentials", "Неверный email или пароль.",
			map[string]string{"password": "Проверьте email и пароль: такой пары нет"})
	case errors.Is(err, auth.ErrNotVerified):
		writeError(w, http.StatusForbidden, "email_not_verified",
			"Подтвердите email: откройте ссылку из письма, отправленного на "+u.Email+".", nil)
	case err != nil:
		writeInternal(w, r, err)
	default:
		h.session(w, r, u)
	}
}

func (h *authHandler) refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized, "Сессия не найдена.", nil)
		return
	}
	u, t, err := h.auth.Refresh(r.Context(), c.Value)
	if errors.Is(err, auth.ErrSessionNotFound) {
		h.setRefresh(w, "", -time.Second)
		writeError(w, http.StatusUnauthorized, CodeUnauthorized, "Сессия закончилась. Войдите снова.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	h.setRefresh(w, t.Refresh, auth.RefreshTTL)
	h.writeSession(w, r, u, t.Access)
}

func (h *authHandler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil {
		_ = h.auth.Logout(r.Context(), c.Value)
	}
	h.setRefresh(w, "", -time.Second)
	w.WriteHeader(http.StatusNoContent)
}

func (h *authHandler) me(w http.ResponseWriter, r *http.Request) {
	p, _ := principal(r)
	u, err := h.q.GetUser(r.Context(), p.UserID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	cur, err := h.access.Current(r.Context(), u.ID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	notes, err := h.q.ListNotifications(r.Context(), u.ID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	type note struct {
		ID        int64     `json:"id"`
		Kind      string    `json:"kind"`
		Text      string    `json:"text"`
		Link      *string   `json:"link"`
		Read      bool      `json:"read"`
		CreatedAt time.Time `json:"created_at"`
	}
	ns := make([]note, 0, len(notes))
	for _, n := range notes {
		x := note{ID: n.ID, Kind: n.Kind, Text: n.Text, Read: n.ReadAt.Valid, CreatedAt: n.CreatedAt.Time}
		if n.Link.Valid {
			x.Link = &n.Link.String
		}
		ns = append(ns, x)
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserJSON(u), "access": cur, "notifications": ns})
}

func (h *authHandler) readNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := principal(r)
	if err := h.q.MarkNotificationsRead(r.Context(), p.UserID); err != nil {
		writeInternal(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
