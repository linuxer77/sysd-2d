import type { AttackId } from "@sysd/shared";
import type { OpId } from "@sysd/match";
import type { IconName } from "./paths";

export const atkIcon = (id: AttackId): IconName => ("ATK_" + (id === "WRITE_STORM" ? "STORM" : id)) as IconName;
export const opsIcon = (id: OpId): IconName => ("OPS_" + id) as IconName;
