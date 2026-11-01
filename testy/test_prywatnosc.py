#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test prywatności: aplikacja nie może wysłać danych, a repo nie może zawierać prawdziwych wyciągów.

1. dist/wydatki.html (artefakt dla użytkownika — najpierw: python3 -I build.py):
   - dokładnie jedna CSP; default-src/connect-src/form-action/base-uri = 'none',
     skrypty tylko z hashem, obrazy tylko data:, bez 'unsafe-eval' i bez adresów zewnętrznych;
   - w kodzie brak API sieciowych (fetch, XMLHttpRequest, WebSocket, sendBeacon, …);
   - brak adresów http(s):// (wyjątki: .kontrola/dozwolone-adresy.txt, jeden adres w linii).
2. Repo (pliki śledzone i nowe nieignorowane): żadnych wyciągów (.csv/.pdf/.xlsx/…) ani plików
   ustawień z danymi poza demo/ i testy/; .gitignore musi blokować te formaty.

Użycie:  python3 -I testy/test_prywatnosc.py [--dist PLIK]     (kod wyjścia 1 = blokada)
"""
import os, re, subprocess, sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(WEB, "dist", "wydatki.html")

CSP_WYMAGANE = {"default-src": {"'none'"}, "connect-src": {"'none'"}, "form-action": {"'none'"}, "base-uri": {"'none'"}}
CSP_DOZWOLONE = {"script-src": re.compile(r"^'sha256-[A-Za-z0-9+/=]{43,44}'$"), "img-src": re.compile(r"^(data:|'none')$"),
                 "style-src": re.compile(r"^'unsafe-inline'$")}
API_SIECI = re.compile(r"\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|new\s+Worker\s*\(|"
                       r"SharedWorker|RTCPeerConnection|navigator\.serviceWorker|window\.open\s*\(|\.submit\s*\(\s*\))")
ADRES = re.compile(r"\b(?:https?|wss?|ftp)://[^\s\"'<>)]{1,200}", re.I)
PRELOAD = re.compile(r"<link[^>]+rel=[\"']?(prefetch|preconnect|dns-prefetch|preload|prerender)", re.I)

WYCIAGI = re.compile(r"\.(csv|pdf|xlsx|xls|ods|ofx|qif|mt940|sta)$", re.I)
USTAWIENIA = re.compile(r"(^|/)(override|tagi|zwroty|kategorie_wlasne|budzety|reguly_wlasne)\.json$|(^|/)wydatki-ustawienia.*\.json$", re.I)
DOZWOLONE_MIEJSCA = re.compile(r"^(demo|testy)/")
GITIGNORE_WYMAGANE = ["*.csv", "*.pdf", "*.xlsx", "wydatki-ustawienia*.json", "override.json", "tagi.json", "zwroty.json"]

bledy = []


def blad(opis):
    bledy.append(opis)
    print(f"  ✗ {opis}")


def ok(opis):
    print(f"  ✓ {opis}")


def sprawdz_dist(DIST=DIST):
    if not os.path.exists(DIST):
        return blad("brak dist/wydatki.html — uruchom najpierw: python3 -I build.py")
    html = open(DIST, encoding="utf-8").read()
    csp = re.findall(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', html)
    if len(csp) != 1:
        return blad(f"CSP: oczekiwano dokładnie 1 nagłówka, jest {len(csp)}")
    dyr = {}
    for d in csp[0].split(";"):
        cz = d.split()
        if cz:
            dyr[cz[0]] = cz[1:]
    zle = []
    for k, wym in CSP_WYMAGANE.items():
        if set(dyr.get(k, [])) != wym:
            zle.append(f"{k} = {' '.join(dyr.get(k, [])) or '(brak)'} (wymagane {' '.join(wym)})")
    for k, wart in dyr.items():
        if k in CSP_WYMAGANE:
            continue
        if k not in CSP_DOZWOLONE:
            zle.append(f"nieoczekiwana dyrektywa {k}")
        else:
            zle += [f"{k}: niedozwolona wartość {w}" for w in wart if not CSP_DOZWOLONE[k].match(w)]
    if zle:
        for z in zle:
            blad("CSP: " + z)
    else:
        ok("CSP: brak połączeń, formularzy i obcych skryptów (default/connect/form-action/base-uri = 'none')")

    api = sorted({m.group(1).strip() for m in API_SIECI.finditer(html)})
    blad(f"API sieciowe w aplikacji: {', '.join(api)}") if api else ok("brak API sieciowych (fetch, XHR, WebSocket, sendBeacon, …)")
    if PRELOAD.search(html):
        blad("link prefetch/preconnect/preload w aplikacji")

    dozw_plik = os.path.join(WEB, ".kontrola", "dozwolone-adresy.txt")
    dozw = set()
    if os.path.exists(dozw_plik):
        dozw = {l.strip() for l in open(dozw_plik, encoding="utf-8") if l.strip() and not l.startswith("#")}
    adresy = sorted({a for a in ADRES.findall(html) if a not in dozw})
    if adresy:
        blad(f"adresy zewnętrzne w aplikacji ({len(adresy)}): {', '.join(a[:60] for a in adresy[:5])}")
    else:
        ok("brak adresów zewnętrznych w aplikacji")


def sprawdz_repo():
    r = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=WEB,
                       capture_output=True, text=True)
    if r.returncode != 0:
        return blad("git ls-files nie działa — nie sprawdzono plików repo")
    pliki = [p for p in r.stdout.split("\0") if p]
    zle = [p for p in pliki if (WYCIAGI.search(p) or USTAWIENIA.search(p)) and not DOZWOLONE_MIEJSCA.match(p)]
    if zle:
        for p in zle:
            blad(f"plik z danymi poza demo/ i testy/: {p}")
    else:
        ok(f"brak wyciągów i ustawień z danymi poza demo/ i testy/ ({len(pliki)} plików)")
    gi = os.path.join(WEB, ".gitignore")
    wpisy = {l.strip() for l in open(gi, encoding="utf-8")} if os.path.exists(gi) else set()
    brak = [w for w in GITIGNORE_WYMAGANE if w not in wpisy]
    blad(f".gitignore nie blokuje: {', '.join(brak)}") if brak else ok(".gitignore blokuje formaty wyciągów i pliki ustawień")


def main():
    # --dist PLIK: sprawdź inny plik (testy mutacyjne samego testu); domyślnie dist/wydatki.html
    arg = sys.argv[1:]
    dist = arg[arg.index("--dist") + 1] if "--dist" in arg and arg.index("--dist") + 1 < len(arg) else DIST
    print("Test prywatności:")
    sprawdz_dist(dist)
    sprawdz_repo()
    print("WYNIK:", "PASS" if not bledy else f"FAIL ({len(bledy)})")
    return 1 if bledy else 0


if __name__ == "__main__":
    sys.exit(main())
