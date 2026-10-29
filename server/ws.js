// Минимальный WebSocket-сервер (RFC 6455) без зависимостей: рукопожатие, текстовые кадры, ping/close.
// Игре этого достаточно — сообщения короткие JSON-строки.
import { createHash } from 'node:crypto';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class Socket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.#receive(chunk));
    socket.on('close', () => this.#closed());
    socket.on('error', () => this.#closed());
  }

  send(text) {
    if (!this.open) return;
    const payload = Buffer.from(text, 'utf8');
    const length = payload.length;
    let header;
    if (length < 126) header = Buffer.from([0x81, length]);
    else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 126; header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  close() {
    if (!this.open) return;
    try { this.socket.write(Buffer.from([0x88, 0])); } catch { /* сокет уже закрыт */ }
    this.socket.end();
    this.#closed();
  }

  #closed() {
    if (!this.open) return;
    this.open = false;
    this.onclose?.();
  }

  #receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0], second = this.buffer[1];
      const fin = (first & 0x80) !== 0, opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f, offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2)); offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;

      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= this.buffer[maskOffset + (i % 4)];
      this.buffer = this.buffer.subarray(offset + length);

      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { // ping → pong
        this.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.fragments.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(this.fragments).toString('utf8');
        this.fragments = [];
        this.onmessage?.(text);
      }
    }
  }
}

/** Подключает WebSocket к HTTP-серверу: onConnection(socket) вызывается на каждого нового клиента. */
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (request, socket) => {
    if (request.url !== path || request.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const key = request.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(key + MAGIC).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    onConnection(new Socket(socket));
  });
}
