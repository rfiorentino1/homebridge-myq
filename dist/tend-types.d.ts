export interface TendCameraInfo {
    /** Numeric ID (e.g. "14097559"). Used in REST URLs. */
    id: string;
    /** Full Tend serial (e.g. "TC-0005-14097559"). */
    serial_number: string;
    /** SDK alias of the form "<account_alias>:<MAC>" — used as CXS dst_id. */
    alias: string;
    /** Camera MAC address (canonical colon-separated form). */
    mac: string;
    /** Display name. */
    name: string;
    /** Account UUID (the user's account, not the camera's). */
    account_id: string;
    /** 16-byte AES key (ASCII string from CDLIST) used for video AES-128-CBC decrypt. */
    aes_key: string;
    /** Online state (camera reachable). */
    online: boolean;
    /** Stream resolution string ("1280x720"). */
    resolution: string;
    /** Whether the camera has a microphone (advertised). */
    has_mic: boolean;
    /** Whether talkback (speaker on camera) is supported. */
    has_talkback: boolean;
}
export interface TendDeviceListResp {
    items?: TendCameraInfo[];
    count?: number;
}
