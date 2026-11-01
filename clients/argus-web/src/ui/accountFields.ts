/**
 * The account rows Settings shows for a hosted computer. The hosted entry
 * provides them, so the network bundle never pulls in the account code (and
 * the zod schemas its log verification needs).
 */

import type { ComponentType } from "react";

export interface AccountFields {
  Name: ComponentType;
  SignOut: ComponentType;
}

let provided: AccountFields | null = null;

export function provideAccountFields(fields: AccountFields): void {
  provided = fields;
}

export function accountFields(): AccountFields | null {
  return provided;
}
