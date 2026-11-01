#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test zgodności dokumentacji z kodem: nowy bank albo format nie może trafić do wydania bez opisu.

Źródło prawdy = kod:
  BANKI (src/parsery/banki.js), NAZWY_BANKOW (src/app.js), BANK_N (src/dashboard/dashboard.js),
  ZRODLO_RE (src/rdzen/model.js) — muszą mieć te same banki i nazwy;
  formaty plików czytane w src/app.js (.csv/.pdf/.xlsx).
Sprawdza:
  - nazwa każdego banku: README.md, docs/jak-to-dziala.html, stopka src/dashboard/uklad.html;
  - folder każdego banku (<klucz>/): drzewo w README.md, docs/jak-to-dziala.html, src/index.html;
  - każdy format: accept= w src/index.html, wzmianka w README.md i docs/jak-to-dziala.html;
  - wersja w stopce docs/jak-to-dziala.html ≥ ostatni tag git (opis nie jest starszy niż wydanie).

Użycie:  python3 -I testy/test_dokumentacja.py      (kod wyjścia 1 = niezgodność)
"""
import os, re, subprocess, sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
czytaj = lambda p: open(os.path.join(WEB, p), encoding="utf-8").read()
bledy = []


def sprawdz(warunek, opis):
    print(f"  {'✓' if warunek else '✗'} {opis}")
    if not warunek:
        bledy.append(opis)


def mapa(tekst, nazwa):
    m = re.search(nazwa + r"\s*=\s*\{([^}]*)\}", tekst)
    return dict(re.findall(r"(\w+)\s*:\s*[\"']([^\"']+)[\"']", m.group(1))) if m else {}


def wersja(s):
    return tuple(int(x) for x in re.findall(r"\d+", s)[:3])


def main():
    print("Test dokumentacji:")
    app, dash, banki_js, model = czytaj("src/app.js"), czytaj("src/dashboard/dashboard.js"), czytaj("src/parsery/banki.js"), czytaj("src/rdzen/model.js")
    banki = re.findall(r"\"(\w+)\"", re.search(r"const BANKI\s*=\s*\[([^\]]*)\]", banki_js).group(1))
    nazwy, nazwy_d = mapa(app, "NAZWY_BANKOW"), mapa(dash, "BANK_N")
    zrodlo = re.search(r"ZRODLO_RE\s*=\s*/\^\(([^)]*)\)", model).group(1).split("|")
    sprawdz(set(banki) == set(nazwy) == set(nazwy_d) == set(zrodlo),
            f"te same banki w BANKI, NAZWY_BANKOW, BANK_N, ZRODLO_RE ({', '.join(banki)})")
    sprawdz(nazwy == nazwy_d, "te same nazwy banków w app.js i dashboard.js")

    readme, docs, index, uklad = czytaj("README.md"), czytaj("docs/jak-to-dziala.html"), czytaj("src/index.html"), czytaj("src/dashboard/uklad.html")
    stopka = re.search(r'class="foot">(.*?)</div>', uklad, re.S)
    for k, n in sorted(nazwy.items()):
        brak = [p for p, t in (("README.md", readme), ("docs/jak-to-dziala.html", docs),
                               ("stopka uklad.html", stopka.group(1) if stopka else "")) if n not in t]
        sprawdz(not brak, f"bank {n}: opisany" + (f" — brak w: {', '.join(brak)}" if brak else ""))
        brak = [p for p, t in (("README.md", readme), ("docs/jak-to-dziala.html", docs), ("src/index.html", index))
                if not re.search(r"[─\s]" + re.escape(k) + r"/", t)]
        sprawdz(not brak, f"folder {k}/: w drzewie folderu" + (f" — brak w: {', '.join(brak)}" if brak else ""))

    formaty = sorted(set(re.findall(r'endsWith\("\.(csv|pdf|xlsx)"\)', app)))
    accept = re.search(r'accept="([^"]*)"', index)
    for f in formaty:
        brak = [p for p, ok in (("accept= w src/index.html", accept and f".{f}" in accept.group(1).split(",")),
                                ("README.md", f.upper() in readme), ("docs/jak-to-dziala.html", f.upper() in docs)) if not ok]
        sprawdz(not brak, f"format {f.upper()}: obsłużony w opisie" + (f" — brak w: {', '.join(brak)}" if brak else ""))

    tag = subprocess.run(["git", "describe", "--tags", "--abbrev=0"], cwd=WEB, capture_output=True, text=True).stdout.strip()
    m = re.search(r"zgodny z wersją ([\d.]+)", docs)
    if tag and m:
        sprawdz(wersja(m.group(1)) >= wersja(tag), f"stopka docs: wersja {m.group(1)} ≥ ostatni tag {tag}")
    else:
        sprawdz(False, "stopka docs: brak wersji („zgodny z wersją X.Y.Z”) albo tagu git")

    print("WYNIK:", "PASS" if not bledy else f"FAIL ({len(bledy)})")
    return 1 if bledy else 0


if __name__ == "__main__":
    sys.exit(main())
