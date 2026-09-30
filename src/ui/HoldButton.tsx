import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { cancelTouch, type InputKey, onInputReset, setTouch } from "./input";

export function HoldButton({
  k,
  label,
  children,
  className,
}: {
  k: InputKey;
  label: string;
  children: ReactNode;
  className: string;
}) {
  const source = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pointer = useRef<number | null>(null);
  const key = useRef<string | null>(null);
  const [held, setHeld] = useState(false);
  const pointerOwner = `${source}:pointer`;
  const keyOwner = `${source}:key`;
  const releasePointer = useCallback(
    (update = true, cancel = false) => {
      if (cancel) cancelTouch(k, pointerOwner);
      const id = pointer.current;
      if (id === null) return;
      pointer.current = null;
      if (!cancel) setTouch(k, false, pointerOwner);
      if (button.current?.hasPointerCapture(id)) button.current.releasePointerCapture(id);
      if (update) setHeld(key.current !== null);
    },
    [k, pointerOwner],
  );
  const releaseKey = useCallback(
    (update = true, cancel = false) => {
      if (cancel) cancelTouch(k, keyOwner);
      if (key.current === null) return;
      if (!cancel) setTouch(k, false, keyOwner);
      key.current = null;
      if (update) setHeld(pointer.current !== null);
    },
    [k, keyOwner],
  );
  useEffect(() => {
    const cancel = () => {
      releasePointer(true, true);
      releaseKey(true, true);
      setHeld(false);
    };
    const unsubscribe = onInputReset(cancel);
    return () => {
      unsubscribe();
      releasePointer(false, true);
      releaseKey(false, true);
    };
  }, [releasePointer, releaseKey]);
  return (
    <button
      ref={button}
      type="button"
      aria-label={label}
      data-held={held}
      data-game-key="true"
      data-action={k}
      onPointerDown={(e) => {
        if (e.button !== 0 || pointer.current !== null) return;
        e.preventDefault();
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        setTouch(k, true, pointerOwner);
        setHeld(true);
      }}
      onPointerUp={(e) => {
        if (pointer.current === e.pointerId) releasePointer();
      }}
      onPointerCancel={(e) => {
        if (pointer.current === e.pointerId) releasePointer(true, true);
      }}
      onLostPointerCapture={(e) => {
        if (pointer.current === e.pointerId) releasePointer(true, true);
      }}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        if (e.repeat || key.current !== null) return;
        key.current = e.code;
        setTouch(k, true, keyOwner);
        setHeld(true);
      }}
      onKeyUp={(e) => {
        if (key.current !== e.code) return;
        e.preventDefault();
        releaseKey();
      }}
      onBlur={() => {
        releasePointer(true, true);
        releaseKey(true, true);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`hold-control wood-btn pointer-events-auto touch-none select-none ${className}`}
    >
      {children}
    </button>
  );
}
