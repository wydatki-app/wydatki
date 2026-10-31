#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Składa aplikację w JEDEN plik: dist/wydatki.html (+ dist/wydatki.html.sha256).

- wszystkie skrypty i style inline, zero zewnętrznych zasobów;
- CSP w <meta>: connect-src 'none' (przeglądarka blokuje każde połączenie sieciowe),
  skrypty dopuszczone tylko po hashu SHA-256 (wstrzyknięty skrypt / onerror= nie wykona się);
- wbudowane: reguły domyślne + dane demo (fikcyjne, z demo/).

Użycie:  python3 -I build.py
"""
import base64, hashlib, json, os, re, sys

WEB = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(WEB, "src")
DIST = os.path.join(WEB, "dist")

# kolejność ma znaczenie: zależności przed użyciem
SKRYPTY = ["rdzen/model.js", "rdzen/csv.js", "rdzen/pdf.js", "parsery/banki.js", "reguly/reguly.js",
           "rdzen/import.js", "rdzen/magazyn.js", "dashboard/dashboard.js", "app.js"]
MOTYW = 'try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}'

# kontrola: nic, co łączy się z siecią albo ładuje zasoby z zewnątrz
ZAKAZANE = re.compile(r"\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|"
                      r"https?://|<link\b|\bsrc=\"(?!data:)", re.I)
# kontrola: dane osobowe autora nie mogą trafić do publicznego pliku. Lista słów leży POZA repo
# (sama lista byłaby wyciekiem): jedno słowo/regex na linię, # = komentarz.
ZAKAZANE_PLIK = os.environ.get("WYDATKI_ZAKAZANE", os.path.expanduser("~/.config/wydatki/zakazane.txt"))


def osobowe():
    try:
        with open(ZAKAZANE_PLIK, encoding="utf-8") as f:
            slowa = [l.strip() for l in f if l.strip() and not l.startswith("#")]
    except OSError:
        return None
    return re.compile("|".join(slowa), re.I) if slowa else None


def czytaj(*sciezka):
    with open(os.path.join(*sciezka), encoding="utf-8") as f:
        return f.read()


def js_str(obj):
    """JSON bezpieczny wewnątrz <script>."""
    return json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")


def demo():
    out = []
    for root, _, files in os.walk(os.path.join(WEB, "demo")):
        for n in sorted(files):
            p = os.path.join(root, n)
            out.append({"sciezka": "Wydatki-demo/" + os.path.relpath(p, os.path.join(WEB, "demo")).replace(os.sep, "/"),
                        "tekst": czytaj(p)})
    return sorted(out, key=lambda x: x["sciezka"])


def sha256_csp(tekst):
    return "'sha256-" + base64.b64encode(hashlib.sha256(tekst.encode("utf-8")).digest()).decode() + "'"


def main():
    skrypt = ("globalThis.W = globalThis.W || {};\n"
              f"W.DOMYSLNE_REGULY = {js_str(czytaj(SRC, 'reguly', 'kategorie.domyslne.yaml'))};\n"
              f"W.DEMO = {js_str(demo())};\n"
              + "\n".join(czytaj(SRC, p) for p in SKRYPTY))
    zle = [m.group(0) for p in SKRYPTY for m in ZAKAZANE.finditer(czytaj(SRC, p))]
    if zle:
        sys.exit(f"STOP — kod sieciowy/zewnętrzny w źródłach: {zle[:10]}")

    skrypt_blok = "\n" + skrypt + "\n"
    csp = ("default-src 'none'; "
           f"script-src {sha256_csp(MOTYW)} {sha256_csp(skrypt_blok)}; "
           "style-src 'unsafe-inline'; img-src data:; connect-src 'none'; "
           "form-action 'none'; base-uri 'none'")
    html = czytaj(SRC, "index.html")
    for znacznik, wartosc in [("<!--CSP-->", f'<meta http-equiv="Content-Security-Policy" content="{csp}">'),
                              ("/*STYL*/", czytaj(SRC, "dashboard", "style.css") + czytaj(SRC, "app.css")),
                              ("<script>/*MOTYW*/</script>", f"<script>{MOTYW}</script>"),
                              ("<!--UKLAD-->", czytaj(SRC, "dashboard", "uklad.html")),
                              ("<script>\n/*SKRYPT*/\n</script>", f"<script>{skrypt_blok}</script>")]:
        if html.count(znacznik) != 1:
            sys.exit(f"Brak znacznika {znacznik} w index.html")
        html = html.replace(znacznik, wartosc)

    rx = osobowe()
    if rx is None:
        print(f"UWAGA: brak listy {ZAKAZANE_PLIK} — kontrola danych osobowych pominięta")
    elif rx.search(html):
        sys.exit(f"STOP — dane osobowe w pliku wynikowym: {[m.group(0) for m in rx.finditer(html)][:10]}")

    os.makedirs(DIST, exist_ok=True)
    cel = os.path.join(DIST, "wydatki.html")
    with open(cel, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    h = hashlib.sha256(html.encode("utf-8")).hexdigest()
    with open(cel + ".sha256", "w") as f:
        f.write(f"{h}  wydatki.html\n")
    print(f"OK: {cel} ({len(html) // 1024} KB)\nSHA-256: {h}")


if __name__ == "__main__":
    main()
