#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generator FIKCYJNYCH wyciągów do demo dashboardu wydatków.

Fikcyjny użytkownik: Jan Kowalski (rodzina 2+1, mieszkanie w mieście).
Wyjście (nadpisuje): demo/dane/{millennium,revolut,alior,mbank,pkobp}/demo.csv
Format plików = format eksportu z banków (Millennium CSV, Revolut CSV z aplikacji, Alior CSV,
mBank „Elektroniczne zestawienie operacji”, PKO BP „Zestawienie operacji”). Prawdziwe eksporty mBank i PKO BP
są w Windows-1250 — demo zapisuje UTF-8 (aplikacja czyta oba). VeloBank (PDF) celowo bez pliku demo.
mBank i PKO BP losowane osobnym generatorem (seed+1, seed+2), więc pliki pozostałych banków się nie zmieniają.

Użycie:
    python3 -I narzedzia/generuj_dane.py                     # domyślny okres i seed (powtarzalne)
    python3 -I narzedzia/generuj_dane.py --od 2026-05-01 --do 2026-10-29 --seed 7
"""
import argparse, csv, os, random
from datetime import date, timedelta

DANE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo", "dane")

# (opis, min zł, max zł, ile razy w miesiącu)
MILLENNIUM_KARTA = [
    ("BIEDRONKA 1234 WARSZAWA", 40, 220, 8),
    ("LIDL MOKOTOWSKA WARSZAWA", 50, 260, 5),
    ("ZABKA Z1234 K.1 WARSZAWA", 8, 45, 6),
    ("CARREFOUR EXPRESS", 30, 150, 2),
    ("PIEKARNIA SKWARCZYNSKI", 12, 40, 4),
    ("ORLEN STACJA NR 452", 180, 320, 3),
    ("APTEKA DOZ 112", 20, 140, 2),
    ("ROSSMANN 214", 30, 120, 1),
    ("MCDONALDS 33 WARSZAWA", 25, 70, 1),
    ("PIZZA HUT ARKADIA", 60, 140, 1),
    ("KAWIARNIA FILTRY", 15, 40, 3),
    ("ALLEGRO.PL", 40, 400, 2),
    ("JAKDOJADE.PL BILET", 4.4, 13, 4),
    ("CINEMA CITY ARKADIA", 50, 110, 0.5),
    ("CASTORAMA 12", 60, 450, 0.5),
    ("DECATHLON 45", 80, 350, 0.4),
    ("MEDIA EXPERT 78", 150, 900, 0.2),
    ("BARBER SHOP KOSA", 60, 80, 1),
]
MILLENNIUM_DZIECKO = [            # karta debetowa dziecka → tag Dzieci
    ("ZABKA Z0981 K.2 WARSZAWA", 6, 30, 5),
    ("MCDONALDS 41 WARSZAWA", 18, 45, 2),
    ("KFC CENTRUM", 20, 50, 1),
    ("EMPIK METRO", 20, 80, 0.5),
    ("STEAM PURCHASE", 20, 120, 0.4),
]
MILLENNIUM_STALE = [              # (dzień, odbiorca, opis, kwota)
    (10, "WSPOLNOTA MIESZKANIOWA ZIELONA 8", "CZYNSZ ZA LOKAL 14", 780.00),
    (12, "PGE OBRÓT S.A.", "ENERGIA ELEKTRYCZNA FAKTURA", None),        # zmienna
    (15, "ORANGE POLSKA S.A.", "ABONAMENT ORANGE FLEX", 89.00),
    (18, "NETIA S.A.", "INTERNET ŚWIATŁOWÓD", 69.00),
    (20, "PZU SA", "SKŁADKA UBEZPIECZENIE MIESZKANIA", 54.00),
    (5,  "ANNA NOWAK SZKOŁA JĘZYKOWA", "KIESZONKOWE I KURS ANGIELSKI", 450.00),
]
REVOLUT = [
    ("Netflix", 43, 43, 1),
    ("Spotify", 23.99, 23.99, 1),
    ("OpenAI *ChatGPT Plus", 89, 92, 1),
    ("Wolt", 45, 120, 2),
    ("Uber", 18, 55, 1.5),
    ("Bolt", 15, 45, 1),
    ("Starbucks", 18, 35, 1.5),
    ("Amazon", 30, 250, 1),
    ("Zalando", 120, 400, 0.4),
    ("Google One", 9.99, 9.99, 1),
]
ALIOR = [
    ("KAUFLAND PL 6421", 80, 320, 3),
    ("AUCHAN WARSZAWA", 120, 380, 1),
    ("ORLEN STACJA NR 108", 200, 300, 1),
    ("LUX MED SP. Z O.O.", 150, 350, 0.4),
    ("H&M SKLEP 112", 80, 300, 0.5),
    ("SHELL 7781", 180, 280, 0.7),
    ("RESTAURACJA STARA KUCHNIA", 120, 300, 0.6),
]
MBANK = [                         # drugie konto Jana: drobne zakupy, BLIK
    ("ROSSMANN 214        /WARSZAWA", 15, 90, 2),
    ("PEPCO 1123          /WARSZAWA", 20, 120, 1),
    ("SUPER-PHARM ARKADIA /WARSZAWA", 25, 110, 0.6),
    ("COSTA COFFEE 0412   /WARSZAWA", 14, 32, 2),
    ("BOLT.EU/O/2605      /TALLINN", 14, 48, 1.5),
    ("ZABKA Z7781 K.1     /WARSZAWA", 6, 35, 3),
]
MBANK_BLIK = [("PYSZNE.PL", 45, 110, 1.2), ("ALLEGRO.PL", 30, 220, 0.8)]
PKO = [                           # (miejsce, miasto, min, max, ile/mc)
    ("STOKROTKA NR 0123", "WARSZAWA", 40, 210, 4),
    ("DINO POLSKA 2231", "PIASECZNO", 30, 160, 2),
    ("CIRCLE K 4410", "WARSZAWA", 150, 290, 1),
    ("APTEKA POD ORLEM", "WARSZAWA", 15, 90, 1),
    ("MULTIKINO ZLOTE TARASY", "WARSZAWA", 45, 120, 0.4),
]

# jednorazowe: (data, plik, opis, kwota)
JEDNORAZOWE = [
    ("2026-05-24", "mil", "KWIACIARNIA BUKIET DLA MAMY", 160.00),
    ("2026-06-14", "rev", "Ebilet FESTIWAL 2026 karnet", 890.00),
    ("2026-06-28", "rev", "FESTIWAL 2026 strefa gastro", 214.50),
    ("2026-07-02", "rev", "Booking.com Makarska", 3420.00),
    ("2026-07-02", "rev", "Ryanair", 1236.00),
    ("2026-08-03", "rev", "Konzum Makarska", 312.40),
    ("2026-08-05", "rev", "Restoran Makarska", 286.10),
    ("2026-08-07", "rev", "Jadrolinija Split", 198.30),
    ("2026-08-09", "rev", "Dubrovnik Cable Car", 240.00),
    ("2026-08-25", "mil", "MEDIA EXPERT LAPTOP DO SZKOLY", 3299.00),
    ("2026-09-03", "mil", "DENTYSTA DR SMILE", 650.00),
    ("2026-09-18", "ali", "IKEA WARSZAWA JANKI", 1180.00),
    ("2026-10-11", "ali", "WARTA UBEZPIECZENIE OC AC", 1460.00),
    ("2026-10-12", "mil", "FUNDACJA DAROWIZNA", 100.00),
]

KONTO_MIL = "PL00 1160 0000 0000 0000 0000 0001"   # fikcyjne
KARTA_MIL = "4249 XXXX XXXX 0001"
KARTA_DEB = "5375 XXXX XXXX 0002"


def months(od, do):
    y, m = od.year, od.month
    while date(y, m, 1) <= do:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def days_in(y, m):
    return ((date(y + m // 12, m % 12 + 1, 1)) - timedelta(days=1)).day


def losuj(rng, wzorce, y, m, od, do):
    """Zwraca listę (data, opis, kwota) wg częstotliwości miesięcznych."""
    out = []
    for opis, lo, hi, ile in wzorce:
        n = int(ile) + (1 if rng.random() < ile - int(ile) else 0)
        for _ in range(n):
            d = date(y, m, rng.randint(1, days_in(y, m)))
            if od <= d <= do:
                out.append((d, opis, round(rng.uniform(lo, hi), 2)))
    return out


def main():
    ap = argparse.ArgumentParser(description="Generator fikcyjnych wyciągów (demo)")
    ap.add_argument("--od", default="2026-05-01")
    ap.add_argument("--do", default="2026-10-29")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    od, do = date.fromisoformat(a.od), date.fromisoformat(a.do)
    rng = random.Random(a.seed)

    mil, rev, ali = [], [], []        # (data, ...) — sortowane przed zapisem
    for y, m in months(od, do):
        # Millennium: karta kredytowa (pusty rodzaj) + debetowa dziecka
        for d, o, k in losuj(rng, MILLENNIUM_KARTA, y, m, od, do):
            mil.append((d, KARTA_MIL, "", "", o, -k, None))
        for d, o, k in losuj(rng, MILLENNIUM_DZIECKO, y, m, od, do):
            mil.append((d, KARTA_DEB, "ZAKUP - FIZ. UŻYCIE KARTY", "", o, -k, None))
        for dz, odb, o, k in MILLENNIUM_STALE:
            d = date(y, m, min(dz, days_in(y, m)))
            if od <= d <= do:
                k = k or round(rng.uniform(160, 290), 2)
                mil.append((d, KONTO_MIL, "PRZELEW ZEWNĘTRZNY WYCHODZĄCY", odb, o, -k, None))
        # wpływy i przepływy własne (wykluczane przez reguły)
        d = date(y, m, min(10, days_in(y, m)))
        if od <= d <= do:
            mil.append((d, KONTO_MIL, "PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY", "ACME SP. Z O.O.", "WYNAGRODZENIE ZA MIESIĄC", None, 11800.00))
            mil.append((d + timedelta(days=1), KONTO_MIL, "PRZELEW WEWNĘTRZNY", "JAN KOWALSKI", "PRZELEW WŁASNY NA REVOLUT", -1500.00, None))
        d = date(y, m, min(25, days_in(y, m)))
        if od <= d <= do:
            mil.append((d, KONTO_MIL, "UZNANIE", "", "CASHBACK ZA ZAKUPY KARTĄ", None, round(rng.uniform(15, 60), 2)))
        rev += losuj(rng, REVOLUT, y, m, od, do)
        ali += losuj(rng, ALIOR, y, m, od, do)

    for ds, plik, o, k in JEDNORAZOWE:
        d = date.fromisoformat(ds)
        if not od <= d <= do:
            continue
        if plik == "mil":
            mil.append((d, KARTA_MIL, "", "", o, -k, None))
        elif plik == "rev":
            rev.append((d, o, k))
        else:
            ali.append((d, o, k))
    # zwrot zakupu (wpływ) w Alior
    ali_zwrot = [(date(2026, 9, 25), "ZWROT TOWARU IKEA WARSZAWA JANKI", 199.00)]

    os.makedirs(os.path.join(DANE, "millennium"), exist_ok=True)
    os.makedirs(os.path.join(DANE, "revolut"), exist_ok=True)
    os.makedirs(os.path.join(DANE, "alior"), exist_ok=True)
    os.makedirs(os.path.join(DANE, "mbank"), exist_ok=True)
    os.makedirs(os.path.join(DANE, "pkobp"), exist_ok=True)

    # --- Millennium CSV (UTF-8 z BOM, przecinek, cudzysłowy) ---
    saldo = 8000.0
    with open(os.path.join(DANE, "millennium", "demo.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(["Numer rachunku/karty", "Data transakcji", "Data rozliczenia", "Rodzaj transakcji",
                    "Na konto/Z konta", "Odbiorca/Zleceniodawca", "Opis", "Obciążenia", "Uznania", "Saldo", "Waluta"])
        for d, nr, rodzaj, odb, o, obc, uzn in sorted(mil, key=lambda r: r[0], reverse=True):
            saldo += (uzn or 0) + (obc or 0)
            w.writerow([nr, d.isoformat(), d.isoformat(), rodzaj, "", odb, o,
                        f"{obc:.2f}" if obc is not None else "", f"{uzn:.2f}" if uzn is not None else "",
                        f"{saldo:.2f}", "PLN"])

    # --- Revolut CSV (format eksportu z aplikacji) ---
    saldo = 600.0
    with open(os.path.join(DANE, "revolut", "demo.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee",
                    "Currency", "State", "Balance"])
        for d, o, k in sorted(rev):
            saldo -= k
            ts = f"{d.isoformat()} {rng.randint(8, 21):02d}:{rng.randint(0, 59):02d}:00"
            w.writerow(["Card Payment", "Current", ts, ts, o, f"{-k:.2f}", "0.00", "PLN", "COMPLETED", f"{saldo:.2f}"])

    # --- Alior CSV (karta kredytowa; 1. wiersz = kryteria, separator ';', przecinek dziesiętny) ---
    with open(os.path.join(DANE, "alior", "demo.csv"), "w", encoding="utf-8-sig", newline="") as f:
        f.write(f"Kryteria transakcji: od {od:%d-%m-%Y} do {do:%d-%m-%Y}\n")
        w = csv.writer(f, delimiter=";")
        w.writerow(["Data transakcji", "Data księgowania", "Nazwa nadawcy", "Nazwa odbiorcy", "Szczegóły transakcji",
                    "Kwota operacji", "Waluta operacji", "Kwota w walucie rachunku", "Waluta rachunku",
                    "Numer rachunku nadawcy", "Numer rachunku odbiorcy"])
        rows = [(d, o, -k) for d, o, k in ali] + ali_zwrot
        for d, o, k in sorted(rows, key=lambda r: r[0], reverse=True):
            kw = f"{k:.2f}".replace(".", ",")
            nad, odb = ("JAN KOWALSKI", o) if k < 0 else (o, "JAN KOWALSKI")
            w.writerow([d.strftime("%d-%m-%Y"), d.strftime("%d-%m-%Y"), nad, odb, o, kw, "PLN", kw, "PLN", "", ""])

    n_mb = zapisz_mbank(random.Random(a.seed + 1), od, do)
    n_pko = zapisz_pkobp(random.Random(a.seed + 2), od, do)
    print(f"Wygenerowano: Millennium {len(mil)}, Revolut {len(rev)}, Alior {len(ali) + len(ali_zwrot)}, "
          f"mBank {n_mb}, PKO BP {n_pko} transakcji ({od} → {do}, seed {a.seed})")


def pl(k):
    """1050.5 → '1 050,50' (format kwot mBank)."""
    return f"{k:,.2f}".replace(",", " ").replace(".", ",")


def zapisz_mbank(rng, od, do):
    ops = []                          # (data_ks, data_op, opis_operacji, tytuł, nadawca/odbiorca, kwota)
    for y, m in months(od, do):
        for d, o, k in losuj(rng, MBANK, y, m, od, do):
            ks = min(d + timedelta(days=1), do)
            ops.append((ks, ks, "ZAKUP PRZY UŻYCIU KARTY", f"{o}   DATA TRANSAKCJI: {d.isoformat()}", "  ", -k))
        for d, o, k in losuj(rng, MBANK_BLIK, y, m, od, do):
            ops.append((d, d, "PŁATNOŚĆ BLIK", f"{o} ZAMÓWIENIE {rng.randint(100000, 999999)}", o, -k))
        d = date(y, m, min(11, days_in(y, m)))
        if od <= d <= do:             # zasilenie z konta głównego (wykluczane regułą „jan kowalski”)
            ops.append((d, d, "PRZELEW WEWNĘTRZNY PRZYCHODZĄCY", "ZASILENIE", "JAN KOWALSKI  UL. ZIELONA 8 M.14 00-001 WARSZAWA", 600.00))
        d = date(y, m, min(28, days_in(y, m)))
        if od <= d <= do:             # przelew własny — parser go pomija
            ops.append((d, d, "PRZELEW WŁASNY", "NA OSZCZĘDNOŚCI", "JAN KOWALSKI", -100.00))
    ops.sort(key=lambda r: r[0])
    uzn = [o for o in ops if o[5] > 0]; obc = [o for o in ops if o[5] < 0]
    saldo0 = 350.00
    with open(os.path.join(DANE, "mbank", "demo.csv"), "w", encoding="utf-8", newline="") as f:
        w = lambda s: f.write(s + "\r\n")
        w("mBank S.A. Bankowość Detaliczna;"); w("\t\tSkrytka Pocztowa 2108;"); w("\t\t90-959 Łódź 2;"); w("")
        w("#Klient;"); w("JAN KOWALSKI;"); w(""); w("Elektroniczne zestawienie operacji;"); w("")
        w("#Za okres:;"); w(f"{od:%d.%m.%Y};{do:%d.%m.%Y};"); w("#Rodzaj rachunku;"); w("EKONTO;"); w("#Waluta;"); w("PLN;")
        w("#Numer rachunku;"); w("00 0000 0000 0000 0000 0000 0001 ;"); w("")
        w("#Podsumowanie obrotów na rachunku;#Liczba operacji;#Wartość operacji")
        w(f"Uznania;{len(uzn)};{pl(sum(o[5] for o in uzn))} PLN;")
        w(f"Obciążenia;{len(obc)};{pl(-sum(o[5] for o in obc))} PLN;"); w("")
        w(f"#Saldo początkowe;{pl(saldo0)} PLN;"); w("")
        w("#Data księgowania;#Data operacji;#Opis operacji;#Tytuł;#Nadawca/Odbiorca;#Numer konta;#Kwota;#Saldo po operacji;")
        saldo = saldo0
        for ks, dop, typ, tyt, kto, k in ops:
            saldo += k
            w(f'{ks.isoformat()};{dop.isoformat()};{typ};"{tyt}";"{kto}";\'\';{pl(k)};{pl(saldo)};')
        w(""); w(f";;;;;;#Saldo końcowe;{pl(saldo)};")
    return len(ops)


def zapisz_pkobp(rng, od, do):
    ops = []                          # (data op., data waluty, typ, kwota, kolumny opisu)
    for y, m in months(od, do):
        for miejsce, miasto, lo, hi, ile in PKO:
            for d, _, k in losuj(rng, [(miejsce, lo, hi, ile)], y, m, od, do):
                ks = min(d + timedelta(days=2), do)
                ops.append((ks, d, "Płatność kartą", -k, [f"Tytuł: 000{rng.randint(100000, 999999)} 7423{rng.randint(10**15, 10**16 - 1)} ",
                            f"Lokalizacja: Adres: {miejsce} Miasto: {miasto} Kraj: POLSKA",
                            f"Data wykonania operacji: {d.isoformat()}", f"Oryginalna kwota operacji: {k:.2f}",
                            "Numer karty: 400000******0000"]))
        for _ in range(2):            # bankomat → kategoria Gotówka
            d = date(y, m, rng.randint(1, days_in(y, m)))
            if od <= d <= do:
                k = float(rng.choice([200, 300, 500]))
                ops.append((d, d, "Wypłata z bankomatu", -k, ["Tytuł: PKO BP 1000000000 0001 ",
                            "Lokalizacja: Adres: UL. MARSZAŁKOWSKA 1 Miasto: WARSZAWA Kraj: POLSKA",
                            f"Data wykonania operacji: {d.isoformat()} 10:15", f"Oryginalna kwota operacji: {k:.2f}",
                            "Numer karty: 400000******0000"]))
        d = date(y, m, min(3, days_in(y, m)))
        if od <= d <= do:
            ops.append((d, d, "Przelew z rachunku", -129.00, ["Rachunek odbiorcy: 00 0000 0000 0000 0000 0000 0002",
                        "Nazwa odbiorcy: BENEFIT SYSTEMS S.A.", "Adres odbiorcy: WARSZAWA", "Tytuł: MULTISPORT KARTA 0001"]))
    zwrot = date(2026, 7, 21)
    if od <= zwrot <= do:
        ops.append((zwrot, zwrot, "Przelew na konto", 1240.00, ["Rachunek nadawcy: 00 0000 0000 0000 0000 0000 0003",
                    "Nazwa nadawcy: URZĄD SKARBOWY WARSZAWA", "Adres nadawcy: WARSZAWA", "Tytuł: ZWROT PODATKU PIT-37 ZA 2025"]))
    ops.sort(key=lambda r: r[0], reverse=True)
    q = lambda v: '"' + str(v).replace('"', '""') + '"'
    saldo = 4200.00
    with open(os.path.join(DANE, "pkobp", "demo.csv"), "w", encoding="utf-8", newline="") as f:
        f.write(",".join(q(x) for x in ["Data operacji", "Data waluty", "Typ transakcji", "Kwota", "Waluta",
                                         "Saldo po transakcji", "Opis transakcji", "", "", "", "", ""]) + "\r\n")
        # blokada (autoryzacja w toku) — parser ją pomija
        f.write(",".join(q(x) for x in ["", do.isoformat(), "Blokada", "-54.20", "PLN", "W rozliczeniu", "Tytuł: P400000000000001  ",
                                         "Lokalizacja: Adres: STOKROTKA NR 0123 Miasto: WARSZAWA Kraj: POLSKA", "", "", "", ""]) + "\r\n")
        for dop, dwal, typ, k, opis in ops:
            kol = (opis + [""] * 6)[:6]
            f.write(",".join(q(x) for x in [dop.isoformat(), dwal.isoformat(), typ, f"{k:+.2f}", "PLN", f"{saldo:+.2f}"] + kol) + "\r\n")
            saldo -= k
    return len(ops)


if __name__ == "__main__":
    main()
