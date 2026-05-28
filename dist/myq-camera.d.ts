import { API, CameraController, CameraStreamingDelegate, Logger, PlatformAccessory, PrepareStreamCallback, PrepareStreamRequest, SnapshotRequest, SnapshotRequestCallback, StreamingRequest, StreamRequestCallback } from "homebridge";
import { TendCameraInfo } from "./tend-types.js";
/**
 * The plugin's myQApi is built around the old myQ garage-door REST API. Cameras
 * live in Tend, so we get the JWT via the same mechanism (refresh_token grant)
 * but only borrow the access_token via this provider interface.
 */
export interface TendJwtProvider {
    jwt(): string;
}
export declare class myQCamera implements CameraStreamingDelegate {
    readonly controller: CameraController;
    private readonly accessory;
    private readonly api;
    private readonly hap;
    private readonly log;
    private readonly cam;
    private readonly tendApi;
    private readonly jwtProvider;
    private readonly ffmpegPath;
    private active;
    private sessions;
    constructor(accessory: PlatformAccessory, api: API, log: Logger, cam: TendCameraInfo, jwtProvider: TendJwtProvider, ffmpegPath?: string);
    handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void>;
    prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void>;
    handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void;
    private startStream;
    private stopStream;
    private reservePort;
}
