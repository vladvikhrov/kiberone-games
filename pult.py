#!/usr/bin/env python3
"""Пульт игр KIBERone: раздаёт игры по локальной сети и включает или выключает их.

Запуск: python3 pult.py [порт]. Нужен только Python 3, ставить ничего не надо.
Игры находятся сами: это любая папка рядом, в которой есть index.html.
"""
import functools
import html
import http.server
import json
import posixpath
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "pult-config.json"
DEFAULT_PORT = 8000
ACTIVE_SECONDS = 120  # ученик считается подключённым, если заходил за последние 2 минуты


def find_games():
    games = {}
    for folder in sorted(ROOT.iterdir()):
        page = folder / "index.html"
        if folder.name.startswith(".") or not page.is_file():
            continue
        found = re.search(r"<title>(.*?)</title>", page.read_text(encoding="utf-8"), re.S)
        games[folder.name] = found.group(1).strip() if found else folder.name
    return games


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.games = find_games()
        self.disabled = set()
        self.port = DEFAULT_PORT
        self.clients = {}  # ip -> (игра, время последнего запроса)
        if CONFIG.exists():
            try:
                saved = json.loads(CONFIG.read_text(encoding="utf-8"))
                self.disabled = set(saved.get("disabled", []))
                self.port = int(saved.get("port", DEFAULT_PORT))
            except (ValueError, TypeError, AttributeError):
                pass  # испорченный файл настроек: работаем со значениями по умолчанию

    def save(self):
        data = {"disabled": sorted(self.disabled), "port": self.port}
        CONFIG.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def toggle(self, name):
        with self.lock:
            self.disabled.symmetric_difference_update({name})
        self.save()

    def set_all(self, enabled):
        with self.lock:
            self.disabled = set() if enabled else set(self.games)
        self.save()

    def enabled(self):
        with self.lock:
            return [g for g in self.games if g not in self.disabled]

    def is_enabled(self, name):
        with self.lock:
            return name in self.games and name not in self.disabled

    def touch(self, ip, game):
        with self.lock:
            old = self.clients.get(ip, (None, 0))[0]
            self.clients[ip] = (game or old, time.time())

    def active(self):
        now = time.time()
        with self.lock:
            return {ip: g for ip, (g, t) in self.clients.items() if now - t < ACTIVE_SECONDS}


CLOSED_PAGE = """<!doctype html><meta charset="utf-8"><title>Игра закрыта</title>
<body style="font:20px sans-serif;background:#2B4C7E;color:#fff;text-align:center;padding-top:20vh">
<h1>{title}: игра сейчас закрыта</h1><p>Подожди, пока тьютор её включит.</p>
<p><a style="color:#FFC83D" href="/">К списку игр</a></p>"""


class Handler(http.server.SimpleHTTPRequestHandler):
    state = None

    def segments(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        return [s for s in posixpath.normpath(path).split("/") if s]

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parts = self.segments()
        first = parts[0] if parts else ""
        ip = self.client_address[0]

        if first == "status.json":
            body = json.dumps({"enabled": self.state.enabled()}).encode()
            self.reply(200, "application/json", body)
            return
        if not parts or parts == ["index.html"]:
            self.state.touch(ip, None)
            self.serve_file()
            return
        # раздаём только папки игр: .git, pult.py и настройки ученикам недоступны
        if first not in self.state.games:
            self.send_error(404)
            return
        if not self.state.is_enabled(first):
            title = html.escape(self.state.games[first])
            self.reply(403, "text/html; charset=utf-8", CLOSED_PAGE.format(title=title).encode())
            return
        self.state.touch(ip, first)
        self.serve_file()

    def serve_file(self):
        if self.command == "HEAD":
            super().do_HEAD()
        else:
            super().do_GET()

    def reply(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # журнал запросов сломал бы экран пульта


class Server:
    def __init__(self, state):
        self.state = state
        self.httpd = None
        self.error = ""

    @property
    def running(self):
        return self.httpd is not None

    def start(self):
        if self.running:
            return
        Handler.state = self.state
        handler = functools.partial(Handler, directory=str(ROOT))
        try:
            self.httpd = http.server.ThreadingHTTPServer(("0.0.0.0", self.state.port), handler)
        except OSError as e:
            self.httpd = None
            self.error = f"Порт {self.state.port} не открылся: {e.strerror}. Закрой другую программу или смени порт (p)."
            return
        self.error = ""
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        if self.running:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None


def lan_ips():
    """Адреса ноутбука в сети, сначала самые вероятные: Wi-Fi и домашние сети раньше виртуальных."""
    found = []
    # UDP-сокет ничего не отправляет: так система просто подсказывает адрес основного подключения
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("8.8.8.8", 80))
            found.append(s.getsockname()[0])
        except OSError:
            pass  # сеть без выхода в интернет: адрес найдём ниже
    try:
        output = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=2).stdout
        found += [ip for ip in output.split() if "." in ip]
    except (OSError, subprocess.SubprocessError):
        pass
    unique = list(dict.fromkeys(ip for ip in found if not ip.startswith("127.")))
    return sorted(unique, key=lambda ip: not ip.startswith("192.168."))


def draw(state, server, note):
    if sys.stdout.isatty():
        print("\033[2J\033[H", end="")
    print("=== Пульт игр KIBERone ===\n")
    if server.running:
        ips = lan_ips()
        print("Сервер: РАБОТАЕТ")
        if ips:
            print(f"Адрес для учеников: http://{ips[0]}:{state.port}")
            for ip in ips[1:]:
                print(f"  если не открывается: http://{ip}:{state.port}")
        else:
            print("Сети нет: подключи ноутбук к Wi-Fi и нажми Enter")
    else:
        print("Сервер: ОСТАНОВЛЕН")
    if server.error:
        print("ОШИБКА:", server.error)

    active = state.active()
    print("\nИгры:")
    names = list(state.games)
    for n, name in enumerate(names, 1):
        mark = "x" if state.is_enabled(name) else " "
        count = sum(1 for g in active.values() if g == name)
        print(f"  {n}. [{mark}] {state.games[name]}" + (f"  (учеников: {count})" if count else ""))
    print(f"\nПодключено за последние 2 минуты: {len(active)}")
    print("\nНомер игры: включить или выключить")
    print("a: включить все   n: выключить все   s: запустить или остановить сервер")
    print("o: открыть меню здесь   p: сменить порт   Enter: обновить   q: выйти")
    if note:
        print("\n" + note)


def open_browser(url):
    # в Linux xdg-open не занимает терминал выводом браузера, в других системах хватает webbrowser
    try:
        subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        webbrowser.open(url)


def handle(cmd, state, server):
    names = list(state.games)
    if cmd.isdigit() and 1 <= int(cmd) <= len(names):
        state.toggle(names[int(cmd) - 1])
    elif cmd == "a":
        state.set_all(True)
    elif cmd == "n":
        state.set_all(False)
    elif cmd == "s":
        server.stop() if server.running else server.start()
    elif cmd == "o":
        if not server.running:
            return "Сначала запусти сервер (s)."
        open_browser(f"http://localhost:{state.port}")
    elif cmd == "p":
        value = input("Новый порт (1024–65535): ").strip()
        if not (value.isdigit() and 1024 <= int(value) <= 65535):
            return "Порт не изменён: нужно число от 1024 до 65535."
        was_running = server.running
        server.stop()
        state.port = int(value)
        state.save()
        if was_running:
            server.start()
    elif cmd:
        return f"Нет такой команды: {cmd}"
    return ""


def main():
    state = State()
    if len(sys.argv) > 1:
        if not (sys.argv[1].isdigit() and 1024 <= int(sys.argv[1]) <= 65535):
            sys.exit("Порт должен быть числом от 1024 до 65535.")
        state.port = int(sys.argv[1])
    server = Server(state)
    server.start()
    note = ""
    try:
        while True:
            draw(state, server, note)
            cmd = input("\n> ").strip().lower()
            if cmd == "q":
                break
            note = handle(cmd, state, server)
    except (EOFError, KeyboardInterrupt):
        print()
    server.stop()


if __name__ == "__main__":
    main()
