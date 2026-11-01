#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Minimalny klient Marionette (wbudowany protokół zdalnego sterowania Firefoksa) — tylko biblioteka standardowa.

Po co: `firefox --screenshot` kończy po zdarzeniu load, a testy aplikacji są asynchroniczne (czytanie plików,
dekompresja) — część przebiegów kończyła się „brak wyniku”. Tu otwieramy stronę i czekamy na wynik testu.

Bezpieczeństwo: Marionette słucha tylko na 127.0.0.1, na losowym porcie, w tymczasowym profilu testowym;
proces jest zamykany po teście. Nie używać ze zwykłym profilem użytkownika.
"""
import json
import os
import socket
import subprocess
import time

FIREFOX_MAC = "/Applications/Firefox.app/Contents/MacOS/firefox"

# wynik testu: <pre> ze znacznikiem (funkcja wypisz w test_przegladarka.py)
SKRYPT_WYNIK = """
const pre = [...document.querySelectorAll('pre')].map(e => e.textContent).find(t => t.startsWith(arguments[0]));
return {wynik: pre || null, stan: document.readyState};
"""


def firefox_bin():
    for p in (os.environ.get("WYDATKI_FIREFOX"), FIREFOX_MAC):
        if p and os.path.exists(p):
            return p
    return "firefox"


def wolny_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Marionette:
    def __init__(self, port, timeout=60):
        koniec = time.time() + timeout
        while True:
            try:
                self.s = socket.create_connection(("127.0.0.1", port), timeout=10)
                break
            except OSError:
                if time.time() > koniec:
                    raise RuntimeError("Marionette: Firefox nie wystartował")
                time.sleep(0.3)
        self.bufor = b""
        self._czytaj()                                  # powitanie {"marionetteProtocol": 3, ...}
        self.nr = 0

    def _czytaj(self):
        while b":" not in self.bufor:
            self._dobierz()
        dl, reszta = self.bufor.split(b":", 1)
        n = int(dl)
        if n > 64 * 1024 * 1024:
            raise RuntimeError("Marionette: za duża odpowiedź")
        self.bufor = reszta
        while len(self.bufor) < n:
            self._dobierz()
        msg, self.bufor = self.bufor[:n], self.bufor[n:]
        return json.loads(msg)

    def _dobierz(self):
        k = self.s.recv(65536)
        if not k:
            raise RuntimeError("Marionette: połączenie zamknięte")
        self.bufor += k

    def wyslij(self, polecenie, parametry=None):
        self.nr += 1
        dane = json.dumps([0, self.nr, polecenie, parametry or {}]).encode()
        self.s.sendall(str(len(dane)).encode() + b":" + dane)
        while True:
            odp = self._czytaj()
            if isinstance(odp, list) and len(odp) == 4 and odp[0] == 1 and odp[1] == self.nr:
                if odp[2]:
                    raise RuntimeError(f"Marionette {polecenie}: {odp[2].get('message', odp[2])}")
                return odp[3]


def uruchom_strone(strona, tmp, znacznik, czekaj_na_wynik=True, limit_s=150, po_load_s=3):
    """Otwiera file://strona w headless Firefoksie i zwraca tekst wyniku (z znacznikiem) albo "".
    czekaj_na_wynik=False (test CSP): po załadowaniu strony czeka tylko po_load_s sekund."""
    prof = os.path.join(tmp, "profil-marionette")
    os.makedirs(prof, exist_ok=True)
    port = wolny_port()
    with open(os.path.join(prof, "user.js"), "w") as f:
        f.write(f'user_pref("marionette.port", {port});\n'
                'user_pref("browser.shell.checkDefaultBrowser", false);\n'
                'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
                'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);\n')
    # lista argumentów, bez powłoki; ścieżkę Firefoksa ustawia uruchamiający testy (WYDATKI_FIREFOX)
    proc = subprocess.Popen([firefox_bin(), "--headless", "--marionette", "--no-remote", "--profile", prof],  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    m = None
    try:
        m = Marionette(port)
        m.wyslij("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"pageLoadStrategy": "normal"}}})
        m.wyslij("WebDriver:Navigate", {"url": "file://" + strona})
        start, zaladowana = time.time(), None
        while time.time() - start < limit_s:
            r = m.wyslij("WebDriver:ExecuteScript", {"script": SKRYPT_WYNIK, "args": [znacznik]})["value"]
            if r.get("wynik"):
                return r["wynik"]
            if r.get("stan") == "complete" and zaladowana is None:
                zaladowana = time.time()
            if not czekaj_na_wynik and zaladowana and time.time() - zaladowana > po_load_s:
                return ""
            time.sleep(0.2)
        return ""
    finally:
        try:
            if m:
                m.wyslij("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
