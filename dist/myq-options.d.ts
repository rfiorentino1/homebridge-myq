import { myQDevice } from "@hjdhjd/myq";
export interface myQOptions {
    activeRefreshDuration: number;
    activeRefreshInterval: number;
    debug: boolean;
    mqttTopic: string;
    mqttUrl: string;
    name: string;
    options: string[];
    refreshInterval: number;
    refreshToken: string;
}
export declare const featureOptionCategories: {
    description: string;
    name: string;
    validFor: string[];
}[];
export declare const featureOptions: {
    [index: string]: FeatureOption[];
};
export interface FeatureOption {
    default: boolean;
    defaultValue?: number;
    description: string;
    group?: string;
    hasFeature?: string[];
    hasProperty?: string[];
    name: string;
}
export declare function isOptionEnabled(configOptions: string[], device: myQDevice | null, option?: string, defaultReturnValue?: boolean): boolean;
export declare function getOptionValue(configOptions: string[], device: myQDevice | null, option: string): string | undefined;
export declare function getOptionFloat(optionValue: string | undefined): number | undefined;
export declare function getOptionNumber(optionValue: string | undefined): number | undefined;
