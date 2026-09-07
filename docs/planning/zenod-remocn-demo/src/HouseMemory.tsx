import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  Easing,
  useCurrentFrame,
} from "remotion";
import { MessageBubble } from "./components/remocn/message-bubble";
import { TypingIndicator } from "./components/remocn/typing-indicator";
import { SoftBlurIn } from "./components/remocn/soft-blur-in";

const ink = "#202421",
  muted = "#8e9790",
  cream = "#f4f1e9",
  green = "#b6d6ae";
const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};
const ramp = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
const Z = ({ size = 34 }: { size?: number }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 7,
      background: cream,
      color: ink,
      display: "grid",
      placeItems: "center",
      fontSize: size * 0.72,
      fontWeight: 650,
      lineHeight: 1,
    }}
  >
    Z
  </div>
);
const Reveal = ({
  at,
  children,
}: {
  at: number;
  children: React.ReactNode;
}) => {
  const f = useCurrentFrame();
  const t = ramp(f, at, at + 18);
  return (
    <div style={{ opacity: t, transform: `translateY(${12 * (1 - t)}px)` }}>
      {children}
    </div>
  );
};
const Source = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 17,
      color: "#bfc8bd",
    }}
  >
    <span style={{ color: green }}>↗</span> Yesterday’s walk{" "}
    <span style={{ color: "#6b766f" }}>· Voice note · 24:18</span>
  </div>
);
const Rule = () => (
  <div style={{ height: 1, background: "#ffffff12", margin: "24px 0" }} />
);
function Capture() {
  const f = useCurrentFrame();
  const t = ramp(f, 12, 32);
  return (
    <div style={{ padding: "30px 34px" }}>
      <div
        style={{
          textAlign: "center",
          fontSize: 14,
          color: muted,
          marginBottom: 30,
        }}
      >
        YESTERDAY · 18:42
      </div>
      <MessageBubble
        variant="outgoing"
        maxWidth="100%"
        style={{ opacity: t, translateY: 12 * (1 - t), scale: 0.97 + 0.03 * t }}
        theme={{ primary: "#34523f", primaryForeground: cream }}
      >
        <div style={{ padding: "12px 13px", width: 440 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ fontSize: 25 }}>▶</div>
            <div
              style={{
                display: "flex",
                gap: 4,
                alignItems: "center",
                height: 48,
              }}
            >
              {Array.from({ length: 48 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    display: "block",
                    width: 4,
                    borderRadius: 5,
                    height: 10 + Math.abs(Math.sin(i * 1.71)) * 29,
                    background:
                      i < interpolate(f, [25, 112], [0, 48], clamp)
                        ? cream
                        : "#7c9784",
                  }}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 14,
              color: "#b8cbbb",
              marginTop: 5,
            }}
          >
            <span>24:18</span>
            <span>18:42 ✓✓</span>
          </div>
        </div>
      </MessageBubble>
      <div
        style={{
          marginTop: 25,
          fontSize: 28,
          lineHeight: 1.35,
          letterSpacing: -0.7,
          color: cream,
        }}
      >
        <Reveal at={30}>
          “Here’s why I think
          <br />I should buy this house…”
        </Reveal>
      </div>
      <div style={{ marginTop: 26, height: 30, color: green }}>
        {f < 108 ? (
          <Reveal at={86}>
            <TypingIndicator color={green} />
          </Reveal>
        ) : (
          <Reveal at={108}>
            <span style={{ fontSize: 18 }}>
              ✓ Original saved. Context connected.
            </span>
          </Reveal>
        )}
      </div>
    </div>
  );
}
function Digest() {
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <aside
        style={{
          width: 195,
          padding: "35px 24px",
          borderRight: "1px solid #ffffff10",
          fontSize: 17,
          color: muted,
        }}
      >
        <div style={{ marginBottom: 26, color: cream }}>Your memory</div>
        {["Inbox", "Projects", "Learnings", "Sources"].map((x, i) => (
          <div
            key={x}
            style={{ marginBottom: 21, color: i === 1 ? green : muted }}
          >
            {x}
          </div>
        ))}
      </aside>
      <div style={{ padding: "30px 40px", flex: 1 }}>
        <Reveal at={0}>
          <div style={{ fontSize: 14, color: muted, letterSpacing: 1 }}>
            PROJECTS / PERSONAL
          </div>
          <h2 style={{ fontSize: 36, margin: "10px 0 0", letterSpacing: -1 }}>
            Buying a house
          </h2>
        </Reveal>
        <Rule />
        <Reveal at={14}>
          <div style={{ color: muted, fontSize: 14, marginBottom: 9 }}>
            YOUR THINKING
          </div>
          <div style={{ fontSize: 23, lineHeight: 1.4 }}>
            A place to settle.
            <br />A decision worth pressure-testing.
          </div>
        </Reveal>
        <Reveal at={36}>
          <div style={{ display: "flex", gap: 10, marginTop: 25 }}>
            {["Interest rates", "House prices"].map((x) => (
              <span
                key={x}
                style={{
                  fontSize: 17,
                  color: green,
                  padding: "7px 13px",
                  background: "#b6d6ae10",
                  borderRadius: 7,
                }}
              >
                {x}
              </span>
            ))}
          </div>
        </Reveal>
        <Reveal at={55}>
          <Rule />
          <Source />
        </Reveal>
      </div>
    </div>
  );
}
function Recall() {
  const f = useCurrentFrame();
  const prompt =
    "Use yesterday’s house note. Analyse interest rates and house-price changes over the last 50 years.";
  const n = Math.floor(interpolate(f, [8, 85], [0, prompt.length], clamp));
  return (
    <div style={{ padding: "30px 40px" }}>
      <div
        style={{
          fontSize: 14,
          color: muted,
          letterSpacing: 1,
          marginBottom: 16,
        }}
      >
        TODAY · A NEW CONVERSATION
      </div>
      <div
        style={{
          padding: "22px 25px",
          border: "1px solid #ffffff20",
          borderRadius: 16,
          background: "#ffffff05",
          height: 125,
          fontSize: 25,
          lineHeight: 1.42,
          letterSpacing: -0.4,
        }}
      >
        {prompt.slice(0, n)}
        <span style={{ opacity: f < 86 ? 1 : 0, color: green }}>▎</span>
      </div>
      <div style={{ height: 34, marginTop: 18, fontSize: 16, color: green }}>
        {f < 115 ? (
          <Reveal at={88}>
            <span style={{ marginRight: 12 }}>Reading Zenod</span>
            <TypingIndicator size={5} amplitude={2} color={green} />
          </Reveal>
        ) : (
          <Reveal at={115}>✓ Found the thought behind your question</Reveal>
        )}
      </div>
      <Reveal at={125}>
        <div
          style={{
            padding: "18px 22px",
            borderLeft: `2px solid ${green}`,
            background: "#b6d6ae09",
          }}
        >
          <Source />
          <div style={{ fontSize: 22, marginTop: 12 }}>
            “Here’s why I think I should buy this house…”
          </div>
        </div>
      </Reveal>
      <Reveal at={156}>
        <div style={{ fontSize: 20, color: "#cad1c8", marginTop: 20 }}>
          I’ll use this context to frame the 50-year comparison.
        </div>
      </Reveal>
    </div>
  );
}
function HouseMemoryJourney() {
  const f = useCurrentFrame();
  const phase = f < 150 ? 0 : f < 285 ? 1 : 2;
  const width = interpolate(f, [132, 166], [570, 900], {
    ...clamp,
    easing: Easing.bezier(0.65, 0, 0.2, 1),
  });
  const close = ramp(f, 498, 522);
  const entry = ramp(f, 0, 22);
  return (
    <AbsoluteFill
      style={{
        background: cream,
        color: ink,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 65%,#dadfd1 0%,transparent 64%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 55,
          top: 35,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 23,
          fontWeight: 600,
        }}
      >
        <div style={{ background: ink, padding: 3, borderRadius: 8 }}>
          <Z size={29} />
        </div>
        zenod
      </div>
      <div
        style={{
          position: "absolute",
          right: 55,
          top: 44,
          fontSize: 13,
          letterSpacing: 1.5,
          color: "#797f77",
        }}
      >
        A THOUGHT, CARRIED FORWARD
      </div>
      <div
        style={{
          opacity: (1 - close) * entry,
          transform: `translateY(${14 * (1 - entry)}px)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 100,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 34,
            fontSize: 15,
          }}
        >
          {["01  Ingestion", "02  Digestion", "03  Retrieval"].map((x, i) => (
            <div
              key={x}
              style={{
                color: phase === i ? ink : "#a5aaa0",
                borderBottom:
                  phase === i ? "2px solid #64805d" : "2px solid transparent",
                paddingBottom: 10,
              }}
            >
              {x}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            top: 152,
            left: (1280 - width) / 2,
            width,
            height: 510,
            borderRadius: 20,
            background: ink,
            color: cream,
            boxShadow: "0 25px 65px #253a2324,0 3px 8px #253a231a",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 62,
              borderBottom: "1px solid #ffffff12",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 28px",
            }}
          >
            {phase === 2 ? (
              <span
                style={{ fontFamily: "monospace", fontSize: 24, color: green }}
              >
                ›_
              </span>
            ) : (
              <Z size={29} />
            )}
            <span style={{ fontSize: 19 }}>
              {phase === 0
                ? "Zenod"
                : phase === 1
                  ? "Zenod / Personal wiki"
                  : "Codex"}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 13, color: muted }}>
              {phase === 0
                ? "WhatsApp"
                : phase === 1
                  ? "Markdown · yours"
                  : "Zenod connected"}
            </span>
          </div>
          <Sequence durationInFrames={150} layout="none">
            <Capture />
          </Sequence>
          <Sequence from={150} durationInFrames={135} layout="none">
            <Digest />
          </Sequence>
          <Sequence from={285} durationInFrames={230} layout="none">
            <Recall />
          </Sequence>
        </div>
        <div
          style={{
            position: "absolute",
            top: 687,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 16,
            color: "#767e70",
          }}
        >
          One original thought. Available beyond the conversation.
        </div>
      </div>
      <div
        style={{
          opacity: close,
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: ink,
            padding: 5,
            borderRadius: 14,
            marginBottom: 32,
          }}
        >
          <Z size={62} />
        </div>
        <div style={{ position: "relative", width: 1200, height: 80 }}>
          <Sequence from={510} layout="none">
            <SoftBlurIn
              text="Your agents change."
              fontSize={66}
              color={ink}
              speed={1.6}
            />
          </Sequence>
        </div>
        <div style={{ position: "relative", width: 1200, height: 80 }}>
          <Sequence from={525} layout="none">
            <SoftBlurIn
              text="Your context stays."
              fontSize={66}
              color="#64805d"
              speed={1.6}
            />
          </Sequence>
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 19,
            color: "#71786c",
            opacity: ramp(f, 550, 572),
          }}
        >
          Codex · Claude Code · Cursor · Any MCP-compatible agent
        </div>
        <div
          style={{
            fontSize: 16,
            marginTop: 15,
            color: "#92998b",
            opacity: ramp(f, 564, 586),
          }}
        >
          Read from it. Write back to it. Keep it yours.
        </div>
      </div>
    </AbsoluteFill>
  );
}

function JourneyHeadline({
  number,
  label,
  first,
  second,
}: {
  number: string;
  label: string;
  first: string;
  second: string;
}) {
  const f = useCurrentFrame();
  const fade = 1 - ramp(f, 78, 90);
  return (
    <AbsoluteFill
      style={{
        background: cream,
        color: ink,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        justifyContent: "center",
        padding: "0 100px",
        opacity: fade,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 55,
          top: 35,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 23,
          fontWeight: 600,
        }}
      >
        <div style={{ background: ink, padding: 3, borderRadius: 8 }}>
          <Z size={29} />
        </div>
        zenod
      </div>
      <Reveal at={0}>
        <div
          style={{
            fontSize: 19,
            letterSpacing: 3,
            color: "#64805d",
            marginBottom: 30,
          }}
        >
          {number} / {label}
        </div>
      </Reveal>
      <Reveal at={4}>
        <div
          style={{
            fontSize: 94,
            fontWeight: 650,
            letterSpacing: -5,
            lineHeight: 1.08,
          }}
        >
          {first}
        </div>
      </Reveal>
      <Reveal at={10}>
        <div
          style={{
            fontSize: 94,
            fontWeight: 650,
            letterSpacing: -5,
            lineHeight: 1.08,
            color: "#64805d",
          }}
        >
          {second}
        </div>
      </Reveal>
    </AbsoluteFill>
  );
}

export function HouseMemory() {
  return (
    <AbsoluteFill style={{ background: cream }}>
      <Sequence durationInFrames={150}>
        <HouseMemoryJourney />
      </Sequence>
      <Sequence from={150} durationInFrames={90}>
        <JourneyHeadline
          number="02"
          label="DIGESTION"
          first="Turn a thought"
          second="into lasting memory."
        />
      </Sequence>
      <Sequence from={240} durationInFrames={135}>
        <Sequence from={-150}>
          <HouseMemoryJourney />
        </Sequence>
      </Sequence>
      <Sequence from={375} durationInFrames={90}>
        <JourneyHeadline
          number="03"
          label="RETRIEVAL"
          first="Pick up the thought."
          second="With any agent."
        />
      </Sequence>
      <Sequence from={465} durationInFrames={345}>
        <Sequence from={-285}>
          <HouseMemoryJourney />
        </Sequence>
      </Sequence>
    </AbsoluteFill>
  );
}
