import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { MessageBubble } from "./components/remocn/message-bubble";
import { TypingIndicator } from "./components/remocn/typing-indicator";
import { SoftBlurIn } from "./components/remocn/soft-blur-in";
import scenes from "./story-v3.json";
const C = {
  paper: "#f4f1e9",
  ink: "#202421",
  muted: "#7c8578",
  sage: "#64805d",
  lime: "#b6d6ae",
  line: "#d9ddd2",
};
const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};
const ramp = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
const Z = ({ size = 38 }: { size?: number }) => (
  <span
    style={{
      width: size,
      height: size,
      display: "grid",
      placeItems: "center",
      background: C.paper,
      color: C.ink,
      borderRadius: 8,
      fontSize: size * 0.7,
      fontWeight: 650,
      border: `2px solid ${C.ink}`,
      lineHeight: 1,
    }}
  >
    Z
  </span>
);
function Appear({
  at = 0,
  children,
}: {
  at?: number;
  children: React.ReactNode;
}) {
  const f = useCurrentFrame();
  const p = ramp(f, at, at + 24);
  return (
    <div style={{ opacity: p, transform: `translateY(${14 * (1 - p)}px)` }}>
      {children}
    </div>
  );
}
function Shell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: C.ink,
        color: C.paper,
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 20px 45px #24302220",
      }}
    >
      <div
        style={{
          padding: "19px 30px",
          borderBottom: "1px solid #ffffff18",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 23,
        }}
      >
        {label === "Zenod" ? (
          <Z size={29} />
        ) : (
          <span style={{ fontFamily: "monospace", color: C.lime }}>›_</span>
        )}
        {label}
        <span style={{ marginLeft: "auto", fontSize: 16, color: "#9ba795" }}>
          {label === "Zenod" ? "WhatsApp" : "Zenod connected"}
        </span>
      </div>
      <div style={{ padding: "27px 32px" }}>{children}</div>
    </div>
  );
}
function Source() {
  return (
    <div
      style={{
        fontSize: 22,
        color: C.lime,
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <span>↗</span>
      <span>
        Yesterday’s walk{" "}
        <span style={{ color: "#96a38f" }}>· Voice note · 24:18</span>
      </span>
    </div>
  );
}
function Flow({ active }: { active: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        marginBottom: 26,
      }}
    >
      {["Ingest", "Digest", "Retrieve"].map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span style={{ color: "#9ea794", fontSize: 30 }}>→</span>}
          <div
            style={{
              fontSize: 25,
              fontWeight: 550,
              color: i === active ? C.ink : "#8e9787",
              borderBottom: `3px solid ${i === active ? C.sage : "transparent"}`,
              padding: "10px 18px",
            }}
          >
            {s}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
const agents = ["Codex", "Claude", "Cursor", "Grok"];
function Islands() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
      {agents.map((a, i) => (
        <Appear key={a} at={65 + i * 18}>
          <div
            style={{
              border: `1px solid ${C.line}`,
              padding: "26px 30px",
              background: "#ffffff77",
              borderRadius: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                fontSize: 27,
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 35,
                  height: 35,
                  borderRadius: 8,
                  background: C.ink,
                  color: C.paper,
                  fontSize: 20,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {a[0]}
              </span>
              {a}
            </div>
            <div style={{ marginTop: 24, fontSize: 25, color: C.sage }}>
              {
                [
                  "“Should I buy this house?”",
                  "“Let’s rethink the project.”",
                  "“Here’s what I learned.”",
                  "“Plans for next year…”",
                ][i]
              }
            </div>
            <div style={{ marginTop: 20, fontSize: 16, color: C.muted }}>
              Context inside this platform
            </div>
          </div>
        </Appear>
      ))}
    </div>
  );
}
function Repeat() {
  const f = useCurrentFrame();
  return (
    <Shell label="Codex">
      <div style={{ fontSize: 33, lineHeight: 1.4 }}>
        “Pick up the house discussion
        <br />I had in Claude.”
      </div>
      <div style={{ margin: "26px 0", height: 1, background: "#ffffff20" }} />
      <Appear at={125}>
        <div style={{ fontSize: 27, color: "#b8c4b2", lineHeight: 1.5 }}>
          That conversation isn’t available here.
          <br />
          Bring the relevant context to continue.
        </div>
      </Appear>
      <div
        style={{
          marginTop: 26,
          color: "#8e9a88",
          fontSize: 18,
          opacity: ramp(f, 160, 180),
        }}
      >
        A different agent. An incomplete picture.
      </div>
    </Shell>
  );
}
function Owned() {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "relative", height: 400 }}>
      <svg width="1080" height="400" style={{ position: "absolute", inset: 0 }}>
        {[135, 405, 675, 945].map((x, i) => (
          <g key={x} opacity={ramp(f, 100 + i * 8, 125 + i * 8)}>
            <path
              d={`M${x},78 C${x},170 540,120 540,205`}
              fill="none"
              stroke="#8b9e80"
              strokeWidth="2"
            />
            <path
              d={`M${x - 5},92 L${x},82 L${x + 5},92`}
              fill="none"
              stroke="#8b9e80"
              strokeWidth="2"
            />
          </g>
        ))}
      </svg>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 28,
          position: "relative",
        }}
      >
        {agents.map((a, i) => (
          <Appear key={a} at={65 + i * 8}>
            <div
              style={{
                textAlign: "center",
                background: "#ffffff80",
                padding: "20px 8px",
                borderRadius: 13,
                fontSize: 26,
                border: `1px solid ${C.line}`,
              }}
            >
              {a}
            </div>
          </Appear>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 145,
          left: 433,
          width: 214,
          textAlign: "center",
          background: C.paper,
          color: C.sage,
          fontSize: 22,
        }}
      >
        Read ↔ Write
      </div>
      <div style={{ position: "absolute", top: 207, left: 260, right: 260 }}>
        <Appear at={90}>
          <div
            style={{
              background: C.ink,
              color: C.paper,
              borderRadius: 19,
              padding: "22px 30px",
              display: "flex",
              alignItems: "center",
              gap: 20,
            }}
          >
            <Z size={58} />
            <div>
              <div style={{ fontSize: 36, fontWeight: 600 }}>Your library</div>
              <div style={{ fontSize: 19, color: C.lime, marginTop: 7 }}>
                Thoughts · Learnings · Facts
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: 21,
              color: C.sage,
              textAlign: "center",
              marginTop: 22,
            }}
          >
            Your Markdown files. Under your control.
          </div>
        </Appear>
      </div>
    </div>
  );
}
function Capture() {
  const f = useCurrentFrame();
  const p = ramp(f, 70, 95);
  const quotes = [
    "“Here’s why I think I should buy this house.”",
    "“I can see myself living there for years.”",
    "“But I want to understand how rates and prices have moved over time.”",
  ];
  const q = f < 190 ? 0 : f < 285 ? 1 : 2;
  return (
    <div style={{ width: 920, margin: "auto" }}>
      <Shell label="Zenod">
        <MessageBubble
          variant="outgoing"
          maxWidth="100%"
          style={{
            opacity: p,
            translateY: (1 - p) * 12,
            scale: 0.98 + 0.02 * p,
          }}
          theme={{ primary: "#34523f", primaryForeground: C.paper }}
        >
          <div style={{ padding: "14px 20px", width: 700 }}>
            <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
              <span style={{ fontSize: 31 }}>▶</span>
              <div
                style={{
                  display: "flex",
                  gap: 5,
                  height: 62,
                  alignItems: "center",
                }}
              >
                {Array.from({ length: 60 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 5,
                      borderRadius: 4,
                      height: 12 + Math.abs(Math.sin(i * 1.71)) * 40,
                      background:
                        i < interpolate(f, [75, 390], [0, 60], clamp)
                          ? C.paper
                          : "#779280",
                    }}
                  />
                ))}
              </div>
            </div>
            <div
              style={{
                fontSize: 19,
                color: "#bdd1bd",
                marginTop: 10,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>24:18</span>
              <span>Yesterday · 18:42 ✓✓</span>
            </div>
          </div>
        </MessageBubble>
        <div
          style={{
            marginTop: 30,
            fontSize: 32,
            lineHeight: 1.4,
            minHeight: 92,
            color: C.paper,
          }}
        >
          {quotes[q]}
        </div>
        <div style={{ fontSize: 19, color: C.lime, marginTop: 14 }}>
          Original voice note preserved
        </div>
      </Shell>
    </div>
  );
}
function Digest() {
  return (
    <>
      <Flow active={1} />
      <div
        style={{
          width: 940,
          margin: "auto",
          background: C.ink,
          color: C.paper,
          borderRadius: 18,
          padding: "26px 34px",
        }}
      >
        <Appear at={85}>
          <div style={{ fontSize: 16, color: "#93a08b", marginBottom: 8 }}>
            PERSONAL WIKI / PROJECTS
          </div>
          <div style={{ fontSize: 37, fontWeight: 600 }}>Buying a house</div>
        </Appear>
        <Appear at={120}>
          <div style={{ fontSize: 27, lineHeight: 1.4, marginTop: 22 }}>
            A place to settle for years.
            <br />
            Open question: how have rates and prices moved?
          </div>
        </Appear>
        <Appear at={165}>
          <div style={{ fontSize: 22, color: C.lime, marginTop: 24 }}>
            Interest rates ↗ &nbsp; House prices ↗
          </div>
        </Appear>
        <Appear at={200}>
          <div
            style={{
              borderTop: "1px solid #ffffff22",
              paddingTop: 20,
              marginTop: 22,
            }}
          >
            <Source />
          </div>
        </Appear>
      </div>
    </>
  );
}
function Retrieve() {
  const f = useCurrentFrame();
  const prompt = "Please retrieve the tasks I laid out in yesterday’s keynote.";
  const count = Math.floor(
    interpolate(f, [85, 205], [0, prompt.length], clamp),
  );
  return (
    <>
      <Flow active={2} />
      <Shell label="Codex">
        <div style={{ fontSize: 30, lineHeight: 1.4, minHeight: 55 }}>
          {prompt.slice(0, count)}
          {f < 207 && <span style={{ color: C.lime }}>▎</span>}
        </div>
        <div style={{ height: 1, background: "#ffffff20", margin: "18px 0" }} />
        {f < 290 ? (
          <Appear at={225}>
            <div
              style={{
                fontSize: 23,
                color: C.lime,
                display: "flex",
                gap: 16,
                alignItems: "center",
              }}
            >
              Reading Zenod <TypingIndicator color={C.lime} />
            </div>
          </Appear>
        ) : (
          <Appear at={290}>
            <div style={{ fontSize: 23, color: C.lime }}>
              ↗ Yesterday’s keynote · Original recording
            </div>
            <div style={{ fontSize: 27, marginTop: 16, lineHeight: 1.35 }}>
              □ Check local house-price data
              <br />□ Compare mortgage scenarios
            </div>
            <div style={{ fontSize: 22, color: "#b7c2ae", marginTop: 21 }}>
              Found your tasks, with the context behind them.
            </div>
          </Appear>
        )}
      </Shell>
    </>
  );
}
function Write() {
  const f = useCurrentFrame();
  return (
    <Shell label="Codex">
      <div
        style={{
          fontSize: 17,
          color: C.lime,
          letterSpacing: 3,
          marginBottom: 24,
        }}
      >
        LATER · AFTER THE ANALYSIS
      </div>
      <div style={{ fontSize: 32 }}>
        “Save the findings, sources, and next steps to Zenod.”
      </div>
      <Appear at={160}>
        <div
          style={{
            padding: "23px 0",
            marginTop: 22,
            borderTop: "1px solid #ffffff22",
            display: "flex",
            gap: 20,
            alignItems: "center",
          }}
        >
          <Z size={48} />
          <div style={{ fontSize: 27 }}>
            ✓ Added to your house project
            <div style={{ fontSize: 21, color: C.lime, marginTop: 8 }}>
              Findings + sources + original context
            </div>
          </div>
        </div>
      </Appear>
      <div
        style={{
          fontSize: 24,
          color: "#bdc8b5",
          marginTop: 20,
          opacity: ramp(f, 210, 235),
        }}
      >
        <div>✓ 2 tasks added to state memory</div>
        <div style={{ fontSize: 19, color: C.lime, marginTop: 12 }}>
          □ Check local house-price data &nbsp; · &nbsp; □ Compare mortgage
          scenarios
        </div>
      </div>
    </Shell>
  );
}
function Finish() {
  const f = useCurrentFrame();
  const cta = ramp(f, 135, 165);
  return (
    <div
      style={{
        height: 530,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Z size={72} />
      <div
        style={{
          position: "relative",
          height: 210,
          width: 1150,
          marginTop: 24,
        }}
      >
        <div style={{ position: "absolute", inset: 0, opacity: 1 - cta }}>
          <div style={{ position: "relative", height: 95 }}>
            <SoftBlurIn
              text="Your agents change."
              fontSize={77}
              color={C.ink}
            />
          </div>
          <div style={{ position: "relative", height: 95 }}>
            <Sequence from={20} layout="none">
              <SoftBlurIn
                text="Your context stays."
                fontSize={77}
                color={C.sage}
              />
            </Sequence>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            opacity: cta,
          }}
        >
          <div
            style={{
              fontSize: 75,
              fontWeight: 650,
              letterSpacing: -3,
              color: C.sage,
            }}
          >
            Test Zenod free.
          </div>
          <div style={{ fontSize: 38, marginTop: 18, letterSpacing: -1 }}>
            Start curating your personal Alexandria.
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: 23,
          color: C.muted,
          textAlign: "center",
          lineHeight: 1.6,
          opacity: ramp(f, 178, 202),
        }}
      >
        Your ideas. Your sources. Your evolving wiki.
        <br />
        Obsidian-compatible. Inspired by Karpathy.
      </div>
      <div style={{ fontSize: 19, color: C.muted, marginTop: 30 }}>
        Codex · Claude Code · Cursor · Any MCP-compatible agent
      </div>
    </div>
  );
}
function Grow() {
  const f = useCurrentFrame();
  const step = f < 180 ? 0 : f < 285 ? 1 : 2;
  const question = "“Does this make sense for me?”";
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 21,
          color: C.muted,
          marginBottom: 30,
        }}
      >
        {["One thought", "Years of learning", "Decades of context"].map(
          (x, i) => (
            <span
              key={x}
              style={{
                color: step >= i ? C.sage : "#b7bdae",
                fontWeight: step === i ? 650 : 400,
              }}
            >
              {x}
            </span>
          ),
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "420px 70px 1fr",
          alignItems: "center",
          gap: 24,
        }}
      >
        <div
          style={{
            background: C.ink,
            color: C.paper,
            padding: 28,
            borderRadius: 20,
            minHeight: 250,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 30,
              fontWeight: 600,
            }}
          >
            <Z size={38} />
            Your memory
          </div>
          <div
            style={{ marginTop: 25, display: "grid", gap: 15, fontSize: 24 }}
          >
            <span>Why this house matters</span>
            <span style={{ opacity: ramp(f, 180, 205), color: C.lime }}>
              Your priorities + constraints
            </span>
            <span style={{ opacity: ramp(f, 285, 310), color: C.lime }}>
              Lessons + corrections + sources
            </span>
          </div>
        </div>
        <div style={{ fontSize: 52, color: C.sage }}>→</div>
        <div>
          <div style={{ fontSize: 20, color: C.muted, marginBottom: 17 }}>
            SAME QUESTION
          </div>
          <div style={{ fontSize: 29, marginBottom: 26 }}>{question}</div>
          <div style={{ fontSize: 27, lineHeight: 1.4, color: C.sage }}>
            {step === 0
              ? "An answer about buying a house."
              : step === 1
                ? "An answer grounded in your plans."
                : "An answer that understands what you mean."}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 26,
          display: "flex",
          gap: 18,
          justifyContent: "center",
          alignItems: "center",
          fontSize: 23,
          color: C.sage,
        }}
      >
        <span>↶</span>Curate context<span>→</span>Better understanding
        <span>→</span>Useful learning<span>↵</span>
      </div>
      <div
        style={{
          textAlign: "center",
          marginTop: 18,
          fontSize: 18,
          color: C.muted,
        }}
      >
        Keep what matters. Correct what changes.
      </div>
    </div>
  );
}
function MemoryHouse() {
  const f = useCurrentFrame();
  const fired = ramp(f, 292, 320);
  return (
    <div style={{ position: "relative", height: 440 }}>
      <svg
        viewBox="0 0 1080 440"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <path
          d="M150 165 L390 25 L630 165 L630 390 L150 390 Z"
          fill="#e6eadf"
          stroke="#64805d"
          strokeWidth="3"
        />
        <path d="M680 245 L885 245" stroke="#64805d" strokeWidth="2" />
        <path
          d="M691 239 L681 245 L691 251 M874 239 L884 245 L874 251"
          fill="none"
          stroke="#64805d"
          strokeWidth="2"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 180,
          top: 122,
          width: 420,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 36, fontWeight: 650 }}>Your library</div>
        <div style={{ fontSize: 22, color: C.sage, marginTop: 16 }}>
          Thoughts · Facts · Learnings
        </div>
        <div style={{ fontSize: 20, color: C.muted, marginTop: 12 }}>
          Your files. Your history. Every original.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 333,
          top: 282,
          width: 116,
          height: 108,
          border: `2px solid ${C.sage}`,
          borderRadius: "12px 12px 0 0",
          background: C.paper,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            opacity: 1 - fired,
            transform: `translateX(${-70 * fired}px)`,
          }}
        >
          <Z size={58} />
        </div>
        <span
          style={{
            position: "absolute",
            fontSize: 17,
            color: C.sage,
            opacity: fired,
          }}
        >
          Librarian 2
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 669,
          top: 203,
          width: 218,
          textAlign: "center",
          fontSize: 22,
          color: C.sage,
        }}
      >
        Read ↔ Write
      </div>
      <div style={{ position: "absolute", left: 897, top: 214, fontSize: 28 }}>
        Agents
      </div>
      <div
        style={{
          position: "absolute",
          left: 666,
          top: 292,
          width: 380,
          fontSize: 25,
          lineHeight: 1.4,
          color: C.sage,
        }}
      >
        {f < 285
          ? "Zenod tends the door. You control access."
          : "A better librarian? Your choice."}
      </div>
      <div
        style={{
          position: "absolute",
          top: 408,
          left: 150,
          fontSize: 20,
          color: C.muted,
        }}
      >
        Original voice notes · Documents · Sources — preserved.
      </div>
    </div>
  );
}

const content: Record<string, () => React.JSX.Element> = {
  grow: Grow,
  house: MemoryHouse,
  islands: Islands,
  repeat: Repeat,
  owned: Owned,
  capture: Capture,
  digest: Digest,
  retrieve: Retrieve,
  write: Write,
  finish: Finish,
};
function Scene({ scene }: { scene: (typeof scenes)[number] }) {
  const f = useCurrentFrame();
  const move = ramp(f, 48, 78);
  const Body = content[scene.key];
  const size = scene.title.length > 34 ? 64 : 76;
  return (
    <AbsoluteFill
      style={{
        background: C.paper,
        color: C.ink,
        fontFamily: "-apple-system,BlinkMacSystemFont,sans-serif",
        opacity: Math.min(
          ramp(f, 0, 12),
          1 - ramp(f, scene.frames - 12, scene.frames),
        ),
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 45,
          top: 28,
          display: "flex",
          gap: 12,
          alignItems: "center",
          fontSize: 22,
          fontWeight: 600,
        }}
      >
        <Z size={31} />
        zenod
      </div>
      <div
        style={{
          position: "absolute",
          right: 45,
          top: 38,
          fontSize: 13,
          color: C.muted,
          letterSpacing: 2,
        }}
      >
        YOUR PERSONAL CONTEXT
      </div>
      {scene.key !== "finish" && (
        <div
          style={{
            position: "absolute",
            left: 90,
            right: 90,
            top: interpolate(move, [0, 1], [282, 105]),
            fontSize: interpolate(move, [0, 1], [size, 43]),
            lineHeight: 1.13,
            fontWeight: 650,
            letterSpacing: interpolate(move, [0, 1], [-3, -1.5]),
            opacity: ramp(f, 8, 32),
          }}
        >
          {scene.title}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: scene.key === "finish" ? 95 : 195,
          left: 100,
          right: 100,
          opacity: scene.key === "finish" ? 1 : ramp(f, 68, 94),
        }}
      >
        <Body />
      </div>
      <Sequence from={scene.key === "capture" ? 82 : 18} premountFor={15}>
        <Audio src={staticFile(`story-v3/${scene.key}.m4a`)} />
      </Sequence>
      <div
        style={{
          position: "absolute",
          left: 45,
          bottom: 20,
          fontSize: 12,
          color: "#959d8c",
        }}
      >
        Illustrative journey
      </div>
      <div
        style={{
          position: "absolute",
          right: 45,
          bottom: 20,
          fontSize: 12,
          color: "#959d8c",
        }}
      >
        ZENOD / {String(scenes.indexOf(scene) + 1).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
}
export const STORY_FRAMES = scenes.reduce((sum, s) => sum + s.frames, 0);
export function ContextStory() {
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {scenes.map((s) => (
        <Sequence
          key={s.key}
          from={s.start}
          durationInFrames={s.frames}
          premountFor={30}
        >
          <Scene scene={s} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
