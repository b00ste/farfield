// Installation support must never delay gameplay or interrupt an active match.
if (window.isSecureContext && "serviceWorker" in navigator) {
  const register = () => {
    void navigator.serviceWorker
      .register("/service-worker.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Browser policy/private modes may block service workers. Online play
        // remains available; browsers without native prompts get manual help.
      });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
