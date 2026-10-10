/** Player-facing help for the browser port, keyed by configuration/action name.
 * Describe live behavior rather than inferring it from the original DOS labels. */
interface OptionHelp {
  text: string;
  values?: Readonly<Record<string, string>>;
}

const optionHelp: Readonly<Record<string, OptionHelp>> = {
  FLY_SOUND: {
    text: "Controls the flight tone when Sound is on.",
    values: {
      POS: "By Height: the pitch rises as the shot climbs above its launch point.",
      VEL: "By Velocity: faster shots produce a higher pitch.",
      OFF: "Off: no flight tone.",
    },
  },
  // main.boot reads cfg.resolution once; changing the menu does not resize it.
  GRAPHICS_MODE: { text: "Sets the game's internal resolution. Use Save Changes on the main menu, then reload the page to apply it." },
  POINTER: {
    text: "Selects the pointer used by the game. Browser menus remain usable with the mouse or touch.",
    values: {
      NONE: "None: disables the joystick pointer; browser mouse input still works.",
      MOUSE: "Mouse: use the browser's normal mouse input.",
      JOYSTICK: "Joystick: uses a connected, calibrated gamepad for the game's software cursor.",
    },
  },
  FIRE_DELAY: { text: "The original game's firing delay. Browser flight speed is fixed. Positive values preserve magnetic shield strength; 0 uses the original alternate magnetic timing." },
  calibrate: { text: "Measures a connected gamepad's center and range for the joystick pointer. Calibration lasts until the page is reloaded." },
  INTEREST_RATE: { text: "Unspent cash earns interest between rounds: 0.05 means 5%. This rate also affects the price of Auto Defense." },
  FREE_MARKET: { text: "Lets shop prices change between rounds according to demand. Selling equipment returns 65% of its current value instead of the usual 80%." },
  OUTLAST_BONUS: { text: "Earn $500 cash per opponent eliminated while you remain alive, paid at round end even if you later die. Adds no score; Greedy rankings still reflect the cash. Simultaneous eliminations tie, and teammate eliminations earn nothing. Changes apply next round." },
  SCORING: {
    text: "Controls rewards and how players are ranked.",
    values: {
      BASIC: "Basic: rewards kills and survival, with no reward for individual hits; ranks by score.",
      STANDARD: "Standard: rewards damage, kills, and survival; ranks by score.",
      GREEDY: "Greedy: uses Standard rewards, but ranks by cash plus the resale value of equipment.",
    },
  },
  // terrain._midpoint overrides LAND1/FLATLAND under RANDOM_LAND.
  LAND1: { text: "Higher values make generated terrain more rugged. Applies when Random Land is off and a scanned mountain is not chosen." },
  FLATLAND: { text: "Limits the height of generated peaks. Applies when Random Land is off and a scanned mountain is not chosen." },
  RANDOM_LAND: { text: "Uses rugged terrain with unflattened peaks, overriding Bumpiness and Flatten Peaks. Scanned mountains are chosen separately." },
  SKY: {
    text: "Chooses the background and environment for each round.",
    values: {
      PLAIN: "Plain: a simple sky background.",
      STORMY: "Storm: lightning can strike tanks when Hostile Environment is on.",
      STARS: "Stars: a starry night sky.",
      SHADED: "Shaded: a gradient sky.",
      SUNSET: "Sunset: a sunset-colored sky.",
      CAVERN: "Cavern: adds a solid dirt ceiling that shots can hit.",
      BLACK: "Black: a black sky background.",
      RANDOM: "Random: chooses a sky each round, including Storm and Cavern but excluding Black.",
    },
  },
  CHANGING_WIND: { text: "Allows wind to vary during a round. When off, wind stays at its starting value for that round." },
  // terrain.generate deliberately floors the scanned-mountain chance at 60%.
  MTN_PERCENT: { text: "Chance of using a scanned mountain instead of generated terrain. When mountain files are available, this version uses at least 60%, even if you set less." },
  AIR_VISCOSITY: { text: "Air resistance that slows projectiles during flight. Higher values cause more drag; 0 means no drag." },
  EDGES_EXTEND: { text: "How many pixels beyond the side edges a shot can travel before disappearing when Effect of Walls is None." },
  // config.ELASTIC maps WRAP to 1 and CONCRETE to 5. Some physics comments still
  // use the old reversed names; the descriptions follow handle_walls itself.
  ELASTIC: {
    text: "Controls what happens when shots reach the battlefield edges.",
    values: {
      NONE: "None: shots can leave the sides, up to the Borders Extend distance.",
      WRAP: "Wrap-around: shots reappear at the opposite side; this version also reverses and boosts their horizontal speed.",
      PADDED: "Padded: side walls and the ceiling bounce shots back at half speed.",
      RUBBER: "Rubber: shots bounce off walls, ceiling, and floor without an initial loss of speed.",
      SPRING: "Spring: shots bounce off walls, ceiling, and floor with an initial boost in speed.",
      CONCRETE: "Concrete: shots stop at the side walls or ceiling instead of bouncing.",
      RANDOM: "Random: chooses one wall behavior for the whole round.",
      ERRATIC: "Erratic: changes the wall behavior as shots resolve during the round.",
    },
  },
  SUSPEND_DIRT: { text: "Chance that unsupported dirt stays suspended after a shot. Higher values mean less falling soil: 0 lets it settle normally, while 100 keeps it suspended except when a weapon forces it to fall." },
  PLAY_MODE: {
    text: "Controls when players aim and fire.",
    values: {
      SEQUENTIAL: "Sequential: players take turns aiming and firing one shot at a time.",
      SYNCHRONOUS: "Synchronous: each player locks in a shot, then everyone fires together.",
      SIMULTANEOUS: "Simultaneous: everyone aims and fires in real time; each player waits for their own shot to finish before firing again.",
    },
  },
  PLAY_ORDER: {
    text: "Sets the player order at the start of each round.",
    values: {
      RANDOM: "Random: shuffles the order each round.",
      "LOSERS-FIRST": "Losers-First: players with lower scores go first.",
      "WINNERS-FIRST": "Winners-First: players with higher scores go first.",
      "ROUND-ROBIN": "Round-Robin: rotates the starting player each round.",
    },
  },
  // game._win_check and scoring implement Standard/Corporate identically;
  // there is no corporate cash-sharing path in this port.
  TEAM_MODE: {
    text: "Controls team play and when a round ends.",
    values: {
      NONE: "None: everyone competes individually; the last surviving tank wins.",
      STANDARD: "Standard: the last surviving team wins. Friendly fire is penalized and survival rewards are shared with teammates.",
      CORPORATE: "Corporate: currently behaves like Standard in this version; there is no additional cash pooling.",
      VICIOUS: "Vicious: team scoring still applies, but play continues until only one tank survives, even if the remaining tanks are teammates.",
    },
  },
  TALKING_TANKS: {
    text: "Controls which tanks display taunts when firing or dying.",
    values: {
      OFF: "Off: no tank taunts.",
      COMPUTERS: "Computers: only computer-controlled tanks talk.",
      ALL: "All: both human and computer-controlled tanks can talk.",
    },
  },
  // main.boot loads the bundled speech files once, with case-insensitive names.
  ATTACK_COMMENTS: { text: "Bundled text file used for firing taunts (normally talk1.cfg). Use Save Changes, then reload the page to load a different file." },
  DIE_COMMENTS: { text: "Bundled text file used for dying taunts (normally talk2.cfg). Use Save Changes, then reload the page to load a different file." },
  HOSTILE_ENVIRONMENT: { text: "Allows environmental lightning to damage tanks. When off, lightning remains visible but does no damage." },
  TUNNELLING: { text: "Lets eligible shots burrow through dirt, losing speed quickly before exploding. Fast shots can emerge from thin terrain. Contact Triggers force impact on the surface." },
  EXPLOSION_SCALE: {
    text: "Changes blast sizes and their reach, not the display zoom.",
    values: {
      NORMAL: "Normal: uses the smallest blast scale.",
      MEDIUM: "Medium: uses larger blasts.",
      LARGE: "Large: uses the largest blasts.",
    },
  },
  ARMS: { text: "Limits which equipment tiers the shop offers, from 0 to 4. Higher levels allow more advanced weapons and defenses; 4 allows all tiers." },
  BOMB_ICON: {
    text: "Changes the marker for ordinary projectiles in flight, without changing their damage.",
    values: {
      INVISIBLE: "Invisible: hides the projectile marker.",
      SMALL: "Small: shows a single dot.",
      BIG: "Big: shows a larger cross-shaped marker.",
    },
  },
};

export function describeOption(key: string | undefined, value: unknown): string | undefined {
  const help = key === undefined ? undefined : optionHelp[key];
  if (!help) return undefined;
  const selected = help.values?.[String(value).toUpperCase()];
  return selected ? `${help.text} ${selected}` : help.text;
}
