/// <reference types="node" />
import { TendCameraInfo } from "./tend-types.js";
export declare class TendApi {
    private jwt;
    constructor(jwt: string);
    /** Update the bearer token (after refresh). */
    setJwt(jwt: string): void;
    private headers;
    /**
     * List all cameras available to this account.
     * Returns parsed TendCameraInfo[] (filters to type=cam only).
     */
    listCameras(): Promise<TendCameraInfo[]>;
    /** Wake a dormant camera so subsequent snapshot/stream requests succeed. */
    wakeup(numericId: string): Promise<boolean>;
    /** Fetch device info JSON. */
    getDevice(numericId: string): Promise<Record<string, unknown> | null>;
    /** Fetch a JPEG snapshot. Returns Buffer or null. */
    getSnapshot(numericId: string, forceRefresh?: boolean): Promise<Buffer | null>;
    /**
     * Build a TendCameraInfo from a /cxs/api/devices/{id} response.
     * The caller has already filtered to camera type.
     */
    buildCameraInfo(device: Record<string, unknown>, accountId: string): TendCameraInfo | null;
}
