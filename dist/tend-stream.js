/* Tend / Seedonk media streaming + AES decryption.
 *
 * 1. Bring up the CXNet session, send require-video-send to the camera.
 * 2. Get the relay host/port (5338 typical).
 * 3. Do the SDNK NAT-traversal handshake on UDP:
 *      REQ_CONN_INFO   → relay   (camera advertises its public IP/port)
 *      ACK_CONN_INFO   → relay
 *      REQ_PUNCH       → camera  (direct, twice)
 *      RES_PUNCH/ACK_PUNCH exchange to advance camera's punch counter
 *    until media starts flowing direct from camera's public IP.
 * 4. Each UDP datagram = an 8B Seedonk chunk header + chunk body.
 *    Multiple chunks with the same byte[0] = one "Seedonk frame".
 *    The first chunk's body has a 12B oRTP header; subsequent chunks are
 *    pure RTP-payload continuation.
 * 5. The assembled RTP payload contains one or more "w1" sub-frames:
 *      magic = 0x77 0x31, dataLen (LE u32), meta(4B), AES-128-CBC IV (16B),
 *      ciphertext (PKCS5-padded). Decrypt → [LE u32 len][NAL]* — emit each NAL
 *      with Annex B start code (0x00000001).
 *
 * The protocol is the same one used by the iPhone/Android myQ live-view UI.
 */
import crypto from "node:crypto";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { CxClient, parseProperties } from "./tend-cxnet.js";
const CXNET_LOGIN_HOST = "server.tend-us.tendplatform.com";
const CXNET_LOGIN_PORT = 5104;
export class TendStream extends EventEmitter {
    jwt;
    cam;
    userAlias = "";
    cxs = null;
    udp = null;
    udpAudio = null;
    relayHost = "";
    relayPort = 0;
    cameraPubIp = "";
    cameraLanIp = "";
    cameraPort = 0;
    cameraAudioPort = 0;
    cameraAudioLanIp = "";
    cameraAudioPubIp = "";
    localIp = "";
    localPort = 0;
    localAudioPort = 0;
    block1 = Buffer.alloc(32);
    block2 = Buffer.alloc(32);
    aesKey;
    resCounter = 0;
    incomingReqPunchCount = 0;
    preferLan = false;
    sentSeq2 = false;
    sentSeq2Audio = false;
    punchInterval = null;
    // Per-frame_id reassembly buffers
    assembly = new Map();
    maxAssemblyAge = 2000; // ms
    // H.264 emit
    h264Buffer = Buffer.alloc(0);
    // Stats
    packetsRx = 0;
    framesDecoded = 0;
    nalsEmitted = 0;
    decryptFailures = 0;
    constructor(jwt, cam) {
        super();
        this.jwt = jwt;
        this.cam = cam;
        this.aesKey = Buffer.from(cam.aes_key, "ascii");
    }
    /** Run the full handshake; on success emits "h264" events with Annex B chunks. */
    async start() {
        if (this.aesKey.length !== 16) {
            throw new Error("AES key must be 16 bytes (got " + this.aesKey.length + ")");
        }
        // 1. Connect CXNet, chase redirects, get our_alias
        let host = CXNET_LOGIN_HOST;
        let port = CXNET_LOGIN_PORT;
        for (let hop = 0; hop < 5; hop++) {
            this.cxs = new CxClient(host, port, CXNET_LOGIN_HOST);
            await this.cxs.connect();
            const r = await this.cxs.login(this.jwt);
            if (r.result === "REDIRECT" && r.redirect) {
                host = r.redirect.host;
                port = r.redirect.port;
                this.cxs.close();
                continue;
            }
            if (r.result === "OK" && r.frame) {
                const dp = parseProperties(r.frame.data);
                this.userAlias = dp.alias ?? "";
                break;
            }
            throw new Error("CXNet login failed: " + r.result);
        }
        if (!this.userAlias) {
            throw new Error("CXNet sign-in returned no alias");
        }
        // First: discover our local IP that routes to the public internet (the relay)
        await new Promise((resolve) => {
            const probe = dgram.createSocket("udp4");
            probe.bind(0, () => {
                probe.connect(1, "8.8.8.8", () => {
                    this.localIp = probe.address().address;
                    probe.close();
                    resolve();
                });
            });
        });
        // Bind TWO UDP sockets — one for video, one for the audio channel. Even when we only
        // care about video media, the camera waits for REQ_CONN_INFO + REQ_PUNCH on BOTH
        // channels before it'll start sending video frames. (Confirmed against the working
        // Python relay_probe_v10.py.) The audio socket otherwise sits idle: the cameras
        // don't actually transmit audio media in regular live view.
        this.udp = dgram.createSocket("udp4");
        this.udpAudio = dgram.createSocket("udp4");
        await new Promise((resolve, reject) => {
            this.udp.once("error", reject);
            this.udp.bind(0, () => {
                this.udp.removeListener("error", reject);
                this.localPort = this.udp.address().port;
                resolve();
            });
        });
        await new Promise((resolve, reject) => {
            this.udpAudio.once("error", reject);
            this.udpAudio.bind(0, () => {
                this.udpAudio.removeListener("error", reject);
                this.localAudioPort = this.udpAudio.address().port;
                resolve();
            });
        });
        // Build SDNK blocks (V_<alias> padded to 32B)
        this.block1 = TendStream.buildBlock("V", this.userAlias);
        this.block2 = TendStream.buildBlock("V", this.cam.alias);
        this.udp.on("message", (msg, rinfo) => this.onUdp(msg, rinfo, false));
        this.udpAudio.on("message", (msg, rinfo) => this.onUdp(msg, rinfo, true));
        // 3. Send require-video-send + start-video-receive. The camera also wants an audio
        // session set up — even though we ignore the audio RTCP-only channel — or it won't
        // start REQ_PUNCH'ing the video channel.
        this.cxs.sendCommand("require-video-send|" + this.userAlias + "|8|", this.cam.alias, crypto.randomBytes(16).toString("hex"));
        const vm = await this.cxs.recvFrame(15000, [438]);
        if (!vm || vm.actionId !== 438) {
            throw new Error("No videomid (action 438) response from camera");
        }
        const serverOpt = vm.options.toString("latin1").trim();
        if (!serverOpt.startsWith("rtp://")) {
            throw new Error("Unexpected serverOpt: " + serverOpt);
        }
        const [rh, rp] = serverOpt.slice(6).split(":");
        this.relayHost = rh;
        this.relayPort = parseInt(rp, 10);
        // Mirror the iPhone live-view: parallel audio session setup. We still ignore its UDP
        // (the camera doesn't actually transmit audio media in regular live view), but the
        // require/start handshake needs to happen on both sides.
        const sessionId = this.userAlias + ":" + Date.now();
        this.cxs.sendCommand("require-audio-send|" + this.userAlias + "|" + sessionId + "|8|", this.cam.alias, crypto.randomBytes(16).toString("hex"));
        await this.cxs.recvFrame(15000, [436]);
        this.cxs.sendCommand("start-video-receive|" + this.userAlias + "|8|", this.cam.alias, crypto.randomBytes(16).toString("hex"));
        this.cxs.sendCommand("start-audio-receive|" + this.userAlias + "|" + sessionId + "|8|", this.cam.alias, crypto.randomBytes(16).toString("hex"));
        // 4. UDP handshake: REQ_CONN_INFO on BOTH channels until camera registers both
        const reqConnV = this.buildReqConnInfo(0, this.localPort);
        const reqConnA = this.buildReqConnInfo(1, this.localAudioPort);
        const ackConnV = this.buildAckConnInfo(0);
        const ackConnA = this.buildAckConnInfo(1);
        const start = Date.now();
        let registered = false;
        while (Date.now() - start < 15000 && !registered) {
            this.udp.send(reqConnV, this.relayPort, this.relayHost);
            this.udpAudio.send(reqConnA, this.relayPort, this.relayHost);
            await sleep(200);
            if (this.cameraPort && this.cameraAudioPort) {
                this.udp.send(ackConnV, this.relayPort, this.relayHost);
                this.udpAudio.send(ackConnA, this.relayPort, this.relayHost);
                registered = true;
                break;
            }
            await sleep(400);
        }
        if (!registered) {
            throw new Error("Camera never registered with relay (V=" + this.cameraPort + " A=" + this.cameraAudioPort + ")");
        }
        // Reinforce ACK_CONN on both sides for a moment.
        for (let i = 0; i < 3; i++) {
            this.udp.send(ackConnV, this.relayPort, this.relayHost);
            this.udpAudio.send(ackConnA, this.relayPort, this.relayHost);
            await sleep(50);
        }
        // 5. REQ_PUNCH on BOTH channels. The camera waits for both before transmitting video.
        // Send to both LAN and public IPs to cover same-subnet (parents' house) + WAN topologies.
        const videoTargets = [[this.cameraPubIp, this.cameraPort]];
        const audioTargets = [[this.cameraAudioPubIp, this.cameraAudioPort]];
        if (this.cameraLanIp && this.cameraLanIp !== this.cameraPubIp && this.cameraLanIp !== "0.0.0.0") {
            videoTargets.push([this.cameraLanIp, this.cameraPort]);
        }
        if (this.cameraAudioLanIp && this.cameraAudioLanIp !== this.cameraAudioPubIp && this.cameraAudioLanIp !== "0.0.0.0") {
            audioTargets.push([this.cameraAudioLanIp, this.cameraAudioPort]);
        }
        for (const seq of [0, 1]) {
            const reqPunch = this.buildReqPunch(seq);
            for (let i = 0; i < 3; i++) {
                for (const [tgt, port] of videoTargets) {
                    this.udp.send(reqPunch, port, tgt);
                }
                for (const [tgt, port] of audioTargets) {
                    this.udpAudio.send(reqPunch, port, tgt);
                }
                await sleep(60);
            }
        }
        // 6. Punch responder loop — runs until disposed
        this.punchInterval = setInterval(() => this.maybeSendPunchResponse(), 50);
        this.emit("ready");
    }
    buildReqConnInfo(channelId, localPort) {
        const p = Buffer.alloc(111);
        p.write("SDNK", 0, "latin1");
        p.writeUInt8(0x01, 4);
        p.writeUInt8(0x00, 5);
        p.writeUInt8(0x01, 7); // version
        p.writeUInt32BE(0x5b, 0x10);
        p.writeUInt8(0x01, 0x14);
        p.writeUInt8(channelId, 0x17);
        p.writeUInt8(0x56, 0x18); // 'V'
        const ipParts = this.localIp.split(".").map(s => parseInt(s, 10));
        for (let i = 0; i < 4; i++) {
            p.writeUInt8(ipParts[i], 0x19 + i);
        }
        p.writeUInt16BE(localPort, 0x2d);
        this.block1.copy(p, 0x2f);
        this.block2.copy(p, 0x4f);
        return p;
    }
    buildAckConnInfo(channelId) {
        const p = Buffer.alloc(87);
        p.write("SDNK", 0, "latin1");
        p.writeUInt8(0x01, 4);
        p.writeUInt8(0x00, 5);
        p.writeUInt8(0x64, 7);
        p.writeUInt32BE(0x43, 0x10);
        p.writeUInt8(0x01, 0x14);
        p.writeUInt8(channelId, 0x15);
        p.writeUInt8(0x56, 0x16);
        this.block1.copy(p, 0x17);
        this.block2.copy(p, 0x37);
        return p;
    }
    buildReqPunch(seq) {
        const p = Buffer.alloc(86);
        p.write("SDNK", 0, "latin1");
        p.writeUInt8(0x01, 4);
        p.writeUInt8(0x00, 5);
        p.writeUInt8(0x03, 7);
        p.writeUInt32BE(0x42, 0x10);
        p.writeUInt8(0x01, 0x14);
        p.writeUInt8(seq & 0xff, 0x15);
        this.block1.copy(p, 0x16);
        this.block2.copy(p, 0x36);
        return p;
    }
    buildResPunch(counter) {
        const p = Buffer.alloc(21);
        p.write("SDNK", 0, "latin1");
        p.writeUInt8(0x01, 4);
        p.writeUInt8(0x00, 5);
        p.writeUInt8(0x04, 7);
        p.writeUInt32BE(counter, 0x08);
        p.writeUInt32BE(1, 0x10);
        p.writeUInt8(counter & 0xff, 0x14);
        return p;
    }
    buildAckPunch(echo) {
        const p = Buffer.alloc(21);
        p.write("SDNK", 0, "latin1");
        p.writeUInt8(0x01, 4);
        p.writeUInt8(0x00, 5);
        p.writeUInt8(0x05, 7);
        p.writeUInt32BE(1, 0x10);
        p.writeUInt8(echo & 0xff, 0x14);
        return p;
    }
    maybeSendPunchResponse() {
        if (!this.udp || !this.cameraPort) {
            return;
        }
        if (this.incomingReqPunchCount >= 7 && this.resCounter < 12) {
            this.resCounter = Math.max(this.resCounter + 1, 7);
            const videoTarget = this.preferLan && this.cameraLanIp ? this.cameraLanIp : this.cameraPubIp;
            this.udp.send(this.buildResPunch(this.resCounter), this.cameraPort, videoTarget);
            // Also send RES_PUNCH on the audio channel — the camera waits for both channels'
            // counters to advance before it'll release the video media flow.
            if (this.udpAudio && this.cameraAudioPort) {
                const audioTarget = this.preferLan && this.cameraAudioLanIp ? this.cameraAudioLanIp : this.cameraAudioPubIp;
                this.udpAudio.send(this.buildResPunch(this.resCounter), this.cameraAudioPort, audioTarget);
            }
        }
    }
    onUdp(msg, rinfo, isAudioChannel) {
        this.packetsRx++;
        if (process.env.TEND_DEBUG) {
            const tag = msg.length >= 4 && msg.toString("latin1", 0, 4) === "SDNK" ? "SDNK v=" + msg.readUInt8(7) : "MEDIA";
            const ch = isAudioChannel ? "A" : "V";
            // eslint-disable-next-line no-console
            console.log("[rx-" + ch + "] from " + rinfo.address + ":" + rinfo.port + " " + msg.length + "B " + tag);
        }
        if (msg.length >= 4 && msg.toString("latin1", 0, 4) === "SDNK") {
            const ver = msg.readUInt8(7);
            if (ver === 0x02 && msg.length >= 0x6c) {
                const port = msg.readUInt16BE(0x54);
                if (port > 0) {
                    if (isAudioChannel && !this.cameraAudioPort) {
                        this.cameraAudioPort = port;
                        this.cameraAudioLanIp = [msg.readUInt8(0x40), msg.readUInt8(0x41), msg.readUInt8(0x42), msg.readUInt8(0x43)].join(".");
                        this.cameraAudioPubIp = [msg.readUInt8(0x56), msg.readUInt8(0x57), msg.readUInt8(0x58), msg.readUInt8(0x59)].join(".");
                    }
                    else if (!isAudioChannel && !this.cameraPort) {
                        this.cameraPort = port;
                        this.cameraLanIp = [msg.readUInt8(0x40), msg.readUInt8(0x41), msg.readUInt8(0x42), msg.readUInt8(0x43)].join(".");
                        this.cameraPubIp = [msg.readUInt8(0x56), msg.readUInt8(0x57), msg.readUInt8(0x58), msg.readUInt8(0x59)].join(".");
                    }
                }
                return;
            }
            if (ver === 0x03) {
                this.incomingReqPunchCount++;
                // Note which path the camera punched us from: if the camera punched from its
                // LAN IP, our outbound RES_PUNCH/ACK_PUNCH must go to the LAN IP too (Linux
                // conntrack matches strict tuples). Otherwise prefer the public IP.
                if (rinfo.address === this.cameraLanIp) {
                    this.preferLan = true;
                }
                return;
            }
            if (ver === 0x04) {
                // Camera's RES_PUNCH — echo back ACK_PUNCH (with the counter byte) + REQ_PUNCH seq=2,
                // on whichever channel this came in on. Python sends seq=2 on both channels; doing
                // so once per channel matches that behavior.
                const echo = msg.readUInt8(0x14);
                const sock = isAudioChannel ? this.udpAudio : this.udp;
                const port = isAudioChannel ? this.cameraAudioPort : this.cameraPort;
                const lanIp = isAudioChannel ? this.cameraAudioLanIp : this.cameraLanIp;
                const pubIp = isAudioChannel ? this.cameraAudioPubIp : this.cameraPubIp;
                const target = this.preferLan && lanIp ? lanIp : pubIp;
                if (port) {
                    sock.send(this.buildAckPunch(echo), port, target);
                    if (isAudioChannel) {
                        if (!this.sentSeq2Audio) {
                            sock.send(this.buildReqPunch(2), port, target);
                            this.sentSeq2Audio = true;
                        }
                    }
                    else if (!this.sentSeq2) {
                        sock.send(this.buildReqPunch(2), port, target);
                        this.sentSeq2 = true;
                    }
                }
                return;
            }
            // ACK_PUNCH, etc. — no action needed
            return;
        }
        // Media (only video-channel — audio channel is RTCP-only in this protocol).
        if (!isAudioChannel) {
            this.onMediaChunk(msg);
        }
    }
    onMediaChunk(raw) {
        if (raw.length < 8) {
            return;
        }
        const frameId = raw.readUInt8(0);
        const totalChunks = raw.readUInt8(4);
        const chunkIdx = raw.readUInt8(6);
        const body = raw.subarray(8);
        let a = this.assembly.get(frameId);
        if (!a) {
            a = { chunks: new Map(), firstSeen: Date.now(), totalChunks };
            this.assembly.set(frameId, a);
        }
        a.chunks.set(chunkIdx, body);
        if (a.chunks.size === a.totalChunks) {
            this.processAssembled(frameId, a);
            this.assembly.delete(frameId);
        }
        // GC stale assemblies
        const cutoff = Date.now() - this.maxAssemblyAge;
        for (const [k, v] of this.assembly) {
            if (v.firstSeen < cutoff) {
                this.assembly.delete(k);
            }
        }
    }
    processAssembled(_frameId, a) {
        // Order chunks by index, concat bodies
        const indices = Array.from(a.chunks.keys()).sort((x, y) => x - y);
        const parts = [];
        for (const i of indices) {
            parts.push(a.chunks.get(i));
        }
        const assembled = Buffer.concat(parts);
        if (assembled.length < 12) {
            return;
        }
        // First 12B = oRTP header
        if ((assembled.readUInt8(0) & 0xc0) !== 0x80) {
            return; // not RTP
        }
        const rtpPayload = assembled.subarray(12);
        // Parse one or more "w1" sub-frames
        let off = 0;
        while (off + 26 <= rtpPayload.length) {
            if (rtpPayload.readUInt8(off) !== 0x77 || rtpPayload.readUInt8(off + 1) !== 0x31) {
                break;
            }
            const dataLen = rtpPayload.readUInt32LE(off + 2);
            if (dataLen < 20 || off + 6 + dataLen > rtpPayload.length) {
                break;
            }
            const b12 = rtpPayload.readUInt8(off + 6);
            // b13 = sizeIndex, b14 = pt marker, b15 = keyframe bit (currently unused)
            const encrypted = ((b12 & 0xe0) >> 5) === 1;
            const iv = rtpPayload.subarray(off + 10, off + 26);
            const ciphertext = rtpPayload.subarray(off + 26, off + 6 + dataLen);
            let plain;
            if (encrypted) {
                plain = this.aesDecrypt(iv, ciphertext);
            }
            else {
                plain = ciphertext;
            }
            if (plain) {
                this.framesDecoded++;
                this.emitNals(plain);
            }
            else {
                this.decryptFailures++;
            }
            off += 6 + dataLen;
        }
    }
    aesDecrypt(iv, ciphertext) {
        try {
            const decipher = crypto.createDecipheriv("aes-128-cbc", this.aesKey, iv);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        }
        catch {
            return null;
        }
    }
    emitNals(plaintext) {
        // Plaintext format: one or more [LE u32 length][bytes] entries.
        // The bytes ALREADY start with Annex B start code (00 00 00 01) + the NAL header.
        // Emit as-is; no need to re-prepend or filter by type.
        let off = 0;
        const out = [];
        while (off + 4 <= plaintext.length) {
            const n = plaintext.readUInt32LE(off);
            if (n <= 0 || off + 4 + n > plaintext.length) {
                break;
            }
            const nal = plaintext.subarray(off + 4, off + 4 + n);
            out.push(nal);
            // Count emitted entries (each = one logical NAL with embedded start code).
            this.nalsEmitted++;
            off += 4 + n;
        }
        if (out.length) {
            this.emit("h264", Buffer.concat(out));
        }
    }
    /** Stop streaming and tear down everything. */
    stop() {
        if (this.punchInterval) {
            clearInterval(this.punchInterval);
            this.punchInterval = null;
        }
        if (this.cxs) {
            try {
                this.cxs.sendCommand("stop-video-receive|" + this.userAlias + "|8|", this.cam.alias, crypto.randomBytes(16).toString("hex"));
            }
            catch {
                // ignore
            }
            this.cxs.close();
            this.cxs = null;
        }
        if (this.udp) {
            try {
                this.udp.close();
            }
            catch {
                // ignore
            }
            this.udp = null;
        }
        if (this.udpAudio) {
            try {
                this.udpAudio.close();
            }
            catch {
                // ignore
            }
            this.udpAudio = null;
        }
    }
    static buildBlock(prefix, alias) {
        const s = (prefix + "_" + alias).slice(0, 32);
        const out = Buffer.alloc(32);
        out.write(s, 0, "latin1");
        return out;
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=tend-stream.js.map