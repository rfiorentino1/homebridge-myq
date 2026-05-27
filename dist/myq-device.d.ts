import { API, HAP, PlatformAccessory } from "homebridge";
import { myQOptions } from "./myq-options.js";
import { myQApi, myQDevice } from "@hjdhjd/myq";
import { myQPlatform } from "./myq-platform.js";
interface myQLogging {
    debug: (message: string, ...parameters: unknown[]) => void;
    error: (message: string, ...parameters: unknown[]) => void;
    info: (message: string, ...parameters: unknown[]) => void;
    warn: (message: string, ...parameters: unknown[]) => void;
}
interface myQHints {
    automationSwitch: boolean;
    occupancyDuration: number;
    occupancySensor: boolean;
    readOnly: boolean;
    showBatteryInfo: boolean;
    syncNames: boolean;
}
export declare abstract class myQAccessory {
    protected readonly accessory: PlatformAccessory;
    protected readonly api: API;
    protected readonly config: myQOptions;
    protected readonly hap: HAP;
    hints: myQHints;
    protected readonly log: myQLogging;
    myQ: myQDevice;
    protected readonly myQApi: myQApi;
    protected readonly platform: myQPlatform;
    constructor(platform: myQPlatform, accessory: PlatformAccessory, device: myQDevice);
    protected configureHints(): boolean;
    protected abstract configureDevice(): void;
    abstract updateState(): boolean;
    protected command(myQCommand: string): Promise<boolean>;
    protected configureInfo(): boolean;
    getFeatureFloat(option: string): number | undefined;
    getFeatureNumber(option: string): number | undefined;
    hasFeature(option: string): boolean;
    get name(): string;
}
export {};
