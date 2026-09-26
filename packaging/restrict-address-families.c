// Test-only amd64 launcher: enforce socket address families like systemd's
// RestrictAddressFamilies, returning EAFNOSUPPORT for disallowed families.
// This is targeted regression coverage, not a full systemd sandbox emulator.
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(int argc, char **argv) {
  struct sock_filter filters[64];
  unsigned short count = 0;
#define EMIT(instruction) filters[count++] = (struct sock_filter) instruction
  EMIT(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
  EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0));
  EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  EMIT(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
  EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_socket, 1, 0));
  EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  EMIT(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])));
  int arg = 1;
  for (; arg < argc && strcmp(argv[arg], "--") != 0; arg++) {
    int family;
    if (strcmp(argv[arg], "AF_UNIX") == 0) family = AF_UNIX;
    else if (strcmp(argv[arg], "AF_INET") == 0) family = AF_INET;
    else if (strcmp(argv[arg], "AF_INET6") == 0) family = AF_INET6;
    else if (strcmp(argv[arg], "AF_NETLINK") == 0) family = AF_NETLINK;
    else { fprintf(stderr, "Unsupported family: %s\n", argv[arg]); return 2; }
    if ((size_t) count + 3 >= sizeof(filters) / sizeof(filters[0])) return 2;
    EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, family, 0, 1));
    EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  }
  if (arg == 1 || arg + 1 >= argc) {
    fprintf(stderr, "usage: restrict-address-families FAMILY... -- COMMAND...\n");
    return 2;
  }
  EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EAFNOSUPPORT));
  struct sock_fprog program = { .len = count, .filter = filters };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
      prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) {
    perror("install seccomp filter");
    return 1;
  }
  execvp(argv[arg + 1], argv + arg + 1);
  perror("execvp");
  return 1;
}
