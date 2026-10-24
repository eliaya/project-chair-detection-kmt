import { DurableObject } from 'cloudflare:workers'

// A socket may close between listing and sending.
const send = (ws: WebSocket, data: ArrayBuffer | string) => {
  try {
    ws.send(data)
  } catch {
    // closed: its webSocketClose updates the others
  }
}

// Live camera view, one object per device. The Pi (main.py LiveUplink) keeps a WebSocket
// here (tag 'pi'); each admin viewer has one tagged 'viewer' and 'cam:<camera id>'.
// The Pi is told which cameras are watched ({"watch": [...]}) and sends only those frames,
// as binary "<camera id>\n<JPEG>"; viewers get the JPEG and {"pi": bool} on changes.
// Hibernation API: an idle Pi connection costs no duration.
export class LiveRelay extends DurableObject<Env> {
  async fetch(req: Request) {
    const url = new URL(req.url)
    const cam = url.searchParams.get('cam')
    const { 0: client, 1: server } = new WebSocketPair()
    if (cam) this.ctx.acceptWebSocket(server, ['viewer', `cam:${cam}`])
    else {
      // A restarted main.py replaces its old connection.
      for (const old of this.ctx.getWebSockets('pi')) old.close(1012, 'replaced')
      this.ctx.acceptWebSocket(server, ['pi'])
    }
    this.update(cam ? undefined : server)
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string) {
    if (typeof msg === 'string' || !this.ctx.getTags(ws).includes('pi')) return
    const bytes = new Uint8Array(msg)
    const nl = bytes.indexOf(10)
    if (nl < 1) return
    const cam = new TextDecoder().decode(bytes.subarray(0, nl))
    const jpeg = msg.slice(nl + 1)
    for (const v of this.ctx.getWebSockets(`cam:${cam}`)) send(v, jpeg)
  }

  webSocketClose(ws: WebSocket) {
    this.update(undefined, ws)
  }

  webSocketError(ws: WebSocket) {
    this.update(undefined, ws)
  }

  // gone: a socket that is closing but may still be listed.
  private update(newPi?: WebSocket, gone?: WebSocket) {
    const live = (tag: string) =>
      this.ctx.getWebSockets(tag).filter((ws) => ws !== gone)
    const pis = newPi ? [newPi] : live('pi')
    const viewers = live('viewer')
    const watch = [
      ...new Set(
        viewers.flatMap((v) =>
          this.ctx
            .getTags(v)
            .filter((t) => t.startsWith('cam:'))
            .map((t) => t.slice(4))
        )
      ),
    ]
    for (const p of pis) send(p, JSON.stringify({ watch }))
    for (const v of viewers) send(v, JSON.stringify({ pi: pis.length > 0 }))
  }
}
