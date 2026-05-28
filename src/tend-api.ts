/* Tend REST API client.
 *
 * Talks to media.hubs.tend-us.tendplatform.com (the camera platform) using the
 * same Bearer JWT that the rest of the plugin uses for the Chamberlain IDS
 * (refresh_token grant against partner-identity.myq-cloud.com).
 *
 * Endpoints used:
 *   POST /cxs/api/devices/{id}/do/wakeup      — nudge dormant camera awake
 *   GET  /cxs/api/devices/{id}                — device info (capabilities + AES key under settings.p2pKey)
 *   GET  /cxs/api/devices/{id}/cam/recentImage.jpg?size=FHD&forceRefresh=true   — snapshot
 *
 * The CDLIST string from CXNet sign-in carries the AES key too, but to avoid
 * making this module depend on the CXNet TLS layer we pull it from the
 * settings.p2pKey field (same value).
 */
import { TendCameraInfo } from "./tend-types.js";

const TEND_HOST = "media.hubs.tend-us.tendplatform.com";
const SNAPSHOT_USER_AGENT = "myQ/310.0.63387 CFNetwork/3860.600.12 Darwin/25.5.0";
const APP_VERSION = "5.310.0.63387";
const IDS_TOKEN_URL = "https://partner-identity.myq-cloud.com/connect/token";

export class TendApi {

  private jwt: string;
  private refreshToken: string | null;
  private expiresAt = 0; // unix seconds

  constructor(jwt: string, refreshToken?: string) {

    this.jwt = jwt;
    this.refreshToken = refreshToken ?? null;
  }

  /**
   * Refresh the access token using the IDS refresh-token grant. The plugin's myQ lib
   * occasionally null's its own access token when the legacy /v5.2/Accounts/{id}/Devices
   * endpoint returns 530; this path keeps Tend access working independently.
   */
  public async refresh(): Promise<boolean> {

    if(!this.refreshToken) {

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

    if(!r.ok) {

      return false;
    }

    const data = await r.json() as { access_token: string, refresh_token: string, expires_in: number };

    this.jwt = data.access_token;
    this.refreshToken = data.refresh_token;
    this.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

    return true;
  }

  public getRefreshToken(): string | null {

    return this.refreshToken;
  }

  public getJwt(): string {

    return this.jwt;
  }

  /** Update the bearer token (after refresh). */
  public setJwt(jwt: string): void {

    this.jwt = jwt;
  }

  private headers(): Record<string, string> {

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
  public async listCameras(): Promise<TendCameraInfo[]> {

    const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices", { headers: this.headers() });

    if(!r.ok) {

      return [];
    }

    const data = await r.json() as { items?: Array<Record<string, unknown>> };
    const cameras: TendCameraInfo[] = [];

    for(const item of data.items ?? []) {

      if(item.type !== "cam") {

        continue;
      }

      // Refetch the full device to get the AES p2pKey under settings
      const full = await this.getDevice(item.id as string);

      if(!full) {

        continue;
      }

      const ownership = item.ownership as Record<string, unknown> | undefined;
      const accountAlias = (ownership?.ownerAlias as string) ?? "";
      const accountId = accountAlias.replace(/^myq/, "");
      const info = this.buildCameraInfo(full, accountId);

      if(info) {

        cameras.push(info);
      }
    }

    return cameras;
  }

  /** Wake a dormant camera so subsequent snapshot/stream requests succeed. */
  public async wakeup(numericId: string): Promise<boolean> {

    const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices/" + numericId + "/do/wakeup", {

      method: "POST",
      headers: this.headers()
    });

    return r.ok;
  }

  /** Fetch device info JSON. */
  public async getDevice(numericId: string): Promise<Record<string, unknown> | null> {

    const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices/" + numericId, { headers: this.headers() });

    if(!r.ok) {

      return null;
    }

    return await r.json() as Record<string, unknown>;
  }

  /** Fetch a JPEG snapshot. Returns Buffer or null. */
  public async getSnapshot(numericId: string, forceRefresh = true): Promise<Buffer | null> {

    const qs = forceRefresh ? "?size=FHD&forceRefresh=true" : "?size=FHD";
    const r = await fetch("https://" + TEND_HOST + "/cxs/api/devices/" + numericId + "/cam/recentImage.jpg" + qs, {

      headers: this.headers()
    });

    if(!r.ok) {

      return null;
    }

    const ab = await r.arrayBuffer();

    return Buffer.from(ab);
  }

  /**
   * Build a TendCameraInfo from a /cxs/api/devices/{id} response.
   * The caller has already filtered to camera type.
   */
  public buildCameraInfo(device: Record<string, unknown>, accountId: string): TendCameraInfo | null {

    const id = device.id as string;
    const serial = device.serialNumber as string;
    const alias = device.alias as string;

    if(!id || !serial || !alias) {

      return null;
    }

    // Extract MAC from alias (last 17 chars after the colon)
    const macParts = alias.split(":").slice(-6);
    const mac = macParts.join(":");

    const settings = device.settings as Record<string, unknown> | undefined;
    const aesKey = (settings?.p2pKey as string) ?? "";
    const cap = device.cap as Record<string, unknown> | undefined;
    const camCap = cap?.cam as Record<string, unknown> | undefined;
    const micCap = cap?.mic as Record<string, unknown> | undefined;
    const spkCap = cap?.spk as Record<string, unknown> | undefined;

    const resList = (camCap?.resList as Array<{ id: string }>) ?? [];
    const resolution = resList[0]?.id ?? "1280x720";

    const displayName = (settings?.displayName as string) ?? ("myQ Camera " + id);

    return {

      account_id: accountId,
      aes_key: aesKey,
      alias,
      has_mic: (micCap?.exists as boolean) ?? false,
      has_talkback: (spkCap?.talkback as boolean) ?? false,
      id,
      mac,
      name: displayName,
      online: true,
      resolution,
      serial_number: serial
    };
  }
}
