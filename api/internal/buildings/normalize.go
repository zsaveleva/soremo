package buildings

import (
	"regexp"
	"strings"
)

// streetTypes are dropped from queries: the base writes them abbreviated and
// either before or after the name («ул. Заставская», «Заставская ул.»).
var streetTypes = map[string]bool{
	"улица": true, "ул": true, "проспект": true, "пр": true, "пр-т": true, "пр-кт": true,
	"переулок": true, "пер": true, "набережная": true, "наб": true, "шоссе": true, "ш": true,
	"площадь": true, "пл": true, "бульвар": true, "бул": true, "дорога": true, "дор": true,
	"дом": true, "д": true, "литера": true, "лит": true,
}

var splitter = regexp.MustCompile(`[\s,]+`)

// SearchTokens splits an address query into words that must all match:
// «Заставская улица, д. 33» → [заставская 33].
func SearchTokens(q string) []string {
	q = strings.ToLower(strings.ReplaceAll(q, "ё", "е"))
	var out []string
	for _, w := range splitter.Split(q, -1) {
		w = strings.Trim(w, ".")
		if w == "" || streetTypes[w] {
			continue
		}
		out = append(out, w)
	}
	return out
}
