import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";

const BG = "#07100d";
const PHONE = "#0b141a";
const HEADER = "#202c33";
const OUTGOING = "#005c4b";
const INCOMING = "#202c33";
const TEXT = "#f3f6f4";
const MUTED = "#9eaaa5";
const WHATSAPP = "#25d366";
const ZENOD = "#b8ff3d";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const Waveform = ({progress}: {progress: number}) => {
  const heights = [
    12, 20, 30, 18, 38, 26, 15, 34, 43, 22, 31, 17, 40, 28, 14, 36, 24,
    42, 19, 31, 14, 27, 39, 18, 32, 23, 41, 16,
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        height: 48,
        flex: 1,
      }}
    >
      {heights.map((height, index) => (
        <span
          key={`${height}-${index}`}
          style={{
            width: 3,
            height,
            borderRadius: 4,
            background:
              index / heights.length <= progress ? TEXT : "#82908b",
          }}
        />
      ))}
    </div>
  );
};

const Check = ({color = MUTED}: {color?: string}) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="m3.5 12.5 4 4L16 8"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="m10 15.5 1.5 1.5L20 8.5"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Mic = () => (
  <svg width="25" height="25" viewBox="0 0 24 24" fill="none">
    <rect x="9" y="3" width="6" height="11" rx="3" fill={TEXT} />
    <path
      d="M6.5 11.5c0 3 2.4 5.5 5.5 5.5s5.5-2.5 5.5-5.5M12 17v4"
      stroke={TEXT}
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const TypingDots = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{display: "flex", alignItems: "center", gap: 6, height: 24}}>
      {[0, 1, 2].map((index) => {
        const phase = (frame - index * 4) % 24;
        const y = phase < 12 ? -4 * Math.sin((phase / 12) * Math.PI) : 0;
        return (
          <span
            key={index}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: MUTED,
              translate: `0 ${y}px`,
            }}
          />
        );
      })}
    </div>
  );
};

export const WhatsAppReceipt = () => {
  const frame = useCurrentFrame();

  const phoneOpacity = interpolate(frame, [0, 20], [0, 1], clamp);
  const phoneScale = interpolate(frame, [0, 24], [0.97, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  const voiceOpacity = interpolate(frame, [22, 42], [0, 1], clamp);
  const voiceY = interpolate(frame, [22, 48], [22, 0], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const voiceProgress = interpolate(frame, [48, 102], [0, 0.72], clamp);

  const typingOpacity = interpolate(
    frame,
    [94, 108, 124, 136],
    [0, 1, 1, 0],
    clamp,
  );
  const receiptOpacity = interpolate(frame, [128, 150], [0, 1], clamp);
  const receiptY = interpolate(frame, [128, 156], [24, 0], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  const storedOpacity = interpolate(frame, [174, 198], [0, 1], clamp);
  const storedScale = interpolate(frame, [174, 204], [0.96, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        color: TEXT,
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      <div
        style={{
          width: 680,
          height: 620,
          borderRadius: 34,
          overflow: "hidden",
          background: PHONE,
          border: "1px solid #314039",
          boxShadow: "0 2px 18px rgba(0,0,0,.24)",
          opacity: phoneOpacity,
          scale: phoneScale,
          position: "relative",
        }}
      >
        <div
          style={{
            height: 92,
            background: HEADER,
            display: "flex",
            alignItems: "center",
            padding: "0 28px",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "#111917",
              border: `1px solid ${ZENOD}`,
              color: ZENOD,
              fontFamily: "Georgia, serif",
              fontSize: 27,
            }}
          >
            A
          </div>
          <div style={{display: "flex", flexDirection: "column", gap: 4}}>
            <span style={{fontSize: 22, fontWeight: 650}}>Zenod</span>
            <span style={{fontSize: 15, color: WHATSAPP}}>online</span>
          </div>
        </div>

        <div
          style={{
            height: 528,
            boxSizing: "border-box",
            padding: "42px 34px 32px",
            position: "relative",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              alignSelf: "flex-end",
              width: 455,
              borderRadius: "18px 4px 18px 18px",
              background: OUTGOING,
              padding: "18px 18px 12px",
              boxSizing: "border-box",
              opacity: voiceOpacity,
              translate: `0 ${voiceY}px`,
            }}
          >
            <div style={{display: "flex", alignItems: "center", gap: 14}}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(255,255,255,.14)",
                }}
              >
                <Mic />
              </div>
              <Waveform progress={voiceProgress} />
            </div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                color: "#c7d4cf",
                fontSize: 15,
              }}
            >
              <span>35:12</span>
              <span style={{display: "flex", alignItems: "center", gap: 5}}>
                10:42 <Check color="#53bdeb" />
              </span>
            </div>
          </div>

          <div
            style={{
              alignSelf: "flex-start",
              marginTop: 26,
              minWidth: 68,
              borderRadius: "4px 18px 18px 18px",
              background: INCOMING,
              padding: "16px 20px",
              opacity: typingOpacity,
            }}
          >
            <TypingDots />
          </div>

          <div
            style={{
              position: "absolute",
              left: 34,
              top: 210,
              width: 492,
              borderRadius: "4px 18px 18px 18px",
              background: INCOMING,
              padding: "22px 24px 18px",
              boxSizing: "border-box",
              opacity: receiptOpacity,
              translate: `0 ${receiptY}px`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 23,
                fontWeight: 650,
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  background: ZENOD,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m6 12 4 4 8-8"
                    stroke={PHONE}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              Saved to Zenod
            </div>
            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid #344249",
                display: "flex",
                flexDirection: "column",
                gap: 9,
                color: MUTED,
                fontSize: 17,
              }}
            >
              <span>Voice note · 35:12</span>
              <span style={{color: TEXT}}>Stored in your memory</span>
            </div>
            <div
              style={{
                marginTop: 14,
                textAlign: "right",
                color: MUTED,
                fontSize: 14,
              }}
            >
              10:43
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 24,
              display: "flex",
              justifyContent: "center",
              opacity: storedOpacity,
              scale: storedScale,
            }}
          >
            <div
              style={{
                borderRadius: 999,
                border: `1px solid ${ZENOD}`,
                color: ZENOD,
                background: "rgba(184,255,61,.05)",
                padding: "11px 18px",
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              Memory stored · ready for any agent
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
