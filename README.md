# homebridge-myq — refresh-token-only fork

Fork of [hjdhjd/homebridge-myq](https://github.com/hjdhjd/homebridge-myq) adapted for the **post-AppCheck era** so myQ garage door openers (Liftmaster / Chamberlain) can be controlled from HomeKit again.

## Why this fork exists

hjdhjd retired `homebridge-myq` in late 2023 / early 2024 after Chamberlain put **Firebase App Check** (Play Integrity / App Attest) in front of the `authorization_code` grant on their identity server. The email-and-password login flow that every community client used stopped working overnight, and there was no clean alternative UX to ship.

The `refresh_token` grant on the same endpoint stayed open. This fork:

- Depends on [`rfiorentino1/myq`](https://github.com/rfiorentino1/myq) (a corresponding fork of the library) which uses Chamberlain's iOS confidential client `IOS_CGI_MYQ` and skips the AppCheck-gated authorization_code path.
- Replaces the `email` + `password` plugin config fields with a single `refreshToken` field.
- Removes hjdhjd's retirement-message early-return so the plugin actually starts.
- Otherwise leaves the plugin essentially unchanged — same MQTT support, same feature options, same polling, same garage-door + lamp accessory types.

## Install

```bash
sudo hb-service add github:rfiorentino1/homebridge-myq
```

Pre-built `dist/` is committed so installs don't require TypeScript compilation on the Pi. ~1 minute on a Raspberry Pi 4.

## Config

In Homebridge's `config.json`:

```json
{
  "platform": "myQ",
  "name": "myQ",
  "refreshToken": "PASTE_YOUR_REFRESH_TOKEN_HERE"
}
```

All of the original feature options (MQTT broker URL, refresh intervals, per-device hide rules, debug logging, etc.) still work — see [hjdhjd's documentation](https://github.com/hjdhjd/homebridge-myq) for the full list.

## How do I get a refresh_token? ← the hard part

You need to do this **once**, on a real iOS or Android device with the official myQ app installed and logged into your account. After that, the plugin runs indefinitely against your account without that device.

Today the extraction is manual — you mitm your phone's myQ traffic and grab the `refresh_token` value from a `/connect/token` response body. mitmproxy in WireGuard mode + iOS WireGuard app is the cleanest path; the entire flow takes about 20 minutes.

A future version of this plugin will embed the bootstrap UX so a user can click a button in the Homebridge UI, scan a QR with their phone's WireGuard app, install a CA, open the myQ app, and have the plugin auto-fill the `refreshToken` field. That's the right shape but not built yet.

Until then, this fork is genuinely for technical users.

## Limitations / known issues

- **Cameras are discovered but not yet integrated.** The plugin logs `myQ device family 'camera' is not currently supported, ignoring` for myQ cameras (`TC-0005-*`). Camera streams use Tend's WebRTC + Seedonk P2P, which is its own RE project. Tracked separately.
- **Capturing your refresh_token will likely cause your myQ phone app to display "offline" briefly.** Chamberlain's IDS rotates refresh tokens; when you redeem one, it invalidates the previous holder's session. Force-quit + reopen the myQ app and it'll re-authenticate. After that initial conflict, your phone and the plugin coexist fine — each has its own refresh_token.
- **Chamberlain could close the refresh-grant path at any time** by adding AppCheck enforcement to refresh requests too. As of mid-2026 they have not, and the third-party [`@amritbrar/homebridge-myq`](https://www.npmjs.com/package/@amritbrar/homebridge-myq) npm package using the same approach has been live for 9+ months without breakage. Long-term durability is not guaranteed.

## Credit

The entire plugin architecture, HomeKit accessory layer, MQTT support, feature-options system, and v6 API decoding is **hjdhjd's work** ([hjdhjd/homebridge-myq](https://github.com/hjdhjd/homebridge-myq) and [hjdhjd/myq](https://github.com/hjdhjd/myq)). This fork is a minimal patch on top, made necessary by Chamberlain's post-2023 hostility to third-party clients. If hjdhjd ever revives the upstream project, this fork should be retired.

## License

ISC, per upstream.
