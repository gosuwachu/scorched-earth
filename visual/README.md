# Retired Python-port visual comparison

The scripts in this directory compare browser output against the historical
Python/pygame game port. That workflow is retired: the original Scorched Earth
DOS executable is now the sole behavioral and visual fidelity reference.

Do not run `run_gate.sh` as a verification gate or generate/update Python frames
as expected output for new changes. These scripts remain historical material;
they are not an automated DOS comparison and contain old environment paths.

Use the [browser verification guide](../test-browser/README.md) to check the real
browser simulation, rendering and controls. Use the
[DOS capture guide](../oracle/dos/README.md) for original-game observations and
the [combat evidence](../oracle/COMBAT_FIDELITY.md) for retained DOS fixtures and
their comparison limits.
