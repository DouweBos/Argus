import type {
  AccountConfig,
  AccountConfigPatch,
  AccountGrantSetting,
} from "../../../lib/types";
import { useState } from "react";
import { Input, Select, SettingsScreenField, Toggle } from "@argus/peacock";
import { accountSetConfig } from "../../../lib/ipc";
import styles from "./AccountSection.module.css";

const PUBLISH: { key: keyof AccountConfig["publish"]; label: string }[] = [
  { key: "lan", label: "LAN address" },
  { key: "tailscale", label: "Tailscale" },
  { key: "cloudflare", label: "Cloudflare tunnel" },
];

function save(patch: AccountConfigPatch) {
  accountSetConfig(patch).catch(() => undefined);
}

/** This computer's account settings (§8) — machine-local, not synced. */
export function AccountSettingsFields({ config }: { config: AccountConfig }) {
  const [serviceUrl, setServiceUrl] = useState(config.service_url);

  return (
    <>
      <SettingsScreenField
        label="Use the account"
        caption="Off stops publishing this computer's address and refuses account devices, while staying linked."
      >
        <Toggle
          checked={config.enabled}
          onChange={(enabled) => save({ enabled })}
        />
      </SettingsScreenField>
      <SettingsScreenField
        label="Publish addresses"
        caption="Which addresses go into the account directory. The account service can see them, including LAN IPs."
      >
        <div className={styles.list}>
          {PUBLISH.map(({ key, label }) => (
            <Toggle
              key={key}
              checked={config.publish[key]}
              onChange={(on) => save({ publish: { [key]: on } })}
            >
              {label}
            </Toggle>
          ))}
        </div>
      </SettingsScreenField>
      <SettingsScreenField
        label="Access for account devices"
        caption="What iPhones, and Macs or desktop windows, on the account may do on this computer."
      >
        <div className={styles.grants}>
          <label className={styles.grant}>
            iPhone
            <Select
              value={config.grants.ios}
              onChange={(e) =>
                save({
                  grants: { ios: e.target.value as AccountGrantSetting },
                })
              }
            >
              <option value="monitor">Watch only</option>
              <option value="control">Run agents</option>
            </Select>
          </label>
          <label className={styles.grant}>
            Mac and desktop
            <Select
              value={config.grants.desktop}
              onChange={(e) =>
                save({
                  grants: { desktop: e.target.value as AccountGrantSetting },
                })
              }
            >
              <option value="monitor">Watch only</option>
              <option value="control">Run agents</option>
              <option value="admin">Full control</option>
            </Select>
          </label>
        </div>
      </SettingsScreenField>
      <SettingsScreenField
        label="Approve from this computer"
        caption="Lets this computer approve other computers joining the account. A computer that can approve can add devices to your other computers too."
      >
        <Toggle
          checked={config.hosts_can_approve}
          onChange={(on) => save({ hosts_can_approve: on })}
        />
      </SettingsScreenField>
      <SettingsScreenField
        label="Account service"
        caption="Leave empty for the built-in service. Only for self-hosting or testing."
      >
        <Input
          placeholder="https://houwert.dev/argus/account/v1"
          value={serviceUrl}
          onChange={(e) => setServiceUrl(e.target.value)}
          onBlur={() => save({ service_url: serviceUrl.trim() })}
        />
      </SettingsScreenField>
    </>
  );
}
