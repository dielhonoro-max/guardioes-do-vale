"""Servidor local do jogo SEM cache — toda recarga pega a versão mais nova dos arquivos.
Uso: python tools/serve.py [porta]   (padrão 8780)
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
handler = functools.partial(NoCache, directory=str(ROOT))
with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as srv:
    print(f'Guardiões do Vale em http://localhost:{port}')
    srv.serve_forever()
