/* Read-only DOS 1.5 timing/flight sampler for SDL 1.2 DOSBox on Linux.
 * LD_PRELOAD before capture.so. Addresses require the SHA-pinned SCORCH.EXE
 * documented in README.md. No guest code or memory is modified. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <SDL/SDL.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const unsigned char *data, *memory;
static uint16_t word(const unsigned char *p) { uint16_t v; memcpy(&v, p, 2); return v; }
static uint32_t dword(const unsigned char *p) { uint32_t v; memcpy(&v, p, 4); return v; }
static double real(const unsigned char *p) { double v; memcpy(&v, p, 8); return v; }

static void locate(void) {
  FILE *maps = fopen("/proc/self/maps", "r");
  if (!maps) return;
  char line[512], permissions[8];
  unsigned long start, end;
  while (fgets(line, sizeof line, maps)) {
    if (sscanf(line, "%lx-%lx %4s", &start, &end, permissions) != 3 ||
        strncmp(permissions, "rw", 2) || end - start < 0x100000) continue;
    const unsigned char *hit = memmem((void *)start, end - start,
      "ASGARD\0frondheim\0ragnarok\0scorch.cfg", 34);
    if (!hit || (uintptr_t)hit < start + 0x51aa) continue;
    const unsigned char *candidate = hit - 0x51aa;
    if ((uintptr_t)candidate + 0x10000 > end) continue;
    // Validate the Mag definition and its relocated far pointer's DS segment.
    if (word(candidate + 0x617c) != 1 || word(candidate + 0x617e) != 55) continue;
    unsigned segment = word(candidate + 0x61d2);
    uintptr_t base = (uintptr_t)candidate - segment * 16;
    if (base < start || base + 0x100000 > end) continue;
    data = candidate; memory = (const unsigned char *)base;
    break;
  }
  fclose(maps);
}

static void sample(void) {
  static Uint32 sampled, searched;
  Uint32 now = SDL_GetTicks();
  if (now - sampled < 16) return;
  sampled = now;
  if (!data && now - searched >= 500) { searched = now; locate(); }
  const char *directory = getenv("SCORCH_CAPTURE");
  if (!data || !directory) return;
  char path[1024];
  snprintf(path, sizeof path, "%s/memory.jsonl", directory);
  FILE *output = fopen(path, "a");
  if (!output) return;
  unsigned n = word(data + 0x1c78);
  fprintf(output, "{\"ms\":%u,\"calibration\":%u,\"n\":%u,\"delay\":%u,"
    "\"dt\":%.17g,\"gravity\":%.17g,\"bounds\":[%u,%u,%u,%u],\"tanks\":[",
    now, dword(data + 0x1c86), n, word(data + 0x5140), real(data + 0xceac),
    real(data + 0x512a), word(data + 0xef38), word(data + 0xef3a),
    word(data + 0xef3c), word(data + 0xef3e));
  // Reference scenarios deliberately use two players.
  for (int i = 0; i < 2; i++) {
    const unsigned char *tank = data + 0xd568 + i * 0xca;
    fprintf(output, "%s{\"x\":%u,\"y\":%u,\"shield\":%u,\"angle\":%u,\"power\":%u}",
      i ? "," : "", word(tank + 0xe), word(tank + 0x10),
      word(tank + 0x96), word(tank + 0x92), word(tank + 0x9e));
  }
  fprintf(output, "],\"projectiles\":[");
  unsigned address = word(data + 0xceba) * 16 + word(data + 0xceb8);
  // The first N slots suffice before any removal/compaction. Discard samples
  // across splits/impacts when comparing a particular projectile's trajectory.
  if (n > 0 && n < 100 && address + 108 * n < 0x100000) {
    for (unsigned i = 0; i < n; i++) {
      const unsigned char *p = memory + address + 108 * i;
      fprintf(output, "%s[%.17g,%.17g,%.17g,%.17g]", i ? "," : "",
        real(p + 0x14), real(p + 0x1c), real(p + 4), real(p + 12));
    }
  }
  fprintf(output, "]}\n");
  fclose(output);
}

int SDL_PollEvent(SDL_Event *event) {
  static int (*next)(SDL_Event *);
  if (!next) next = dlsym(RTLD_NEXT, "SDL_PollEvent");
  sample();
  return next(event);
}
