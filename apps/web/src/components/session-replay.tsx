"use client";

import * as React from "react";
import { Pause, Play, SkipBack, SkipForward, Zap } from "lucide-react";
import type { UserTimelineEvent } from "@trackme/analytics";
import { pageColor } from "@/lib/page-color";

/** Quiet stretches longer than this are shortened, so a 4 minute pause is not 4 minutes of nothing. */
const IDLE_CAP_MS = 2500;
const SPEEDS = [1, 2, 4] as const;

const clock = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function offset(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

function isGoal(event: UserTimelineEvent): boolean {
  return event.properties?.eventName === "goal_completed" || Boolean(event.properties?.goal);
}

/**
 * Plays back one session's path: the page or event at each moment, in order, at the real
 * pace (with idle stretches shortened). It is a reading of the recorded events, not a
 * screen recording, and says so.
 */
export function SessionReplay({ events }: { events: UserTimelineEvent[] }) {
  // events arrive oldest first; t is real ms since the first one, at is replay ms.
  const steps = React.useMemo(() => {
    const t0 = new Date(events[0]?.timestamp ?? 0).getTime();
    let at = 0;
    let prev = 0;
    return events.map((event, i) => {
      const t = new Date(event.timestamp).getTime() - t0;
      if (i > 0) at += Math.min(Math.max(t - prev, 0), IDLE_CAP_MS);
      prev = t;
      return { event, t, at };
    });
  }, [events]);

  const total = steps[steps.length - 1]?.at ?? 0;
  const realTotal = steps[steps.length - 1]?.t ?? 0;

  const [pos, setPos] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1);
  const posRef = React.useRef(0);
  posRef.current = pos;

  // The step showing: the last one whose time has been reached.
  let current = 0;
  for (let i = 0; i < steps.length; i += 1) if (steps[i]!.at <= pos + 0.5) current = i;

  React.useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = posRef.current + (now - last) * speed;
      last = now;
      if (next >= total) {
        setPos(total);
        setPlaying(false);
        return;
      }
      setPos(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, total]);

  const seekStep = (i: number) => {
    const clamped = Math.min(Math.max(i, 0), steps.length - 1);
    setPos(steps[clamped]!.at);
  };
  const toggle = () => {
    if (!playing && pos >= total) setPos(0);
    setPlaying((p) => !p);
  };

  const trackRef = React.useRef<HTMLDivElement>(null);
  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || total === 0) return;
    setPos(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total);
  };

  if (steps.length === 0) return null;
  const step = steps[current]!;
  const event = step.event;
  const action = event.type !== "pageview";
  const goal = isGoal(event);
  const label = action && event.eventName && event.eventName !== event.type ? event.eventName : event.path || event.url;
  const pct = (at: number) => (total > 0 ? (at / total) * 100 : 0);
  const color = pageColor(event.path || event.url || label);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      seekStep(current + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekStep(current - 1);
    } else if (e.key === " " && e.target === e.currentTarget) {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <div
      role="group"
      aria-label="Session replay"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="space-y-3 rounded-lg border border-white/[0.07] bg-black/30 p-3 outline-none focus-visible:border-white/[0.25]"
    >
      {/* Frame: what the visitor was doing at this moment */}
      <div className="rounded-md border border-white/[0.07] bg-card">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: action ? (goal ? "#f59e0b" : "#22c55e") : color }} />
          <p key={event.eventId} className="reveal min-w-0 flex-1 truncate font-mono text-xs text-zinc-200" title={event.url || event.path}>
            {label}
          </p>
          <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-500">
            {current + 1} / {steps.length}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs text-zinc-400">
              {action ? (
                <span
                  className={`inline-flex items-center gap-1 rounded px-2 py-px text-xs font-medium ${
                    goal ? "bg-white/[0.06] text-zinc-300" : "bg-[#4cc38a]/10 text-[#4cc38a]"
                  }`}
                >
                  {goal && <Zap className="h-4 w-4" />}
                  {goal ? "Goal reached" : event.type}
                </span>
              ) : (
                <span className="text-zinc-500">Viewed page</span>
              )}
              {event.title && <span className="truncate text-zinc-300">{event.title}</span>}
            </p>
            {current === 0 && event.referrer && (
              <p className="mt-1 truncate text-xs text-zinc-600">Arrived from {event.referrer}</p>
            )}
          </div>
          <p className="shrink-0 text-right font-mono text-xs tabular-nums text-zinc-500">
            <span className="block text-zinc-300">{clock.format(new Date(event.timestamp))}</span>+{offset(step.t)}
          </p>
        </div>
      </div>

      {/* Scrubber */}
      <div
        ref={trackRef}
        className="relative h-9 cursor-pointer select-none"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromPointer(e.clientX);
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[0.08]" />
        <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[0.07]" style={{ width: `${pct(pos)}%` }} />
        {steps.map((s, i) => {
          const done = s.at <= pos + 0.5;
          const isAction = s.event.type !== "pageview";
          return (
            <button
              key={s.event.eventId}
              type="button"
              tabIndex={-1}
              aria-label={`Step ${i + 1}: ${s.event.path || s.event.eventName} at +${offset(s.t)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => seekStep(i)}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-2"
              style={{ left: `${pct(s.at)}%` }}
            >
              <span
                className={`block transition-transform ${isAction ? "h-2 w-2 rotate-45 rounded-[1px]" : "h-2 w-2 rounded-full"} ${
                  i === current ? "scale-150" : ""
                }`}
                style={{
                  background: done ? (isAction ? (isGoal(s.event) ? "#f59e0b" : "#22c55e") : pageColor(s.event.path || s.event.url)) : "#3f3f46",
                }}
              />
            </button>
          );
        })}
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ left: `${pct(pos)}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => seekStep(current - 1)}
            disabled={current === 0}
            aria-label="Previous step"
            className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause" : pos >= total && total > 0 ? "Replay" : "Play"}
            className="inline-flex h-7 items-center gap-2 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-white"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Pause" : pos >= total && total > 0 ? "Replay" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => seekStep(current + 1)}
            disabled={current >= steps.length - 1}
            aria-label="Next step"
            className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md border border-white/[0.08] p-0.5" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className={`rounded px-2 py-0.5 font-mono text-xs transition-colors ${
                  speed === s ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
          <span className="font-mono text-xs tabular-nums text-zinc-500">
            {offset(step.t)} / {offset(realTotal)}
          </span>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-zinc-600">
        Replays the pages and events recorded for this session at their real pace; pauses over{" "}
        {Math.round(IDLE_CAP_MS / 1000)}s are shortened. It is not a screen recording.
      </p>
    </div>
  );
}
