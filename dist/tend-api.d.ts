/// <reference types="node" />
import { TendCameraInfo } from "./tend-types.js";
export declare class TendApi {
    private jwt;
    private refreshToken;
    private expiresAt;
    constructor(jwt: string, refreshToken?: string);
    /**
     * Refresh the access token using the IDS refresh-token grant. The plugin's myQ lib
     * occasionally null's its own access token when the legacy /v5.2/Accounts/{id}/Devices
     * endpoint returns 530; this path keeps Tend access working independently.
     */
    refresh(): Promise<boolean>;
    getRefreshToken(): string | null;
    getJwt(): string;
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
