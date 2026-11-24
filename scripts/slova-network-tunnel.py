"""Local TCP forwarding to Slova through one Windows interface, keeping VPN on.

Uses Windows IP_UNICAST_IF per socket; does not change routing tables or VPN settings.
Only SSH and HTTPS for the fixed Slova host are forwarded, on loopback listeners.
"""

import argparse
import select
import socket
import socketserver
import struct
import threading

TARGET = "193.160.208.95"
IP_UNICAST_IF = 31


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface-index", type=int, required=True)
    parser.add_argument("--source-address", required=True)
    args = parser.parse_args()
    if not 0 < args.interface_index < 2**24:
        parser.error("invalid interface index")
    socket.inet_pton(socket.AF_INET, args.source_address)

    class Forwarder(socketserver.BaseRequestHandler):
        def handle(self):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as remote:
                    remote.settimeout(10)
                    # Microsoft requires the interface index in network byte order.
                    remote.setsockopt(socket.IPPROTO_IP, IP_UNICAST_IF,
                                      struct.pack("!I", args.interface_index))
                    remote.bind((args.source_address, 0))
                    remote.connect((TARGET, self.server.remote_port))
                    remote.settimeout(30)
                    self.request.settimeout(30)
                    readers = [self.request, remote]
                    peers = {self.request: remote, remote: self.request}
                    while readers:
                        ready, _, _ = select.select(readers, [], [], 300)
                        if not ready:
                            return
                        for source in ready:
                            data = source.recv(65536)
                            if data:
                                peers[source].sendall(data)
                            else:
                                readers.remove(source)
                                peers[source].shutdown(socket.SHUT_WR)
            except OSError:
                # Never log forwarded bytes, credentials or per-user payloads.
                print("Slova tunnel connection closed or unavailable", flush=True)

    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
        allow_reuse_address = False

    servers = []
    server_threads = []
    try:
        for local_port, remote_port in [(18022, 22), (18443, 443)]:
            server = Server(("127.0.0.1", local_port), Forwarder)
            server.remote_port = remote_port
            servers.append(server)
        for server in servers:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            server_threads.append((server, thread))
            thread.start()
        print("Slova tunnel ready: localhost:18022 -> SSH; localhost:18443 -> HTTPS", flush=True)
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        # shutdown() waits for serve_forever(); an unstarted server would hang.
        for server, thread in server_threads:
            if thread.is_alive():
                server.shutdown()
                thread.join()
        for server in servers:
            server.server_close()


if __name__ == "__main__":
    main()
