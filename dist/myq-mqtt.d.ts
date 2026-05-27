/// <reference types="node" />
import { PlatformAccessory } from "homebridge";
import { myQDevice } from "@hjdhjd/myq";
import { myQPlatform } from "./myq-platform.js";
export declare class myQMqtt {
    private config;
    private debug;
    private isConnected;
    private log;
    private mqtt;
    private platform;
    private subscriptions;
    constructor(platform: myQPlatform);
    private configure;
    publish(accessory: PlatformAccessory, topic: string, message: string): void;
    subscribe(accessory: PlatformAccessory, device: myQDevice, topic: string, callback: (cbBuffer: Buffer) => void): void;
    private expandTopic;
}
