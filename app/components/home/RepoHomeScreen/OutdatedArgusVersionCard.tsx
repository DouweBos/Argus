import { CalloutCard, IconBadge, Icons } from "@argus/peacock";

interface OutdatedArgusVersionCardProps {
  appVersion: string;
  minVersion: string;
}

export function OutdatedArgusVersionCard({
  appVersion,
  minVersion,
}: OutdatedArgusVersionCardProps) {
  return (
    <CalloutCard
      tone="warning"
      leading={
        <IconBadge tone="warning">
          <Icons.WarningIcon size={14} />
        </IconBadge>
      }
      title="Argus is out of date for this project"
      meta={`This project requires Argus ${minVersion} or newer. You're running ${appVersion}. Update Argus from the menu (Argus → Check for updates) to avoid missing features and config keys.`}
    />
  );
}
