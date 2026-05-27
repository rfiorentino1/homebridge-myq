import { myQAccessory } from "./myq-device.js";
export declare class myQLamp extends myQAccessory {
    private lastUpdate;
    protected configureDevice(): void;
    protected configureInfo(): boolean;
    private configureLamp;
    private configureMqtt;
    private setLampState;
    updateState(): boolean;
    private lampStatus;
    private lampCommand;
}
