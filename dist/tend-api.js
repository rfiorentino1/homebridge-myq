const TEND_HOST = "media.hubs.tend-us.tendplatform.com";
const SNAPSHOT_USER_AGENT = "myQ/310.0.63387 CFNetwork/3860.600.12 Darwin/25.5.0";
const APP_VERSION = "5.310.0.63387";
const IDS_TOKEN_URL = "https://partner-identity.myq-cloud.com/connect/token";
export class TendApi {
    jwt;
    refreshToken;
    expiresAt = 0; // unix seconds
    constructor(jwt, refreshToken) {
        this.jwt = jwt;
        this.refreshToken = refreshToken ?? null;
    }
    /**
     * Refresh the access token using the IDS refresh-token grant. The plugin's myQ lib
     * occasionally null's its own access token when the legacy /v5.2/Accounts/{id}/Devices
     * endpoint returns 530; this path keeps Tend access working independently.
     */
    async refresh() {
        if (!this.refreshToken) {
            return false;
        }
        const body = new URLSearchParams({
            "client_id": "IOS_CGI_MYQ",
            "grant_type": "refresh_token",
            "refresh_token": this.refreshToken
        });
        const r = await fetch(IDS_TOKEN_URL, {
            body,
            headers: {
                "App-Version": APP_VERSION,
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": SNAPSHOT_USER_AGENT
            },
            method: "POST"
        });
        if (!r.ok) {
            return false;
        }
        const data = await r.json();
        this.jwt = data.access_token;
        this.refreshToken = data.refresh_token;
        this.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
        return true;
    }
    getRefreshToken() {
        return this.refreshToken;
    }
    getJwt() {
        return this.jwt;
    }
    /** Update the bearer token (after refresh). */
    setJwt(jwt) {
        this.jwt = jwt;
    }
    headers() {
        return {
            "Authorization": "Bearer " + this.jwt,
            "AntiCSRF": "AntiCSRF",
            "User-Agent": SNAPSHOT_USER_AGENT,
            "App-Version": APP_VERSION
        };
    }
    /**
     * List all cameras available to this account.
     * Returns parsed TendCameraInfo[] (filters to type=cam only).
     */
    async listCameras() {
        const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices", { headers: this.headers() });
        if (!r.ok) {
            return [];
        }
        const data = await r.json();
        const cameras = [];
        for (const item of data.items ?? []) {
            if (item.type !== "cam") {
                continue;
            }
            // Refetch the full device to get the AES p2pKey under settings
            const full = await this.getDevice(item.id);
            if (!full) {
                continue;
            }
            const ownership = item.ownership;
            const accountAlias = ownership?.ownerAlias ?? "";
            const accountId = accountAlias.replace(/^myq/, "");
            const info = this.buildCameraInfo(full, accountId);
            if (info) {
                cameras.push(info);
            }
        }
        return cameras;
    }
    /** Wake a dormant camera so subsequent snapshot/stream requests succeed. */
    async wakeup(numericId) {
        const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices/" + numericId + "/do/wakeup", {
            method: "POST",
            headers: this.headers()
        });
        return r.ok;
    }
    /** Fetch device info JSON. */
    async getDevice(numericId) {
        const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices/" + numericId, { headers: this.headers() });
        if (!r.ok) {
            return null;
        }
        return await r.json();
    }
    /** Fetch a JPEG snapshot. Returns Buffer or null. */
    async getSnapshot(numericId, forceRefresh = true) {
        const qs = forceRefresh ? "?size=FHD&forceRefresh=true" : "?size=FHD";
        const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices/" + numericId + "/cam/recentImage.jpg" + qs, {
            headers: this.headers()
        });
        if (!r.ok) {
            return null;
        }
        const ab = await r.arrayBuffer();
        return Buffer.from(ab);
    }
    /**
     * Build a TendCameraInfo from a /cxs/api/devices/{id} response.
     * The caller has already filtered to camera type.
     */
    buildCameraInfo(device, accountId) {
        const id = device.id;
        const serial = device.serialNumber;
        const alias = device.alias;
        if (!id || !serial || !alias) {
            return null;
        }
        // Extract MAC from alias (last 17 chars after the colon)
        const macParts = alias.split(":").slice(-6);
        const mac = macParts.join(":");
        const settings = device.settings;
        const aesKey = settings?.p2pKey ?? "";
        const cap = device.cap;
        const camCap = cap?.cam;
        const micCap = cap?.mic;
        const spkCap = cap?.spk;
        const resList = camCap?.resList ?? [];
        const resolution = resList[0]?.id ?? "1280x720";
        const displayName = settings?.displayName ?? ("myQ Camera " + id);
        return {
            account_id: accountId,
            aes_key: aesKey,
            alias,
            has_mic: micCap?.exists ?? false,
            has_talkback: spkCap?.talkback ?? false,
            id,
            mac,
            name: displayName,
            online: true,
            resolution,
            serial_number: serial
        };
    }
}
//# sourceMappingURL=tend-api.js.map