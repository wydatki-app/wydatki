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
| `src/parsery/banki.js` | Millennium, VeloBank (PDF), Revolut (aplikacja + Account Statement), Alior, mBank, PKO BP (CSV w CP1250) |
| `src/reguly/reguly.js` | mini-parser `kategorie.yaml`, kategorie, tagi, grupy wpływów |
| `src/reguly/kategorie.domyslne.yaml` | reguły startowe |
| `src/dashboard/` | dashboard (`style.css`, `uklad.html`, `dashboard.js`) |
| `src/app.js`, `src/app.css`, `src/index.html` | ekran startowy, import folderu/plików, zapis do folderu (File System Access API) |
| `build.py` | → `dist/wydatki.html` (1 plik, CSP z hashami skryptów, SHA-256) |
| `demo/` | fikcyjne dane (Jan Kowalski) w układzie folderu użytkownika — wbudowane w plik jako demo |
| `narzedzia/generuj_dane.py` | generator fikcyjnych wyciągów do `demo/dane/` (powtarzalny, seed) |
| `testy/test_przegladarka.py` | testy w Firefox i Chromium headless: import, XSS, CSP, zapis, pierwszeństwo ustawień |
| `testy/parytet.py` | porównanie z referencyjną implementacją Python (historyczna wersja narzędzia) |

## Budowanie i testy

```
python3 -I build.py                                          # → dist/wydatki.html (+ .sha256)
python3 -I testy/test_przegladarka.py                        # Firefox + Chromium
python3 -I testy/test_przegladarka.py --przegladarka chromium
```

Chromium: domyślnie `~/Downloads/chrome-linux/chrome`, inna ścieżka przez `WYDATKI_CHROMIUM=…`.
Demo bez klikania: `dist/wydatki.html#demo`.

Opcjonalna kontrola danych osobowych przy budowaniu: plik `~/.config/wydatki/zakazane.txt`
(lub `WYDATKI_ZAKAZANE=…`) — jedno słowo/regex na linię; budowanie przerwie się, jeśli któreś trafi do `dist/`.

## Dodanie banku

1. Parser w `src/parsery/banki.js`: funkcja `tekst → [W.model.mk(data, opis, odbiorca, obciążenie, uznanie)]`.
2. Rozpoznanie po nagłówku w `rozpoznaj()`, nazwa w `BANKI` (kolejność = kolejność scalania).
3. Fikcyjny plik w `demo/dane/<bank>/` (generator) i test.

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
