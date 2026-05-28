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

export class TendApi {

  private jwt: string;

  constructor(jwt: string) {

    this.jwt = jwt;
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
