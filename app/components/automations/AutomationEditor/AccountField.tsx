import { automationAccountOptions } from "@argus/client-core";
import { FormField, Icons, MenuChip } from "@argus/peacock";
import { useClaudeAccounts } from "../../../stores/claudeAccountsStore";

/**
 * Which Claude account the run signs in as. Only offered with more than one
 * account, or while a pin is set so it can still be cleared.
 */
export function AccountField({
  value,
  onChange,
}: {
  onChange: (id: string) => void;
  value: string;
}) {
  const { accounts, activeId } = useClaudeAccounts();
  if (accounts.length < 2 && !value) {
    return null;
  }

  return (
    <FormField
      label="Claude account"
      helper={
        value
          ? "Runs only on this account, and never move to another one when its plan limit is reached."
          : "Follows the active account, and may move to another one when its plan limit is reached."
      }
    >
      <MenuChip
        showsTitle
        leading={<Icons.OrganizationIcon size={11} />}
        options={automationAccountOptions(accounts, activeId, value).map(
          (o) => ({
            value: o.value,
            label: o.name,
            hint: o.description,
          }),
        )}
        title="Account"
        value={value}
        onChange={onChange}
      />
    </FormField>
  );
}
