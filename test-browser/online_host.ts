// Browser-only test harness. Production pages do not expose a game-state handle.
import { boot, setGameStateFactory, setSpritesBundle } from "../src/main";
import { createGameState } from "../src/game";
import * as sprites from "../src/sprites";

const canvas = document.createElement("canvas");
canvas.id = "game";
canvas.width = 1024;
canvas.height = 768;
document.body.append(canvas);
setGameStateFactory(createGameState);
setSpritesBundle(sprites);
const app = await boot();
Object.assign(window, { onlineApp: app });
