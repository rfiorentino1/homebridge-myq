/* CXNet IM protocol TLS client — Node port of cxnet_client.py.
 *
 * Frame layout (LE throughout, 27B fixed header + variable):
 *   off  width  field
 *   0    1      Name              = 65 ('A')
 *   1    1      Version           = 1 (login) / 2 / 3 (commands)
 *   2    2      TotalLen          = HLen + Options + 27
 *   4    2      HLen              = 16
 *   6    1      Direction         = 0
 *   7    4      DLength
 *   11   2      ServiceID         = 121 (myQ)
 *   13   2      ActionID          = 519 login, 411 cmd, 1 err, 438 videomid, 436 chatmid
 *   15   2      CryptoID          = 2 (SSL marker; bodies plaintext)
 *   17   2      ServerID          = "**"
 *   19   8      To                = 0
 *   27   HLen   From              = 16 bytes
 *   ...         Options + Data    = java.util.Properties text bodies
 */
import tls from "node:tls";
const NAME_A = 65;
const SERVERID_DEFAULT = Buffer.from("**", "latin1");
export function encodeProperties(props) {
    // Match java.util.Properties.store(null comments): "key=value\n" per entry, latin-1.
    const lines = [];
    for (const [k, v] of Object.entries(props)) {
        lines.push(propsEscape(k, true) + "=" + propsEscape(v, false) + "\n");
    }
    return Buffer.from(lines.join(""), "latin1");
}
function propsEscape(s, isKey) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "\\") {
            out.push("\\\\");
        }
        else if (c === "\n") {
            out.push("\\n");
        }
        else if (c === "\r") {
            out.push("\\r");
        }
        else if (c === "\t") {
            out.push("\\t");
        }
        else if (isKey && (c === " " || c === "=" || c === ":" || c === "#" || c === "!")) {
            out.push("\\" + c);
        }
        else if (!isKey && i === 0 && c === " ") {
            out.push("\\ ");
        }
        else {
            out.push(c);
        }
    }
    return out.join("");
}
export function parseProperties(data) {
    const result = {};
    const text = data.toString("latin1");
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length) {
        let s = lines[i].replace(/^\s+/, "");
        i++;
        if (!s || s[0] === "#" || s[0] === "!") {
            continue;
        }
        // Line continuations
        while (s.endsWith("\\") && !s.endsWith("\\\\") && i < lines.length) {
            s = s.slice(0, -1) + lines[i].replace(/^\s+/, "");
            i++;
        }
        // Find first unescaped separator
        let sepIdx = -1;
        let j = 0;
        while (j < s.length) {
            const c = s[j];
            if (c === "\\") {
                j += 2;
                continue;
            }
            if (c === "=" || c === ":" || (/\s/.test(c) && sepIdx === -1)) {
                sepIdx = j;
                break;
            }
            j++;
        }
        let key, val;
        if (sepIdx === -1) {
            key = propsUnescape(s);
            val = "";
        }
        else {
            key = propsUnescape(s.slice(0, sepIdx));
            let rest = s.slice(sepIdx + 1).replace(/^\s+/, "");
            if (sepIdx + 1 < s.length && (s[sepIdx] === " " || s[sepIdx] === "\t") && (rest.startsWith("=") || rest.startsWith(":"))) {
                rest = rest.slice(1).replace(/^\s+/, "");
            }
            val = propsUnescape(rest);
        }
        result[key] = val;
    }
    return result;
}
function propsUnescape(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === "\\" && i + 1 < s.length) {
            const n = s[i + 1];
            if (n === "n") {
                out.push("\n");
            }
            else if (n === "r") {
                out.push("\r");
            }
            else if (n === "t") {
                out.push("\t");
            }
            else if (n === "u" && i + 5 < s.length) {
                out.push(String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)));
                i += 6;
                continue;
            }
            else {
                out.push(n);
            }
            i += 2;
        }
        else {
            out.push(c);
            i++;
        }
    }
    return out.join("");
}
export function encodeFrame(f) {
    if (f.serverId.length !== 2) {
        throw new Error("server_id must be 2 bytes");
    }
    const hlen = f.fromBytes.length;
    if (hlen % 16 !== 0 || hlen < 16) {
        throw new Error("HLen must be >=16 and %16==0, got " + hlen);
    }
    const totalLen = hlen + 27 + f.options.length;
    const dlen = f.data.length;
    const out = Buffer.allocUnsafe(totalLen + dlen);
    out.writeUInt8(f.name, 0);
    out.writeUInt8(f.version, 1);
    out.writeUInt16LE(totalLen, 2);
    out.writeUInt16LE(hlen, 4);
    out.writeUInt8(f.direction, 6);
    out.writeUInt32LE(dlen, 7);
    out.writeUInt16LE(f.serviceId, 11);
    out.writeUInt16LE(f.actionId, 13);
    out.writeUInt16LE(f.cryptoId, 15);
    f.serverId.copy(out, 17);
    out.writeBigUInt64LE(f.toLong, 19);
    f.fromBytes.copy(out, 27);
    f.options.copy(out, 27 + hlen);
    f.data.copy(out, 27 + hlen + f.options.length);
    return out;
}
export class CxClient {
    host;
    port;
    sni;
    sock = null;
    rxBuf = Buffer.alloc(0);
    fromBytes = Buffer.alloc(16);
    pending = [];
    constructor(host, port, sni) {
        this.host = host;
        this.port = port;
        this.sni = sni ?? host;
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.sock = tls.connect({
                host: this.host,
                // The Tend brokers don't respond to login frames over TLS 1.3 — only the platform's
                // top-level host does. Pin to TLS 1.2 so we can talk to whichever broker we're routed to.
                maxVersion: "TLSv1.2",
                port: this.port,
                rejectUnauthorized: false, // Tend brokers use a wildcard cert that doesn't match shard IPs
                servername: this.sni
            });
            const onError = (err) => {
                this.sock?.removeListener("secureConnect", onSecureConnect);
                reject(err);
            };
            const onSecureConnect = () => {
                this.sock.removeListener("error", onError);
                this.sock.on("data", (chunk) => this.onData(chunk));
                this.sock.on("error", () => { this.flushPending(null); });
                this.sock.on("close", () => { this.flushPending(null); });
                resolve();
            };
            this.sock.once("error", onError);
            this.sock.once("secureConnect", onSecureConnect);
        });
    }
    flushPending(f) {
        while (this.pending.length) {
            const cb = this.pending.shift();
            if (cb) {
                cb(f);
            }
        }
    }
    onData(chunk) {
        this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
        while (this.rxBuf.length >= 27) {
            const totalLen = this.rxBuf.readUInt16LE(2);
            const hlen = this.rxBuf.readUInt16LE(4);
            const dlen = this.rxBuf.readUInt32LE(7);
            const frameLen = totalLen + dlen;
            if (this.rxBuf.length < frameLen) {
                return;
            }
            const buf = this.rxBuf.subarray(0, frameLen);
            this.rxBuf = this.rxBuf.subarray(frameLen);
            const f = {
                actionId: buf.readUInt16LE(13),
                cryptoId: buf.readUInt16LE(15),
                data: Buffer.from(buf.subarray(27 + hlen + (totalLen - hlen - 27), 27 + hlen + (totalLen - hlen - 27) + dlen)),
                direction: buf.readUInt8(6),
                fromBytes: Buffer.from(buf.subarray(27, 27 + hlen)),
                name: buf.readUInt8(0),
                options: Buffer.from(buf.subarray(27 + hlen, 27 + totalLen - hlen - 27 + hlen)),
                serverId: Buffer.from(buf.subarray(17, 19)),
                serviceId: buf.readUInt16LE(11),
                toLong: buf.readBigUInt64LE(19),
                version: buf.readUInt8(1)
            };
            const cb = this.pending.shift();
            if (cb) {
                cb(f);
            }
        }
    }
    close() {
        if (this.sock) {
            try {
                this.sock.end();
            }
            catch {
                // ignore
            }
            this.sock = null;
        }
    }
    sendFrame(f) {
        if (!this.sock) {
            throw new Error("not connected");
        }
        this.sock.write(encodeFrame(f));
    }
    /** Wait for the next inbound frame matching one of the action IDs (or any if undefined). */
    recvFrame(timeoutMs = 10000, allowedActions) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const idx = this.pending.indexOf(handler);
                if (idx >= 0) {
                    this.pending.splice(idx, 1);
                }
                resolve(null);
            }, timeoutMs);
            const handler = (f) => {
                if (!f) {
                    clearTimeout(timer);
                    resolve(null);
                    return;
                }
                if (allowedActions === undefined || allowedActions.includes(f.actionId) || f.actionId === 1) {
                    clearTimeout(timer);
                    resolve(f);
                    return;
                }
                // Skip and keep waiting
                this.pending.unshift(handler);
            };
            this.pending.push(handler);
        });
    }
    /** Send action-411 command. */
    sendCommand(cmd, dstId, correlationId) {
        const f = {
            actionId: 411,
            cryptoId: 0,
            data: Buffer.from(cmd, "utf-8"),
            direction: 0,
            fromBytes: this.fromBytes,
            name: NAME_A,
            options: encodeProperties({ "CX_DSTID": dstId, "CorrelationID": correlationId }),
            serverId: SERVERID_DEFAULT,
            serviceId: 121,
            toLong: 0n,
            version: 3
        };
        this.sendFrame(f);
    }
    /**
     * Login with the Bearer JWT. Returns:
     *   - "REDIRECT" + {host,port} when the server tells us to chase to a different broker
     *   - "OK" + frame when login succeeds (frame contains alias, session-id, etc. in data props)
     *   - "ERROR" + frame on failure
     */
    async login(jwt, partnerId = "myQ") {
        const f = {
            actionId: 519,
            cryptoId: 2,
            data: encodeProperties({ "CX_UNAME": "", "mode": "0" }),
            direction: 0,
            fromBytes: Buffer.alloc(16),
            name: NAME_A,
            // Property order matches the working Python client — the relay broker is
            // empirically picky about key order in the second-hop request.
            options: encodeProperties({
                "CX_UNAME": "",
                "CX_PASSWD": "myQ.accessToken:" + jwt,
                "os_name": "ANDROID",
                "os_version": "14",
                "partner-id": partnerId,
                "sdk-version": "5.310.0",
                "client_type": "homebridge-myq-tend/1.0"
            }),
            serverId: SERVERID_DEFAULT,
            serviceId: 121,
            toLong: 0n,
            version: 1
        };
        // Properties body is doubled per Java's C20526h.F()
        f.data = Buffer.concat([f.data, f.data]);
        this.sendFrame(f);
        const resp = await this.recvFrame(20000);
        if (!resp) {
            return { frame: null, result: "TIMEOUT" };
        }
        if (resp.actionId === 519) {
            this.fromBytes = resp.fromBytes;
            const dp = parseProperties(resp.data);
            if (dp["1"]) {
                const [nh, np] = dp["1"].split(":");
                return { frame: resp, redirect: { host: nh, port: parseInt(np, 10) }, result: "REDIRECT" };
            }
            return { frame: resp, result: "OK" };
        }
        return { frame: resp, result: "ERROR" };
    }
}
//# sourceMappingURL=tend-cxnet.js.map