// Aplikacja: ekran startowy (wybór folderu / demo) → import → dashboard → zapis ustawień.
// Pliki są czytane w przeglądarce (File API) — nic nie jest wysyłane.
// Zapis: Chrome/Edge — do folderu (File System Access API, za zgodą użytkownika);
//        Safari/Firefox — kopia w przeglądarce + „Zapisz kopię ustawień” (pobranie pliku).
(function (W) {
  "use strict";

  const MAX_PLIK = 30 * 1024 * 1024;
  const PALETA = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948",
                  "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#86bcb6", "#d37295",
                  "#a0cbe8", "#ffbe7d", "#8cd17d", "#f1ce63", "#d4a6c8", "#d7b5a6"];
  const M = W.magazyn;
  const PLIKI_USTAWIEN = new Set(["kategorie.yaml", "kategorie.yml", "konfiguracja.json", ...Object.values(M.PLIKI)]);
  const PAKIET_RE = /^wydatki-ustawienia( ?\(\d+\))?\.json$/;    // pobrany kilka razy: "… (1).json"
  const NAZWY_BANKOW = { millennium: "Millennium", velo: "VeloBank", revolut: "Revolut", alior: "Alior", mbank: "mBank", pkobp: "PKO BP", bnp: "BNP Paribas", ofx: "OFX/QFX" };
  const $ = id => document.getElementById(id);
  const escH = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const nazwaPliku = p => p.split("/").pop();
  const FS_API = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const t = W.t, tH = W.tH, I = W.i18n;

  // ostatnie źródło: {profil, wpisy, uchwyt?, sciezkiUstawien} — do przeliczenia i zapisu
  let ostatni = null;

  // --- zbieranie plików ---------------------------------------------------------------
  // ścieżka względem folderu głównego (gdy wszystkie wpisy mają wspólny pierwszy segment)
  function wzgledne(wpisy) {
    const pierwsze = new Set(wpisy.map(w => (w.sciezka.includes("/") ? w.sciezka.split("/")[0] : "")));
    const zFolderu = pierwsze.size === 1 && !pierwsze.has("");
    return w => (zFolderu ? w.sciezka.split("/").slice(1) : w.sciezka.split("/"));
  }

  // wpis: {sciezka, plik: File} albo {sciezka, tekst} (demo); sciezka zaczyna się od nazwy folderu.
  // Foldery "_…" i ".…" (np. _backup) są pomijane w całości. Ustawienia tylko z folderu głównego
  // albo z ustawienia/ — inaczej stara kopia z podfolderu mogłaby zostać wczytana i nadpisana.
  // UTF-8 (z BOM lub bez), a gdy bajty nie są poprawnym UTF-8 — Windows-1250 (eksport mBank)
  async function dekoduj(plik) {
    const buf = await plik.arrayBuffer();
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder("windows-1250").decode(buf); }
  }

  async function czytajWpisy(wpisy) {
    const dane = [], ustawienia = {}, sciezki = {}, pominiete = [], pominieteFoldery = new Set();
    const rel = wzgledne(wpisy);
    let czas = 0, pakietCzas = -1;
    for (let w of wpisy) {
      // demo: PDF/XLSX osadzone jako base64 → File, dalej ta sama ścieżka co prawdziwy plik z dysku
      if (typeof w.b64 === "string") w = { sciezka: w.sciezka, plik: new File([Uint8Array.from(atob(w.b64), c => c.charCodeAt(0))], nazwaPliku(w.sciezka)) };
      const czesci = rel(w), foldery = czesci.slice(0, -1);
      const ukryty = foldery.find(f => f.startsWith("_") || f.startsWith("."));
      if (ukryty) { pominieteFoldery.add(ukryty); continue; }
      const nazwa = nazwaPliku(w.sciezka), mala = nazwa.toLowerCase();
      const pakiet = PAKIET_RE.test(mala);
      const miejsceUstawien = foldery.length === 0 || (foldery.length === 1 && foldery[0].toLowerCase() === "ustawienia");
      const wUstawieniach = (PLIKI_USTAWIEN.has(mala) || pakiet) && miejsceUstawien;
      const pdf = !wUstawieniach && mala.endsWith(".pdf");
      const xlsx = !wUstawieniach && mala.endsWith(".xlsx");
      if (!wUstawieniach && !pdf && !xlsx && !mala.endsWith(".csv") && !mala.endsWith(".ofx") && !mala.endsWith(".qfx")) continue;
      if (w.plik && w.plik.size > MAX_PLIK) { pominiete.push(t("imp.za_duzy", { plik: w.sciezka })); continue; }
      if (pdf) {                                            // VeloBank: tekst z PDF czytnikiem W.pdf
        if (!w.plik) continue;
        try {
          const t = await W.pdf.tekst(await w.plik.arrayBuffer());
          if (t != null) dane.push({ sciezka: w.sciezka, tekst: t });
          else pominiete.push(t("imp.nie_pdf", { plik: w.sciezka }));
        } catch (e) { pominiete.push(t("imp.pdf_blad", { plik: w.sciezka, blad: e.message || e })); }
        continue;
      }
      if (xlsx) {                                           // BNP Paribas: arkusz → CSV czytnikiem W.xlsx
        if (!w.plik) continue;
        try {
          const rows = await W.xlsx.wiersze(await w.plik.arrayBuffer());
          if (rows) dane.push({ sciezka: w.sciezka, tekst: W.xlsx.doCsv(rows) });
          else pominiete.push(t("imp.nie_xlsx", { plik: w.sciezka }));
        } catch (e) { pominiete.push(t("imp.xlsx_blad", { plik: w.sciezka, blad: e.message || e })); }
        continue;
      }
      const tekst = w.tekst != null ? w.tekst : await dekoduj(w.plik);
      if (pakiet) {                                         // kilka kopii → najnowsza wg pola "zapisano"
        let z = -1;
        try { z = Date.parse(JSON.parse(tekst).zapisano) || 0; } catch (e) { z = -1; }
        if (z > pakietCzas) { pakietCzas = z; ustawienia[M.PAKIET] = tekst; }
      } else if (wUstawieniach) {
        // przy duplikatach wygrywa plik z folderu ustawienia/
        const klucz = mala === "kategorie.yml" ? "kategorie.yaml" : mala;
        if (!(klucz in ustawienia) || /(^|\/)ustawienia\//.test(w.sciezka)) {
          ustawienia[klucz] = tekst;
          sciezki[klucz] = w.sciezka;
          if (w.plik && Object.values(M.PLIKI).includes(klucz)) czas = Math.max(czas, w.plik.lastModified || 0);
        }
      } else dane.push({ sciezka: w.sciezka, tekst });
    }
    if (pominieteFoldery.size) pominiete.push(t("imp.foldery", { lista: [...pominieteFoldery].join(", ") }));
    return { dane, ustawienia, sciezki, czas, pominiete };
  }

  // przeciągnięty folder: rekurencyjne czytanie wpisów (Chrome, Firefox, Safari)
  function zEntry(entry, prefiks) {
    return new Promise(resolve => {
      if (entry.isFile) entry.file(f => resolve([{ sciezka: prefiks + f.name, plik: f }]), () => resolve([]));
      else if (entry.isDirectory) {
        const r = entry.createReader(), wszystkie = [];
        const czytaj = () => r.readEntries(async lst => {
          if (!lst.length) {
            const pod = await Promise.all(wszystkie.map(e => zEntry(e, prefiks + entry.name + "/")));
            resolve(pod.flat());
          } else { wszystkie.push(...lst); czytaj(); }
        }, () => resolve([]));
        czytaj();
      } else resolve([]);
    });
  }

  // folder z File System Access API (Chrome/Edge): rekurencyjnie, bez ukrytych plików
  async function zUchwytu(dir, prefiks) {
    const out = [];
    for await (const h of dir.values()) {
      if (h.name.startsWith(".")) continue;
      if (h.kind === "file") out.push({ sciezka: prefiks + h.name, plik: await h.getFile() });
      else out.push(...await zUchwytu(h, prefiks + h.name + "/"));
    }
    return out;
  }

  // --- pamięć ostatniego folderu (Chrome): uchwyt w IndexedDB, dostęp i tak wymaga zgody ---
  function idb(tryb, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("wydatki", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("uchwyty");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction("uchwyty", tryb), r = fn(tx.objectStore("uchwyty"));
        tx.oncomplete = () => { req.result.close(); resolve(r && r.result); };
        tx.onerror = () => { req.result.close(); reject(tx.error); };
      };
    });
  }
  const zapamietajFolder = h => idb("readwrite", s => s.put(h, "ostatni")).catch(() => {});
  const ostatniFolder = () => idb("readonly", s => s.get("ostatni")).catch(() => null);

  // --- zapis do folderu ---------------------------------------------------------------
  async function maZapis(uchwyt) {
    try { return (await uchwyt.queryPermission({ mode: "readwrite" })) === "granted"; } catch (e) { return false; }
  }

  // zapis w miejscu, z którego plik wczytano; nowy plik → ustawienia/
  async function zapiszPlik(uchwyt, sciezka, tekst) {
    const czesci = sciezka.split("/").slice(1);             // bez nazwy folderu głównego
    let dir = uchwyt;
    for (const c of czesci.slice(0, -1)) dir = await dir.getDirectoryHandle(c, { create: true });
    const f = await dir.getFileHandle(czesci[czesci.length - 1], { create: true });
    const w = await f.createWritable();                     // zapis atomowy: plik tymczasowy → podmiana przy close()
    await w.write(tekst);
    await w.close();
  }

  // hook magazynu: po każdej udanej zmianie w dashboardzie
  async function poZapisie(nazwa) {
    const o = ostatni;
    if (o && !o.uchwyt && o.profil !== "demo") poprosOTrwalosc();
    if (!o || !o.uchwyt) return stanZapisu();
    const plik = M.PLIKI[nazwa];
    const sciezka = o.sciezkiUstawien[plik] || `${o.profil}/ustawienia/${plik}`;
    try {
      if (!(await maZapis(o.uchwyt))) throw new Error(t("imp.brak_zgody"));
      await zapiszPlik(o.uchwyt, sciezka, M.jsonPython(M.stan[nazwa]) + "\n");
      o.sciezkiUstawien[plik] = sciezka;
      M.zapisanoWFolderze();
      stanZapisu();
    } catch (e) {
      stanZapisu(t("imp.nie_zapisano", { blad: e.message }));
    }
  }
  M.poZapisie = poZapisie;

  // kopia z przeglądarki nowsza niż folder → zapisz wszystko do folderu
  async function synchronizuj() {
    for (const k of Object.keys(M.PLIKI)) await poZapisie(k);
  }

  function pobierz(nazwa, tekst) {
    const typ = /\.ya?ml$/i.test(nazwa) ? "text/yaml" : "application/json";
    const url = URL.createObjectURL(new Blob([tekst], { type: typ + ";charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = nazwa;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- dane dla dashboardu (odpowiednik build_html z wersji Python) ------------------
  // k: zwalidowany obiekt z magazynu (konfiguracja.json); brakujące pola = wartości domyślne
  // dzieciDomyslnie: tag z reguł domyślnych w języku reguł ("Dzieci" / "Kids")
  function konfiguracja(k, dzieciDomyslnie) {
    k = k || {};
    const lista = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : null);
    const liczba = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
    return {
      n: liczba(k.miesiecy_podsumowania, 4), jedn: liczba(k.prog_jednorazowych, 300),
      syn: lista(k.tagi_dzieci) || [dzieciDomyslnie || "Dzieci"], wyd: lista(k.tagi_wydarzen) || [],
      fire_mc: liczba(k.fire_cel_mc, 5000), swr: liczba(k.fire_swr, 0.04),
    };
  }

  async function przygotuj(profil, wpisy) {
    const { dane, ustawienia, sciezki, czas, pominiete } = await czytajWpisy(wpisy);
    const zPliku = ustawienia["kategorie.yaml"];
    let tekstRegul = zPliku || W.DOMYSLNE_REGULY;
    let R0 = W.reguly.zbuduj(tekstRegul);
    const zrodlo = M.wczytaj(profil, ustawienia, R0.kategorie, czas);          // ustawienia (w tym reguły własne)
    if (M.stan.konfiguracja.jezyk) I.ustaw(M.stan.konfiguracja.jezyk);       // język z folderu wygrywa z przeglądarką
    // bez kategorie.yaml w folderze: reguły domyślne w języku interfejsu (język znany dopiero po ustawieniach)
    if (!zPliku && I.jezyk() === "en") {
      tekstRegul = W.DOMYSLNE_REGULY_EN;
      R0 = W.reguly.zbuduj(tekstRegul);
      M.kategorieRegul = R0.kategorie;
    }
    const R = M.stan.reguly.length ? W.reguly.zbuduj(tekstRegul, M.stan.reguly) : R0;
    const imp = W.importuj(dane, { waluta: M.stan.konfiguracja.waluta });
    I.ustawWalute(imp.waluta);
    const r = W.reguly.doDashboardu(R, imp.txs);
    const DATA = {
      out: r.out, in: r.in, pal: PALETA, server: true,
      budzety: M.stan.budzety,
      wplywy_grupy: [...R.wplywyGrupy, R.inneWplywy], inne: R.inne,
      kategorie: R.kategorie, kategorie_wlasne: M.stan.wlasne,
      sumcfg: konfiguracja(M.stan.konfiguracja, R.inne === W.reguly.ROLE.inne[1] ? "Kids" : "Dzieci"), waluta: imp.waluta,
      reguly_yaml: tekstRegul, reguly_z_pliku: !!ustawienia["kategorie.yaml"],
    };
    const raport = { imp, pominiete, bledyRegul: R.bledy, regulyZPliku: !!ustawienia["kategorie.yaml"], zrodlo, zUchwytu: false };
    return { DATA, raport, sciezki };
  }

  // --- pasek importu nad dashboardem -----------------------------------------------
  function pasek(profil, raport) {
    const perBank = {};
    for (const p of raport.imp.raport) {
      const b = (perBank[p.bank] = perBank[p.bank] || { pliki: 0, n: 0 });
      b.pliki++; b.n += p.n;
    }
    const banki = Object.entries(perBank).map(([b, v]) => t("imp.bank", { bank: NAZWY_BANKOW[b], pliki: v.pliki, n: v.n })).join(" · ") || t("imp.brak_bankow");
    // komunikaty: tH escapuje szablon i parametry (nazwy plików i błędy reguł pochodzą z danych)
    const ostrz = [];
    if (raport.imp.nierozpoznane.length) ostrz.push(tH("imp.nierozpoznane", { lista: raport.imp.nierozpoznane.join(", ") }));
    if (raport.imp.odrzucone.length) ostrz.push(tH("imp.zla_data", { lista: raport.imp.odrzucone.map(o => `${o.sciezka} (${o.n})`).join(", ") }));
    if (raport.pominiete.length) ostrz.push(tH("imp.pominiete", { lista: raport.pominiete.join(", ") }));
    if (raport.imp.bledne.length) ostrz.push(tH("imp.bledne", { lista: raport.imp.bledne.map(o => `${o.sciezka} (${o.blad})`).join(", ") }));
    if (raport.imp.inneWaluty.length) ostrz.push(tH("imp.inne_waluty", { waluta: raport.imp.waluta,
      lista: raport.imp.inneWaluty.map(o => `${o.sciezka} (${o.n}: ${o.waluty.join(", ")})`).join(", ") }));
    if (raport.bledyRegul.length) ostrz.push(tH("imp.bledy_regul", { lista: raport.bledyRegul.join("; ") }));
    if (raport.zUchwytu) ostrz.push(tH("imp.dwukropek"));
    return `<div class="imp-bar"><div><b>${profil === "demo" ? escH(t("imp.demo")) : escH(profil)}</b> · ${escH(banki)}
      ${raport.imp.waluta !== "PLN" ? "· " + escH(t("imp.waluta", { waluta: raport.imp.waluta })) : ""}
      · ${escH(t("imp.reguly", { zrodlo: t(raport.regulyZPliku ? "imp.reguly_folder" : "imp.reguly_domyslne") }))} · <span id="imp-zapis"></span>
      · <button class="lnk" id="imp-zmien">${escH(t("imp.zmien"))}</button>
      · <button class="lnk" id="imp-wyczysc" title="${escH(t("imp.wyczysc_title"))}">${escH(t("imp.wyczysc"))}</button></div>
      ${profil === "demo" ? `<div class="imp-info">${tH("imp.demo_info")}</div>` : ""}
      <div class="imp-kopia" id="imp-kopia" role="status" hidden></div>
      <div class="imp-warn" id="imp-blad" hidden></div>
      ${ostrz.map(o => `<div class="imp-warn">${o}</div>`).join("")}</div>`;
  }

  // przypomnienie o kopii (Firefox/Safari): po tylu zmianach lub dniach baner robi się pilny
  const PROG_ZMIAN = 10, PROG_DNI = 3;
  const zmian = n => t("imp.zmian", { n });
  let prosbaTrwalosc = false;

  function banerKopii(o) {
    const el = $("imp-kopia");
    if (!el) return;
    const n = M.bezKopii || 0;
    if (o.uchwyt || o.profil === "demo" || M.zrodlo !== "przegladarka" || !n) { el.hidden = true; return; }
    const od = Date.parse(M.pierwszaBezKopii) || Date.now();
    const dni = Math.floor((Date.now() - od) / 864e5);
    const pilne = n >= PROG_ZMIAN || dni >= PROG_DNI;
    const kopia = M.ostatniaKopia ? I.dataCzas(M.ostatniaKopia) : t("imp.nigdy");
    el.hidden = false;
    el.className = "imp-kopia" + (pilne ? " pilne" : "");
    el.innerHTML = tH("imp.kopia_baner", { pilne: pilne ? "⚠ " : "", zmiany: zmian(n), od: I.dataCzas(od),
      dni: dni >= 1 ? ", " + t("imp.dni", { n: dni }) : "", kopia })
      + ` <button class="lnk" id="imp-kopia-teraz">${escH(t("imp.kopia_teraz"))}</button> `
      + tH("imp.kopia_przenies", { plik: M.PAKIET, folder: o.profil + "/ustawienia/" });
    $("imp-kopia-teraz").onclick = () => zapiszKopieUstawien(o);
  }

  function zapiszKopieUstawien(o) {
    pobierz(M.PAKIET, M.eksport());
    M.oznaczKopie();
    stanZapisu();
    alert(t("imp.pobrano", { plik: M.PAKIET, folder: o.profil + "/ustawienia/" }));
  }

  // pamięć przeglądarki „trwała” — przeglądarka nie usunie jej sama przy braku miejsca
  // (nie chroni przed ręcznym wyczyszczeniem danych); prośba raz, przy pierwszej zmianie
  function poprosOTrwalosc() {
    if (prosbaTrwalosc) return;
    prosbaTrwalosc = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* brak API */ }
  }

  // stan zapisu w pasku: gdzie lądują zmiany + akcje
  function stanZapisu(blad) {
    const el = $("imp-zapis");
    if (!el || !ostatni) return;
    const o = ostatni, czas = M.zmieniono ? I.dataCzas(M.zmieniono) : "";
    const lnk = (id, k) => `<button class="lnk" id="${id}">${escH(t(k))}</button>`;
    let h;
    if (o.uchwyt) {
      h = M.zrodlo === "folder" ? tH("imp.zapis_folder")
        : tH("imp.tylko_przegl", { czas }) + " " + lnk("imp-sync", "imp.zapisz_w_folderze");
    } else if (o.profil === "demo") {
      h = tH("imp.zapis_przegl");
    } else {
      h = (M.zrodlo === "przegladarka" ? tH("imp.tylko_przegl", { czas }) : tH("imp.zapis_przegl"))
        + " · " + lnk("imp-eksport", "imp.eksport")
        + (M.zrodlo === "przegladarka" ? " · " + lnk("imp-odrzuc", "imp.odrzuc") : "");
    }
    el.innerHTML = h;
    const b = $("imp-blad");
    b.hidden = !blad; b.textContent = blad || "";
    const sync = $("imp-sync");
    if (sync) sync.onclick = async () => {
      if (o.uchwyt.requestPermission && (await o.uchwyt.requestPermission({ mode: "readwrite" })) !== "granted") return;
      synchronizuj();
    };
    const eks = $("imp-eksport");
    if (eks) eks.onclick = () => zapiszKopieUstawien(o);
    banerKopii(o);
    const odrz = $("imp-odrzuc");
    if (odrz) odrz.onclick = () => {
      if (!confirm(t("imp.odrzuc_pyt"))) return;
      M.odrzucKopie();
      uruchom(o.profil, o.wpisy, o.uchwyt);
    };
  }

  // --- montowanie dashboardu (można powtórzyć: świeży DOM z szablonu) ----------------
  function motyw() {
    const b = $("theme-btn"), L = { "": ["◐", "motyw.auto"], dark: ["☾", "motyw.ciemny"], light: ["☀", "motyw.jasny"] };
    const show = () => { const m = document.documentElement.dataset.theme || ""; b.textContent = L[m][0]; b.title = t("motyw.klik", { motyw: t(L[m][1]) }); };
    b.addEventListener("click", () => {
      const m = document.documentElement.dataset.theme || "", n = m === "" ? "dark" : m === "dark" ? "light" : "";
      if (n) document.documentElement.dataset.theme = n; else delete document.documentElement.dataset.theme;
      try { n ? localStorage.setItem("theme", n) : localStorage.removeItem("theme"); } catch (e) { /* brak dostępu */ }
      show();
    });
    show();
  }

  async function uruchom(profil, wpisy, uchwyt) {
    $("start-blad").textContent = "";
    let wynik;
    try { wynik = await przygotuj(profil, wpisy); }
    catch (e) { $("start-blad").textContent = t("start.blad_wczytania", { blad: e.message }); return; }
    const { DATA, raport, sciezki } = wynik;
    raport.zUchwytu = !!uchwyt;
    if (!DATA.out.length && !DATA.in.length) {
      $("start-blad").textContent = t("start.brak_tx") + " " + (raport.imp.nierozpoznane.length
        ? t("start.nierozpoznane", { lista: raport.imp.nierozpoznane.join(", ") }) : t("start.wybierz_folder"));
      return;
    }
    ostatni = { profil, wpisy, uchwyt: uchwyt || null, sciezkiUstawien: sciezki };
    $("start").hidden = true;
    const app = $("app");
    app.innerHTML = pasek(profil, raport) + $("uklad").innerHTML;
    I.zastosuj(app);
    app.hidden = false;
    $("gen").textContent = I.dataCzas(Date.now());
    motyw();
    W.uruchomDashboard(DATA);
    const b = $("btn-przelicz");
    if (b) b.textContent = t("imp.wczytaj_ponownie");
    $("imp-zmien").onclick = () => location.reload();
    $("imp-wyczysc").onclick = () => wyczyscDane();
    stanZapisu();
    if (uchwyt && M.zrodlo === "przegladarka" && (await maZapis(uchwyt))) synchronizuj();
  }

  async function uruchomZUchwytu(uchwyt) {
    let wpisy;
    try { wpisy = await zUchwytu(uchwyt, uchwyt.name + "/"); }
    catch (e) { $("start-blad").textContent = t("start.blad_folderu", { blad: e.message }); return; }
    return uruchom(uchwyt.name, wpisy, uchwyt);
  }

  // --- wyczyszczenie danych aplikacji z tej przeglądarki (np. komputer współdzielony) --------
  // Tylko klucze z prefiksem "wydatki": w Chrome wszystkie strony file:// mają wspólny localStorage,
  // więc nie ruszamy cudzych danych. Motyw ("theme") zostaje — to nie dane. Pliki w folderze nietknięte.
  const PREFIKS_LS = "wydatki", KOPIA_LS = "wydatki_web_ustawienia_v1:";
  function kluczeAplikacji() {
    try { return Object.keys(localStorage).filter(k => k.startsWith(PREFIKS_LS)); } catch (e) { return []; }
  }
  // zmiany bez kopii we wszystkich profilach poza demo — przepadną przy czyszczeniu
  function zmianyBezKopii() {
    let n = 0;
    for (const k of kluczeAplikacji()) {
      if (!k.startsWith(KOPIA_LS) || k === KOPIA_LS + "demo") continue;
      try { const v = JSON.parse(localStorage.getItem(k)); n += typeof v.bezKopii === "number" ? v.bezKopii : 1; } catch (e) { n += 1; }
    }
    return n;
  }
  function usunBaze() {
    return new Promise(res => {
      try {
        const r = indexedDB.deleteDatabase("wydatki");
        r.onsuccess = r.onerror = r.onblocked = () => res();
      } catch (e) { res(); }
    });
  }
  // opcje: {bezPytania, przeladuj} — dla testów; zwraca true, gdy wyczyszczono
  async function wyczyscDane(opcje = {}) {
    const n = zmianyBezKopii();
    const pytanie = t("imp.wyczysc_pyt") + (n ? t("imp.wyczysc_uwaga", { zmiany: zmian(n) }) : "") + t("imp.wyczysc_pliki");
    if (!opcje.bezPytania && !confirm(pytanie)) return false;
    for (const k of kluczeAplikacji()) { try { localStorage.removeItem(k); } catch (e) { /* brak dostępu */ } }
    await usunBaze();
    if (opcje.przeladuj !== false) location.reload();       // dane w pamięci karty też znikają
    return true;
  }

  // „↻ Wczytaj ponownie”: z uchwytem (Chrome) folder czytany od nowa — widać nowe wyciągi;
  // bez uchwytu te same pliki (nowe pliki wymagają ponownego wyboru folderu)
  W.przeladuj = () => {
    if (!ostatni) return location.reload();
    const p = ostatni.uchwyt ? uruchomZUchwytu(ostatni.uchwyt) : uruchom(ostatni.profil, ostatni.wpisy);
    p.catch(() => location.reload());
  };

  function profilZ(wpisy) {
    const pierwszy = wpisy.find(w => w.sciezka.includes("/"));
    return pierwszy ? pierwszy.sciezka.split("/")[0] : "pliki";
  }

  // napisy ekranu startowego w bieżącym języku (także po przełączeniu PL/EN)
  function ekranStartowy() {
    I.zastosuj($("start"));
    $("info-zapis").textContent = t(FS_API ? "start.info_fs" : "start.info_bez_fs");
    const b = $("btn-ostatni");
    if (b.dataset.nazwa) b.textContent = t("start.ostatni", { nazwa: b.dataset.nazwa });
    document.querySelectorAll("#start [data-jezyk]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.jezyk === I.jezyk())));
  }

  async function start() {
    const zInputu = e => {
      const wpisy = [...e.target.files].map(f => ({ sciezka: f.webkitRelativePath || f.name, plik: f }));
      if (wpisy.length) uruchom(profilZ(wpisy), wpisy);
      e.target.value = "";
    };
    $("wybierz-folder").onchange = zInputu;
    $("wybierz-pliki").onchange = zInputu;
    $("btn-folder").onclick = async () => {
      if (!FS_API) return $("wybierz-folder").click();
      let h;
      try { h = await window.showDirectoryPicker({ id: "wydatki", mode: "readwrite" }); }
      catch (e) { return; }                                 // anulowane
      zapamietajFolder(h);
      uruchomZUchwytu(h);
    };
    // demo w języku interfejsu: PL — polskie banki w PLN, EN — rachunek w USA (OFX, USD)
    $("pokaz-demo").onclick = () => uruchom("demo", (I.jezyk() === "en" ? W.DEMO_EN : W.DEMO).map(p => ({ ...p })));
    const strefa = $("strefa");
    ["dragenter", "dragover"].forEach(ev => strefa.addEventListener(ev, e => { e.preventDefault(); strefa.classList.add("nad"); }));
    ["dragleave", "drop"].forEach(ev => strefa.addEventListener(ev, () => strefa.classList.remove("nad")));
    strefa.addEventListener("drop", async e => {
      e.preventDefault();
      const items = [...e.dataTransfer.items];
      // Chrome: przeciągnięty folder jako uchwyt z możliwością zapisu
      if (FS_API && items.length === 1 && items[0].getAsFileSystemHandle) {
        const h = await items[0].getAsFileSystemHandle().catch(() => null);
        if (h && h.kind === "directory") {
          if ((await h.requestPermission({ mode: "readwrite" }).catch(() => "denied")) === "granted") zapamietajFolder(h);
          return uruchomZUchwytu(h);
        }
      }
      const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      const wpisy = (await Promise.all(entries.map(en => zEntry(en, "")))).flat();
      if (wpisy.length) uruchom(profilZ(wpisy), wpisy);
    });
    ekranStartowy();
    document.querySelectorAll("#start [data-jezyk]").forEach(b => { b.onclick = () => { I.ustaw(b.dataset.jezyk, true); ekranStartowy(); }; });
    const bw = $("btn-wyczysc");
    bw.onclick = () => wyczyscDane();
    const box = $("wyczysc-box");
    box.hidden = !kluczeAplikacji().length;
    if (location.hash === "#demo-en") { I.ustaw("en"); ekranStartowy(); }
    if (location.hash === "#demo" || location.hash === "#demo-en") return $("pokaz-demo").click();   // link bezpośrednio do demo
    if (FS_API) {
      const h = await ostatniFolder();
      if (h) {
        box.hidden = false;
        const b = $("btn-ostatni");
        b.dataset.nazwa = h.name;
        b.textContent = t("start.ostatni", { nazwa: h.name });
        b.hidden = false;
        b.onclick = async () => {
          if ((await h.requestPermission({ mode: "readwrite" }).catch(() => "denied")) !== "granted") return;
          uruchomZUchwytu(h);
        };
      }
    }
  }

  W.app = { przygotuj, uruchom, uruchomZUchwytu, wyczyscDane, zmianyBezKopii };
  W.pobierz = pobierz;
  if (typeof document !== "undefined" && document.getElementById("start")) start();
})(globalThis.W = globalThis.W || {});
