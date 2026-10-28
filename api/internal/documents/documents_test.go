package documents

import (
	"archive/zip"
	"bytes"
	"errors"
	"testing"
)

func docx(t *testing.T, withBody bool) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	name := "word/document.xml"
	if !withBody {
		name = "xl/workbook.xml"
	}
	f, _ := w.Create(name)
	_, _ = f.Write([]byte("<w:document/>"))
	_ = w.Close()
	return b.Bytes()
}

func TestDetectTypeByContent(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
		err  error
	}{
		{"pdf", []byte("%PDF-1.7\n%..."), "application/pdf", nil},
		{"png", []byte("\x89PNG\r\n\x1a\n0000"), "image/png", nil},
		{"jpeg", []byte("\xff\xd8\xff\xe0\x00\x10JFIF"), "image/jpeg", nil},
		{"docx", docx(t, true), mimeDOCX, nil},
		{"xlsx is not docx", docx(t, false), "", ErrBadType},
		{"exe renamed to pdf", []byte("MZ\x90\x00\x03"), "", ErrBadType},
		{"html", []byte("<html><script>alert(1)</script>"), "", ErrBadType},
		{"empty", nil, "", ErrEmpty},
	}
	for _, c := range cases {
		got, err := DetectType(c.data)
		if !errors.Is(err, c.err) || got != c.want {
			t.Errorf("%s: got (%q, %v), want (%q, %v)", c.name, got, err, c.want, c.err)
		}
	}
}

func TestSafeName(t *testing.T) {
	cases := map[[2]string]string{
		{"../../etc/passwd", "application/pdf"}:                  "passwd.pdf",
		{`C:\Users\a\Техзаключение 2024.pdf`, "application/pdf"}: "Техзаключение 2024.pdf",
		{"фото фасада.HEIC.jpg", "image/jpeg"}:                   "фото фасада.HEIC.jpg",
		{"report<script>.docx", mimeDOCX}:                        "report_script.docx",
		{"скан.exe", "application/pdf"}:                          "скан.pdf",
		{"", "image/png"}:                                        "document.png",
	}
	for in, want := range cases {
		if got := SafeName(in[0], in[1]); got != want {
			t.Errorf("SafeName(%q) = %q, want %q", in[0], got, want)
		}
	}
}
