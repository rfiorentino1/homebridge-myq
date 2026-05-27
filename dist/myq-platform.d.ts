import { API, DynamicPlatformPlugin, HAP, Logging, PlatformAccessory, PlatformConfig } from "homebridge";
import { myQOptions } from "./myq-options.js";
import { myQAccessory } from "./myq-device.js";
import { myQApi } from "@hjdhjd/myq";
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
    readonly hap: HAP;
    readonly log: Logging;
    readonly mqtt: myQMqtt;
    readonly myQApi: myQApi;
    private pollingTimer;
    readonly pollOptions: myQPollInterface;
    private unsupportedDevices;
    constructor(log: Logging, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private login;
    private discoverAndSyncAccessories;
    private updateAccessories;
    poll(delay?: number): void;
    featureOptionDefault(option: string): boolean;
    debug(message: string, ...parameters: unknown[]): void;
}
export {};
