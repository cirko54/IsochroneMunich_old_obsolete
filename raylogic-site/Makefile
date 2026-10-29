.PHONY: serve import deploy check

PORT ?= 8000

serve:            ## Lokale Vorschau auf http://localhost:$(PORT)
	cd site && python3 -m http.server $(PORT)

import:           ## Carrd-Inhalte holen: make import URL=https://raylogic.carrd.co
	python3 tools/carrd_import.py "$(URL)" --out carrd-export --img-dir site/assets/img/carrd

deploy:           ## Auf die Synology: make deploy NAS=user@host
	NAS=$(NAS) ./deploy/deploy.sh

check:            ## Offene Platzhalter auflisten
	@grep -rn "TODO(carrd)\|Platzhalter\|example.org" site --include=*.html || echo "Keine Platzhalter mehr."
