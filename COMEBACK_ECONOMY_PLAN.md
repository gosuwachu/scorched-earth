# Multiplayer comeback economy plan

Status: implemented as an optional browser economy. The amounts remain starting values for balance playtesting.

Introduce an optional Comeback economy that helps players afford useful equipment after losing a round. Preserve the full cash and score rewards for damage, kills, and survival. Winning should remain rewarding while losing players retain a practical chance to compete in the next round.

A round is one battle followed by a shop. A match contains multiple rounds.

## Current feedback loop

Winning and surviving produce more cash, which buys stronger equipment and improves the chance of winning subsequent rounds. Several existing systems reinforce this:

- Damage and kills award both cash and score.
- Standard scoring awards a $5,000 survival pool.
- Outlast awards $500 per opponent outlived when enabled.
- Surviving players earn interest on banked cash; the default rate is 5%.
- Cash and purchased equipment carry between rounds.

Relevant implementation: [scoring.ts](src/scoring.ts), [outlast.ts](src/outlast.ts), [economy.ts](src/economy.ts), and the round transitions in [game.ts](src/game.ts).

## Proposed rules

### Resupply for everyone

Give every player $5,000 before each subsequent shop, including players eliminated immediately. Do not add this payment to the initial shop or after the final round.

At current base prices, $5,000 buys a Battery bundle or two Missile bundles. Availability and changing market prices still apply.

### Full combat rewards

Keep 100% of existing cash and score rewards for damage, kills, and survival. Keep existing friendly-fire and suicide penalties. Resupply and recovery payments add no score or win credit.

### Recovery after consecutive losses

Add a recovery payment to resupply based on the player's consecutive losses:

- One loss: $500.
- Two losses: $1,000.
- Three or more losses: $1,500.

Include the round just completed when calculating the streak. Reset the streak on a win, so the winner receives no recovery payment for that round. Reset all streaks when starting a new match.

In a five-player free-for-all, one player wins and all four others lose, regardless of elimination order.

Use the team's result in team games, including for teammates eliminated before their team won. Draws and administrative mass kills neither increase nor reset streaks; the next recovery payment uses the unchanged streak.

### Remove additional compounding bonuses

Disable bank-interest accrual and Outlast cash while Comeback mode is active. Keep saved cash and equipment.

Skip interest accrual directly rather than setting `INTEREST_RATE` to zero: that setting also affects Auto Defense pricing. Preserve that pricing behavior.

### Lobby setting and scoring compatibility

Add one lobby choice: Classic or Comeback. Fix the selection for the duration of the match and explain the rules in the lobby help.

Classic preserves the existing economy. Comeback is a browser rule, not a DOS fidelity change. Initially support Comeback with Basic and Standard scoring only. Greedy ranks players by wealth, so assistance would directly affect the match standings and needs a separate design decision.

The implemented selector is in the new-game dialog and online host lobby. Classic is the default. Selecting Comeback while Greedy is configured switches scoring to Standard, as explained in the control's help.

## Example payout

Assume a Standard duel with another round remaining. Both players have $0 banked before rewards. The winner deals 100 health damage, earns one kill, and survives; the loser earns no combat rewards. The current economy has Outlast enabled and 5% interest.

Current winner income is $9,450: $3,000 damage + $500 kill + $5,000 survival + $500 Outlast + $450 interest. The loser receives $0.

With Comeback, the winner receives $13,500: $5,000 resupply + the full $8,500 in combat rewards. The loser receives $5,500 after one consecutive loss, $6,000 after two, or $6,500 after three or more.

The winner still earns $8,500 score and the loser earns zero score in either economy. These figures describe new income, not total wealth or equipment value.

This is a modest comeback mechanic. Full combat rewards allow a strong player to keep building a substantial equipment advantage; resupply and recovery primarily keep losing players able to make useful purchases. The proposed amounts need playtesting.

## Implementation steps

1. Add the economy mode to configuration, lobby controls, and option help. Preserve existing behavior for Classic and older saves without the new fields.
2. Add a small dedicated module for recovery streaks and resupply calculations. Use deterministic integer amounts without additional randomness.
3. Integrate streak updates with completed round results. Pay resupply and recovery exactly once before the next shop, before either human or AI purchases. Keep existing combat reward timing.
4. Gate Outlast and bank-interest accrual on the selected mode without changing Auto Defense pricing.
5. Persist the selected mode, streaks, and any payment bookkeeping needed to prevent duplicate credits through saves and restores. Use the authoritative game state for multiplayer payouts and reconnects.
6. Display a shop income breakdown: Resupply, Combat earnings, and Recovery bonus. Keep penalties visible when relevant and distinguish new income from the player's total cash balance.

## Verification

Add focused browser-rule tests for:

- Resupply to winners and eliminated players.
- Full combat cash and score rewards, with existing penalties intact.
- Recovery increments, the $1,500 cap, and resets on wins or new matches.
- Team outcomes, draws, and administrative mass kills.
- No initial-shop or final-round resupply payment.
- Disabled interest and Outlast in Comeback, with Auto Defense pricing preserved.
- Save and restore, reconnects, and repeated round-transition calls without duplicate credits.
- Classic behavior and compatibility with older saved games.
- Lobby scoring restrictions and matching payout information for local and remote players.

Run focused tests during implementation, then `npm test` and `npm run build`. Follow [test-browser/README.md](test-browser/README.md) for browser verification, including `ui.mjs` for the lobby and shop interactions. Inspect representative captures and verify the multiplayer shop flow.

Keep these expectations separate from DOS fixtures. Passing them validates the new browser rule, not full-game DOS parity.

## Balance evaluation

Compare Classic and Comeback over repeatable seeded scenarios and human multiplayer sessions with different player counts and match lengths. Check:

- Whether players can afford useful purchases after repeated losses.
- Whether early winners dominate subsequent rounds.
- How cash and equipment advantages develop over a match.
- Whether the extra income makes expensive weapons too common.
- Whether deliberate losses or passive play become attractive ways to earn recovery payments.

Tune the resupply amount and recovery cap from these results. Keep full combat rewards as the agreed design constraint.
