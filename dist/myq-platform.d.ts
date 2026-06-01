import { API, DynamicPlatformPlugin, HAP, Logging, PlatformAccessory, PlatformConfig } from "homebridge";
import { myQOptions } from "./myq-options.js";
import { myQAccessory } from "./myq-device.js";
import { myQApi } from "@hjdhjd/myq";
import { myQCamera } from "./myq-camera.js";
import { myQMqtt } from "./myq-mqtt.js";
interface myQPollInterface {
    count: number;
    maxCount: number;
}
export declare class myQPlatform implements DynamicPlatformPlugin {
    private readonly accessories;
    readonly api: API;
    private featureOptionDefaults;
    config: myQOptions;
    readonly configOptions: string[];
    readonly configuredDevices: {
        [index: string]: myQAccessory;
    };
    readonly configuredCameras: {
        [index: string]: myQCamera;
    };
    readonly hap: HAP;
    readonly log: Logging;
    readonly mqtt: myQMqtt;
    readonly myQApi: myQApi;
    private pollingTimer;
    private pollFailures;
    apiOnline: boolean;
    readonly pollOptions: myQPollInterface;
    private unsupportedDevices;
    private tendApi;
    constructor(log: Logging, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    /**
     * Write the rotated refresh_token back into config.json so it survives Homebridge
     * restarts. This is the same field the config UI populates (and will populate when the
     * WireGuard mitm-bootstrap UX ships), so there's one source of truth. Atomic write via
     * temp + rename so a crash mid-write can't corrupt config.json.
     */
    private persistRefreshToken;
    private login;
    /**
     * Find Tend cameras (TC-0005-* serials) for this account and register a CameraController
     * accessory for each. Snapshots use the Tend REST endpoint; live streaming uses CXNet +
     * SDNK NAT punching + AES-CBC decrypt (see tend-stream.ts / tend-cxnet.ts).
     */
    private discoverCameras;
    private discoverAndSyncAccessories;
    private updateAccessories;
    poll(delay?: number): void;
    featureOptionDefault(option: string): boolean;
    debug(message: string, ...parameters: unknown[]): void;
}
export {};
