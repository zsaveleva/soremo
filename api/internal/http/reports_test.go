package httpapi

import (
	"net/http/httptest"
	"testing"
)

func TestSharedPDFPreservesNoStore(t *testing.T) {
	w := httptest.NewRecorder()
	w.Header().Set("Cache-Control", "no-store")
	writePDF(w, []byte("%PDF-test"), "Тестовая ул., 1")
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("shared PDF cached: %s", got)
	}
	if got := w.Header().Get("Content-Type"); got != "application/pdf" {
		t.Fatalf("content type: %s", got)
	}
}
