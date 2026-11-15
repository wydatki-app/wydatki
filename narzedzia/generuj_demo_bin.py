#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generator FIKCYJNYCH plików demo w formatach binarnych/obcych (uzupełnia generuj_dane.py):

  demo/dane/velo/demo.pdf     — VeloBank „Historia karty” (PDF jak z wkhtmltopdf: Type0/Identity-H + ToUnicode)
  demo/dane/bnp/demo.xlsx     — BNP Paribas „Zestawienie operacji” (XLSX, daty jako liczby seryjne Excela)
  demo/en/dane/ofx/demo.ofx   — rachunek w USA (OFX 1.x SGML, USD) — demo wersji angielskiej
  demo/en/ustawienia/*.json   — ustawienia demo EN (język, waluta, cel FIRE, budżety)

Bez zależności (stdlib). Stałe ziarno → powtarzalne pliki (ZIP z ustaloną datą, PDF bez dat).
Numery kart/rachunków: zamaskowane albo fikcyjne, bez poprawnej sumy kontrolnej (kontrola.py).

Użycie:  python3 -I narzedzia/generuj_demo_bin.py [--seed 42]
"""
import argparse, io, json, os, random, zipfile, zlib
from datetime import date, timedelta
from xml.sax.saxutils import escape

DEMO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo")
OD, DO = date(2026, 5, 1), date(2026, 10, 29)


def dni(rng, wzorce):
    """(opis, min, max, ile/mc) → posortowana lista (data, opis, kwota) w okresie OD–DO."""
    out, d = [], OD.replace(day=1)
    while d <= DO:
        nast = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
        for opis, lo, hi, ile in wzorce:
            n = int(ile) + (1 if rng.random() < ile - int(ile) else 0)
            for _ in range(n):
                x = d + timedelta(days=rng.randrange((nast - d).days))
                if OD <= x <= DO:
                    out.append((x, opis, round(rng.uniform(lo, hi), 2)))
        d = nast
    return sorted(out)


def pl(k):
    return f"{k:,.2f}".replace(",", " ").replace(".", ",")


# --- VeloBank PDF ---------------------------------------------------------------------------
VELO = [("ŻABKA Z4521, Warszawa, PL", 8, 40, 3), ("LIDL ŁOMIANKI, Łomianki, PL", 40, 180, 1.5),
        ("STACJA ORLEN 4412, Warszawa, PL", 150, 260, 0.6), ("KINO MURANÓW, Warszawa, PL", 30, 60, 0.4)]


def pdf(linie):
    """Linie (y, tekst) → PDF: każdy znak osobnym Td, jak w prawdziwych wyciągach Velo."""
    znaki = sorted({c for _, l in linie for c in l if c != " "})
    cid = {c: i + 1 for i, c in enumerate(znaki)}
    fs, sz = 8, 0.55
    tresc = ["BT", f"/F1 {fs} Tf 1 0 0 -1 0 0 Tm"]
    for y, l in linie:
        x = px = 20.0
        tresc.append(f"1 0 0 -1 0 0 Tm {x} {-y} Td")
        for c in l:
            if c != " ":
                tresc.append(f"{x - px:.4f} 0 Td <{cid[c]:04X}> Tj")
                px = x
            x += sz * fs
    tresc.append("ET")
    strumien = zlib.compress(("0.75 0 0 -0.75 0 842 cm\n" + "\n".join(tresc)).encode("latin-1"), 9)
    cmap = ("/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
            f"{len(znaki)} beginbfchar\n" + "".join(f"<{cid[c]:04X}> <{ord(c):04X}>\n" for c in znaki) +
            "endbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end").encode("latin-1")
    obiekty = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 595 842] >>",
        b"<< /Length " + str(len(strumien)).encode() + b" /Filter /FlateDecode >>\nstream\n" + strumien + b"\nendstream",
        b"<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
        b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /DW 550 /W [1 [" + b" ".join(b"550" for _ in znaki) + b"]] >>",
        b"<< /Length 8 0 R >>\nstream\n" + cmap + b"\nendstream",
        str(len(cmap)).encode(),
    ]
    out = b"%PDF-1.4\n"
    for i, o in enumerate(obiekty, 1):
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    return out + b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"


def velo(rng):
    txs = dni(rng, VELO)[-40:]                             # jedna strona: ostatnie 40 operacji
    linie = [(40, "Historia karty"), (60, "RACHUNEK PROWADZONY NA RZECZ:      JAN KOWALSKI"),
             (100, "DATA        DATA                    KWOTA        SALDO PO")]
    y = 120
    for d, opis, k in reversed(txs):
        dd = d.strftime("%d.%m.%Y")
        linie.append((y, f"{dd}   {dd}   Operacja kartą 1111 **** **** 2222 na kwotę {pl(k)} PLN w {opis}      -{pl(k)} PLN      -"))
        linie.append((y + 12, opis.split(", ")[1] + ", PL"))
        y += 24
    linie.append((y + 10, "Dokument wygenerowany elektronicznie. VeloBank S.A. z siedzibą w Warszawie"))
    return pdf(linie), len(txs)


# --- BNP Paribas XLSX -----------------------------------------------------------------------
BNP_NAGL = ["Data transakcji", "Data zaksięgowania", "Data odrzucenia", "Kwota", "Waluta", "Nadawca", "Odbiorca", "Opis",
            "Produkt", "Typ transakcji", "Kwota zlecenia", "Waluta zlecenia", "Status", "Saldo po transakcji"]
BNP_NR = "12345678901234567890xxxxxx"                     # zamaskowany jak w eksporcie banku, bez sumy kontrolnej
BNP = [("CARREFOUR MARKET", 40, 220, 2), ("DECATHLON", 60, 300, 0.4), ("APTEKA GEMINI", 15, 90, 0.8),
       ("BOLT.EU", 12, 40, 1.5), ("LEROY MERLIN", 50, 400, 0.4)]


def xlsx(wiersze):
    ss, idx, rows = [], {}, []
    for i, w in enumerate(wiersze, 1):
        cells = []
        for j, v in enumerate(w):
            ref = chr(65 + j) + str(i)
            if isinstance(v, (int, float)):
                cells.append(f'<c r="{ref}"><v>{v}</v></c>')
            elif v:
                if v not in idx:
                    idx[v] = len(ss); ss.append(v)
                cells.append(f'<c r="{ref}" t="s"><v>{idx[v]}</v></c>')
        rows.append(f'<row r="{i}">{"".join(cells)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    sheet = f'<?xml version="1.0" encoding="UTF-8"?><worksheet {ns}><sheetData>{"".join(rows)}</sheetData></worksheet>'
    sst = (f'<?xml version="1.0" encoding="UTF-8"?><sst {ns}>'
           + "".join(f'<si><t xml:space="preserve">{escape(x)}</t></si>' for x in ss) + '</sst>')
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        for nazwa, tresc in (("[Content_Types].xml", "<Types/>"), ("xl/sharedStrings.xml", sst), ("xl/worksheets/sheet1.xml", sheet)):
            z.writestr(zipfile.ZipInfo(nazwa, (2026, 10, 30, 0, 0, 0)), tresc, zipfile.ZIP_DEFLATED)   # stała data = powtarzalny plik
    return b.getvalue()


def bnp(rng):
    txs = dni(rng, BNP)
    saldo, wiersze = 4200.0, [BNP_NAGL]
    for d, opis, k in reversed(txs):                       # bank: najnowsze na górze
        seryjna = (d - date(1899, 12, 30)).days
        wiersze.append([seryjna, seryjna, "", -k, "PLN", BNP_NR, opis, opis, "Mastercard Demo\n" + BNP_NR,
                        "Transakcja kartą", -k, "PLN", "Zrealizowana", round(saldo, 2)])
        saldo += k
    return xlsx(wiersze), len(txs)


# --- OFX USD (demo EN) --------------------------------------------------------------------------
US = [("WALMART SUPERCENTER #1234", 35, 160, 4), ("TRADER JOE'S #552", 25, 95, 2), ("STARBUCKS STORE 991", 4, 12, 5),
      ("SHELL OIL 57444", 35, 70, 3), ("AMAZON.COM*MK1234", 12, 140, 2), ("CVS/PHARMACY #7781", 8, 45, 1),
      ("CHIPOTLE 2231", 11, 24, 2), ("UBER *TRIP", 9, 32, 1.5), ("TARGET T-1102", 18, 120, 1.5),
      ("DOORDASH*BURGERS", 18, 45, 1), ("HOME DEPOT #4410", 25, 260, 0.5), ("AMC THEATRES 2201", 14, 40, 0.5)]
US_STALE = [(1, "ACME PROPERTY MGMT RENT", 1650.00), (3, "NETFLIX.COM", 15.49), (5, "SPOTIFY USA", 11.99),
            (8, "COMCAST XFINITY", 89.99), (12, "GEICO AUTO INSURANCE", 118.40), (15, "PLANET FITNESS", 24.99),
            (18, "VERIZON WIRELESS", 72.00), (20, "PG&E UTILITY BILL", 0)]
US_JEDNORAZOWE = [(date(2026, 7, 6), "AIRBNB HMXK21", 980.00), (date(2026, 7, 8), "DELTA AIR LINES", 612.40),
                  (date(2026, 8, 22), "BEST BUY 00123 LAPTOP", 1149.99), (date(2026, 9, 9), "DENTAL CARE ASSOC", 320.00)]


def ofx(rng):
    txs = [(d, o, -k) for d, o, k in dni(rng, US)] + [(d, o, -k) for d, o, k in US_JEDNORAZOWE]
    d = OD
    while d <= DO:
        if d.day == 1:
            txs.append((d, "ACME CORP PAYROLL", 5200.00))      # wykluczone regułą (pensja)
        for dzien, opis, k in US_STALE:
            if d.day == dzien:
                txs.append((d, opis, -(k or round(rng.uniform(60, 140), 2))))
        if d.day == 25:
            txs.append((d, "CASHBACK REWARD", round(rng.uniform(5, 25), 2)))
        d += timedelta(days=1)
    txs.sort()
    st = [f"<STMTTRN><TRNTYPE>{'DEBIT' if k < 0 else 'CREDIT'}<DTPOSTED>{d:%Y%m%d}120000[-5:EST]<TRNAMT>{k:.2f}"
          f"<FITID>DEMO{i:05d}<NAME>{escape(o)}</STMTTRN>" for i, (d, o, k) in enumerate(txs, 1)]
    tekst = ("OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\n"
             "OLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>"
             "<DTSERVER>20261030120000<LANGUAGE>ENG<FI><ORG>DEMO BANK<FID>0000</FI></SONRS></SIGNONMSGSRSV1>\n"
             "<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>USD\n"
             "<BANKACCTFROM><BANKID>000000000<ACCTID>000099990001<ACCTTYPE>CHECKING</BANKACCTFROM>\n"
             f"<BANKTRANLIST><DTSTART>{OD:%Y%m%d}<DTEND>{DO:%Y%m%d}\n" + "\n".join(st) +
             "\n</BANKTRANLIST><LEDGERBAL><BALAMT>4321.00<DTASOF>20261030</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n")
    return tekst, len(txs)


def zapisz(sciezka, dane):
    p = os.path.join(DEMO, sciezka)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb" if isinstance(dane, bytes) else "w", **({} if isinstance(dane, bytes) else {"encoding": "utf-8", "newline": "\n"})) as f:
        f.write(dane)


def main():
    ap = argparse.ArgumentParser(description="Generator fikcyjnych plików demo: PDF Velo, XLSX BNP, OFX USD")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    b_velo, n_velo = velo(random.Random(a.seed + 3))
    b_bnp, n_bnp = bnp(random.Random(a.seed + 4))
    t_ofx, n_ofx = ofx(random.Random(a.seed + 5))
    zapisz("dane/velo/demo.pdf", b_velo)
    zapisz("dane/bnp/demo.xlsx", b_bnp)
    zapisz("en/dane/ofx/demo.ofx", t_ofx)
    zapisz("en/ustawienia/konfiguracja.json", json.dumps(
        {"jezyk": "en", "waluta": "USD", "fire_cel_mc": 6000, "fire_swr": 0.04, "tagi_dzieci": ["Kids"]}, indent=0) + "\n")
    zapisz("en/ustawienia/budzety.json", json.dumps(
        [{"nazwa": "Groceries", "okres": "miesiac", "limit": 700, "kategorie": ["Groceries"], "tagi": []},
         {"nazwa": "Dining out", "okres": "miesiac", "limit": 250, "kategorie": ["Dining_out"], "tagi": []},
         {"nazwa": "Travel", "okres": "rok", "limit": 2500, "kategorie": ["Travel"], "tagi": []}], indent=0) + "\n")
    print(f"OK: VeloBank PDF {n_velo}, BNP XLSX {n_bnp}, OFX USD {n_ofx} transakcji (seed {a.seed})")


if __name__ == "__main__":
    main()
