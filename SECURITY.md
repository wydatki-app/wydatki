# Polityka bezpieczeństwa

Wydatki przetwarzają wyciągi bankowe, więc każde zgłoszenie bezpieczeństwa traktujemy poważnie.
Jak aplikacja chroni dane i jak to sprawdzić: [BEZPIECZENSTWO.md](BEZPIECZENSTWO.md).

## Jak zgłosić podatność

**Prywatnie**, przez [Security → Report a vulnerability](https://github.com/wydatki-app/wydatki/security/advisories/new).
Nie zgłaszaj podatności w publicznym Issue ani w Discussions.

Przydatne w zgłoszeniu:
- wersja (np. `v0.2.0`) i przeglądarka;
- kroki odtworzenia, najlepiej z **fikcyjnym** plikiem (nie wysyłaj prawdziwych wyciągów);
- skutek: co napastnik może osiągnąć i pod jakim warunkiem.

## Czego możesz się spodziewać

Projekt jest utrzymywany po godzinach przez jedną osobę, dlatego terminy są realistyczne, a nie ambitne:

| Etap | Termin |
|---|---|
| Potwierdzenie otrzymania | do 14 dni |
| Wstępna ocena (czy to podatność, jaki poziom) | do 30 dni |
| Poprawka poważnej podatności | najszybciej, jak to możliwe; zwykle w kolejnym wydaniu |
| Publiczne ujawnienie | po wydaniu poprawki albo po 90 dniach od zgłoszenia, uzgodnione ze zgłaszającym |

Zgłaszającego wymieniamy w opisie poprawki, jeśli sobie tego życzy.

## Wspierane wersje

Poprawki bezpieczeństwa trafiają tylko do **najnowszego wydania**. Pobierz aktualny plik z
[Releases](https://github.com/wydatki-app/wydatki/releases) i porównaj jego SHA-256.

## Zakres

**W zakresie**
- `wydatki.html` z wydań i kod w tym repozytorium (parsery CSV/PDF, reguły, dashboard, zapis ustawień);
- wyciek danych poza przeglądarkę, obejście CSP, XSS przez zawartość plików z banku lub ustawień;
- zawieszenie aplikacji spreparowanym plikiem (DoS), zapis poza wybranym folderem;
- proces wydania (GitHub Actions) i strona demo.

**Poza zakresem**
- złośliwe rozszerzenia przeglądarki i przejęty komputer użytkownika;
- zmodyfikowana kopia pliku, której SHA-256 nie zgadza się z wydaniem;
- ataki wymagające fizycznego dostępu do odblokowanego urządzenia;
- błędy samej przeglądarki lub GitHub Pages.

## Badania w dobrej wierze

Testy prowadzone w dobrej wierze, na własnych lub fikcyjnych danych, bez szkody dla innych
i ze zgłoszeniem tutaj, przed publikacją, są mile widziane. Nie podejmiemy wobec nich żadnych kroków.

---

## English summary

Please report vulnerabilities **privately** via
[Security → Report a vulnerability](https://github.com/wydatki-app/wydatki/security/advisories/new), not in public issues.
Include the version, browser, reproduction steps (use **synthetic** bank files only) and impact.
This is a one-person, spare-time project: acknowledgement within 14 days, initial assessment within 30 days,
coordinated disclosure after a fix or 90 days. Only the latest release is supported.
In scope: the app and this repository (parsers, CSP bypass, XSS, data exfiltration, DoS via crafted files, release pipeline).
Out of scope: malicious browser extensions, compromised devices, modified copies whose SHA-256 does not match a release.
Good-faith research is welcome.
