// Line diagrams for the Paper landing (ZAL-A6, direction A). Each diagram has a
// wide drawing for desktop and a tall one for phones; CSS shows one of them.

import type { ReactNode } from "react";

type Pt = readonly [number, number];

function Box({
  x,
  y,
  w,
  h,
  title,
  sub,
  focus,
  dash,
  ts = 24,
  ss = 18,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  sub?: string;
  focus?: boolean;
  dash?: boolean;
  ts?: number;
  ss?: number;
}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <>
      <rect
        className={"pp-d-box" + (focus ? " pp-d-focus" : "") + (dash ? " pp-d-dash" : "")}
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
      />
      {title ? (
        <text className="pp-d-t" x={cx} y={sub ? cy - 3 : cy + ts * 0.35} textAnchor="middle" fontSize={ts}>
          {title}
        </text>
      ) : null}
      {sub ? (
        <text className="pp-d-s" x={cx} y={cy + ss + 7} textAnchor="middle" fontSize={ss}>
          {sub}
        </text>
      ) : null}
    </>
  );
}

// A line through the points, with an arrowhead on the last segment.
function Arrow({ pts, dash, head = true }: { pts: readonly Pt[]; dash?: boolean; head?: boolean }) {
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
  const [x1, y1] = pts[pts.length - 2];
  const [x2, y2] = pts[pts.length - 1];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const a: Pt = [x2 - ux * 9 - uy * 6, y2 - uy * 9 + ux * 6];
  const b: Pt = [x2 - ux * 9 + uy * 6, y2 - uy * 9 - ux * 6];
  return (
    <>
      <path className={"pp-d-line" + (dash ? " pp-d-dash" : "")} d={d} />
      {head ? <path className="pp-d-line" d={`M${a[0]} ${a[1]}L${x2} ${y2}L${b[0]} ${b[1]}`} /> : null}
    </>
  );
}

function Label({ x, y, children, size = 18, anchor = "start" }: { x: number; y: number; children: string; size?: number; anchor?: "start" | "middle" }) {
  return (
    <text className="pp-d-s" x={x} y={y} textAnchor={anchor} fontSize={size}>
      {children}
    </text>
  );
}

function Figure({ label, wide, tall }: { label: string; wide: { w: number; h: number; body: ReactNode }; tall: { w: number; h: number; body: ReactNode } }) {
  return (
    <figure className="pp-diagram">
      <svg className="pp-d-wide" viewBox={`0 0 ${wide.w} ${wide.h}`} role="img" aria-label={label}>
        {wide.body}
      </svg>
      <svg className="pp-d-tall" viewBox={`0 0 ${tall.w} ${tall.h}`} role="img" aria-label={label}>
        {tall.body}
      </svg>
    </figure>
  );
}

export function WaysInDiagram() {
  return (
    <Figure
      label="Two ways in. WhatsApp on your phone takes voice notes, photos and documents. Code agents such as Claude Code, Cursor and ChatGPT connect over MCP. Both go to Zenod, which files everything in your library."
      wide={{
        w: 960,
        h: 250,
        body: (
          <>
            <Box x={10} y={20} w={260} h={90} title="WhatsApp" sub="voice notes, photos, files" />
            <Box x={10} y={140} w={260} h={90} title="Code agents" sub="Claude Code, Cursor and more" />
            <Arrow pts={[[274, 65], [320, 65], [320, 125], [376, 125]]} />
            <Arrow pts={[[274, 185], [320, 185], [320, 125]]} head={false} />
            <Box x={380} y={80} w={220} h={90} title="Zenod" sub="files it" focus />
            <Arrow pts={[[604, 125], [676, 125]]} />
            <Box x={680} y={80} w={270} h={90} title="Your library" sub="plain Markdown, yours" />
          </>
        ),
      }}
      tall={{
        w: 360,
        h: 360,
        body: (
          <>
            <Box x={10} y={0} w={165} h={84} title="WhatsApp" sub="voice notes" ts={21} ss={15} />
            <Box x={185} y={0} w={165} h={84} title="Code agents" sub="over MCP" ts={21} ss={15} />
            <Arrow pts={[[92, 88], [92, 112], [180, 112], [180, 140]]} />
            <Arrow pts={[[268, 88], [268, 112], [180, 112]]} head={false} />
            <Box x={30} y={144} w={300} h={80} title="Zenod" sub="files it" focus ts={22} ss={16} />
            <Arrow pts={[[180, 228], [180, 272]]} />
            <Box x={30} y={276} w={300} h={80} title="Your library" sub="plain Markdown, yours" ts={22} ss={16} />
          </>
        ),
      }}
    />
  );
}

export function LayersDiagram() {
  return (
    <Figure
      label="Three layers. Originals at the bottom: recordings, photos and documents, kept as they arrived. Pages in the middle: projects, people and preferences, each line linked back to its original. Answers on top, for you and your agents."
      wide={{
        w: 960,
        h: 330,
        body: (
          <>
            <Box x={10} y={10} w={940} h={74} title="Answers" sub="for you and the agents you connect" ts={26} ss={19} />
            <Box x={10} y={128} w={940} h={74} title="Pages" sub="projects, people, preferences, dates" focus ts={26} ss={19} />
            <Box x={10} y={246} w={940} h={74} title="Originals" sub="recordings, photos, documents, kept as they arrived" ts={26} ss={19} />
            <Arrow pts={[[200, 242], [200, 206]]} />
            <Arrow pts={[[200, 124], [200, 88]]} />
            <Label x={214} y={233} size={20}>digestion</Label>
            <Label x={214} y={115} size={20}>retrieval</Label>
            <Arrow pts={[[600, 206], [600, 242]]} dash />
            <Label x={614} y={233} size={20}>every line links back to its source</Label>
          </>
        ),
      }}
      tall={{
        w: 360,
        h: 324,
        body: (
          <>
            <Box x={0} y={0} w={360} h={76} title="Answers" sub="for you and your agents" ts={22} ss={16} />
            <Box x={0} y={124} w={360} h={76} title="Pages" sub="projects, people, preferences" focus ts={22} ss={16} />
            <Box x={0} y={248} w={360} h={76} title="Originals" sub="recordings, photos, documents" ts={22} ss={16} />
            <Arrow pts={[[48, 244], [48, 204]]} />
            <Arrow pts={[[48, 120], [48, 80]]} />
            <Label x={62} y={230} size={16}>digestion</Label>
            <Label x={62} y={106} size={16}>retrieval</Label>
            <Arrow pts={[[220, 204], [220, 244]]} dash />
            <Label x={234} y={230} size={16}>links back</Label>
          </>
        ),
      }}
    />
  );
}

export function CustodyDiagram() {
  return (
    <Figure
      label="Zenod, the librarian you hire, keeps your library in order. The library sits in your own GitHub repository or Google Drive. Another librarian or tool could take over later."
      wide={{
        w: 960,
        h: 300,
        body: (
          <>
            <Box x={10} y={50} w={230} h={90} title="Zenod" sub="the librarian you hire" focus ts={26} ss={19} />
            <Box x={10} y={170} w={230} h={90} title="Any other tool" sub="if you ever switch" dash ts={26} ss={19} />
            <Arrow pts={[[244, 95], [326, 95]]} />
            <Arrow pts={[[244, 215], [326, 215]]} dash />
            <rect className="pp-d-box pp-d-dash" x={330} y={20} width={620} height={260} rx={3} />
            <Label x={354} y={56} size={19}>Yours: your GitHub repository or Google Drive</Label>
            <Box x={360} y={85} w={560} h={160} title="Your library" sub="plain Markdown, originals included" ts={30} ss={20} />
          </>
        ),
      }}
      tall={{
        w: 360,
        h: 410,
        body: (
          <>
            <Box x={10} y={0} w={165} h={80} title="Zenod" sub="you hire it" focus ts={22} ss={15} />
            <Box x={185} y={0} w={165} h={80} title="Any other" sub="if you switch" dash ts={22} ss={15} />
            <Arrow pts={[[92, 84], [92, 140]]} />
            <Arrow pts={[[268, 84], [268, 140]]} dash />
            <rect className="pp-d-box pp-d-dash" x={10} y={144} width={340} height={250} rx={3} />
            <Label x={26} y={176} size={15.5}>Yours: GitHub repo or Google Drive</Label>
            <Box x={30} y={200} w={300} h={170} title="Your library" sub="Markdown, originals included" ts={28} ss={16} />
          </>
        ),
      }}
    />
  );
}
