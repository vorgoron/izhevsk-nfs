# Выполнить код в открытом Blender через дополнение MCP (Blender Lab): bl.py file.py | bl.py -c "code"
import socket, json, sys
code = sys.argv[2] if sys.argv[1] == '-c' else open(sys.argv[1]).read()
s = socket.create_connection(('127.0.0.1', 9876), timeout=300)
s.sendall(json.dumps({'type': 'execute', 'code': code, 'strict_json': False}).encode() + b'\0')
buf = b''
while (c := s.recv(65536)): buf += c
r = json.loads(buf.rstrip(b'\0'))
for k in ('stdout', 'stderr'):
    if r.get(k): print(r.pop(k), end='', file=sys.stderr if k == 'stderr' else sys.stdout)
print(json.dumps(r, ensure_ascii=False))
