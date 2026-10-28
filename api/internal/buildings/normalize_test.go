package buildings

import (
	"reflect"
	"testing"
)

func TestSearchTokens(t *testing.T) {
	cases := map[string][]string{
		"Заставская улица, 33":   {"заставская", "33"},
		"ул. Заставская д. 33":   {"заставская", "33"},
		"проспект Стачек 72":     {"стачек", "72"},
		"  Большой   пр В.О. 83": {"большой", "в.о", "83"},
		"ДК Кирова":              {"дк", "кирова"},
		"Тимуровская, ё":         {"тимуровская", "е"},
	}
	for in, want := range cases {
		if got := SearchTokens(in); !reflect.DeepEqual(got, want) {
			t.Errorf("SearchTokens(%q) = %q, want %q", in, got, want)
		}
	}
}
