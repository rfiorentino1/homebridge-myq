/* Homebridge camera accessory for myQ / Tend cameras.
 *
 * Snapshots: simple REST GET of /cxs/api/devices/{id}/cam/recentImage.jpg
 * Live stream: TendStream (CXNet + SDNK + AES-CBC decrypt) → H.264 Annex B
 *              → ffmpeg subprocess → SRTP → HomeKit
 */
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { TendApi } from "./tend-api.js";
import { TendStream } from "./tend-stream.js";
export class myQCamera {
    controller;
    accessory;
    api;
    hap;
    log;
    cam;
    tendApi;
    jwtProvider;
    ffmpegPath;
    active = new Map();
    sessions = new Map();
    constructor(accessory, api, log, cam, jwtProvider, ffmpegPath = "ffmpeg") {
        this.accessory = accessory;
        this.api = api;
        this.hap = api.hap;
        this.log = log;
        this.cam = cam;
        this.jwtProvider = jwtProvider;
        this.tendApi = new TendApi(jwtProvider.jwt());
        this.ffmpegPath = ffmpegPath;
        const opts = {
            cameraStreamCount: 2,
            delegate: this,
            streamingOptions: {
                audio: {
                    codecs: [{ samplerate: 16 /* AudioStreamingSamplerate.KHZ_16 */, type: "AAC-eld" /* AudioStreamingCodecType.AAC_ELD */ }],
                    twoWayAudio: false
                },
                supportedCryptoSuites: [0 /* SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 */],
                video: {
                    codec: {
                        levels: [0 /* this.hap.H264Level.LEVEL3_1 */, 1 /* this.hap.H264Level.LEVEL3_2 */, 2 /* this.hap.H264Level.LEVEL4_0 */],
                        profiles: [0 /* this.hap.H264Profile.BASELINE */, 1 /* this.hap.H264Profile.MAIN */, 2 /* this.hap.H264Profile.HIGH */]
                    },
                    resolutions: [
                        [1280, 720, 25],
                        [1280, 720, 15],
                        [640, 360, 25],
                        [320, 240, 15]
                    ]
                }
            }
        };
        this.controller = new this.hap.CameraController(opts);
        accessory.configureController(this.controller);
    }
    async handleSnapshotRequest(request, callback) {
        this.tendApi.setJwt(this.jwtProvider.jwt());
        // Best-effort wake (idempotent — camera ignores if already awake)
        await this.tendApi.wakeup(this.cam.id).catch(() => false);
        const jpeg = await this.tendApi.getSnapshot(this.cam.id, true);
        if (!jpeg) {
            callback(new Error("Tend snapshot endpoint returned an error"));
            return;
        }
        this.log.debug("Snapshot %dx%d, %dB", request.width, request.height, jpeg.length);
        callback(undefined, jpeg);
    }
    async prepareStream(request, callback) {
        // Allocate an outbound UDP port for FFmpeg → HomeKit return data
        const videoReturnPort = await this.reservePort(request.addressVersion === "ipv6");
        const audioReturnPort = await this.reservePort(request.addressVersion === "ipv6");
        const sessionInfo = {
            address: request.targetAddress,
            audioCryptoSuite: request.audio.srtpCryptoSuite,
            audioPort: request.audio.port,
            audioReturnPort,
            audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
            audioSSRC: this.hap.CameraController.generateSynchronisationSource(),
            ipv6: request.addressVersion === "ipv6",
            videoCryptoSuite: request.video.srtpCryptoSuite,
            videoMtu: 1316,
            videoPort: request.video.port,
            videoReturnPort,
            videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
            videoSSRC: this.hap.CameraController.generateSynchronisationSource()
        };
        this.sessions.set(request.sessionID, sessionInfo);
        const response = {
            audio: {
                port: audioReturnPort,
                srtp_key: request.audio.srtp_key,
                srtp_salt: request.audio.srtp_salt,
                ssrc: sessionInfo.audioSSRC
            },
            video: {
                port: videoReturnPort,
                srtp_key: request.video.srtp_key,
                srtp_salt: request.video.srtp_salt,
                ssrc: sessionInfo.videoSSRC
            }
        };
        callback(undefined, response);
    }
    handleStreamRequest(request, callback) {
        switch (request.type) {
            case "start" /* StreamRequestTypes.START */:
                this.startStream(request, callback);
                break;
            case "reconfigure" /* StreamRequestTypes.RECONFIGURE */:
                this.log.info("Reconfigure not implemented; ignoring.");
                callback();
                break;
            case "stop" /* StreamRequestTypes.STOP */:
                this.stopStream(request.sessionID);
                callback();
                break;
        }
    }
    async startStream(request, callback) {
        const session = this.sessions.get(request.sessionID);
        if (!session) {
            callback(new Error("Unknown session"));
            return;
        }
        const videoInfo = request.video;
        this.tendApi.setJwt(this.jwtProvider.jwt());
        await this.tendApi.wakeup(this.cam.id).catch(() => false);
        // 1. Open Tend stream — receives raw H.264 NAL chunks via "h264" events
        const tend = new TendStream(this.jwtProvider.jwt(), this.cam);
        try {
            await tend.start();
        }
        catch (err) {
            this.log.error("Tend stream start failed: %s", String(err));
            callback(err);
            return;
        }
        // 2. Build FFmpeg command. stdin = our H.264 Annex B stream. Output = SRTP to HomeKit.
        const args = [
            "-hide_banner", "-loglevel", "warning",
            "-fflags", "+genpts",
            "-use_wallclock_as_timestamps", "1",
            "-f", "h264",
            "-i", "pipe:0",
            "-an",
            "-c:v", "copy",
            "-payload_type", String(videoInfo.pt),
            "-ssrc", String(session.videoSSRC),
            "-f", "rtp",
            "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
            "-srtp_out_params", session.videoSRTP.toString("base64"),
            "srtp://" + session.address + ":" + session.videoPort + "?rtcpport=" + session.videoPort + "&pkt_size=" + session.videoMtu
        ];
        const ffmpeg = spawn(this.ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
        ffmpeg.stderr.on("data", (b) => {
            this.log.debug("ffmpeg: %s", b.toString().trim());
        });
        ffmpeg.on("exit", (code) => {
            this.log.debug("ffmpeg exited with %s", String(code));
            this.stopStream(request.sessionID);
        });
        tend.on("h264", (chunk) => {
            if (ffmpeg.stdin?.writable) {
                ffmpeg.stdin.write(chunk);
            }
        });
        tend.on("error", (err) => {
            this.log.error("Tend stream error: %s", String(err));
            this.stopStream(request.sessionID);
        });
        this.active.set(request.sessionID, { ffmpeg, tend });
        this.log.info("Live stream up for %s (%dx%d @ %d fps)", this.cam.name, videoInfo.width, videoInfo.height, videoInfo.fps);
        callback();
    }
    stopStream(sessionId) {
        const a = this.active.get(sessionId);
        if (a) {
            try {
                a.tend.stop();
            }
            catch {
                // ignore
            }
            try {
                a.ffmpeg.stdin?.end();
                a.ffmpeg.kill("SIGTERM");
            }
            catch {
                // ignore
            }
            this.active.delete(sessionId);
        }
        this.sessions.delete(sessionId);
    }
    reservePort(ipv6) {
        return new Promise((resolve, reject) => {
            const sock = dgram.createSocket(ipv6 ? "udp6" : "udp4");
            sock.once("error", reject);
            sock.bind(0, () => {
                const port = sock.address().port;
                sock.close(() => resolve(port));
            });
        });
    }
}
//# sourceMappingURL=myq-camera.js.map