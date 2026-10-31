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
  const NAZWY_BANKOW = { millennium: "Millennium", velo: "VeloBank", revolut: "Revolut", alior: "Alior", mbank: "mBank", pkobp: "PKO BP" };
  const $ = id => document.getElementById(id);
  const escH = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const nazwaPliku = p => p.split("/").pop();
  const FS_API = typeof window !== "undefined" && "showDirectoryPicker" in window;

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
    for (const w of wpisy) {
      const czesci = rel(w), foldery = czesci.slice(0, -1);
      const ukryty = foldery.find(f => f.startsWith("_") || f.startsWith("."));
      if (ukryty) { pominieteFoldery.add(ukryty); continue; }
      const nazwa = nazwaPliku(w.sciezka), mala = nazwa.toLowerCase();
      const pakiet = PAKIET_RE.test(mala);
      const miejsceUstawien = foldery.length === 0 || (foldery.length === 1 && foldery[0].toLowerCase() === "ustawienia");
      const wUstawieniach = (PLIKI_USTAWIEN.has(mala) || pakiet) && miejsceUstawien;
      const pdf = !wUstawieniach && mala.endsWith(".pdf");
      if (!wUstawieniach && !pdf && !mala.endsWith(".csv")) continue;
      if (w.plik && w.plik.size > MAX_PLIK) { pominiete.push(`${w.sciezka} (za duży)`); continue; }
      if (pdf) {                                            // VeloBank: tekst z PDF czytnikiem W.pdf
        if (!w.plik) continue;
        try {
          const t = await W.pdf.tekst(await w.plik.arrayBuffer());
          if (t != null) dane.push({ sciezka: w.sciezka, tekst: t });
          else pominiete.push(`${w.sciezka} (to nie jest PDF)`);
        } catch (e) { pominiete.push(`${w.sciezka} (PDF nieczytelny: ${e.message || e})`); }
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
    if (pominieteFoldery.size) pominiete.push(`foldery ${[...pominieteFoldery].join(", ")} (nazwa zaczyna się od _ lub .)`);
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
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
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
      if (!(await maZapis(o.uchwyt))) throw new Error("brak zgody na zapis");
      await zapiszPlik(o.uchwyt, sciezka, M.jsonPython(M.stan[nazwa]) + "\n");
      o.sciezkiUstawien[plik] = sciezka;
      M.zapisanoWFolderze();
      stanZapisu();
    } catch (e) {
      stanZapisu("Nie zapisano do folderu (" + e.message + ") — zmiana jest w przeglądarce.");
    }
  }
  M.poZapisie = poZapisie;

  // kopia z przeglądarki nowsza niż folder → zapisz wszystko do folderu
  async function synchronizuj() {
    for (const k of Object.keys(M.PLIKI)) await poZapisie(k);
  }

  function pobierz(nazwa, tekst) {
    const url = URL.createObjectURL(new Blob([tekst], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = nazwa;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- dane dla dashboardu (odpowiednik build_html z wersji Python) ------------------
  function konfiguracja(tekst) {
    let k = {};
    try { k = JSON.parse(tekst || "{}"); } catch (e) { k = {}; }
    const lista = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : null);
    const liczba = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
    return {
      n: liczba(k.miesiecy_podsumowania, 4), jedn: liczba(k.prog_jednorazowych, 300),
      syn: lista(k.tagi_dzieci) || ["Dzieci"], wyd: lista(k.tagi_wydarzen) || [],
      fire_mc: liczba(k.fire_cel_mc, 5000), swr: liczba(k.fire_swr, 0.04),
    };
  }

  async function przygotuj(profil, wpisy) {
    const { dane, ustawienia, sciezki, czas, pominiete } = await czytajWpisy(wpisy);
    const R = W.reguly.zbuduj(ustawienia["kategorie.yaml"] || W.DOMYSLNE_REGULY);
    const imp = W.importuj(dane);
    const r = W.reguly.doDashboardu(R, imp.txs);
    const zrodlo = M.wczytaj(profil, ustawienia, R.kategorie, czas);
    const DATA = {
      out: r.out, in: r.in, pal: PALETA, server: true,
      budzety: M.stan.budzety,
      wplywy_grupy: [...R.wplywyGrupy, "Inne_wpływy"],
      kategorie: R.kategorie, kategorie_wlasne: M.stan.wlasne,
      sumcfg: konfiguracja(ustawienia["konfiguracja.json"]),
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
    const banki = Object.entries(perBank).map(([b, v]) => `${NAZWY_BANKOW[b]}: ${v.pliki} pl. / ${v.n} tr.`).join(" · ") || "brak rozpoznanych wyciągów";
    const ostrz = [];
    if (raport.imp.nierozpoznane.length) ostrz.push("Nierozpoznane pliki: " + raport.imp.nierozpoznane.map(escH).join(", "));
    if (raport.pominiete.length) ostrz.push("Pominięte: " + raport.pominiete.map(escH).join(", "));
    if (raport.bledyRegul.length) ostrz.push("Błędne reguły w kategorie.yaml: " + raport.bledyRegul.map(escH).join("; "));
    if (raport.zUchwytu) ostrz.push("Brakuje jakiegoś wyciągu? Ta przeglądarka nie widzi plików z dwukropkiem „:” w nazwie "
      + "(np. <code>shared-text-2026-10-01 11:39:03.csv</code> z telefonu) — zmień nazwę pliku, np. na <code>revolut-2026-10.csv</code>.");
    return `<div class="imp-bar"><div><b>${profil === "demo" ? "DEMO — dane fikcyjne" : escH(profil)}</b> · ${escH(banki)}
      · reguły: ${raport.regulyZPliku ? "z folderu" : "domyślne"} · <span id="imp-zapis"></span>
      · <button class="lnk" id="imp-zmien">zmień folder</button></div>
      ${profil === "demo" ? `<div class="imp-info">VeloBank: w demo brak przykładu — wyciągi Velo to pliki <b>PDF</b>
        („Historia rachunku” / „Historia karty” z bankowości internetowej). W swoim folderze wrzuć je do
        <code>dane/velo/</code> — aplikacja odczyta je sama, bez konwersji.</div>` : ""}
      <div class="imp-kopia" id="imp-kopia" role="status" hidden></div>
      <div class="imp-warn" id="imp-blad" hidden></div>
      ${ostrz.map(o => `<div class="imp-warn">${o}</div>`).join("")}</div>`;
  }

  // przypomnienie o kopii (Firefox/Safari): po tylu zmianach lub dniach baner robi się pilny
  const PROG_ZMIAN = 10, PROG_DNI = 3;
  const zmian = n => n === 1 ? "zmiana" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? "zmiany" : "zmian";
  let prosbaTrwalosc = false;

  function banerKopii(o) {
    const el = $("imp-kopia");
    if (!el) return;
    const n = M.bezKopii || 0;
    if (o.uchwyt || o.profil === "demo" || M.zrodlo !== "przegladarka" || !n) { el.hidden = true; return; }
    const od = Date.parse(M.pierwszaBezKopii) || Date.now();
    const dni = Math.floor((Date.now() - od) / 864e5);
    const pilne = n >= PROG_ZMIAN || dni >= PROG_DNI;
    const kopia = M.ostatniaKopia ? new Date(M.ostatniaKopia).toLocaleString("pl-PL") : "nigdy";
    el.hidden = false;
    el.className = "imp-kopia" + (pilne ? " pilne" : "");
    el.innerHTML = `${pilne ? "⚠ " : ""}<b>${n} ${zmian(n)} bez kopii</b> (od ${escH(new Date(od).toLocaleString("pl-PL"))}`
      + `${dni >= 1 ? `, ${dni} dn.` : ""}) — są tylko w pamięci tej przeglądarki; wyczyszczenie jej danych je usunie. `
      + `Ostatnia kopia: ${escH(kopia)}. <button class="lnk" id="imp-kopia-teraz">Zapisz kopię teraz</button> `
      + `i przenieś plik <code>${escH(M.PAKIET)}</code> do folderu <code>${escH(o.profil)}/ustawienia/</code>.`;
    $("imp-kopia-teraz").onclick = () => zapiszKopieUstawien(o);
  }

  function zapiszKopieUstawien(o) {
    pobierz(M.PAKIET, M.eksport());
    M.oznaczKopie();
    stanZapisu();
    alert(`Pobrano ${M.PAKIET}. Przenieś go do folderu ${o.profil}/ustawienia/ — przy następnym wczytaniu folderu ustawienia będą z pliku.`);
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
    const o = ostatni, czas = M.zmieniono ? new Date(M.zmieniono).toLocaleString("pl-PL") : "";
    let h;
    if (o.uchwyt) {
      h = M.zrodlo === "folder" ? "zmiany zapisują się w folderze ✓"
        : `<b>zmiany z ${escH(czas)} tylko w przeglądarce</b> <button class="lnk" id="imp-sync">zapisz w folderze</button>`;
    } else if (o.profil === "demo") {
      h = "zmiany zapisują się w tej przeglądarce";
    } else {
      h = (M.zrodlo === "przegladarka" ? `<b>zmiany z ${escH(czas)} tylko w przeglądarce</b>` : "zmiany zapisują się w tej przeglądarce")
        + ` · <button class="lnk" id="imp-eksport">zapisz kopię ustawień</button>`
        + (M.zrodlo === "przegladarka" ? ` · <button class="lnk" id="imp-odrzuc">wczytaj z folderu</button>` : "");
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
      if (!confirm("Odrzucić zmiany zapisane w tej przeglądarce i wczytać ustawienia z folderu?")) return;
      M.odrzucKopie();
      uruchom(o.profil, o.wpisy, o.uchwyt);
    };
  }

  // --- montowanie dashboardu (można powtórzyć: świeży DOM z szablonu) ----------------
  function motyw() {
    const b = $("theme-btn"), L = { "": ["◐", "Motyw: automatyczny (jak system)"], dark: ["☾", "Motyw: ciemny"], light: ["☀", "Motyw: jasny"] };
    const show = () => { const t = document.documentElement.dataset.theme || ""; b.textContent = L[t][0]; b.title = L[t][1] + " — kliknij, by zmienić"; };
    b.addEventListener("click", () => {
      const t = document.documentElement.dataset.theme || "", n = t === "" ? "dark" : t === "dark" ? "light" : "";
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
    catch (e) { $("start-blad").textContent = "Nie udało się wczytać plików: " + e.message; return; }
    const { DATA, raport, sciezki } = wynik;
    raport.zUchwytu = !!uchwyt;
    if (!DATA.out.length && !DATA.in.length) {
      $("start-blad").innerHTML = "Nie znaleziono transakcji. " + (raport.imp.nierozpoznane.length
        ? "Nierozpoznane pliki: " + raport.imp.nierozpoznane.map(escH).join(", ") : "Wybierz folder z plikami CSV z banku.");
      return;
    }
    ostatni = { profil, wpisy, uchwyt: uchwyt || null, sciezkiUstawien: sciezki };
    $("start").hidden = true;
    const app = $("app");
    app.innerHTML = pasek(profil, raport) + $("uklad").innerHTML;
    app.hidden = false;
    $("gen").textContent = new Date().toLocaleString("pl-PL");
    motyw();
    W.uruchomDashboard(DATA);
    const b = $("btn-przelicz");
    if (b) b.textContent = "↻ Wczytaj ponownie";
    $("imp-zmien").onclick = () => location.reload();
    stanZapisu();
    if (uchwyt && M.zrodlo === "przegladarka" && (await maZapis(uchwyt))) synchronizuj();
  }

  async function uruchomZUchwytu(uchwyt) {
    let wpisy;
    try { wpisy = await zUchwytu(uchwyt, uchwyt.name + "/"); }
    catch (e) { $("start-blad").textContent = "Nie udało się odczytać folderu: " + e.message; return; }
    return uruchom(uchwyt.name, wpisy, uchwyt);
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
    $("pokaz-demo").onclick = () => uruchom("demo", W.DEMO.map(p => ({ sciezka: p.sciezka, tekst: p.tekst })));
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
    $("info-zapis").textContent = FS_API
      ? "Twoja przeglądarka zapisze zmiany (kategorie, tagi, budżety) prosto do folderu — zapyta o zgodę."
      : "Ta przeglądarka (Firefox/Safari) nie zapisuje do folderu: zmiany (kategorie, tagi, budżety) są w jej pamięci. "
        + "Co jakiś czas kliknij „zapisz kopię ustawień” i przenieś plik wydatki-ustawienia.json do folderu ustawienia/ — "
        + "aplikacja przypomni. Zapis automatyczny do folderu: Chrome lub Edge.";
    if (location.hash === "#demo") return $("pokaz-demo").click();      // link bezpośrednio do demo
    if (FS_API) {
      const h = await ostatniFolder();
      if (h) {
        const b = $("btn-ostatni");
        b.textContent = `Otwórz ostatni folder: ${h.name}`;
        b.hidden = false;
        b.onclick = async () => {
          if ((await h.requestPermission({ mode: "readwrite" }).catch(() => "denied")) !== "granted") return;
          uruchomZUchwytu(h);
        };
      }
    }
  }

  W.app = { przygotuj, uruchom, uruchomZUchwytu };
  if (typeof document !== "undefined" && document.getElementById("start")) start();
})(globalThis.W = globalThis.W || {});
