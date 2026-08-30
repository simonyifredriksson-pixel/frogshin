"""Development server for FROGSHIN.

Plain `python -m http.server` lets the browser cache the ES modules, which
makes edits appear to do nothing. This sends no-store on everything so a
normal refresh always picks up the latest code.

    py serve.py            # http://127.0.0.1:8124  (this PC only)
    py serve.py 9000       # custom port
    py serve.py --lan      # also reachable from other devices on your Wi-Fi

Note: a 127.0.0.1 / localhost address means "the computer I am typing on", so
it can never be shared with anyone else. Use --lan for the same network, or
publish the folder to static hosting for anywhere.
"""
import sys
import os
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # Never answer a conditional request with 304 — always resend the file.
    # self.headers is an email.message.Message, so removal is `del`, and
    # deleting an absent key is already a no-op there.
    def send_head(self):
        del self.headers['If-Modified-Since']
        del self.headers['If-None-Match']
        return super().send_head()

    def log_message(self, fmt, *args):
        # Keep the console quiet apart from real problems.
        status = args[1] if len(args) > 1 else ''
        if str(status).startswith(('4', '5')):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def lan_ip():
    """This machine's address on the local network."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No packets are actually sent; this just picks the outbound interface.
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    lan = '--lan' in sys.argv
    port = int(args[0]) if args else 8124
    root = os.path.dirname(os.path.abspath(__file__))
    handler = partial(NoCacheHandler, directory=root)

    host = '0.0.0.0' if lan else '127.0.0.1'
    server = ThreadingHTTPServer((host, port), handler)

    print(f'FROGSHIN dev server (serving {root})')
    print(f'  this PC   : http://127.0.0.1:{port}/')
    if lan:
        ip = lan_ip()
        if ip:
            print(f'  same Wi-Fi: http://{ip}:{port}/   <- give this one to a friend')
        print('  (Windows may ask you to allow Python through the firewall - say yes)')
    else:
        print('  not shareable: 127.0.0.1 means "this computer". Re-run with --lan')
        print('  to let other devices on your network connect.')
    print('Caching is disabled; just refresh after an edit. Ctrl+C to stop.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')


if __name__ == '__main__':
    main()
