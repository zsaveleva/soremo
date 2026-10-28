package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"

	"github.com/go-playground/validator/v10"

	"github.com/rs/zerolog/log"
)

// Error codes shared with the frontend.
const (
	CodeValidation = "validation_failed"
	CodeNotFound   = "not_found"
	CodeForbidden  = "forbidden"
	CodeInternal   = "internal"

	CodeUnauthorized  = "unauthorized"
	CodeRateLimited   = "rate_limited"
	CodeQuotaExceeded = "quota_exceeded"
	CodeAccessExpired = "access_expired"
	CodeConflict      = "conflict"
)

type apiError struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string, fields map[string]string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: msg, Fields: fields}})
}

func writeInternal(w http.ResponseWriter, r *http.Request, err error) {
	log.Ctx(r.Context()).Error().Err(err).Str("path", r.URL.Path).Msg("request failed")
	writeError(w, http.StatusInternalServerError, CodeInternal, "Не удалось выполнить запрос. Повторите позже.", nil)
}

var validate = func() *validator.Validate {
	v := validator.New(validator.WithRequiredStructEnabled())
	// В ошибках — имена полей из JSON, как их видит фронтенд.
	v.RegisterTagNameFunc(func(f reflect.StructField) string {
		return strings.SplitN(f.Tag.Get("json"), ",", 2)[0]
	})
	return v
}()

// fieldMessages — тексты ошибок валидации в формулировке «что сделать» (ТЗ 5.4).
var fieldMessages = map[string]string{
	"email.required":      "Введите email",
	"email.email":         "Введите email в формате name@site.ru",
	"password.required":   "Придумайте пароль",
	"password.min":        "Пароль — не короче 8 символов",
	"password.max":        "Пароль — не длиннее 72 символов",
	"type.required":       "Выберите: физлицо или юрлицо",
	"type.oneof":          "Выберите: физлицо или юрлицо",
	"segment.required":    "Выберите, чем вы занимаетесь",
	"segment.oneof":       "Выберите, чем вы занимаетесь",
	"company_name.max":    "Сократите название до 200 символов",
	"phone.max":           "Укажите телефон цифрами, начиная с +7",
	"token.required":      "Откройте ссылку из письма целиком",
	"package_id.required": "Выберите пакет",
}

// decode reads a JSON body and validates it; on failure it writes the error and returns false.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, CodeValidation, "Не удалось прочитать запрос.", nil)
		return false
	}
	if err := validate.Struct(v); err != nil {
		var ve validator.ValidationErrors
		if !errors.As(err, &ve) {
			writeInternal(w, r, err)
			return false
		}
		fields := map[string]string{}
		for _, fe := range ve {
			name := fe.Field()
			msg, ok := fieldMessages[name+"."+fe.Tag()]
			if !ok {
				msg = "Проверьте значение"
			}
			fields[name] = msg
		}
		writeError(w, http.StatusUnprocessableEntity, CodeValidation, "Проверьте поля формы.", fields)
		return false
	}
	return true
}
