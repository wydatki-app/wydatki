#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test parytetu: wersja przeglądarkowa (JS) vs Python (analiza_wydatkow.py) na tych samych danych.

Porównuje wynik extract_for_json: wydatki (id, data, opis, kwota, kategoria, tagi z reguł) i wpływy.
JS uruchamiany w Firefoksie headless (bez Node) — wynik przez window.dump() na stdout.
VeloBank (PDF) pominięty po obu stronach (JS go czyta, ale Python wymaga pdftotext); mBank i PKO BP
— tylko w wersji JS, więc poza zakresem (porównywane foldery: millenet/, revolut/, alior/).

Użycie:
    python3 -I testy/parytet.py <katalog_danych> [--python <ścieżka do analiza_wydatkow.py>]

<katalog_danych> w układzie wersji Python: millenet/, revolut/, alior/ (+ Historia_transakcji_*.csv), kategorie.yaml.
Wypisuje tylko liczby i maks. 5 przykładów różnic (bez pełnych danych).
"""
import argparse, glob, importlib.util, json, os, subprocess, sys, tempfile

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZRODLA_JS = ["src/rdzen/model.js", "src/rdzen/csv.js", "src/parsery/banki.js",
             "src/reguly/reguly.js", "src/rdzen/import.js"]
ZNACZNIK = "@@PARYTET@@"


def wynik_python(modul, katalog):
    spec = importlib.util.spec_from_file_location("analiza_ref", modul)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.HERE = katalog
    m.reload_rules()
    m.parse_velo_pdf = lambda path: iter(())          # Velo poza zakresem testu
    out, inn = m.extract_for_json(m.load_transactions())
    return out, inn


def pliki_danych(katalog):
    sciezki = (glob.glob(os.path.join(katalog, "Historia_transakcji_*.csv"))
               + glob.glob(os.path.join(katalog, "millenet", "*.csv"))
               + glob.glob(os.path.join(katalog, "revolut", "*.csv"))
               + glob.glob(os.path.join(katalog, "alior", "*.csv")))
    out = []
    for p in sciezki:
        with open(p, encoding="utf-8-sig") as f:
            out.append({"sciezka": os.path.relpath(p, katalog), "tekst": f.read()})
    return out


def wynik_js(katalog):
    with open(os.path.join(katalog, "kategorie.yaml"), encoding="utf-8") as f:
        yaml = f.read()
    dane = json.dumps({"pliki": pliki_danych(katalog), "yaml": yaml}, ensure_ascii=False).replace("</", "<\\/")
    js = "\n".join(open(os.path.join(WEB, p), encoding="utf-8").read() for p in ZRODLA_JS)
    test = f"""
const D = {dane};
let wynik;
try {{
  const R = W.reguly.zbuduj(D.yaml);
  const imp = W.importuj(D.pliki);
  const r = W.reguly.doDashboardu(R, imp.txs);
  wynik = {{ out: r.out, in: r.in, bledy: R.bledy, nierozpoznane: imp.nierozpoznane }};
}} catch (e) {{ wynik = {{ wyjatek: String(e) + "\\n" + e.stack }}; }}
window.dump("{ZNACZNIK}" + JSON.stringify(wynik) + "{ZNACZNIK}\\n");
"""
    with tempfile.TemporaryDirectory() as tmp:
        prof = os.path.join(tmp, "profil")
        os.makedirs(prof)
        with open(os.path.join(prof, "user.js"), "w") as f:
            f.write('user_pref("browser.dom.window.dump.enabled", true);\n')
        strona = os.path.join(tmp, "test.html")
        with open(strona, "w", encoding="utf-8") as f:
            f.write(f"<!doctype html><meta charset='utf-8'><script>{js}\n{test}</script>")
        p = subprocess.run(["firefox", "--headless", "--no-remote", "--profile", prof,
                            "--screenshot", os.path.join(tmp, "x.png"), "file://" + strona],
                           capture_output=True, text=True, timeout=180)
    czesci = p.stdout.split(ZNACZNIK)
    if len(czesci) < 3:
        sys.exit("Brak wyniku z Firefoksa:\n" + p.stdout[-2000:] + p.stderr[-2000:])
    w = json.loads(czesci[1])
    if "wyjatek" in w:
        sys.exit("Wyjątek JS:\n" + w["wyjatek"])
    return w


def porownaj(nazwa, py, js, pola):
    # JSON z JS nie odróżnia 40 od 40.0 — kwoty porównujemy jako float
    norm = lambda p, v: float(v) if p == "k" and v is not None else v
    klucz = lambda r: json.dumps([norm(p, r.get(p)) for p in pola], ensure_ascii=False, sort_keys=True)
    a, b = [klucz(r) for r in py], [klucz(r) for r in js]
    sa, sb = sorted(a), sorted(b)
    ok = sa == sb
    kol = "kolejność zgodna" if a == b else "kolejność INNA"
    suma = lambda rs: round(sum(r["k"] for r in rs), 2)
    print(f"  {nazwa}: Python {len(py)} / JS {len(js)} · suma {suma(py):,.2f} / {suma(js):,.2f} · "
          f"{'ZGODNE' if ok else 'RÓŻNICE'} · {kol}")
    if not ok:
        tylko_py = [x for x in a if x not in set(b)][:5]
        tylko_js = [x for x in b if x not in set(a)][:5]
        for x in tylko_py:
            print("    tylko Python:", x[:160])
        for x in tylko_js:
            print("    tylko JS:    ", x[:160])
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("katalog")
    ap.add_argument("--python", default=None, help="analiza_wydatkow.py (domyślnie: z katalogu danych)")
    a = ap.parse_args()
    katalog = os.path.abspath(a.katalog)
    modul = a.python or os.path.join(katalog, "analiza_wydatkow.py")
    py_out, py_in = wynik_python(modul, katalog)
    js = wynik_js(katalog)
    print(f"Parytet JS vs Python — {katalog}")
    if js["bledy"]:
        print("  błędy regex w JS:", js["bledy"][:5])
    if js["nierozpoznane"]:
        print("  nierozpoznane pliki (JS):", js["nierozpoznane"])
    ok1 = porownaj("wydatki", py_out, js["out"], ["id", "d", "o", "k", "c", "at"])
    ok2 = porownaj("wpływy ", py_in, js["in"], ["d", "o", "k", "g"])
    print("WYNIK:", "PASS" if ok1 and ok2 else "FAIL")
    sys.exit(0 if ok1 and ok2 else 1)


if __name__ == "__main__":
    main()
