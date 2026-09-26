/* SDL 1.2 capture/input adapter for an isolated DOSBox reference process.
 * Does not patch the executable or guest memory. Build with sdl-config. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <SDL/SDL.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void capture(void) {
  static Uint32 captured;
  const char *directory = getenv("SCORCH_CAPTURE");
  if (!directory) return;
  Uint32 now = SDL_GetTicks();
  if (now - captured < 16) return;
  captured = now;
  SDL_Surface *surface = SDL_GetVideoSurface();
  if (!surface) return;
  char path[1024], target[1024];
  snprintf(path, sizeof path, "%s/latest.tmp.bmp", directory);
  snprintf(target, sizeof target, "%s/latest.bmp", directory);
  SDL_SaveBMP(surface, path);
  rename(path, target);
  snprintf(path, sizeof path, "%s/record", directory);
  if (access(path, F_OK) == 0) {
    snprintf(path, sizeof path, "%s/%08u.bmp", directory, now);
    SDL_SaveBMP(surface, path);
  }
}

int SDL_Flip(SDL_Surface *surface) {
  static int (*real_flip)(SDL_Surface *);
  if (!real_flip) real_flip = dlsym(RTLD_NEXT, "SDL_Flip");
  int result = real_flip(surface);
  capture();
  return result;
}

void SDL_UpdateRects(SDL_Surface *surface, int n, SDL_Rect *rects) {
  static void (*real_update)(SDL_Surface *, int, SDL_Rect *);
  if (!real_update) real_update = dlsym(RTLD_NEXT, "SDL_UpdateRects");
  real_update(surface, n, rects);
  capture();
}

int SDL_PollEvent(SDL_Event *event) {
  static int (*real_poll)(SDL_Event *);
  static SDL_Event release;
  static int pending;
  static long last_id;
  if (!real_poll) real_poll = dlsym(RTLD_NEXT, "SDL_PollEvent");
  if (pending) { *event = release; pending = 0; return 1; }
  const char *directory = getenv("SCORCH_CAPTURE");
  if (!directory) return real_poll(event);
  capture();
  char path[1024];
  snprintf(path, sizeof path, "%s/input", directory);
  FILE *input = fopen(path, "r");
  long id; char kind; int a = 0, b = 0;
  int fields = input ? fscanf(input, "%ld %c %d %d", &id, &kind, &a, &b) : 0;
  if (input) fclose(input);
  if (fields >= 2 && id != last_id) {
    last_id = id;
    if (kind == 'q') exit(0);
    memset(event, 0, sizeof *event);
    if (kind == 'k') {
      event->type = SDL_KEYDOWN;
      event->key.state = SDL_PRESSED;
      event->key.keysym.sym = a;
      event->key.keysym.unicode = a < 128 ? a : 0;
      release = *event;
      release.type = SDL_KEYUP;
      release.key.state = SDL_RELEASED;
    } else if (kind == 'm') {
      SDL_WarpMouse(a, b);
      event->type = SDL_MOUSEBUTTONDOWN;
      event->button.button = SDL_BUTTON_LEFT;
      event->button.state = SDL_PRESSED;
      event->button.x = a;
      event->button.y = b;
      release = *event;
      release.type = SDL_MOUSEBUTTONUP;
      release.button.state = SDL_RELEASED;
    } else return real_poll(event);
    pending = 1;
    return 1;
  }
  return real_poll(event);
}
