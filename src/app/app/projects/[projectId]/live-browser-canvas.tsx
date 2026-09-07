"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The temporary browser, drawn as pixels (ADR 0076).
 *
 * ## Why this is a canvas and not an iframe
 *
 * It replaces one, and the replacement is safer rather than merely different.
 * The iframe embedded a provider's DevTools frontend, which loaded and ran the
 * customer's own signed-in application inside a frame on this page — third-party
 * script, in a document, next to Vibe's session. It needed `allow-scripts` and
 * `allow-same-origin` together to work at all, which is the combination that
 * lets a frame reach out of its own sandbox.
 *
 * What arrives here is a JPEG. A canvas executes nothing, has no DOM to reach
 * into, and cannot navigate anything. The customer's page runs where it always
 * ran — inside a microVM that is destroyed with the session — and this end holds
 * a picture of it.
 *
 * ## What goes back
 *
 * Four message shapes, and the guard on the other side accepts no others:
 * mouse, key and wheel in, frames out. There is no navigate, no evaluate, no
 * screenshot-to-disk. A person can click and type in a browser that is showing
 * their own product, which is exactly what signing in requires and nothing more.
 *
 * ## Coordinates
 *
 * The canvas is laid out responsively and the frame is whatever size Chromium
 * rendered, so every pointer position is scaled from one to the other. Getting
 * this wrong does not throw — it puts the click somewhere else on the page,
 * which is the kind of bug a person blames themselves for.
 */

type Frame = { t: "frame"; data: string; w: number; h: number };

export type LiveBrowserCanvasProps = {
  /**
   * The view channel's URL, including its token.
   *
   * A capability, held for the lifetime of this component and never stored.
   * It comes only from the authorized server action.
   */
  viewUrl: string;
  /** Announced to the person when the socket has not come up. */
  onUnavailable?: () => void;
};

/** Printable single characters go to Chromium as text; everything else as a key. */
function isPrintable(key: string): boolean {
  return key.length === 1;
}

/**
 * A pointer position in the frame's coordinate space.
 *
 * Exported and pure because getting it wrong does not throw. It puts the click
 * somewhere else on the page — off by the ratio between the element's laid-out
 * size and the size Chromium rendered — which is the kind of bug a person
 * blames themselves for, and the kind no rendering test would catch.
 */
export function frameCoordinates(
  pointer: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
  frame: { w: number; h: number },
): { x: number; y: number } {
  // A zero-sized box is a canvas that has not been laid out yet. Dividing by it
  // would send NaN, and the guard coerces NaN to 0 — a click at the top-left
  // corner, which is a real place on a real page.
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return {
    x: Math.round(((pointer.clientX - box.left) / box.width) * frame.w),
    y: Math.round(((pointer.clientY - box.top) / box.height) * frame.h),
  };
}

/**
 * Modifier bits, in CDP's own order.
 *
 * Alt 1, Ctrl 2, Meta 4, Shift 8 — a capital letter needs the Shift bit or the
 * page sees an unmodified keypress, which is how a typed password silently
 * becomes lowercase.
 */
export function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

/**
 * Whether a keydown is the soft keyboard declining to say what was pressed.
 *
 * On a phone there is no hardware key behind a keystroke. iOS and Android
 * report `key: "Unidentified"` and the historical composition sentinel
 * `keyCode: 229` for ordinary characters, so forwarding that keydown sends
 * Chromium a keystroke with no key in it — the field stays empty and the
 * person believes the browser is frozen.
 *
 * When this is true the keystroke is left alone, the hidden field receives the
 * text, and `charactersOf` turns it into characters the guard understands.
 * Every real key — a hardware keyboard, Backspace, Enter, Tab, the arrows —
 * reports itself properly and takes the ordinary path unchanged.
 */
export function isComposingKey(event: { key: string; keyCode: number }): boolean {
  return event.key === "Unidentified" || event.keyCode === 229;
}

/**
 * Typed text as the characters a person meant.
 *
 * Spread rather than `split("")`, because an emoji and several accented
 * characters are two code units and splitting by index would send two halves
 * of one character. Nobody types an emoji into a password field; somebody
 * types `é` into a name field on the way to signing in.
 */
export function charactersOf(value: string): string[] {
  return [...value];
}

export function LiveBrowserCanvas({ viewUrl, onUnavailable }: LiveBrowserCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The hidden field that exists so a phone will open its keyboard. */
  const keyboardRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  /** The size of the last frame, which is the coordinate space the guard expects. */
  const frameSize = useRef({ w: 0, h: 0 });
  const [connected, setConnected] = useState(false);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(viewUrl);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);

    socket.onmessage = (event) => {
      let message: Frame;
      try {
        message = JSON.parse(String(event.data)) as Frame;
      } catch {
        return;
      }
      if (message.t !== "frame") return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const image = new Image();
      image.onload = () => {
        // The backing store matches the frame, so nothing is resampled twice:
        // CSS scales the element, the browser scales the pixels once.
        if (canvas.width !== message.w || canvas.height !== message.h) {
          canvas.width = message.w;
          canvas.height = message.h;
        }
        frameSize.current = { w: message.w, h: message.h };
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        setPainted(true);
      };
      image.src = `data:image/jpeg;base64,${message.data}`;
    };

    const lost = () => {
      setConnected(false);
      onUnavailable?.();
    };
    socket.onerror = lost;
    socket.onclose = lost;

    return () => {
      socketRef.current = null;
      // Closing here matters: the component unmounts when the dialog is
      // dismissed, and a socket left open would keep streaming frames of a
      // signed-in product into a page nobody is looking at.
      socket.close();
    };
  }, [viewUrl, onUnavailable]);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  /** Client coordinates into frame coordinates. */
  const at = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return frameCoordinates(event, canvas.getBoundingClientRect(), frameSize.current);
  }, []);

  const button = (which: number) => (which === 2 ? "right" : which === 1 ? "middle" : "left");

  /**
   * Raises the keyboard, on the gesture that asked for it.
   *
   * iOS opens the software keyboard only for a focused editable element, and
   * only when `focus()` is called inside a user gesture. A canvas is neither,
   * whatever its tabindex — which is why a phone could show this browser,
   * scroll it and tap it, and never type a password into it.
   */
  const takeKeyboard = useCallback(() => {
    keyboardRef.current?.focus({ preventScroll: true });
  }, []);

  /** One press-and-release, for a character the keyboard would not name. */
  const sendCharacter = useCallback(
    (character: string) => {
      send({ t: "key", type: "keyDown", key: character, text: character, modifiers: 0 });
      send({ t: "key", type: "keyUp", key: character, modifiers: 0 });
    },
    [send],
  );

  const keyDown = useCallback(
    (event: {
      key: string;
      code?: string;
      keyCode: number;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    }) => {
      send({
        t: "key",
        type: "keyDown",
        key: event.key,
        code: event.code,
        text: isPrintable(event.key) ? event.key : undefined,
        keyCode: event.keyCode,
        modifiers: modifiersOf(event),
      });
    },
    [send],
  );

  /** A touch is a mouse the person is holding. */
  const touchAt = useCallback(
    (event: { touches: TouchList; changedTouches: TouchList }) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      return touch ? at(touch) : null;
    },
    [at],
  );

  return (
    <div className="relative h-full w-full">
      {/*
        The keyboard's only reason to exist, and it is deliberately not a
        control: it displays nothing, holds nothing, and is emptied after every
        keystroke. What it provides is the one thing a canvas cannot — a
        focusable editable element, which is what a phone requires before it
        will show a keyboard at all.

        Positioned over the canvas rather than off-screen: iOS scrolls a focused
        field into view, and a field parked at -9999px takes the dialog with it.
      */}
      <input
        ref={keyboardRef}
        type="text"
        // Never a password field: the browser would offer to save a credential
        // that belongs to the customer's product, into Vibe's origin.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // Labelled rather than `aria-hidden`: an aria-hidden element that can
        // still take focus is a thing a screen reader lands on and refuses to
        // describe. Out of the tab order is what keeps it out of the way.
        aria-label="Keyboard input for the temporary browser"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 h-full w-full resize-none border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
        onKeyDown={(event) => {
          if (event.key !== "Escape") {
            // A key the keyboard named goes straight through, exactly as it
            // does from the canvas. One it did not name is left alone, so the
            // field receives the text and `onChange` below sends it.
            if (!isComposingKey(event)) event.preventDefault();
          }
          if (!isComposingKey(event)) keyDown(event);
        }}
        onKeyUp={(event) => {
          if (isComposingKey(event)) return;
          if (event.key !== "Escape") event.preventDefault();
          send({
            t: "key",
            type: "keyUp",
            key: event.key,
            code: event.code,
            keyCode: event.keyCode,
            modifiers: modifiersOf(event),
          });
        }}
        onChange={(event) => {
          for (const character of charactersOf(event.target.value)) sendCharacter(character);
          // Emptied immediately: this field is a conduit, and text left in it
          // would be a password sitting in Vibe's DOM.
          event.target.value = "";
        }}
      />
      <canvas
      ref={canvasRef}
      // Focusable so a password can be typed into it at all — the keystrokes
      // are received by the hidden field above, which this hands focus to.
      tabIndex={0}
      role="application"
      aria-label="Temporary browser for signing in to your product"
      /*
       * The canvas remains the tab stop — it is the thing with a name and a
       * role — and hands focus to the conduit the moment it receives it. A
       * keyboard-only person tabs here and types; the field they are actually
       * typing into displays nothing and is never announced.
       */
      onFocus={takeKeyboard}
      // `touch-action: none`: without it a drag scrolls Vibe's page instead of
      // reaching the product, and a double-tap zooms the picture rather than
      // the page inside it.
      className="block h-full w-full cursor-default touch-none focus:outline-none"
      onMouseDown={(event) => {
        takeKeyboard();
        send({
          t: "mouse",
          type: "mousePressed",
          ...at(event),
          button: button(event.button),
          clickCount: 1,
          modifiers: modifiersOf(event),
        });
      }}
      onMouseUp={(event) =>
        send({
          t: "mouse",
          type: "mouseReleased",
          ...at(event),
          button: button(event.button),
          clickCount: 1,
          modifiers: modifiersOf(event),
        })
      }
      onMouseMove={(event) =>
        send({
          t: "mouse",
          type: "mouseMoved",
          ...at(event),
          button: "none",
          modifiers: modifiersOf(event),
        })
      }
      onWheel={(event) => send({ t: "wheel", ...at(event), dx: event.deltaX, dy: event.deltaY })}
      /*
       * Touch, translated rather than left to the browser.
       *
       * Safari does synthesize mouse events from a tap, but only for a tap —
       * not for a drag, and never soon enough to scroll a login page. So each
       * touch is sent as the mouse it stands for, and `preventDefault` stops
       * the synthesized pair arriving afterwards as a second click.
       */
      onTouchStart={(event) => {
        event.preventDefault();
        takeKeyboard();
        const point = touchAt(event.nativeEvent);
        if (point) {
          send({ t: "mouse", type: "mousePressed", ...point, button: "left", clickCount: 1, modifiers: 0 });
        }
      }}
      onTouchMove={(event) => {
        event.preventDefault();
        const point = touchAt(event.nativeEvent);
        if (point) send({ t: "mouse", type: "mouseMoved", ...point, button: "left", modifiers: 0 });
      }}
      onTouchEnd={(event) => {
        event.preventDefault();
        const point = touchAt(event.nativeEvent);
        if (point) {
          send({ t: "mouse", type: "mouseReleased", ...point, button: "left", clickCount: 1, modifiers: 0 });
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
      data-connected={connected ? "true" : "false"}
      data-painted={painted ? "true" : "false"}
      />
    </div>
  );
}
