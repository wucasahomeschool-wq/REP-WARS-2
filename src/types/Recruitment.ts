/** Decimal integer strings retain exact clock algebra without JSON bigint loss. */
export interface TerritoryRecruitment {
  territoryId: string;
  factionId: string;
  troops: number;
  /** Paid whole troops only; fractional work is not a troop or a spendable reserve. */
  fractionalWork: string;
  /** Processed simulation work, units = one world-accrual numerator. */
  accruedThroughWork: string;
}
