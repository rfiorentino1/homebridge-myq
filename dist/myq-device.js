import { getOptionFloat, getOptionNumber, getOptionValue, isOptionEnabled } from "./myq-options.js";
import util from "node:util";
export class myQAccessory {
    accessory;
    api;
    config;
    hap;
    hints;
    log;
    myQ;
    myQApi;
    platform;
    // The constructor initializes key variables and calls configureDevice().
    constructor(platform, accessory, device) {
        this.accessory = accessory;
        this.api = platform.api;
        this.config = platform.config;
        this.hap = this.api.hap;
        this.hints = {};
        this.myQ = device;
        this.myQApi = platform.myQApi;
        this.platform = platform;
        this.log = {
            debug: (message, ...parameters) => platform.debug(util.format(this.name + ": " + message, ...parameters)),
            error: (message, ...parameters) => platform.log.error(util.format(this.name + ": " + message, ...parameters)),
            info: (message, ...parameters) => platform.log.info(util.format(this.name + ": " + message, ...parameters)),
            warn: (message, ...parameters) => platform.log.warn(util.format(this.name + ": " + message, ...parameters))
        };
        this.configureDevice();
    }
    // Configure device-specific settings.
    configureHints() {
        this.hints.syncNames = this.hasFeature("Device.SyncNames");
        return true;
    }
    // Called when the myQ API becomes unreachable, so the accessory can flip itself to "No Response" in HomeKit
    // instead of leaving a stale value on display. Default is a no-op; device types that have a meaningful live
    // state to misrepresent (e.g. the garage door) override this.
    markUnreachable() {
        return;
    }
    // Execute myQ commands.
    async command(myQCommand) {
        if (!this.myQ) {
            this.log.error("Can't find the associated device in the myQ API.");
            return false;
        }
        // Execute the command.
        if (!(await this.myQApi.execute(this.myQ, myQCommand))) {
            return false;
        }
        // Increase the frequency of our polling for state updates to catch any updates from myQ.
        // This will trigger polling at activeRefreshInterval until activeRefreshDuration is hit. If you
        // query the myQ API too quickly, the API won't have had a chance to begin executing our command.
        this.platform.pollOptions.count = 0;
        this.platform.poll(this.config.refreshInterval * -1);
        return true;
    }
    // Configure the device information for HomeKit.
    configureInfo() {
        // Decode our hardware information if we have access to it.
        const hwInfo = this.myQApi.getHwInfo(this.myQ?.serial_number);
        // Update the manufacturer information for this device.
        this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Manufacturer, hwInfo?.brand ?? "Liftmaster");
        // Update the model information for this device.
        this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.Model, hwInfo?.product ?? "myQ");
        // Update the serial number for this device.
        if (this.myQ?.serial_number) {
            this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.SerialNumber, this.myQ.serial_number);
        }
        // Set the firmware revision for this device. Fun fact: This firmware information is stored on the gateway not the device.
        const firmwareVersion = this.myQApi.devices.find(x => x.serial_number === this.myQ.parent_device_id)?.state?.firmware_version ?? null;
        if (firmwareVersion) {
            this.accessory.getService(this.hap.Service.AccessoryInformation)?.updateCharacteristic(this.hap.Characteristic.FirmwareRevision, firmwareVersion);
        }
        return true;
    }
    // Utility function to return a floating point configuration parameter on a device.
    getFeatureFloat(option) {
        return getOptionFloat(getOptionValue(this.platform.configOptions, this.myQ, option));
    }
    // Utility function to return an integer configuration parameter on a device.
    getFeatureNumber(option) {
        return getOptionNumber(getOptionValue(this.platform.configOptions, this.myQ, option));
    }
    // Utility for checking feature options on a device.
    hasFeature(option) {
        return isOptionEnabled(this.platform.configOptions, this.myQ, option, this.platform.featureOptionDefault(option));
    }
    // Name utility function.
    get name() {
        return this.accessory.displayName ?? this.myQ.name;
    }
}
//# sourceMappingURL=myq-device.js.map