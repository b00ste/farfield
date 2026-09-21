import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import "./game-select.css";
export function GameSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const [bounds, setBounds] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 240,
  });
  const selected = options.findIndex((o) => o.value === value);
  const close = (focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const choose = (index: number) => {
    if (options[index]) onChange(options[index].value);
    close(true);
  };
  const expand = () => {
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const box = trigger.current!.getBoundingClientRect(),
        width = Math.min(Math.max(box.width, 180), innerWidth - 16);
      const below = innerHeight - box.bottom - 12,
        above = box.top - 12;
      const up =
        below < Math.min(options.length * 44 + 10, 240) && above > below;
      const maxHeight = Math.max(44, Math.min(240, up ? above : below));
      setBounds({
        left: Math.max(8, Math.min(box.left, innerWidth - width - 8)),
        top: up
          ? Math.max(
              8,
              box.top - 6 - Math.min(options.length * 44 + 10, maxHeight),
            )
          : box.bottom + 6,
        width,
        maxHeight,
      });
    };
    position();
    list.current?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const keyboard = (event: KeyboardEvent) => {
    event.stopPropagation();
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (key === "Tab") {
      close(true);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      choose(active);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      event.preventDefault();
      setActive((current) =>
        key === "Home"
          ? 0
          : key === "End"
            ? options.length - 1
            : (current + (key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length,
      );
    } else if (key.length === 1) {
      const index = options.findIndex((o) =>
        o.label.toLowerCase().startsWith(key.toLowerCase()),
      );
      if (index >= 0) {
        event.preventDefault();
        setActive(index);
      }
    }
  };
  return (
    <span className="ff-select">
      <button
        ref={trigger}
        type="button"
        className="ff-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : expand())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            expand();
          }
        }}
      >
        <span>{options[selected]?.label ?? "Choose…"}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={id}
            className="ff-select-options"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${id}-${active}`}
            style={bounds}
            onKeyDown={keyboard}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) close();
            }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={value === option.value}
                data-index={index}
                data-active={active === index}
                className="ff-select-option"
                onPointerMove={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                {option.label}
                <span aria-hidden="true">
                  {option.value === value ? "✓" : ""}
                </span>
              </div>
            ))}
          </div>,
          trigger.current?.closest("dialog") ?? document.body,
        )}
    </span>
  );
}
