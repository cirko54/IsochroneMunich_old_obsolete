#!/usr/bin/env python3
"""Carrd-Seite einlesen und Inhalte + Bilder für die Migration sichern.

Nur Standardbibliothek. Quelle ist eine URL oder eine lokal gespeicherte HTML-Datei
(Browser → "Seite speichern unter…", falls die Seite passwortgeschützt ist).

    python3 tools/carrd_import.py https://raylogic.carrd.co
    python3 tools/carrd_import.py ~/Downloads/raylogic.html --base https://raylogic.carrd.co

Ergebnis (Standard: ./carrd-export/):
    page.html      Original-HTML
    content.md     Inhalte in Dokumentreihenfolge, gegliedert nach Carrd-Sections
    content.json   dasselbe strukturiert
    meta.json      Titel, Description, OG-Daten, Formulare, externe Links
und die Bilder unter --img-dir (Standard: site/assets/img/carrd/).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) RayLogic-Migration/1.0"
BLOCK_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "figcaption"}
SKIP_TAGS = {"script", "style", "noscript", "svg", "template"}
INLINE_MD = {"strong": "**", "b": "**", "em": "*", "i": "*", "code": "`"}
VOID_TAGS = {"img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "wbr"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


class CarrdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.items: list[dict] = []
        self.meta: dict = {"title": "", "meta": {}, "forms": [], "links": []}
        self.css_blocks: list[str] = []
        self._stack: list[str] = []
        self._skip = 0
        self._in_title = False
        self._in_style = False
        self._block: dict | None = None
        self._block_depth = 0
        self._link_stack: list[str | None] = []
        self._section = None

    # -- Hilfen --
    def _emit(self, item: dict) -> None:
        item["section"] = self._section
        self.items.append(item)

    def _flush_block(self) -> None:
        if not self._block:
            return
        text = re.sub(r"[ \t]+", " ", self._block["text"]).strip()
        text = re.sub(r"\s*\n\s*", "\n", text)
        if text:
            self._emit({"type": self._block["tag"], "id": self._block["id"], "text": text})
        self._block = None

    # -- Parser-Callbacks --
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag not in VOID_TAGS:
            self._stack.append(tag)

        if tag in SKIP_TAGS:
            self._skip += 1
            self._in_style = tag == "style"
            return
        if self._skip:
            return

        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = a.get("name") or a.get("property")
            if key and a.get("content"):
                self.meta["meta"][key] = a["content"]
        elif tag == "section" and a.get("id"):
            self._flush_block()
            self._section = a["id"].removesuffix("-section")
            self._emit({"type": "section", "id": self._section})
        elif tag == "img":
            src = a.get("src") or a.get("data-src")
            if src:
                self._emit({"type": "image", "id": a.get("id"), "src": src, "alt": a.get("alt", "")})
        elif tag == "form":
            self.meta["forms"].append({"id": a.get("id"), "action": a.get("action"), "method": a.get("method"), "fields": []})
        elif tag in {"input", "textarea", "select"} and self.meta["forms"]:
            self.meta["forms"][-1]["fields"].append(
                {k: a.get(k) for k in ("type", "name", "placeholder") if a.get(k) is not None}
                | {"tag": tag, "required": "required" in a}
            )
        elif tag == "br" and self._block:
            self._block["text"] += "\n"
        elif tag == "a":
            href = a.get("href")
            self._link_stack.append(href)
            if href:
                self.meta["links"].append(href)
            if self._block:
                self._block["text"] += "["
            else:
                # Carrd-Buttons/Icons: Link ohne umschließenden Textblock
                self._block = {"tag": "button", "id": a.get("id") or a.get("class"), "text": "", "href": href}
                self._block_depth = len(self._stack)
        elif tag in BLOCK_TAGS:
            self._flush_block()
            self._block = {"tag": tag, "id": a.get("id"), "text": ""}
            self._block_depth = len(self._stack)
        elif tag in INLINE_MD and self._block:
            self._block["text"] += INLINE_MD[tag]

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            self._in_style = False
        elif not self._skip:
            if tag == "title":
                self._in_title = False
            elif tag == "a":
                href = self._link_stack.pop() if self._link_stack else None
                if self._block and self._block["tag"] == "button" and len(self._stack) == self._block_depth:
                    text = self._block["text"].strip()
                    if text or href:
                        self._emit({"type": "button", "id": self._block["id"], "text": text, "href": href})
                    self._block = None
                elif self._block:
                    self._block["text"] += f"]({href})" if href else "]"
            elif tag in INLINE_MD and self._block:
                self._block["text"] += INLINE_MD[tag]
            elif tag in BLOCK_TAGS and self._block and self._block["tag"] == tag:
                self._flush_block()
        # Stack bis einschließlich passendem Tag abbauen (robust gegen kaputtes HTML)
        if tag in self._stack:
            while self._stack and self._stack.pop() != tag:
                pass

    def handle_data(self, data):
        if self._in_style:
            self.css_blocks.append(data)
            return
        if self._skip:
            return
        if self._in_title:
            self.meta["title"] += data.strip()
        elif self._block is not None:
            self._block["text"] += data


def to_markdown(items: list[dict], meta: dict) -> str:
    out = [f"# Carrd-Export: {meta['title']}\n"]
    if d := meta["meta"].get("description"):
        out.append(f"> Meta-Description: {d}\n")
    for it in items:
        t = it["type"]
        if t == "section":
            out.append(f"\n---\n\n## [Section: {it['id']}]\n")
        elif t in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            out.append(f"{'#' * min(6, int(t[1]) + 2)} {it['text']}\n")
        elif t == "li":
            out.append(f"- {it['text']}")
        elif t == "image":
            out.append(f"![{it['alt']}]({it.get('local') or it['src']})\n")
        elif t == "button":
            out.append(f"[Button] {it['text'] or '(Icon)'} → {it['href']}\n")
        else:
            out.append(f"{it['text']}\n")
    if meta["forms"]:
        out.append("\n---\n\n## Formulare\n")
        for f in meta["forms"]:
            out.append(f"- {f['id']}: " + ", ".join(x.get("name") or x.get("placeholder") or x["tag"] for x in f["fields"]))
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="URL der Carrd-Seite oder lokale HTML-Datei")
    ap.add_argument("--base", help="Basis-URL für relative Bildpfade (bei lokaler Datei)")
    ap.add_argument("--out", default="carrd-export", help="Ausgabeordner für Texte/Metadaten")
    ap.add_argument("--img-dir", default="site/assets/img/carrd", help="Zielordner für Bilder")
    ap.add_argument("--no-images", action="store_true", help="Bilder nicht herunterladen")
    args = ap.parse_args()

    is_url = re.match(r"^https?://", args.source) is not None
    base = args.source if is_url else (args.base or "")
    raw = fetch(args.source) if is_url else Path(args.source).expanduser().read_bytes()
    html = raw.decode("utf-8", errors="replace")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "page.html").write_text(html, encoding="utf-8")

    p = CarrdParser()
    p.feed(html)
    p.close()

    # Hintergrundbilder aus Carrd-Inline-CSS ergänzen
    css = "\n".join(p.css_blocks)
    def key(src: str) -> str:
        return urllib.parse.urljoin(base, src).split("?")[0] if base else src.split("?")[0]

    seen = {key(it["src"]) for it in p.items if it["type"] == "image"}
    for m in re.finditer(r"url\(['\"]?([^'\")]+\.(?:jpe?g|png|webp|gif|svg|avif)[^'\")]*)['\"]?\)", css, re.I):
        if key(m.group(1)) not in seen:
            seen.add(key(m.group(1)))
            p.items.append({"type": "image", "id": "css-background", "src": m.group(1), "alt": "", "section": None})
    if og := p.meta["meta"].get("og:image"):
        if key(og) not in seen:
            p.items.append({"type": "image", "id": "og:image", "src": og, "alt": "", "section": None})

    if not args.no_images:
        img_dir = Path(args.img_dir)
        img_dir.mkdir(parents=True, exist_ok=True)
        for it in p.items:
            if it["type"] != "image" or it["src"].startswith("data:"):
                continue
            url = urllib.parse.urljoin(base, it["src"]) if base else it["src"]
            if not re.match(r"^https?://", url):
                print(f"  übersprungen (keine Basis-URL): {it['src']}", file=sys.stderr)
                continue
            name = Path(urllib.parse.urlparse(url).path).name or "bild"
            target = img_dir / name
            try:
                if not target.exists():
                    target.write_bytes(fetch(url))
                it["local"] = target.as_posix()
                print(f"  Bild: {name}")
            except Exception as e:  # noqa: BLE001 – einzelne Fehlschläge nicht fatal
                print(f"  Fehler bei {url}: {e}", file=sys.stderr)

    (out / "content.json").write_text(json.dumps(p.items, ensure_ascii=False, indent=2), encoding="utf-8")
    p.meta["links"] = sorted(set(p.meta["links"]))
    (out / "meta.json").write_text(json.dumps(p.meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "content.md").write_text(to_markdown(p.items, p.meta), encoding="utf-8")

    n_text = sum(1 for i in p.items if i["type"] not in {"image", "section"})
    n_img = sum(1 for i in p.items if i["type"] == "image")
    print(f"Fertig: {n_text} Textelemente, {n_img} Bilder, {len(p.meta['forms'])} Formulare → {out}/content.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
