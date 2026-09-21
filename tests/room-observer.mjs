// Observe state delivered through the game's normal trusted-host MessagePort.
// Test-only instrumentation: never changes payloads, time, resources, or commands.
export async function observeRoom(page, onView) {
  await page.exposeBinding("__farfieldRoomObservation", (_source, view) =>
    onView(view),
  );
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const original = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message, ...rest) {
      const view = message?.result?.state
        ? message.result
        : message?.state
          ? message
          : null;
      if (view?.selfId && view?.code)
        void window.__farfieldRoomObservation(view).catch(() => {});
      return original.call(this, message, ...rest);
    };
  });
}
