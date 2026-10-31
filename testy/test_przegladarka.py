#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test aplikacji w przeglądarce (Firefox i Chromium headless): import, dashboard, XSS, zapis ustawień.

Bierze dist/wydatki.html (najpierw: python3 -I build.py), zdejmuje CSP (żeby dołączyć skrypt testowy)
i sprawdza zachowanie aplikacji. Ochrona CSP sprawdzana osobno: test_csp w tym pliku.

Użycie:  python3 -I testy/test_przegladarka.py [--przegladarka firefox|chromium|obie]
Chromium: ~/Downloads/chrome-linux/chrome albo zmienna WYDATKI_CHROMIUM.
"""
import argparse, json, os, re, subprocess, sys, tempfile

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMIUM = os.environ.get("WYDATKI_CHROMIUM", os.path.expanduser("~/Downloads/chrome-linux/chrome"))
ZNACZNIK = "@@TEST@@"

XSS_CSV = ('"Numer rachunku/karty","Data transakcji","Data rozliczenia","Rodzaj transakcji","Na konto/Z konta",'
           '"Odbiorca/Zleceniodawca","Opis","Obciążenia","Uznania","Saldo","Waluta"\n'
           '"X","2026-10-01","2026-10-01","","","","<img id=""xss1"" src=x onerror=""window.PWNED=1"">","-12.00","","0","PLN"\n'
           '"X","2026-10-02","2026-10-02","","","","ZWROT <svg id=""xss4"" onload=""window.PWNED=4"">","","50.00","0","PLN"\n'
           '"X","2026-10-03","2026-10-03","","","","SKLEP ZLY","-30.00","","0","PLN"\n'
           '"X","<b id=""xss5"">2026-10-04</b>","2026-10-04","","","","SKLEP DATA","-40.00","","0","PLN"\n'
           '"X","2026-02-31","2026-02-31","","","","SKLEP LUTY","-5.00","","0","PLN"\n')
XSS_YAML = ('kategorie:\n  Zle<i id="xss2">:\n    - "sklep zly"\n  Inne_nieskategoryzowane: []\n'
            '_tagi:\n  T<s id="xss3">:\n    - "sklep"\n_wplywy:\n  Zwroty:\n    - "zwrot"\n')

# mBank: fikcyjny wyciąg w CP1250 (jak prawdziwy eksport) — test dekodowania i parsera
MBANK_CSV = ("mBank S.A. Bankowość Detaliczna;\r\n\r\n#Klient;\r\nJAN KOWALSKI;\r\n\r\n"
             "#Data księgowania;#Data operacji;#Opis operacji;#Tytuł;#Nadawca/Odbiorca;#Numer konta;#Kwota;#Saldo po operacji;\r\n"
             "2026-09-02;2026-09-02;ZAKUP PRZY UŻYCIU KARTY;\"ŻABKA Z1 /WARSZAWA     DATA TRANSAKCJI: 2026-09-01\";\"  \";'';-9,00;91,00;\r\n"
             "2026-09-06;2026-09-06;PRZELEW WEWNĘTRZNY PRZYCHODZĄCY;\"KIESZONKOWE\";\"ANNA KOWALSKA\";'1';1 050,00;1 141,00;\r\n"
             "2026-09-07;2026-09-07;PRZELEW WŁASNY;\"NA OSZCZĘDNOŚCI\";\"JAN KOWALSKI\";'2';-100,00;1 041,00;\r\n"
             "\r\n;;;;;;#Saldo końcowe;1 041,00;\r\n")
MBANK_BAJTY = list(MBANK_CSV.encode("cp1250"))

# PKO BP: fikcyjne „Zestawienie operacji” w CP1250 — blokada pominięta, PESEL nie trafia do opisu
PKO_CSV = ('"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji","","","","",""\r\n'
           '"","2026-10-31","Blokada","-20.00","PLN","W rozliczeniu","Tytuł: P1  ","Lokalizacja: Adres: SKLEP X Miasto: GDAŃSK Kraj: POLSKA","","","",""\r\n'
           '"2026-10-29","2026-10-27","Płatność kartą","-10.77","PLN","+100.00","Tytuł: 0001 ","Lokalizacja: Adres: APTEKA ŻÓŁTA Miasto: GDAŃSK Kraj: POLSKA","Data wykonania operacji: 2026-10-27","Oryginalna kwota operacji: 10.77","Numer karty: 4000******0000",""\r\n'
           '"2026-10-19","2026-10-19","Przelew na konto","+1500.00","PLN","+110.77","Rachunek nadawcy: 00 0000","Nazwa nadawcy: FIRMA SP. Z O.O.","Adres nadawcy: Gdańsk","Tytuł: Wynagrodzenie","",""\r\n'
           '"2026-10-13","2026-10-13","Przelew podatkowy","-151.00","PLN","+90.00","Rachunek odbiorcy: 00 0000","Nazwa odbiorcy: URZĄD SKARBOWY","Adres odbiorcy: CENTRUM","Nazwa i nr identyfikatora: PESEL, 99999999999","Symbol formularza: PPE","Okres płatności: 26M09"\r\n')
PKO_BAJTY = list(PKO_CSV.encode("cp1250"))


def velo_pdf():
    """Fikcyjny wyciąg VeloBank jak z wkhtmltopdf: font Type0/Identity-H + ToUnicode, treść FlateDecode,
    każdy znak osobnym Td (tak jak w prawdziwych plikach). Posiadacz: JAN KOWALSKI."""
    import zlib
    linie = [
        (40, "Historia rachunku"),
        (60, "RACHUNEK PROWADZONY NA RZECZ:      JAN KOWALSKI"),
        (100, "DATA        DATA                    KWOTA        SALDO PO"),
        (120, "15.09.2026   16.09.2026   Operacja kartą 1111 **** **** 2222 na kwotę 12,50 PLN w ŻABKA Z1, Gdańsk, PL      -12,50 PLN      0,00"),
        (132, "Gdańsk, PL"),
        (144, "16.09.2026   16.09.2026   Operacja kartą 1111 **** **** 2222 na kwotę 7,00 PLN w JAN KOWALSKI-Sopot-KIOSK RUCH-616      -7,00 PLN      0,00"),
        (156, "17.09.2026   17.09.2026   Przelew z rachunku: 00 1111,      1 200,00 PLN      0,00"),
        (168, "Nadawca: KOWALSKI JAN,"),
        (180, "Tytuł: spłata karty kredytowej"),
        (200, "Dokument wygenerowany elektronicznie. VeloBank S.A. z siedzibą w Warszawie"),
    ]
    znaki = sorted({c for _, l in linie for c in l if c != " "})
    cid = {c: i + 1 for i, c in enumerate(znaki)}
    fs, sz = 8, 0.55                                  # rozmiar fontu, szerokość znaku (em)
    tresc = ["BT", f"/F1 {fs} Tf 1 0 0 -1 0 0 Tm"]
    for y, l in linie:
        x0, x = 20.0, 20.0
        tresc.append(f"1 0 0 -1 0 0 Tm {x0} {-y} Td")
        px = x0
        for c in l:
            if c != " ":
                tresc.append(f"{x - px:.4f} 0 Td <{cid[c]:04X}> Tj")
                px = x
            x += sz * fs
    tresc.append("ET")
    strumien = zlib.compress(("0.75 0 0 -0.75 0 842 cm\n" + "\n".join(tresc)).encode("latin-1"))
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

def pdf_z(obiekty):
    out = b"%PDF-1.4\n"
    for i, o in enumerate(obiekty, 1):
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    return out + b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"


def zle_pdf():
    """Złośliwe PDF-y (DoS czytnika): bomba deflate, ogromne zakresy w fontach, cykl w drzewie stron."""
    import zlib
    strona = b"<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
    font = b"<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>"
    tresc = zlib.compress(b"BT /F1 8 Tf 10 10 Td <0001> Tj ET")
    cmap_zakres = b"1 begincodespacerange <0000> <FFFF> endcodespacerange\n1 beginbfrange\n<0000> <FFFFFFFF> <0041>\nendbfrange"
    def strumien(dane, flate=True):
        return (b"<< /Length " + str(len(dane)).encode() + (b" /Filter /FlateDecode" if flate else b"")
                + b" >>\nstream\n" + dane + b"\nendstream")
    bomba = zlib.compress(b" " * (60 * 1024 * 1024), 9)        # ~60 KB → 60 MB po dekompresji
    return {
        "bomba": pdf_z([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", strona,
                        strumien(bomba), font, b"<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>", strumien(cmap_zakres, False)]),
        "zakresy": pdf_z([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", strona,
                          strumien(tresc), font, b"<< /Type /Font /Subtype /CIDFontType2 /W [1 4294967295 550] >>",
                          strumien(cmap_zakres, False)]),
        "cykl": pdf_z([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [8 0 R 8 0 R] /Count 1 >>", strona,
                       strumien(tresc), font, b"<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>", strumien(cmap_zakres, False),
                       b"<< /Type /Pages /Parent 2 0 R /Kids [8 0 R 8 0 R 3 0 R] /Count 1 >>"]),
    }


# wynik testu: Firefox → window.dump na stdout; Chromium → base64 w DOM (czytany z --dump-dom)
WYPISZ = r"""
function wypisz(obj) {
  const t = "@@TEST@@" + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))) + "@@TEST@@";
  if (window.dump) window.dump(t + "\n");
  const pre = document.createElement("pre"); pre.textContent = t; document.body.appendChild(pre);
}
"""

TEST = r"""
(async () => {
  const wyn = [], ok = (nazwa, war) => wyn.push([nazwa, !!war]);
  // dashboard renderuje po kilku await (atrapa API = mikrozadania); setTimeout odpada — Firefox
  // z --screenshot kończy po zdarzeniu load, a mikrozadania wykonują się przed nim
  const czekaj = async () => { for (let i = 0; i < 100; i++) await null; };
  try {
    localStorage.clear();
    // 1. demo: import i dashboard
    await W.app.uruchom("demo", W.DEMO); await czekaj();
    ok("demo: dashboard widoczny", !document.getElementById("app").hidden && document.querySelector("#app .kpi"));
    const dt = document.getElementById("app").textContent;
    ok("demo: Millennium 384 tr. (dane bez zmian)", dt.includes("Millennium: 1 pl. / 384 tr."));
    ok("demo: mBank i PKO BP w demo", /mBank: 1 pl\. \/ \d+ tr\./.test(dt) && /PKO BP: 1 pl\. \/ \d+ tr\./.test(dt));
    ok("demo: informacja o VeloBank (PDF)", dt.includes("VeloBank: w demo brak przykładu") && dt.includes("dane/velo/"));

    // 1b. mBank: plik w CP1250 (File), dekodowanie + parser; przelew własny pominięty
    const mb = new File([new Uint8Array(MBANK_BAJTY)], "mbank.csv");
    await W.app.uruchom("mbank", [{sciezka: "m/dane/mbank/mbank.csv", plik: mb}]); await czekaj();
    const mt = document.getElementById("app").textContent;
    ok("mbank: rozpoznany, 2 operacje", mt.includes("mBank: 1 pl. / 2 tr."));
    ok("mbank: polskie znaki po CP1250", mt.includes("ŻABKA") && !mt.includes("\ufffd"));
    const pkoTx = W.banki.pkobp(new TextDecoder("windows-1250").decode(new Uint8Array(PKO_BAJTY)));
    ok("pkobp: blokada pominięta, 3 operacje", pkoTx.length === 3);
    ok("pkobp: karta — data wykonania, miejsce", pkoTx[0].data === "2026-10-27" && pkoTx[0].opis === "APTEKA ŻÓŁTA GDAŃSK" && pkoTx[0].obc === 10.77);
    ok("pkobp: przelew — tytuł i nadawca", pkoTx[1].uzn === 1500 && pkoTx[1].odb === "FIRMA SP. Z O.O." && pkoTx[1].opis.includes("Wynagrodzenie"));
    ok("pkobp: PESEL nie trafia do opisu", !/99999999999/.test(pkoTx[2].text) && pkoTx[2].opis === "Przelew podatkowy PPE 26M09");
    await W.app.uruchom("pko", [{sciezka: "p/dane/pkobp/z.csv", plik: new File([new Uint8Array(PKO_BAJTY)], "z.csv")}]); await czekaj();
    ok("pkobp: import pliku w aplikacji", document.getElementById("app").textContent.includes("PKO BP: 1 pl. / 3 tr."));

    // 1c. VeloBank PDF: czytnik W.pdf + parser; prefiks posiadacza zdjęty, spłata karty = wpływ wykluczany regułą
    const vp = new File([new Uint8Array(VELO_BAJTY)], "velo.pdf");
    const vt = await W.pdf.tekst(await vp.arrayBuffer());
    const vtx = W.banki.velo(vt);
    ok("velo: PDF rozpoznany", W.banki.rozpoznaj(vt) === "velo");
    ok("velo: 3 operacje, kwoty", vtx.length === 3 && vtx[0].obc === 12.5 && vtx[2].uzn === 1200);
    ok("velo: merchant i polskie znaki", vtx[0].opis === "ŻABKA Z1, Gdańsk, PL");
    ok("velo: prefiks posiadacza zdjęty", vtx[1].opis === "KIOSK RUCH");
    await W.app.uruchom("velo", [{sciezka: "v/dane/velo/velo.pdf", plik: vp}]); await czekaj();
    ok("velo: import pliku w aplikacji", document.getElementById("app").textContent.includes("VeloBank: 1 pl. / 3 tr."));
    // 2. XSS: opis transakcji, nazwa kategorii (yaml), tag z reguły, opis wpływu
    await W.app.uruchom("xss", [{sciezka: "x/dane/millennium/a.csv", tekst: XSS_CSV},
                                {sciezka: "x/ustawienia/kategorie.yaml", tekst: XSS_YAML}]);
    await czekaj();
    ok("xss: dashboard wyrenderowany", document.querySelector("#app .kpi"));
    document.querySelectorAll("#app [data-v]").forEach(el => el.click());     // wyrenderuj wszystkie widoki
    await czekaj();
    const app = document.getElementById("app");
    ok("xss: brak <img id=xss1>", !document.getElementById("xss1"));
    ok("xss: brak <i id=xss2> (kategoria)", !document.getElementById("xss2"));
    ok("xss: brak <s id=xss3> (tag)", !document.getElementById("xss3"));
    ok("xss: brak <svg id=xss4> (wpływ)", !document.getElementById("xss4"));
    ok("xss: skrypt nie wykonany", !window.PWNED);
    ok("xss: opis widoczny jako tekst", app.textContent.includes('<img id="xss1"'));
    ok("xss: brak <b id=xss5> (data)", !document.getElementById("xss5"));
    // budżet na kategorię z „<” w nazwie: API odrzuca (TXT_RE), stan wraca, nazwa nie trafia do HTML
    const alertOrg = window.alert; window.alert = () => {};
    document.querySelector('#app [data-v="budzety"]')?.click(); await czekaj();
    const bz = document.getElementById("bud-z");
    if (bz) {
      document.getElementById("bud-n").value = "Test"; document.getElementById("bud-l").value = "100";
      bz.value = [...bz.options].map(o => o.value).find(v => v.startsWith("k:Zle")) || "";
      document.getElementById("bud-add").click(); await czekaj();
    }
    window.alert = alertOrg;
    ok("xss: budżet z kategorią <i> — opcja istnieje", bz && bz.value.startsWith("k:Zle"));
    ok("xss: budżet z kategorią <i> — brak <i id=xss2>, budżet odrzucony", !document.getElementById("xss2")
       && !document.getElementById("budzety").textContent.includes("Test"));
    ok("data: błędne wiersze pominięte (ładunek, 31 lutego)", !app.textContent.includes("SKLEP DATA") && !app.textContent.includes("SKLEP LUTY")
       && app.textContent.includes("Pominięte wiersze z błędną datą: x/dane/millennium/a.csv (2)"));
    ok("data: walidator", W.model.poprawnaData("2026-10-31") && !W.model.poprawnaData("2026-02-29") && W.model.poprawnaData("2028-02-29")
       && !W.model.poprawnaData("2026-13-01") && !W.model.poprawnaData(" 2026-10-31") && !W.model.poprawnaData(null));
    // 2a. ReDoS: długie pola z pliku nie mogą zawiesić parsera
    let t1 = performance.now();
    const kwotaDl = W.model.parseAmount("1".repeat(200000) + "x");
    const pkoDl = W.banki.pkobp('"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji"\r\n'
      + '"2026-10-29","2026-10-29","Płatność kartą","-1.00","PLN","+1.00","Lokalizacja: Adres: X' + " ".repeat(200000) + 'y"\r\n');
    ok(`redos: długa kwota i lokalizacja PKO < 1 s (${Math.round(performance.now() - t1)} ms)`,
       kwotaDl === null && pkoDl.length === 1 && performance.now() - t1 < 1000);
    // 2b. złośliwe PDF-y: ma się skończyć szybko — wyjątkiem (pominięty plik) albo tekstem, bez zawieszenia
    for (const [nazwa, bajty] of Object.entries(ZLE_PDF)) {
      const t0 = performance.now();
      let wynik;
      try { wynik = await W.pdf.tekst(new Uint8Array(bajty)); } catch (e) { wynik = "wyjątek: " + e.message; }
      const ms = Math.round(performance.now() - t0);
      ok(`pdf ${nazwa}: obsłużony w ${ms} ms (< 5 s)`, ms < 5000 && wynik != null);
      if (nazwa === "bomba") ok("pdf bomba: odrzucona limitem", String(wynik).includes("limit 50 MB"));
    }
    // 3. magazyn: walidacja i zapis kopii w przeglądarce
    let r = await W.api("/api/tagi", {method: "POST", body: JSON.stringify({"a|b|1.0": ["<b>"]})});
    ok("api: zły tag odrzucony (400)", r.status === 400);
    r = await W.api("/api/tagi", {method: "POST", body: JSON.stringify({"a|b|1.0": ["Wakacje 2026"]})});
    ok("api: dobry tag zapisany", r.ok && (await (await W.api("/api/tagi")).json())["a|b|1.0"][0] === "Wakacje_2026");
    r = await W.api("/api/budzety", {method: "POST", body: JSON.stringify([{nazwa: "<x>", okres: "rok", limit: 1, tagi: ["a"]}])});
    ok("api: zła nazwa budżetu odrzucona", r.status === 400);
    // 2b. przypomnienie o kopii (profil bez dostępu do folderu = Firefox/Safari)
    const kb = document.getElementById("imp-kopia");
    ok("kopia: baner po 1 zmianie", !kb.hidden && kb.textContent.includes("1 zmiana bez kopii"));
    ok("kopia: 1 zmiana = jeszcze nie pilne", !kb.classList.contains("pilne"));
    for (let i = 0; i < 9; i++) await W.api("/api/tagi", {method: "POST", body: JSON.stringify({"a|b|1.0": ["T" + i]})});
    ok("kopia: 10 zmian = pilne", kb.classList.contains("pilne") && kb.textContent.includes("10 zmian bez kopii"));
    W.magazyn.oznaczKopie(); await W.magazyn.poZapisie("tagi");
    ok("kopia: po zapisaniu kopii baner znika", kb.hidden);
    const kl = JSON.parse(localStorage.getItem(W.magazyn.klucz));
    ok("kopia: licznik i data kopii w localStorage", kl.bezKopii === 0 && !!kl.ostatniaKopia);
    await W.api("/api/tagi", {method: "POST", body: JSON.stringify({"a|b|1.0": ["Wakacje 2026"]})});
    W.magazyn.pierwszaBezKopii = new Date(Date.now() - 4 * 864e5).toISOString();
    await W.magazyn.poZapisie("tagi");
    ok("kopia: 4 dni bez kopii = pilne", kb.classList.contains("pilne") && kb.textContent.includes("4 dn.") && !kb.textContent.includes("nigdy"));
    ok("magazyn: kopia w localStorage", W.magazyn.wczytaj("xss", {}, []) === "przegladarka");
    ok("magazyn: osobny profil demo", W.magazyn.wczytaj("demo", {}, []) === "folder");

    // 4. zapis do folderu (Chrome: File System Access API) — atrapa folderu w pamięci
    const folder = (nazwa, drzewo) => ({
      kind: "directory", name: nazwa, _d: drzewo,
      async *values() { for (const [n, v] of Object.entries(drzewo))
        yield typeof v === "object" && !("tekst" in v) ? folder(n, v) : plikH(drzewo, n); },
      async getDirectoryHandle(n, o) { if (!drzewo[n]) { if (!o || !o.create) throw new Error("brak"); drzewo[n] = {}; } return folder(n, drzewo[n]); },
      async getFileHandle(n, o) { if (!drzewo[n]) { if (!o || !o.create) throw new Error("brak"); drzewo[n] = {tekst: "", czas: 0}; } return plikH(drzewo, n); },
      async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
    });
    const plikH = (dir, n) => ({ kind: "file", name: n,
      async getFile() { const f = dir[n]; return {name: n, size: f.tekst.length, lastModified: f.czas, text: async () => f.tekst, arrayBuffer: async () => new TextEncoder().encode(f.tekst).buffer}; },
      async createWritable() { let buf = ""; return { async write(t) { buf += t; }, async close() { dir[n] = {tekst: buf, czas: Date.now()}; } }; } });
    const csvDemo = W.DEMO.find(p => p.sciezka.endsWith("millennium/demo.csv")).tekst;

    localStorage.clear();
    const drzewoA = { dane: { millennium: { "a.csv": {tekst: csvDemo, czas: 1000} } }, ustawienia: { "tagi.json": {tekst: "{}", czas: 1000} } };
    await W.app.uruchomZUchwytu(folder("MojFolder", drzewoA)); await czekaj();
    await W.api("/api/tagi", {method: "POST", body: JSON.stringify({"a|b|1.0": ["Wakacje 2026", "-AI"], "x": ["T"]})});
    await czekaj();
    ok("folder: tagi.json zapisany w ustawienia/", drzewoA.ustawienia["tagi.json"].tekst === OCZEK_TAGI + "\n");
    ok("folder: format JSON jak Python (indent=0)", W.magazyn.jsonPython({"a|b|1.0": ["Wakacje_2026", "-AI"], "x": ["T"]}) === OCZEK_TAGI);
    ok("folder: kopia w przeglądarce usunięta po zapisie", !localStorage.getItem("wydatki_web_ustawienia_v1:MojFolder"));
    ok("folder: pasek pokazuje zapis do folderu", document.getElementById("imp-zapis").textContent.includes("w folderze ✓"));
    await W.api("/api/budzety", {method: "POST", body: JSON.stringify([{nazwa: "Test", okres: "rok", limit: 100, tagi: ["T"]}])});
    await czekaj();
    ok("folder: nowy plik budzety.json → ustawienia/", !!drzewoA.ustawienia["budzety.json"]);

    // układ wersji Python: ustawienia w katalogu głównym → zapis w tym samym miejscu
    const drzewoB = { "Historia_transakcji_1.csv": {tekst: csvDemo, czas: 1000}, "override.json": {tekst: "{}", czas: 1000} };
    await W.app.uruchomZUchwytu(folder("wydatki", drzewoB)); await czekaj();
    await W.api("/api/kategorie", {method: "POST", body: JSON.stringify({"id1": "Zakupy"})});
    await czekaj();
    ok("folder Python: override.json nadpisany w miejscu", drzewoB["override.json"].tekst.includes('"id1": "Zakupy"') && !drzewoB.ustawienia);

    // folder z kopią zapasową: _backup/override.json NIE jest czytany ani nadpisywany
    const drzewoC = { "_backup": { "override.json": {tekst: '{"stary": "Z_backupu"}', czas: 1}, "x.csv": {tekst: csvDemo, czas: 1} },
                      "Historia_transakcji_1.csv": {tekst: csvDemo, czas: 1000}, "override.json": {tekst: '{"id0": "Zakupy"}', czas: 1000} };
    await W.app.uruchomZUchwytu(folder("wydatki", drzewoC)); await czekaj();
    ok("backup: ustawienia z folderu głównego, nie z _backup", W.magazyn.stan.override.id0 === "Zakupy" && !W.magazyn.stan.override.stary);
    await W.api("/api/kategorie", {method: "POST", body: JSON.stringify({"id0": "Zakupy", "id2": "Transport"})});
    await czekaj();
    ok("backup: zapis do głównego override.json", drzewoC["override.json"].tekst.includes('"id2": "Transport"'));
    ok("backup: _backup/override.json nietknięty", drzewoC._backup["override.json"].tekst === '{"stary": "Z_backupu"}');
    ok("backup: CSV z _backup pominięty, ostrzeżenie w pasku", document.getElementById("app").textContent.includes("foldery _backup"));

    // 5. pierwszeństwo: nowsza wygrywa (kopia przeglądarki vs folder)
    localStorage.setItem("wydatki_web_ustawienia_v1:P", JSON.stringify({stan: {tagi: {"k": ["Z_kopii"]}}, zmieniono: "2026-10-01T00:00:00Z"}));
    ok("pierwszeństwo: kopia nowsza niż pliki → kopia",
       W.magazyn.wczytaj("P", {"tagi.json": '{"k":["Z_folderu"]}'}, [], Date.parse("2026-09-01")) === "przegladarka" && W.magazyn.stan.tagi.k[0] === "Z_kopii");
    ok("pierwszeństwo: pliki nowsze niż kopia → folder",
       W.magazyn.wczytaj("P", {"tagi.json": '{"k":["Z_folderu"]}'}, [], Date.parse("2026-10-05")) === "folder" && W.magazyn.stan.tagi.k[0] === "Z_folderu");

    // 6. eksport → pakiet w folderze (Safari/Firefox); kilka pobrań → najnowszy
    W.magazyn.stan.tagi = {"k": ["Z_pakietu"]};
    const pak = W.magazyn.eksport(), pakStary = JSON.stringify({...JSON.parse(pak), zapisano: "2020-01-01T00:00:00Z", tagi: {"k": ["Stary"]}});
    localStorage.clear();
    await W.app.uruchom("Q", [{sciezka: "Q/dane/a.csv", tekst: csvDemo}, {sciezka: "Q/ustawienia/tagi.json", tekst: '{"k":["Z_pliku"]}'},
                              {sciezka: "Q/ustawienia/wydatki-ustawienia.json", tekst: pakStary},
                              {sciezka: "Q/ustawienia/wydatki-ustawienia (1).json", tekst: pak}]);
    await czekaj();
    ok("eksport: pakiet (najnowszy) nadpisuje pliki", W.magazyn.stan.tagi.k && W.magazyn.stan.tagi.k[0] === "Z_pakietu");
    ok("eksport: przycisk widoczny bez dostępu do folderu", !!document.getElementById("imp-eksport"));
    // 4. wyczyszczenie danych z przeglądarki: tylko klucze aplikacji + baza IndexedDB, z ostrzeżeniem o braku kopii
    ok("wyczyść: przycisk w pasku", !!document.getElementById("imp-wyczysc"));
    localStorage.setItem("inna_aplikacja", "x"); localStorage.setItem("theme", "dark");
    localStorage.setItem("wydatki_web_ustawienia_v1:Prywatny", JSON.stringify({ stan: {}, zmieniono: "2026-10-31T10:00:00Z", bezKopii: 3 }));
    // atrapa IndexedDB: Firefox z --screenshot kończy po „load”, a prawdziwe IDB odpowiada makrozadaniami
    const idbOrg = Object.getOwnPropertyDescriptor(window, "indexedDB") || Object.getOwnPropertyDescriptor(Window.prototype, "indexedDB");
    let usunietaBaza = null;
    Object.defineProperty(window, "indexedDB", { configurable: true, value: { deleteDatabase(n) {
      usunietaBaza = n; const r = {}; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r; } } });
    const confirmOrg = window.confirm; let pytanie = "";
    window.confirm = q => { pytanie = q; return false; };
    ok("wyczyść: anulowanie niczego nie usuwa", (await W.app.wyczyscDane({ przeladuj: false })) === false
       && localStorage.getItem("wydatki_web_ustawienia_v1:Prywatny"));
    ok("wyczyść: ostrzeżenie o zmianach bez kopii", W.app.zmianyBezKopii() >= 3 && /zmian\S* bez kopii — przepadnie/.test(pytanie));
    window.confirm = () => true;
    ok("wyczyść: potwierdzone", await W.app.wyczyscDane({ przeladuj: false }));
    window.confirm = confirmOrg;
    ok("wyczyść: brak kluczy aplikacji", !Object.keys(localStorage).some(k => k.startsWith("wydatki")));
    ok("wyczyść: cudze klucze i motyw zostają", localStorage.getItem("inna_aplikacja") === "x" && localStorage.getItem("theme") === "dark");
    delete window.indexedDB; if (idbOrg && !("indexedDB" in window)) Object.defineProperty(window, "indexedDB", idbOrg);
    ok("wyczyść: baza IndexedDB „wydatki” (zapamiętany folder) usuwana", usunietaBaza === "wydatki");
    localStorage.removeItem("inna_aplikacja"); localStorage.removeItem("theme");
  } catch (e) { wyn.push(["wyjątek: " + e + " " + e.stack, false]); }
  if (/Chrome\//.test(navigator.userAgent))
    ok("chromium: showDirectoryPicker dostępne na file://", typeof window.showDirectoryPicker === "function");
  wypisz(wyn);
})();
"""


def uruchom(przegladarka, strona, tmp):
    if przegladarka == "firefox":
        prof = os.path.join(tmp, "profil-ff")
        os.makedirs(prof, exist_ok=True)
        with open(os.path.join(prof, "user.js"), "w") as f:
            f.write('user_pref("browser.dom.window.dump.enabled", true);\n')
        cmd = ["firefox", "--headless", "--no-remote", "--profile", prof,
               "--screenshot", os.path.join(tmp, "x.png"), "file://" + strona]
    else:
        cmd = [CHROMIUM, "--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + os.path.join(tmp, "profil-ch"),
               "--virtual-time-budget=10000", "--dump-dom", "file://" + strona]
    # ścieżka przeglądarki z WYDATKI_CHROMIUM ustawia sam uruchamiający testy; lista argumentów, bez powłoki
    return subprocess.run(cmd, capture_output=True, text=True, timeout=180).stdout  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args


def wynik(out):
    # --dump-dom zawiera też źródło skryptu ze znacznikiem — bierzemy tylko blok base64
    m = re.search(ZNACZNIK + r"([A-Za-z0-9+/=]+)" + ZNACZNIK, out)
    if not m:
        return None
    import base64
    return json.loads(base64.b64decode(m.group(1)).decode("utf-8"))


def test(przegladarka, html, test_js):
    bez_csp = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', "", html, count=1)
    with tempfile.TemporaryDirectory() as tmp:
        strona = os.path.join(tmp, "t.html")
        with open(strona, "w", encoding="utf-8") as f:
            f.write(bez_csp.replace("</body>", f"<script>{WYPISZ}{test_js}</script></body>"))
        out = uruchom(przegladarka, strona, tmp)
        # test CSP: oryginalny plik + wstrzyknięty skrypt bez hasha → NIE może się wykonać
        csp = os.path.join(tmp, "csp.html")
        with open(csp, "w", encoding="utf-8") as f:
            f.write(html.replace("</body>", f'<script>{WYPISZ}wypisz([["csp: obcy skrypt WYKONANY", false]]);</script></body>'))
        out_csp = uruchom(przegladarka, csp, tmp)
    wyn = wynik(out)
    if wyn is None:
        return [[f"brak wyniku z przeglądarki: {out[-300:]!r}", False]]
    wyn.append(["csp: obcy skrypt zablokowany", wynik(out_csp) is None])
    return wyn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--przegladarka", choices=["firefox", "chromium", "obie"], default="obie")
    a = ap.parse_args()
    lista = ["firefox", "chromium"] if a.przegladarka == "obie" else [a.przegladarka]
    if "chromium" in lista and not os.path.exists(CHROMIUM):
        print(f"(pomijam Chromium — brak {CHROMIUM})")
        lista.remove("chromium")
    html = open(os.path.join(WEB, "dist", "wydatki.html"), encoding="utf-8").read()
    # oczekiwany format = json.dump(indent=0) z serwer.py
    oczek = json.dumps({"a|b|1.0": ["Wakacje_2026", "-AI"], "x": ["T"]}, ensure_ascii=False, indent=0)
    test_js = (f"const XSS_CSV = {json.dumps(XSS_CSV)}; const XSS_YAML = {json.dumps(XSS_YAML)}; "
               f"const OCZEK_TAGI = {json.dumps(oczek)}; const MBANK_BAJTY = {json.dumps(MBANK_BAJTY)}; const VELO_BAJTY = {json.dumps(list(velo_pdf()))}; const PKO_BAJTY = {json.dumps(PKO_BAJTY)}; "
               f"const ZLE_PDF = {json.dumps({k: list(v) for k, v in zle_pdf().items()})};\n" + TEST)
    zle = 0
    for p in lista:
        wyn = test(p, html, test_js)
        print(f"[{p}]")
        for nazwa, ok in wyn:
            print(f"  {'✓' if ok else '✗'} {nazwa}")
        zle += sum(1 for _, ok in wyn if not ok)
    print("WYNIK:", "PASS" if not zle else f"FAIL ({zle})")
    sys.exit(1 if zle else 0)


if __name__ == "__main__":
    main()
