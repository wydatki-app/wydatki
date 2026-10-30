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
           '"X","2026-10-03","2026-10-03","","","","SKLEP ZLY","-30.00","","0","PLN"\n')
XSS_YAML = ('kategorie:\n  Zle<i id="xss2">:\n    - "sklep zly"\n  Inne_nieskategoryzowane: []\n'
            '_tagi:\n  T<s id="xss3">:\n    - "sklep"\n_wplywy:\n  Zwroty:\n    - "zwrot"\n')

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
    ok("demo: 480 wydatków", document.getElementById("app").textContent.includes("Millennium: 1 pl. / 384 tr."));
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
    // 3. magazyn: walidacja i zapis kopii w przeglądarce
    let r = await W.api("/api/tagi", {method: "POST", body: JSON.stringify({"a|b|1.0": ["<b>"]})});
    ok("api: zły tag odrzucony (400)", r.status === 400);
    r = await W.api("/api/tagi", {method: "POST", body: JSON.stringify({"a|b|1.0": ["Wakacje 2026"]})});
    ok("api: dobry tag zapisany", r.ok && (await (await W.api("/api/tagi")).json())["a|b|1.0"][0] === "Wakacje_2026");
    r = await W.api("/api/budzety", {method: "POST", body: JSON.stringify([{nazwa: "<x>", okres: "rok", limit: 1, tagi: ["a"]}])});
    ok("api: zła nazwa budżetu odrzucona", r.status === 400);
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
      async getFile() { const f = dir[n]; return {name: n, size: f.tekst.length, lastModified: f.czas, text: async () => f.tekst}; },
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
    return subprocess.run(cmd, capture_output=True, text=True, timeout=180).stdout


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
               f"const OCZEK_TAGI = {json.dumps(oczek)};\n" + TEST)
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
