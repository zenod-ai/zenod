import {TransitionSeries, linearTiming} from "@remotion/transitions";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import {AiPromptFlow} from "@/components/remocn/ai-prompt-flow";
import {ChatFlow} from "@/components/remocn/chat-flow";
import {SoftBlurIn} from "@/components/remocn/soft-blur-in";
import {zoomBlur} from "@/components/remocn/zoom-blur";
import type {RemocnTheme} from "@/lib/remocn-ui";

const BG = "#090b0b";
const PANEL = "#101313";
const PANEL_2 = "#171a1a";
const TEXT = "#f4f5f2";
const MUTED = "#8d9693";
const LINE = "#29302e";
const ACCENT = "#b8ff3d";

const theme: Partial<RemocnTheme> = {
  background: BG,
  foreground: TEXT,
  card: PANEL,
  cardForeground: TEXT,
  popover: PANEL_2,
  popoverForeground: TEXT,
  primary: ACCENT,
  primaryForeground: BG,
  secondary: PANEL_2,
  secondaryForeground: TEXT,
  muted: PANEL_2,
  mutedForeground: MUTED,
  accent: ACCENT,
  accentForeground: BG,
  border: LINE,
  input: LINE,
  ring: ACCENT,
  radius: 14,
};

const Shell: React.FC<React.PropsWithChildren<{label?: string}>> = ({
  children,
  label,
}) => (
  <AbsoluteFill
    style={{
      background: BG,
      color: TEXT,
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)",
        backgroundSize: "72px 72px",
      }}
    />
    <div
      style={{
        position: "absolute",
        top: 34,
        left: 48,
        display: "flex",
        alignItems: "center",
        gap: 11,
        fontSize: 19,
        fontWeight: 700,
      }}
    >
      <span>ZENOD</span>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: ACCENT,
        }}
      />
    </div>
    {label ? (
      <div
        style={{
          position: "absolute",
          top: 37,
          right: 48,
          color: MUTED,
          fontSize: 16,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    ) : null}
    {children}
  </AbsoluteFill>
);

const Intro = () => {
  const frame = useCurrentFrame();
  const subOpacity = interpolate(frame, [26, 48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const subY = interpolate(frame, [26, 48], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <Shell>
      <SoftBlurIn
        text="Your context should outlive every agent."
        color={TEXT}
        fontSize={68}
        fontWeight={600}
        blur={10}
        speed={1.5}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 448,
          textAlign: "center",
          color: MUTED,
          fontSize: 25,
          opacity: subOpacity,
          translate: `0 ${subY}px`,
        }}
      >
        Capture it once. Use it everywhere.
      </div>
    </Shell>
  );
};

const Capture = () => {
  const frame = useCurrentFrame();
  const copyOpacity = interpolate(frame, [10, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const copyX = interpolate(frame, [10, 38], [-24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <Shell label="Capture">
      <div
        style={{
          position: "absolute",
          inset: "96px 92px 62px",
          display: "grid",
          gridTemplateColumns: "0.9fr 1.1fr",
          gap: 62,
          alignItems: "center",
        }}
      >
        <div
          style={{
            opacity: copyOpacity,
            translate: `${copyX}px 0`,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div style={{fontSize: 64, lineHeight: 1.02, fontWeight: 600}}>
            Say what
            <br />
            matters.
          </div>
          <div style={{fontSize: 25, lineHeight: 1.45, color: MUTED}}>
            A long voice note becomes durable context—not another forgotten
            message.
          </div>
        </div>

        <div
          style={{
            height: 542,
            borderRadius: 30,
            background: PANEL,
            border: `1px solid ${LINE}`,
            overflow: "hidden",
          }}
        >
          <ChatFlow
            speed={1.8}
            accentColor={ACCENT}
            theme={theme}
            contact={{name: "Zenod librarian"}}
            messages={[
              {from: "me", text: "Voice note · 35:12"},
              {
                from: "them",
                text: "Captured. I found 8 decisions and 4 open questions.",
                reaction: "✓",
              },
            ]}
          />
        </div>
      </div>
    </Shell>
  );
};

const Memory = () => {
  const frame = useCurrentFrame();
  const items = [
    ["Decision", "Agent memory must stay portable"],
    ["Project", "Zenod landing page"],
    ["Open question", "How should retrieval feel?"],
    ["Source", "Voice note · Tuesday"],
  ] as const;

  const sealScale = interpolate(frame, [0, 28], [0.82, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const sealOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Shell label="Organize">
      <div
        style={{
          position: "absolute",
          inset: "106px 92px 62px",
          display: "grid",
          gridTemplateColumns: "420px 1fr",
          gap: 74,
          alignItems: "center",
        }}
      >
        <div
          style={{
            height: 390,
            borderRadius: 28,
            border: `1px solid ${LINE}`,
            background: PANEL,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            opacity: sealOpacity,
            scale: sealScale,
          }}
        >
          <div
            style={{
              width: 150,
              height: 150,
              borderRadius: "50%",
              border: `1px solid ${ACCENT}`,
              display: "grid",
              placeItems: "center",
              color: ACCENT,
              fontFamily: "Georgia, serif",
              fontSize: 72,
            }}
          >
            A
          </div>
          <div style={{fontSize: 27, fontWeight: 600}}>The librarian</div>
          <div style={{fontSize: 18, color: MUTED}}>Maintains the index</div>
        </div>

        <div style={{display: "flex", flexDirection: "column", gap: 14}}>
          {items.map(([label, value], index) => {
            const start = 18 + index * 12;
            const opacity = interpolate(frame, [start, start + 18], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const y = interpolate(frame, [start, start + 22], [22, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            return (
              <div
                key={label}
                style={{
                  minHeight: 74,
                  padding: "18px 22px",
                  borderRadius: 16,
                  border: `1px solid ${LINE}`,
                  background: PANEL,
                  display: "grid",
                  gridTemplateColumns: "150px 1fr",
                  alignItems: "center",
                  gap: 20,
                  opacity,
                  translate: `0 ${y}px`,
                }}
              >
                <span style={{fontSize: 16, color: ACCENT}}>{label}</span>
                <span style={{fontSize: 21, color: TEXT}}>{value}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
};

const Recall = () => (
  <Shell label="Retrieve">
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 82,
        textAlign: "center",
        fontSize: 24,
        color: MUTED,
      }}
    >
      Any agent can pick up where you left off.
    </div>
    <AiPromptFlow
      prompt="Use Tuesday's voice note to create the launch backlog"
      buttonLabel="Retrieve memory"
      answerLines={[
        "Found the voice note and its 8 decisions.",
        "Created a prioritized launch backlog with owners.",
        "Linked every item back to the original memory.",
      ]}
      toastTitle="Memory connected"
      theme={theme}
    />
  </Shell>
);

const Outro = () => {
  const frame = useCurrentFrame();
  const lineWidth = interpolate(frame, [20, 54], [0, 264], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const footOpacity = interpolate(frame, [44, 66], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Shell>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 26,
        }}
      >
        <div style={{fontSize: 88, fontWeight: 650}}>Own your agent's memory.</div>
        <div style={{width: lineWidth, height: 4, background: ACCENT}} />
        <div style={{fontSize: 25, color: MUTED, opacity: footOpacity}}>
          Portable. Connected. Maintained.
        </div>
      </div>
    </Shell>
  );
};

export const ZenodDemo = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={75}>
      <Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={zoomBlur({blur: 12, rise: 10})}
      timing={linearTiming({durationInFrames: 18})}
    />
    <TransitionSeries.Sequence durationInFrames={210}>
      <Capture />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={zoomBlur({blur: 12, rise: 10})}
      timing={linearTiming({durationInFrames: 18})}
    />
    <TransitionSeries.Sequence durationInFrames={150}>
      <Memory />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={zoomBlur({blur: 12, rise: 10})}
      timing={linearTiming({durationInFrames: 18})}
    />
    <TransitionSeries.Sequence durationInFrames={230}>
      <Recall />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={zoomBlur({blur: 12, rise: 10})}
      timing={linearTiming({durationInFrames: 18})}
    />
    <TransitionSeries.Sequence durationInFrames={90}>
      <Outro />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
