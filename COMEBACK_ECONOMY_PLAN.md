# Multiplayer Comeback economy

Status: revised rules implemented for new matches and accepted after user playtesting.
Classic remains unchanged. These are intentional browser rules, not DOS fidelity
changes. A round is one battle; a ten-round match has nine subsequent shops.

## Cash rules

| Source | Cash |
| --- | --- |
| Resupply before each subsequent shop | $7,500 for every player |
| Round victory | $7,500 pool, independent of player count |
| Enemy kill | $1,000 before player-count scaling |
| Enemy health damage | $30 per point before scaling |
| Enemy shield damage | $2 per point before scaling |
| Recovery after consecutive losses | $500 per loss, capped at $1,500 |

Multiply positive damage and kill cash by `3 / (starting players - 1)`. Four
players is the reference balance. Count the complete starting roster, including
AI players, eliminated players and disconnected controllers. Do not recalculate
the rate as tanks die. A one-player roster uses a denominator of one.

Cash is credited when damage, kills and victories are awarded. Round each
player's cumulative scaled damage/kill cash to the nearest dollar (half up),
crediting the difference from the previous rounded total. This makes one large
hit and many small hits pay identically. Persist the unscaled accumulator through
saves, and reset it at the next battle. Victory cash is separate and unscaled.

Combat **scores**, win counters, rankings and existing suicide/friendly-fire
penalties stay unchanged. Basic still awards no hit score, but now pays the same
positive damage/kill cash as Standard. Basic's absence of hit penalties remains
unchanged. Greedy still switches to Standard when Comeback is selected.

## Recovery, teams and exceptional endings

The current round counts toward the losing streak. A win resets recovery; every
other player loses regardless of elimination order. No survivors means a draw,
which preserves streaks. Team results include eliminated teammates.

Team mode retains the existing victory distribution: divide the $7,500 cash pool
among surviving winners, with eliminated teammates each receiving half of a
survivor's share, rounded down. As before, payments to dead teammates are additional
to the pool distributed to survivors. The combat multiplier uses the full starting
roster in team games too; team-specific balancing is not part of this playtest.

Administrative Mass Kill preserves earned combat cash and streaks, pays no new
victory cash, and still grants resupply and existing recovery before the next shop.
Its existing score distribution is unchanged. Draws pay earned combat cash but no
victory. Neither the initial shop nor the final round grants resupply/recovery.
Final-round combat and victory cash still accrue, but there is no subsequent shop.

Comeback disables bank interest and Outlast cash. Cash and inventory carry over.
The interest-rate setting still affects Auto Defense pricing; item prices,
Free Market behavior, arms availability and starting cash are unchanged.

## Purchasing target and limits

A four-player winner dealing 100 health damage and earning one kill receives
$19,000: $7,500 resupply + $7,500 victory + $3,000 damage + $1,000 kill.
After $10,000 in regular purchases, $9,000 remains. Five **consecutive wins with
that performance** yield $45,000 from zero savings, enough to buy the $40,000
two-item Super Mag bundle before round 6. This is an acceptance example, not a
guarantee for the eventual match winner.

A duel's full 100-damage kill pays $12,000 combat cash; with victory and resupply
the winner receives $27,000. A full sweep pays the same $12,000 combat total at
2, 4, 6 or 10 players. A first-time loser with no combat income receives $8,000,
rising to $9,000 after three losses.

The multiplier equalizes sweeps, not average purchasing power. The cash-flow
simulation showed that strong players in larger games can still take longer to
afford Super Mag. The user chose to playtest this proposal despite that tradeoff.
The $10,000-per-shop supply budget also exceeds guaranteed losing-player income;
actual supply spending is a major variable to measure.

## Persistence and presentation

The economy is fixed at match creation. New Comeback matches carry version 2.
Unversioned Comeback saves retain $5,000 resupply and their original full combat
cash rules for the rest of that match. Saves without a Comeback tracker remain
Classic. Starting a new Comeback match selects the revised rules.

Local and controller shops display Resupply, Combat earnings, Victory, Penalties,
Recovery bonus and Total. Victory is no longer included in combat earnings for
new matches. Old saves keep their previously combined earnings in the combat row.
Purchases do not change the income history. Host-authoritative payouts, saved
accumulators and payment guards prevent duplication during reconnects or restores.

Round results show cumulative score alongside wins and
net round income. Income includes the next shop's resupply and recovery without
crediting them early; the final round includes neither. Expand the income details
to see each player's components. Final standings show remaining cash instead of
round income. Classic also tracks round earnings from the post-shopping balance;
older Classic saves show an unavailable total until a new round starts.

## Verification and playtest

`test/comeback.test.ts` covers 2/4/6/10-player cash rates, full sweeps, damage-packet
rounding, fractional save/restore, unchanged scores and penalties, recovery,
teams, administrative endings, old saves, controllers and the five-round Super Mag
purchase with actual shop transactions. These expectations are browser-rule
acceptance cases, separate from DOS fixtures.

Run `npm test` and `npm run build`. Follow [test-browser/README.md](test-browser/README.md)
for local `ui.mjs` and multiplayer `online.mjs` checks, including screenshots of
the income breakdown, mode help, mobile layout and controller reconnects.

For human playtesting, start a **new** Comeback match with Standard scoring,
four players, ten rounds, $10,000 starting cash, Arms level 4 and Free Market off.
Track actual supply spending, kills, victory income, first Super Mag purchase and
round-5 balances. Repeat at two and ten players to assess the multiplier. Verify
that active attackers retain a meaningful advantage and that losing players can
still buy useful supplies. Passing the automated checks does not establish good
balance or full-game DOS parity.
