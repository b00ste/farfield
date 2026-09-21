import { useEffect, useState } from "react";

// Browsers do not expose a portable hardware-keyboard connection event.
// On touch devices, show shortcuts only after keyboard use outside text fields.
export function useKeyboardHints() {
  const [visible, setVisible] = useState(
    () => navigator.maxTouchPoints === 0 && matchMedia("(pointer: fine)").matches,
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !event.isTrusted || !event.code || event.isComposing ||
        event.key === "Unidentified"
      ) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      ) return;
      setVisible(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") setVisible(false);
    };
    const onBlur = () => {
      if (navigator.maxTouchPoints > 0) setVisible(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return visible;
}
