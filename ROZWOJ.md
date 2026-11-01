# Rozwój

Czysty JavaScript bez bibliotek; `build.py` (Python 3, bez zależności) skleja źródła w jeden plik.

## Struktura

| Ścieżka | Zawartość |
|---|---|
| `src/rdzen/model.js` | model transakcji, kwoty, stabilne ID transakcji (`data\|opis\|kwota`) |
| `src/rdzen/csv.js` | parser CSV (cudzysłowy, nowe linie w polach, BOM) |
| `src/rdzen/import.js` | rozpoznanie banku po treści, scalanie i deduplikacja |
| `src/rdzen/magazyn.js` | ustawienia + lokalna atrapa API (walidacja zapisów), kopia w localStorage, pakiet eksportu |
| `src/rdzen/pdf.js` | czytnik tekstu z PDF bez bibliotek (FlateDecode, fonty ToUnicode), układ jak `pdftotext -layout` |
| `src/rdzen/xlsx.js` | czytnik pierwszego arkusza XLSX bez bibliotek (ZIP + deflate-raw + skaner XML), limity jak w PDF; wynik → CSV |
| `src/parsery/banki.js` | Millennium, VeloBank (PDF), Revolut (aplikacja + Account Statement), Alior, mBank, PKO BP (CSV w CP1250), BNP Paribas (XLSX) |
| `src/reguly/reguly.js` | mini-parser `kategorie.yaml`, kategorie, tagi, grupy wpływów |
| `src/reguly/kategorie.domyslne.yaml` | reguły startowe |
| `src/dashboard/` | dashboard (`style.css`, `uklad.html`, `dashboard.js`) |
| `src/app.js`, `src/app.css`, `src/index.html` | ekran startowy, import folderu/plików, zapis do folderu (File System Access API) |
| `build.py` | → `dist/wydatki.html` (1 plik, CSP z hashami skryptów, SHA-256) |
| `demo/` | fikcyjne dane (Jan Kowalski) w układzie folderu użytkownika — wbudowane w plik jako demo |
| `narzedzia/generuj_dane.py` | generator fikcyjnych wyciągów do `demo/dane/` (powtarzalny, seed) |
| `testy/test_przegladarka.py` | testy w Firefox (przez Marionette) i Chromium headless: import, XSS, CSP, bomby ZIP/PDF, zapis, pierwszeństwo ustawień |
| `testy/marionette.py` | minimalny klient Marionette (stdlib): czeka na wynik testu zamiast na zdarzenie load |
| `testy/test_prywatnosc.py` | `dist/`: CSP bez sieci, brak API sieciowych i adresów zewnętrznych; repo: brak wyciągów, `.gitignore` |
| `testy/test_dokumentacja.py` | każdy bank i format z kodu opisany w README, „Jak to działa” i pomocy aplikacji; wersja w stopce ≥ tag |
| `.kontrola/testy.txt` | obowiązkowe testy uruchamiane przez kontrolę bezpieczeństwa w hooku pre-push |
| `testy/parytet.py` | porównanie z referencyjną implementacją Python (historyczna wersja narzędzia) |

## Budowanie i testy

```
python3 -I build.py                                          # → dist/wydatki.html (+ .sha256)
python3 -I testy/test_prywatnosc.py                          # CSP bez sieci, brak wyciągów w repo
python3 -I testy/test_dokumentacja.py                        # banki i formaty opisane w dokumentacji
python3 -I testy/test_przegladarka.py                        # Firefox + Chromium
python3 -I testy/test_przegladarka.py --przegladarka chromium
```

Chromium: domyślnie `~/Downloads/chrome-linux/chrome`, inna ścieżka przez `WYDATKI_CHROMIUM=…`.
Brave (macOS): `WYDATKI_CHROMIUM="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"` + `WYDATKI_CHROMIUM_PROFIL=<katalog>` — Brave headless wisi przy pierwszym starcie na pustym profilu; profil trzeba raz „rozgrzać” (`--headless=new --virtual-time-budget=2000 --dump-dom` na dowolnej stronie).
Firefox: przez Marionette (`testy/marionette.py`); inna ścieżka przez `WYDATKI_FIREFOX=…`.
Przed pushem hook uruchamia `kontrola.py` z toolkitu bezpieczeństwa, a ta — polecenia z `.kontrola/testy.txt` (build, prywatność, Firefox).
Demo bez klikania: `dist/wydatki.html#demo`.

Opcjonalna kontrola danych osobowych przy budowaniu: plik `~/.config/wydatki/zakazane.txt`
(lub `WYDATKI_ZAKAZANE=…`) — jedno słowo/regex na linię; budowanie przerwie się, jeśli któreś trafi do `dist/`.

## Dodanie banku

1. Parser w `src/parsery/banki.js`: funkcja `tekst → [W.model.mk(data, opis, odbiorca, obciążenie, uznanie)]`.
2. Rozpoznanie po nagłówku w `rozpoznaj()`, nazwa w `BANKI` (kolejność = kolejność scalania).
3. Nazwa banku: `NAZWY_BANKOW` (`src/app.js`), `BANK_N` (`src/dashboard/dashboard.js`), `ZRODLO_RE` (`src/rdzen/model.js`).
4. Źródło (opcjonalnie): `tx.konto = "k1234"`/`"r1234"` — tylko 4 ostatnie cyfry (`kontoZNumeru`).
5. Fikcyjny plik w `demo/dane/<bank>/` (generator) i test. Format binarny (PDF, XLSX): na razie tylko w testach — demo wbudowuje pliki jako tekst.

## Układ folderu użytkownika

```
Wydatki/
├── wydatki.html
├── dane/<bank>/*.csv
└── ustawienia/   # kategorie.yaml, konfiguracja.json, budzety.json, tagi.json, override.json,
                  # zwroty.json, kategorie_wlasne.json, wydatki-ustawienia.json (kopia z Firefox/Safari)
```

Ustawienia są czytane tylko z folderu głównego i `ustawienia/`; foldery `_…` i `.…` (np. `_backup`) są pomijane.

## Wydanie

Tag `vX.Y.Z` → GitHub Actions buduje, testuje, publikuje wydanie (plik + SHA-256) i stronę demo.
