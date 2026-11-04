// Product visuals for the Paper landing (ZAL-A6 iteration 2). Demo content only
// (Maya, Leo, the garden shed); everything else is copied from production:
// - WhatsApp replies: packages/server/src/phylaxPortedRuntime.ts (voice-note
//   acknowledgement) and terminalCaptureReceipt in phylaxChannels.ts (receipt).
// - Tool calls and outputs: search_memory, get_memory, store_memory and
//   get_task_result in packages/server/src/mcp.ts.
// - Console images: the real apps/web console rendered with demo API data.
import consoleOverview from "@/assets/paper/console-overview.webp";
import consoleOverviewPhone from "@/assets/paper/console-overview-phone.webp";
import consoleWhatsApp from "@/assets/paper/console-whatsapp.webp";
import consoleDrive from "@/assets/paper/console-drive.webp";

const TRANSCRIPT =
  "Just talked to Leo about the shed. He can come Saturday morning to help put up the frame, so I need to order the cedar boards before Friday.";
const EVIDENCE = "Log/2026-11-04.md#^e-4f2a9c";
const LEARNING =
  "When migrating the orders table, run it on a copy first: the live table locks for several minutes.";
const JOB = "7c1e0b52-4a9d-4f1e-9b3a-2d6c8e01f5a7";

const VOICE_ACK =
  "I received your voice note and queued it for transcription. Transcription is usually quick; Google Drive archiving and filing continue in the background. Send “cancel transcription” to cancel the latest pending voice note in this conversation.";
const VOICE_RECEIPT = [
  "Saved ✓",
  "Recap: Leo can help put up the garden shed frame on Saturday morning. Order the cedar boards before Friday.",
  "Google Drive audio: https://drive.google.com/file/d/1hQ7demo",
  "Transcription: completed.",
  `Transcript: ${TRANSCRIPT}`,
  "Filed: Projects/Garden shed.md, People/Leo.md",
  "",
  "reply to this message to discuss or act on it",
].join("\n");

const BARS = [4, 9, 14, 7, 11, 16, 6, 12, 15, 8, 5, 13, 10, 6, 14, 9, 4, 11, 7, 5];

export function WhatsAppVoiceShot() {
  return (
    <figure className="pp-shot">
      <div className="pp-phone">
        <div className="pp-phone-screen">
          <p className="pp-wa-head">
            <span className="pp-wa-avatar" aria-hidden="true">Z</span>
            Zenod
          </p>
          <div className="pp-wa">
            <div className="pp-wa-msg pp-wa-out">
              <span className="pp-wa-voice" aria-label="Voice note, 0:14">
                <span className="pp-wa-play" aria-hidden="true" />
                <span className="pp-wa-wave" aria-hidden="true">
                  {BARS.map((h, i) => (
                    <i key={i} style={{ height: `${h}px` }} />
                  ))}
                </span>
                <span className="pp-wa-len">0:14</span>
              </span>
              <span className="pp-wa-time">9:28</span>
            </div>
            <div className="pp-wa-msg">
              {VOICE_ACK}
              <span className="pp-wa-time">9:28</span>
            </div>
            <div className="pp-wa-msg">
              {VOICE_RECEIPT}
              <span className="pp-wa-time">9:29</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        A voice note on WhatsApp and Zenod’s two replies, word for word. Demo
        contact and content.
      </figcaption>
    </figure>
  );
}

type Line =
  | { kind: "ask"; text: string }
  | { kind: "tool"; name: string; args: string }
  | { kind: "out"; text: string }
  | { kind: "say"; text: string };

function Terminal({ title, lines, caption }: { title: string; lines: Line[]; caption: string }) {
  return (
    <figure className="pp-shot pp-term-fig">
      <div className="pp-term">
        <p className="pp-term-bar">{title}</p>
        <div className="pp-term-body">
          {lines.map((line, i) => {
            if (line.kind === "ask")
              return (
                <p key={i} className="pp-term-ask">
                  <span aria-hidden="true">&gt; </span>
                  {line.text}
                </p>
              );
            if (line.kind === "tool")
              return (
                <p key={i} className="pp-term-tool">
                  <span className="pp-term-dot" aria-hidden="true">●</span>
                  <b>zenod - {line.name}</b> (MCP)({line.args})
                </p>
              );
            if (line.kind === "out")
              return (
                <p key={i} className="pp-term-out">
                  <span aria-hidden="true">└ </span>
                  {line.text}
                </p>
              );
            return (
              <p key={i} className="pp-term-say">
                <span className="pp-term-dot pp-term-dot-ink" aria-hidden="true">●</span>
                {line.text}
              </p>
            );
          })}
        </div>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function RecallShot() {
  return (
    <Terminal
      title="Claude Code"
      caption="Claude Code finds this morning’s voice note in Zenod and reads its transcript. Demo content."
      lines={[
        { kind: "ask", text: "What did I say in this morning’s voice note about the shed?" },
        {
          kind: "tool",
          name: "search_memory",
          args: 'source: "whatsapp", contentType: "voice_note", order: "newest", limit: 1',
        },
        {
          kind: "out",
          text: `2026-11-04T09:28:00.000Z · whatsapp/voice_note · ${EVIDENCE}\n  Just talked to Leo about the shed. He can come Saturday morning…\n… +1 line`,
        },
        { kind: "tool", name: "get_memory", args: `path: "${EVIDENCE}"` },
        {
          kind: "out",
          text: `${EVIDENCE}\nsource: whatsapp\ncontentType: voice_note\ncapturedAt: 2026-11-04T09:28:00.000Z\n${TRANSCRIPT}`,
        },
        {
          kind: "say",
          text: "In your 9:28 voice note you said Leo can come Saturday morning to help put up the shed frame, and that you need to order the cedar boards before Friday.",
        },
      ]}
    />
  );
}

export function LearningShot() {
  return (
    <Terminal
      title="Claude Code"
      caption="A coding agent saves a new learning to Zenod, then reads back where it was filed. Demo content."
      lines={[
        { kind: "ask", text: "That was the cause. Save it to Zenod as a learning." },
        { kind: "tool", name: "store_memory", args: `content: "${LEARNING}"` },
        {
          kind: "out",
          text: `Queued job ${JOB} (status: queued). This runs in the background — poll get_task_result with this ticket_id until state is 'done'.`,
        },
        { kind: "tool", name: "get_task_result", args: `ticket_id: "${JOB}"` },
        {
          kind: "out",
          text: "Saved.\nevidence: Log/2026-11-04.md#^e-91b07d\npages: Learnings/Databases.md",
        },
        { kind: "say", text: "Saved. Zenod filed it on Learnings/Databases.md." },
      ]}
    />
  );
}

export function ConsoleShots() {
  return (
    <>
      <figure className="pp-shot pp-console">
        <picture>
          <source media="(max-width: 760px)" srcSet={consoleOverviewPhone} width={860} height={1322} />
          <img
            src={consoleOverview}
            width={1920}
            height={2142}
            loading="lazy"
            alt="The Zenod console overview: MCP, vault and channel cards, included usage at 18 percent, and recent saves from a WhatsApp voice note and an AI assistant"
          />
        </picture>
        <figcaption>Overview: what you saved lately, and how much of the month’s usage is left.</figcaption>
      </figure>
      <div className="pp-console-pair">
        <figure className="pp-shot">
          <img
            src={consoleWhatsApp}
            width={796}
            height={518}
            loading="lazy"
            alt="The WhatsApp channel card, connected for one verified sender, with Send test and Disconnect buttons"
          />
          <figcaption>WhatsApp, connected to your number.</figcaption>
        </figure>
        <figure className="pp-shot">
          <img
            src={consoleDrive}
            width={796}
            height={542}
            loading="lazy"
            alt="The Google Drive vault card, ready, describing Markdown files in a Zenod Vault folder you own with Git history"
          />
          <figcaption>Your library, in a Google Drive folder you own.</figcaption>
        </figure>
      </div>
      <p className="pp-fine">The real Zenod console, shown with demo data.</p>
    </>
  );
}
