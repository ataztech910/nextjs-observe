/**
 * Xbox-controller navigation, so the deck can be driven from across the room.
 *
 * Adapted from https://github.com/ataztech910/slides (`src/engine/useGamepadControls.ts`).
 * Same shape — rAF polling, rising-edge detection, haptics — with this deck's
 * actions instead of a timer: the D-pad picks a branch, which is the one
 * interaction a presentation remote cannot do.
 *
 * | Button   | Action |
 * |----------|--------|
 * | RB / A   | next |
 * | LB / B   | back |
 * | D-pad ←→ | pick branch 1..4 (left/right move the highlight, A confirms) |
 * | D-pad ↑  | start / pause the timer of the card in focus |
 * | D-pad ↓  | reset that timer |
 * | Y        | overview |
 * | X        | presenter notes |
 * | START    | fullscreen |
 * | BACK     | home |
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type GamepadActions = {
  onNext?: () => void;
  onPrev?: () => void;
  onOverview?: () => void;
  onNotes?: () => void;
  onFullscreen?: () => void;
  onHome?: () => void;
  /** D-pad left/right while a branch point is open. */
  onBranchStep?: (delta: 1 | -1) => void;
  /** D-pad up / down: the timer of the card in focus — like T and R on the keyboard. */
  onTimerToggle?: () => void;
  onTimerReset?: () => void;
};

export type GamepadState = {
  isConnected: boolean;
  /** True once any button has been touched — the UI can stay quiet until then. */
  isActivated: boolean;
  pulseHaptic: (intensity?: number, durationMs?: number) => Promise<boolean>;
};

const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_X = 2;
const BUTTON_Y = 3;
const BUTTON_LB = 4;
const BUTTON_RB = 5;
const BUTTON_BACK = 8;
const BUTTON_START = 9;
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

/** Analog triggers report a value without setting `pressed`, hence the 0.5 gate. */
function isButtonPressed(button: GamepadButton | undefined): boolean {
  if (!button) return false;
  return button.pressed || button.value > 0.5;
}

export function useGamepad(actions: GamepadActions): GamepadState {
  const actionsRef = useRef(actions);
  const previousPressedRef = useRef<Record<number, boolean>>({});
  const activeIndexRef = useRef<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isActivated, setIsActivated] = useState(false);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  useEffect(() => {
    let frameId = 0;

    const forget = () => {
      activeIndexRef.current = null;
      previousPressedRef.current = {};
    };

    const updateConnectionState = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const has = pads.some((p) => p?.connected);
      setIsConnected(has);
      if (!has) forget();
    };

    // Fires the callback on the rising edge only, so holding a button does not repeat.
    const onPress = (pad: Gamepad, index: number, run?: () => void) => {
      const pressed = isButtonPressed(pad.buttons[index]);
      const was = previousPressedRef.current[index] ?? false;
      if (pressed && !was) run?.();
      previousPressedRef.current[index] = pressed;
    };

    // The Gamepad API has no events for button state, so poll each frame.
    const tick = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = pads.find((p) => p?.connected) ?? null;
      setIsConnected(Boolean(pad));

      if (!pad) {
        forget();
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      // A different pad means the remembered press state is meaningless.
      if (activeIndexRef.current !== pad.index) {
        activeIndexRef.current = pad.index;
        previousPressedRef.current = {};
      }

      if (pad.buttons.some(isButtonPressed)) setIsActivated(true);

      const a = actionsRef.current;
      onPress(pad, BUTTON_RB, a.onNext);
      onPress(pad, BUTTON_A, a.onNext);
      onPress(pad, BUTTON_LB, a.onPrev);
      onPress(pad, BUTTON_B, a.onPrev);
      onPress(pad, BUTTON_Y, a.onOverview);
      onPress(pad, BUTTON_X, a.onNotes);
      onPress(pad, BUTTON_START, a.onFullscreen);
      onPress(pad, BUTTON_BACK, a.onHome);
      onPress(pad, DPAD_RIGHT, () => a.onBranchStep?.(1));
      onPress(pad, DPAD_LEFT, () => a.onBranchStep?.(-1));
      onPress(pad, DPAD_UP, a.onTimerToggle);
      onPress(pad, DPAD_DOWN, a.onTimerReset);

      frameId = window.requestAnimationFrame(tick);
    };

    updateConnectionState();
    frameId = window.requestAnimationFrame(tick);
    window.addEventListener("gamepadconnected", updateConnectionState);
    window.addEventListener("gamepaddisconnected", updateConnectionState);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("gamepadconnected", updateConnectionState);
      window.removeEventListener("gamepaddisconnected", updateConnectionState);
    };
  }, []);

  /** A short rumble, to confirm a press without looking at the screen. */
  const pulseHaptic = useCallback(async (intensity = 0.75, durationMs = 140) => {
    const index = activeIndexRef.current;
    if (index === null) return false;
    const pad = navigator.getGamepads?.()[index] ?? null;
    if (!pad) return false;

    type WithRumble = Gamepad & {
      vibrationActuator?: {
        playEffect?: (
          type: "dual-rumble",
          params: { startDelay: number; duration: number; weakMagnitude: number; strongMagnitude: number },
        ) => Promise<unknown>;
      };
      hapticActuators?: Array<{ pulse?: (value: number, duration: number) => Promise<boolean> }>;
    };
    const p = pad as WithRumble;

    if (p.vibrationActuator?.playEffect) {
      await p.vibrationActuator.playEffect("dual-rumble", {
        startDelay: 0,
        duration: durationMs,
        weakMagnitude: intensity,
        strongMagnitude: intensity,
      });
      return true;
    }
    const actuator = p.hapticActuators?.[0];
    if (actuator?.pulse) return actuator.pulse(intensity, durationMs);
    return false;
  }, []);

  return { isConnected, isActivated, pulseHaptic };
}
