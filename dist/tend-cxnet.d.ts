/// <reference types="node" />
export interface CxFrame {
    name: number;
    version: number;
    direction: number;
    serviceId: number;
    actionId: number;
    cryptoId: number;
    serverId: Buffer;
    toLong: bigint;
    fromBytes: Buffer;
    options: Buffer;
    data: Buffer;
}
export declare function encodeProperties(props: Record<string, string>): Buffer;
export declare function parseProperties(data: Buffer): Record<string, string>;
export declare function encodeFrame(f: CxFrame): Buffer;
export declare class CxClient {
    private host;
    private port;
    private sni;
    private sock;
    private rxBuf;
    fromBytes: Buffer;
    private pending;
    constructor(host: string, port: number, sni?: string);
    connect(): Promise<void>;
    private flushPending;
    private onData;
    close(): void;
    private sendFrame;
    /** Wait for the next inbound frame matching one of the action IDs (or any if undefined). */
    recvFrame(timeoutMs?: number, allowedActions?: number[]): Promise<CxFrame | null>;
    /** Send action-411 command. */
    sendCommand(cmd: string, dstId: string, correlationId: string): void;
    /**
     * Login with the Bearer JWT. Returns:
     *   - "REDIRECT" + {host,port} when the server tells us to chase to a different broker
     *   - "OK" + frame when login succeeds (frame contains alias, session-id, etc. in data props)
     *   - "ERROR" + frame on failure
     */
    login(jwt: string, partnerId?: string): Promise<{
        result: string;
        frame: CxFrame | null;
        redirect?: {
            host: string;
            port: number;
        };
    }>;
}
