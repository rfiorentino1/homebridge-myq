/// <reference types="node" />
import { EventEmitter } from "node:events";
import { TendCameraInfo } from "./tend-types.js";
export declare class TendStream extends EventEmitter {
    private jwt;
    private cam;
    private userAlias;
    private cxs;
    private udp;
    private udpAudio;
    private relayHost;
    private relayPort;
    private cameraPubIp;
    private cameraLanIp;
    private cameraPort;
    private cameraAudioPort;
    private cameraAudioLanIp;
    private cameraAudioPubIp;
    private localIp;
    private localPort;
    private localAudioPort;
    private block1;
    private block2;
    private aesKey;
    private resCounter;
    private incomingReqPunchCount;
    private preferLan;
    private sentSeq2;
    private sentSeq2Audio;
    private punchInterval;
    private assembly;
    private maxAssemblyAge;
    private h264Buffer;
    packetsRx: number;
    framesDecoded: number;
    nalsEmitted: number;
    decryptFailures: number;
    constructor(jwt: string, cam: TendCameraInfo);
    /** Run the full handshake; on success emits "h264" events with Annex B chunks. */
    start(): Promise<void>;
    private buildReqConnInfo;
    private buildAckConnInfo;
    private buildReqPunch;
    private buildResPunch;
    private buildAckPunch;
    private maybeSendPunchResponse;
    private onUdp;
    private onMediaChunk;
    private processAssembled;
    private aesDecrypt;
    private emitNals;
    /** Stop streaming and tear down everything. */
    stop(): void;
    private static buildBlock;
}
