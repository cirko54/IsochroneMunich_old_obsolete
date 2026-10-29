# RayLogic – Website (self-hosted)

Statische Seite ohne Build-Schritt und ohne externe Requests (Fonts, Skripte, Bilder liegen lokal → DSGVO-unkritisch, strikte CSP möglich). Läuft auf der Synology als nginx-Container hinter dem DSM-Reverse-Proxy, ist aber auf jeden anderen Static-Host portierbar (Ordner `site/` hochladen, fertig).

```
raylogic-site/
├── site/                    ← Web-Root (das ist die Website)
│   ├── index.html           Startseite
│   ├── impressum.html, datenschutz.html, 404.html
│   └── assets/{css,js,fonts,img}
├── deploy/
│   ├── docker-compose.yml   Synology Container Manager
│   ├── nginx.conf           Clean URLs, Caching, gzip, www→Apex
│   ├── security-headers.conf  CSP & Co.
│   └── deploy.sh            rsync vom Mac auf die NAS
├── tools/carrd_import.py    Carrd-Inhalte + Bilder extrahieren
└── Makefile
```

## Lokal ansehen

```sh
make serve            # → http://localhost:8000
```

## 1. Inhalte aus Carrd übernehmen

```sh
make import URL=https://<carrd-adresse>
```

Erzeugt `carrd-export/content.md` (alle Texte in Reihenfolge, nach Carrd-Sections gegliedert), `meta.json` (Titel, Description, OG-Bild, Formulare, Links) und lädt alle Bilder nach `site/assets/img/carrd/`. Bei passwortgeschützter Carrd-Seite: im Browser „Seite speichern unter…“ und dann
`python3 tools/carrd_import.py ~/Downloads/seite.html --base https://<carrd-adresse>`.

Danach die Texte in `site/index.html` einsetzen. Alle Stellen sind mit `TODO(carrd)` markiert:

```sh
make check            # listet verbleibende Platzhalter
```

Hinweis: Nutzt die Carrd-Seite ein Kontaktformular, braucht es Ersatz (aktuell `mailto:`-Button; Formular-Backend wäre ein separater kleiner Dienst).

## 2. Auf die Synology bringen

Annahme: isochronenkarte.de läuft bereits über DSM-Reverse-Proxy + Let's Encrypt, d. h. Portweiterleitung 80/443 und DDNS existieren.

1. Ordner anlegen: `/volume1/docker/raylogic` (File Station).
2. Vom Mac: `make deploy NAS=<user>@<nas-ip>` (SSH muss in DSM aktiv sein).
3. Container Manager → Projekt → Erstellen → Pfad `/volume1/docker/raylogic/deploy` → vorhandene `docker-compose.yml` verwenden → starten. Läuft dann auf Port 8081.
4. Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy → Erstellen:
   Quelle `HTTPS`, Host `raylogic.de`, Port 443, HSTS an → Ziel `HTTP`, `localhost`, Port `8081`.
   Zweiten Eintrag für `www.raylogic.de` auf dasselbe Ziel (nginx leitet auf die Apex-Domain um).
5. Sicherheit → Zertifikat → Hinzufügen → Let's Encrypt für `raylogic.de` mit alternativem Namen `www.raylogic.de` → unter „Einstellungen“ den beiden Reverse-Proxy-Einträgen zuordnen.
   Let's Encrypt validiert über Port 80 – das funktioniert erst, wenn DNS schon auf die NAS zeigt (Schritt 6). Reihenfolge: Schritte 1–4, DNS umstellen, dann Zertifikat.
6. DNS beim Registrar: die bisherigen Carrd-Einträge (A-Records auf Carrd bzw. CNAME) ersetzen durch dieselben Einträge wie bei isochronenkarte.de (A/AAAA auf die öffentliche IP oder CNAME auf den DDNS-Namen). TTL vorher auf 300 s senken, dann ist der Wechsel in Minuten durch.
7. Danach in Carrd die Domain entfernen bzw. das Abo auslaufen lassen.

Updates: Dateien in `site/` ändern → `make deploy NAS=…`. Kein Container-Neustart nötig (Volume-Mount). Nur bei Änderungen an der nginx-Konfiguration: `RELOAD=1 make deploy NAS=…`.

## Später extern hosten

`site/` ist rein statisch. Optionen: Cloudflare Pages / Netlify (Git-Push → Deploy, kostenlos), oder ein Webspace bei einem deutschen Hoster. Die Security-Header aus `deploy/security-headers.conf` müssen dort in das jeweilige Header-Format übertragen werden (`_headers`-Datei bei Netlify/Cloudflare).

## Technik / Design

- Hero: Canvas-Animation einer rotierenden Mehrfeld-Bestrahlung (9 Felder, VMAT-artig) mit live berechneter Dosisverteilung und Isodosen 20/50/80/95 % per Marching Squares; Zielvolumen-Kontur „atmet“ über winkelabhängige Feldbreiten; folgt leicht dem Mauszeiger. Pausiert außerhalb des Viewports und in Hintergrund-Tabs.
- Scroll-Reveals, wortweise Headline-Animation, Zähler, Spotlight-Karten, magnetische Buttons, Scroll-Fortschrittsbalken (CSS Scroll-Timeline mit JS-Fallback), View Transitions zwischen Seiten.
- Hell/Dunkel nach Systemeinstellung, `prefers-reduced-motion` wird vollständig respektiert (statisches Hero-Bild, keine Bewegungen).
- Fonts: Inter, Space Grotesk, JetBrains Mono (SIL OFL, lokal eingebunden).
