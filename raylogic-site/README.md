# RayLogic – Website (self-hosted)

Statische Seite ohne Build-Schritt und ohne externe Requests (Fonts, Skripte, Bilder liegen lokal → DSGVO-unkritisch, strikte CSP möglich). Läuft auf der Synology als nginx-Container hinter einem Cloudflare Tunnel, ist aber auf jeden anderen Static-Host portierbar (Ordner `site/` hochladen, fertig).

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

## 2. Auf die Synology bringen (Cloudflare Tunnel)

Der Anschluss hat keine feste IP; wie bei isochronenkarte.de läuft der Zugriff über einen Cloudflare Tunnel. Dadurch braucht es weder Portfreigaben noch DSM-Reverse-Proxy oder Let's-Encrypt-Zertifikate auf der NAS – TLS übernimmt Cloudflare.

### a) Container auf der NAS

1. Per SSH auf der NAS (oder Container Manager → Projekt mit Git-Ordner):
   ```sh
   cd /volume1/docker
   git clone https://github.com/cirko54/raylogic-web.git raylogic
   ```
   Für ein privates Repository vorher einen Deploy-Key (nur Lesen) anlegen, siehe unten.
2. Container Manager → Projekt → Erstellen → Pfad `/volume1/docker/raylogic/deploy` → vorhandene `docker-compose.yml` → starten.
3. Test im Heimnetz: `http://<NAS-IP>:8081`.

### b) DNS von raylogic.de zu Cloudflare

Cloudflare Tunnel funktioniert (im kostenlosen Tarif) nur für Domains, deren DNS bei Cloudflare liegt. Die Domain selbst bleibt bei IONOS registriert, nur die Nameserver wechseln.

1. **Vorher bei IONOS alle DNS-Einträge von raylogic.de notieren** (Screenshot), vor allem MX, SPF (TXT `v=spf1 …`), DKIM/`_domainkey` und `autodiscover`. Daran hängt das Postfach fahima.sadat@ und die Weiterleitungen.
2. Cloudflare-Dashboard → *Add a domain* → `raylogic.de` → Free. Cloudflare liest die vorhandenen Einträge ein. **Abgleichen, dass alle Mail-Einträge aus Schritt 1 übernommen wurden**, und für MX/TXT den Proxy-Status auf „DNS only“ lassen.
3. Die alten Carrd-Einträge für `@` und `www` (A/CNAME) bei Cloudflare löschen.
4. Bei IONOS → Domain → Nameserver → „Andere Nameserver“ → die zwei von Cloudflare genannten eintragen. Umstellung dauert Minuten bis wenige Stunden; Cloudflare meldet „Active“.

### c) Hostnamen im Tunnel

Cloudflare Zero Trust → Networks → Tunnels → bestehender Tunnel (isochronenkarte) → *Public Hostname* hinzufügen:

| Subdomain | Domain | Service |
|---|---|---|
| (leer) | raylogic.de | `http://<NAS-IP>:8081` |
| www | raylogic.de | `http://<NAS-IP>:8081` |

Läuft `cloudflared` als Container mit Host-Netzwerk oder als DSM-Paket, geht statt `<NAS-IP>` auch `localhost`. Cloudflare legt die DNS-Einträge dafür automatisch an. `www` leitet nginx auf `raylogic.de` um.

Empfohlen in Cloudflare unter SSL/TLS → Edge Certificates: *Always Use HTTPS* und *HSTS* einschalten.

### d) Abschluss

- Seite, Impressum, Mail (senden und empfangen) testen.
- In Carrd die Domain entfernen und das Abo auslaufen lassen.

### Automatische Updates

`deploy/update.sh` holt neue Commits und lädt nginx nur neu, wenn sich die Konfiguration geändert hat. Im DSM-Aufgabenplaner (Benutzerdefiniertes Skript, Benutzer root, alle 10 Minuten):

```sh
/volume1/docker/raylogic/deploy/update.sh
```

Deploy-Key für das private Repository: auf der NAS `ssh-keygen -t ed25519 -f /volume1/docker/raylogic-deploy-key -N ""`, den öffentlichen Schlüssel bei GitHub unter Repository → Settings → Deploy keys (nur Lesen) eintragen und das Repo per `git clone git@github.com:cirko54/raylogic-web.git` mit `GIT_SSH_COMMAND="ssh -i /volume1/docker/raylogic-deploy-key"` klonen.

Ohne Git geht es auch manuell vom Mac: `make deploy NAS=<user>@<nas-ip>` (rsync per SSH).

## Später extern hosten

`site/` ist rein statisch. Optionen: Cloudflare Pages / Netlify (Git-Push → Deploy, kostenlos), oder ein Webspace bei einem deutschen Hoster. Die Security-Header aus `deploy/security-headers.conf` müssen dort in das jeweilige Header-Format übertragen werden (`_headers`-Datei bei Netlify/Cloudflare).

## Technik / Design

- Hero: Canvas-Animation eines Patientenpfads als kleine Warteschlangen-Simulation (Anmeldung → Diagnostik → Befundung → Therapie → Nachsorge). Im Ist-Ablauf verschlungene Wege und ein Engpass mit wachsender Schlange, im optimierten Ablauf glätten sich die Wege und die Schlange löst sich auf; Phasen wechseln automatisch, Label unten rechts. Farben ausschließlich aus dem Logo (Navy, Royal, Himmelblau). Pausiert außerhalb des Viewports und in Hintergrund-Tabs.
- Scroll-Reveals, wortweise Headline-Animation, Zähler, Spotlight-Karten, magnetische Buttons, Scroll-Fortschrittsbalken (CSS Scroll-Timeline mit JS-Fallback), View Transitions zwischen Seiten.
- Hell/Dunkel nach Systemeinstellung, `prefers-reduced-motion` wird vollständig respektiert (statisches Hero-Bild, keine Bewegungen).
- Fonts: Inter, Space Grotesk, JetBrains Mono (SIL OFL, lokal eingebunden).

## Logo-Dateien (`brand/`)

Erzeugt mit `python3 tools/build_logos.py` aus `brand/RayLogic_blau_original.svg`. Jede Variante gibt es für helle und (Suffix `-dunkel`) dunkle Hintergründe:

- `raylogic-horizontal` – Bildmarke links, Schriftzug in Originalgröße daneben (Website-Header, E-Mail-Signatur, Briefkopf)
- `raylogic-vertikal` – Original-Anordnung, Schriftzug zentriert darunter
- `raylogic-vertikal-kompakt` – Schriftzug exakt so breit wie die Bildmarke
- `raylogic-bildmarke` – nur das R (Favicon, Social-Media-Profilbild, App-Icon)
