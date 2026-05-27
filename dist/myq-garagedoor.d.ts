import { myQAccessory } from "./myq-device.js";
export declare class myQGarageDoor extends myQAccessory {
    private batteryDeviceSupport;
    private obstructionDetected;
    private obstructionTimer;
    private occupancyTimer;
    protected configureDevice(): void;
    protected configureHints(): boolean;
    private configureGarageDoor;
    private configureBatteryInfo;
    private configureSwitch;
    protected configureOccupancySensor(): boolean;
    private configureMqtt;
    private setDoorState;
    updateState(): boolean;
    private doorCommand;
    private translateDoorState;
    private doorCurrentStateBias;
    private doorTargetStateBias;
    private get status();
    private get dpsBatteryStatus();
    private get isOnline();
    get name(): string;
}
