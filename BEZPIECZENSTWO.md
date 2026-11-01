# Bezpieczeństwo

Wyciągi bankowe to wrażliwe dane. Ta aplikacja jest zaprojektowana tak, żeby nie musieć ufać autorowi —
każdą z poniższych obietnic możesz sprawdzić samodzielnie.

## Model

| Obietnica | Jak jest zapewniona | Jak sprawdzić |
|---|---|---|
| Dane nie opuszczają komputera | brak serwera; pliki czytane przez File API przeglądarki | tryb samolotowy → aplikacja działa tak samo |
| Strona nie może nic wysłać | CSP w `<meta>`: `default-src 'none'; connect-src 'none'; form-action 'none'` | narzędzia deweloperskie → Sieć: zero żądań po wczytaniu plików; automatycznie: `testy/test_prywatnosc.py` (każda zmiana i każde wydanie) |
| Nie da się wstrzyknąć skryptu | CSP dopuszcza tylko skrypty o znanych hashach SHA-256; opisy transakcji są escapowane | `testy/test_przegladarka.py` — próby XSS przez opis transakcji, nazwę kategorii, tag |
| Żadnych zależności z zewnątrz | zero bibliotek i CDN; `build.py` przerywa budowanie, gdy znajdzie `fetch`, `XMLHttpRequest`, `http(s)://` itp. | przeszukaj `wydatki.html` — brak zewnętrznych adresów |
| Złośliwy plik nie zawiesi aplikacji | PDF i XLSX czytane własnym kodem z limitami: 50 MB po rozpakowaniu (także gdy archiwum podaje fałszywy rozmiar), liczba wierszy i elementów; XML z `DOCTYPE`/`ENTITY` odrzucany | `testy/test_przegladarka.py` — bomby ZIP i PDF, bomba encji XML |
| Numery kart i rachunków nie są przechowywane | parser zapisuje tylko 4 ostatnie cyfry jako źródło transakcji | `testy/test_przegladarka.py` — „pełny numer karty nie trafia do UI” |
| Plik do pobrania = kod z repozytorium | wydanie budowane przez GitHub Actions z oznaczonej wersji (tag) | porównaj SHA-256 pliku z wartością w wydaniu (niżej) |

## Weryfikacja pobranego pliku

```
sha256sum wydatki.html                       # Linux
shasum -a 256 wydatki.html                   # macOS
Get-FileHash wydatki.html -Algorithm SHA256  # Windows (PowerShell)
```

Wynik musi być identyczny z `wydatki.html.sha256` z [wydania](https://github.com/wydatki-app/wydatki/releases/latest).
Możesz też zbudować plik sam: `python3 -I build.py` → `dist/wydatki.html`.

## Gdzie są Twoje dane

| Dane | Miejsce |
|---|---|
| Wyciągi CSV | tylko Twój folder; aplikacja ich nie modyfikuje |
| Kategorie, reguły, tagi, budżety, cel FIRE | Chrome/Edge: pliki w `Wydatki/ustawienia/` (lub obok, jeśli tam były); Firefox/Safari: pamięć przeglądarki (localStorage) + plik kopii, gdy go zapiszesz |
| Czyszczenie | Przycisk „wyczyść dane z przeglądarki” usuwa klucze aplikacji (`wydatki*`) z localStorage i bazę IndexedDB `wydatki` (zapamiętany folder). Cudze dane stron `file://` i motyw zostają, pliki w folderze nietknięte. Przy zmianach bez kopii pokazuje ostrzeżenie |
| Ostatni folder (Chrome/Edge) | uchwyt w pamięci przeglądarki (IndexedDB); dostęp i tak wymaga Twojej zgody przy każdym otwarciu |

## Znane ograniczenia

- Wersja z GitHub Pages (demo) jest ładowana z serwera GitHub przy każdym wejściu — ufasz wtedy hostingowi.
  Do pracy na prawdziwych wyciągach używaj **pobranego pliku** (zweryfikowanego hashem).
- CSP w `<meta>` nie chroni przed rozszerzeniami przeglądarki — rozszerzenie z dostępem do „wszystkich stron” widzi zawartość każdej strony.

## Zgłaszanie podatności

Znalazłeś problem z bezpieczeństwem? Zgłoś go prywatnie przez
[Security → Report a vulnerability](https://github.com/wydatki-app/wydatki/security/advisories/new), nie w publicznym Issue.
Zakres, terminy odpowiedzi i zasady ujawniania: [SECURITY.md](SECURITY.md).
