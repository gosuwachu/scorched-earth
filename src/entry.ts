const room = new URLSearchParams(location.search).get("join");
if (room) {
  void import("./controller").then(({ startController }) => startController(room));
} else {
  void import("./main");
}
