import { useEffect, useRef } from "react";
import { Mic, MicOff, Phone, PhoneOff, Hand } from "lucide-react";
import { useLiveVoice, type LiveEvent } from "@/hooks/use-live-voice";
import { pVoiceLevel, setLiveCall, useLiveCall } from "@/lib/p/live-call-store";
import { useOpenApp } from "@/lib/pt/apps";
import { cn } from "@/lib/utils";

/** Measures the loudness of P's live voice so the hologram's mouth follows the real sound. */
function useVoiceLevel(audioRef: React.RefObject<HTMLAudioElement | null>, live: boolean) {
  useEffect(() => {
    if (!live) {
      pVoiceLevel.live = false;
      pVoiceLevel.value = 0;
      return;
    }
    pVoiceLevel.live = true;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    let raf = 0;
    const buf = new Float32Array(1024);
    const tick = () => {
      const el = audioRef.current;
      const s = el?.srcObject instanceof MediaStream ? el.srcObject : null;
      if (s && s !== stream && s.getAudioTracks().length) {
        stream = s;
        try {
          ctx ??= new AudioContext();
          void ctx.resume();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaStreamSource(s).connect(analyser);
        } catch {
          analyser = null;
        }
      }
      if (analyser) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 6);
        // fast attack, quick release so the mouth closes as soon as she stops
        pVoiceLevel.value = rms > pVoiceLevel.value ? rms : pVoiceLevel.value * 0.7 + rms * 0.3;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      pVoiceLevel.live = false;
      pVoiceLevel.value = 0;
      void ctx?.close();
    };
  }, [audioRef, live]);
}

/** Persistent live call with P. Lives in the shell so the call survives opening apps. */
export function PLiveCall() {
  const open = useOpenApp();
  const heardRef = useRef("");
  const saidRef = useRef("");
  const onEvent = (event: LiveEvent) => {
    const e = event as LiveEvent & { delta?: string; plan?: { target?: string } };
    if (e.type === "session.input_transcript.delta" && e.delta) {
      if (saidRef.current) { saidRef.current = ""; }
      heardRef.current = (heardRef.current + e.delta).slice(-220);
      setLiveCall({ heard: heardRef.current });
    } else if (e.type === "session.output_transcript.delta" && e.delta) {
      if (heardRef.current) heardRef.current = "";
      saidRef.current = (saidRef.current + e.delta).slice(-220);
      setLiveCall({ said: saidRef.current });
    } else if (e.type === "app.p.point" && e.plan?.target) {
      const target = e.plan.target;
      setLiveCall({ pointTarget: target });
      window.setTimeout(() => {
        if (target !== "desktop") open(target as Parameters<typeof open>[0]);
        else open("applications" as Parameters<typeof open>[0]);
      }, 1300);
      window.setTimeout(() => setLiveCall({ pointTarget: null }), 2600);
    }
  };
  const call = useLiveVoice({ onEvent });
  const idle = call.status === "idle" || call.status === "closed";
  const connected = call.status === "connected";
  useVoiceLevel(call.audioRef, !idle);

  useEffect(() => {
    setLiveCall({ active: !idle, status: call.status });
    if (idle) { heardRef.current = ""; saidRef.current = ""; setLiveCall({ heard: "", said: "" }); }
  }, [call.status, idle]);

  const heard = useLiveCall((s) => s.heard);
  const said = useLiveCall((s) => s.said);

  return (
    <>
      <audio ref={call.audioRef} controls className="sr-only" />
      <PointingHand />
      <div className="pointer-events-auto absolute bottom-10 right-5 z-40 flex w-80 flex-col gap-2 rounded-2xl border border-line-strong bg-deep/85 p-3 shadow-glow backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", connected ? "bg-cyan glow animate-pulse" : "bg-text-3")} />
          <p className="hud-label flex-1 !text-cyan">
            {connected ? "Live with P" : call.status === "connecting" || call.status === "starting" ? "Calling P…" : "Talk to P"}
          </p>
          {connected && (
            <button type="button" onClick={() => call.setMuted(!call.muted)} aria-label={call.muted ? "Unmute" : "Mute"} className="grid size-8 place-items-center rounded-full border border-line text-text-2 hover:text-text">
              {call.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </button>
          )}
          {idle ? (
            <button type="button" onClick={call.start} className="flex items-center gap-1.5 rounded-full bg-cyan px-3 py-1.5 text-xs font-semibold text-deep hover:opacity-90">
              <Phone className="size-3.5" /> Start call
            </button>
          ) : (
            <button type="button" onClick={call.stop} disabled={call.status === "stopping"} className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:opacity-90">
              <PhoneOff className="size-3.5" /> End
            </button>
          )}
        </div>
        {(heard || said) && (
          <p className="text-[12px] leading-snug text-text-2">
            {said ? <><span className="text-cyan">P: </span>{said}</> : <><span className="text-text-3">You: </span>{heard}</>}
          </p>
        )}
        {!idle && !heard && !said && <p className="text-[11px] text-text-3">Just talk — you can cut in any time.</p>}
        {call.error && <p role="alert" className="text-[11px] text-destructive">{call.error}</p>}
        {call.playbackBlocked && (
          <button type="button" onClick={call.resumePlayback} className="rounded-md border border-cyan/60 px-2 py-1 text-xs text-cyan">Play P's voice</button>
        )}
      </div>
    </>
  );
}

/** A glowing hand that flies from P to the app she is pointing at. */
function PointingHand() {
  const target = useLiveCall((s) => s.pointTarget);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hand = ref.current;
    if (!hand) return;
    const stage = hand.offsetParent as HTMLElement | null;
    if (!target || !stage) { hand.style.opacity = "0"; return; }
    const el = document.querySelector<HTMLElement>(`[data-app-id="${target}"]`);
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / stage.offsetWidth || 1;
    // start near P's hologram (centre), then glide to the target
    hand.style.transition = "none";
    hand.style.transform = `translate(${stage.offsetWidth / 2}px, ${stage.offsetHeight / 2}px) scale(0.6)`;
    hand.style.opacity = "1";
    requestAnimationFrame(() => {
      let x = stage.offsetWidth / 2, y = stage.offsetHeight - 160;
      if (el) {
        const r = el.getBoundingClientRect();
        x = (r.left + r.width / 2 - sr.left) / scale - 24;
        y = (r.top - sr.top) / scale - 56;
      }
      hand.style.transition = "transform 1.1s cubic-bezier(.2,.8,.2,1), opacity .3s";
      hand.style.transform = `translate(${x}px, ${y}px) scale(1) rotate(180deg)`;
    });
  }, [target]);
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute left-0 top-0 z-50 opacity-0">
      <Hand className="size-12 text-cyan drop-shadow-[0_0_18px_var(--pt-glow)]" strokeWidth={1.5} />
    </div>
  );
}
