import * as React from "react"
import { ArrowUpRightIcon, CheckIcon, CopyIcon } from "lucide-react"

import {
  CURSOR_CONFIG,
  CURSOR_INSTALL_URL,
  EXAMPLE_PROMPTS,
  GEMINI_COMMAND,
  ICON_URLS,
  MCP_SERVER_URL,
  MEMORY_TOOLS,
  SUPPORT_EMAIL,
  VSCODE_COMMAND,
  VSCODE_CONFIG,
} from "@/lib/connect"

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }
  return (
    <div className="zc-code">
      <div className="zc-code-bar">
        <span>{label}</span>
        <button type="button" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  )
}

function Client({
  id,
  name,
  children,
}: {
  id: string
  name: string
  children: React.ReactNode
}) {
  return (
    <article className="zc-client" id={id}>
      <h3>{name}</h3>
      {children}
    </article>
  )
}

export function ConnectPage({
  header,
  footer,
}: {
  header: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <div className="v5-site zc-page">
      {header}
      <main className="v5-wrap">
        <section className="zc-intro">
          <img
            className="zc-icon"
            src={ICON_URLS.svg}
            width={96}
            height={96}
            alt="Zenod icon"
          />
          <p className="v5-kicker">Connect Zenod over MCP</p>
          <h1>Your memory, inside the AI you already use.</h1>
          <p className="v5-lead">
            Send notes on WhatsApp; Zenod files them into a
            Markdown vault you own on GitHub or Google Drive and answers from it
            with sources. Add Zenod as a connector and Claude, ChatGPT, Cursor,
            VS Code or Gemini CLI can search your memory, open a note, store
            something new and ask questions that span many notes.
          </p>
          <div className="zc-server">
            <span className="v5-micro">SERVER URL</span>
            <code>{MCP_SERVER_URL}</code>
            <small>
              Streamable HTTP · sign in with OAuth (your Zenod account, Google
              sign-in at cloud.zenod.dev). No API key to paste.
            </small>
          </div>
        </section>

        <section className="zc-section" aria-labelledby="zc-clients">
          <p className="v5-kicker">Add it as a connector</p>
          <h2 id="zc-clients">Pick your client</h2>
          <nav className="zc-jump" aria-label="Clients">
            <a href="#claude">Claude</a>
            <a href="#chatgpt">ChatGPT</a>
            <a href="#cursor">Cursor</a>
            <a href="#vscode">VS Code</a>
            <a href="#gemini">Gemini CLI</a>
          </nav>
          <div className="zc-clients">
            <Client id="claude" name="Claude (web, desktop, Cowork)">
              <ol>
                <li>
                  Open <b>Customize → Connectors</b>, click <b>+ Add</b>, then{" "}
                  <b>Add custom connector</b>.
                </li>
                <li>
                  Name it <b>Zenod</b>, paste the server URL and click{" "}
                  <b>Continue</b>.
                </li>
                <li>
                  Under Authentication choose <b>Sign in now</b>, keep the
                  recommended OAuth client, then click <b>Add</b> and sign in to
                  Zenod.
                </li>
              </ol>
              <p className="zc-note">
                Works on every Claude plan (the Free plan allows one custom
                connector). On Team and Enterprise an owner adds it first under{" "}
                <b>Organization settings → Connectors → Add → Custom → Web</b>;
                each member then clicks <b>Connect</b>.
              </p>
            </Client>

            <Client id="chatgpt" name="ChatGPT">
              <ol>
                <li>
                  Open{" "}
                  <a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">
                    chatgpt.com/plugins
                  </a>
                  , select <b>+</b>, then <b>Add custom MCP server</b>.
                </li>
                <li>
                  Name it <b>Zenod</b>, choose <b>Public endpoint</b> and paste
                  the server URL.
                </li>
                <li>
                  Choose OAuth for authentication, confirm the warning, select{" "}
                  <b>Create as a plugin</b> and sign in to Zenod.
                </li>
              </ol>
              <p className="zc-note">
                Your ChatGPT plan and workspace policies decide whether custom
                MCP servers are allowed; on Business and Enterprise an admin may
                need to enable them.
              </p>
            </Client>

            <Client id="cursor" name="Cursor">
              <a className="v5-button v5-button-primary zc-install" href={CURSOR_INSTALL_URL}>
                Add to Cursor <ArrowUpRightIcon />
              </a>
              <p>
                The button opens Cursor and installs Zenod; Cursor then asks you
                to sign in. Or add it by hand to <code>~/.cursor/mcp.json</code>{" "}
                (all projects) or <code>.cursor/mcp.json</code> (one project):
              </p>
              <CopyBlock label="mcp.json" value={CURSOR_CONFIG} />
            </Client>

            <Client id="vscode" name="VS Code (GitHub Copilot)">
              <ol>
                <li>
                  Run <b>MCP: Add Server</b> from the Command Palette and choose{" "}
                  <b>HTTP</b>.
                </li>
                <li>
                  Paste the server URL, name it <b>zenod</b> and pick where to
                  save it. VS Code opens the Zenod sign-in when you first use it.
                </li>
              </ol>
              <p>Or from a terminal, or in <code>mcp.json</code>:</p>
              <CopyBlock label="terminal" value={VSCODE_COMMAND} />
              <CopyBlock label="mcp.json" value={VSCODE_CONFIG} />
            </Client>

            <Client id="gemini" name="Gemini CLI">
              <CopyBlock label="terminal" value={GEMINI_COMMAND} />
              <p>
                Then run <code>/mcp auth zenod</code> inside Gemini CLI to sign
                in. Sign-in opens a browser and returns to localhost, so run it
                on a machine with a browser, not over SSH.
              </p>
            </Client>
          </div>
        </section>

        <section className="zc-section" aria-labelledby="zc-tools">
          <p className="v5-kicker">What the connector can do</p>
          <h2 id="zc-tools">The tools</h2>
          <div className="zc-tools">
            {MEMORY_TOOLS.map((tool) => (
              <article key={tool.name}>
                <span className="v5-micro">{tool.access.toUpperCase()}</span>
                <h3>{tool.title}</h3>
                <code>{tool.name}</code>
                <p>{tool.does}</p>
              </article>
            ))}
          </div>
          <p className="zc-note">
            Nothing is deleted through the connector. Every write lands in your
            own vault with a receipt: the page it touched and the revision it
            saved.
          </p>
        </section>

        <section className="zc-section" aria-labelledby="zc-prompts">
          <p className="v5-kicker">Try it</p>
          <h2 id="zc-prompts">Things to ask</h2>
          <ul className="zc-prompts">
            {EXAMPLE_PROMPTS.map((example) => (
              <li key={example.prompt}>
                <q>{example.prompt}</q>
                <code>{example.tool}</code>
              </li>
            ))}
          </ul>
        </section>

        <section className="zc-section zc-help" aria-labelledby="zc-help">
          <p className="v5-kicker">Privacy and support</p>
          <h2 id="zc-help">Your data, your vault</h2>
          <p>
            Your memory is ordinary Markdown in your GitHub repository or Google
            Drive folder; you can read, edit or move it at any time. Read the{" "}
            <a href="/legal/privacy.html">privacy policy</a>,{" "}
            <a href="/legal/terms.html">terms</a> and{" "}
            <a href="/legal/data-handling.html">how we handle data</a>. Questions
            or a connection that will not work:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
          <p className="zc-note">
            Need a Zenod account first? <a href="/pricing">See the plans</a>.
            Zenod is open source (AGPL-3.0) on{" "}
            <a href="https://github.com/zenod-ai/zenod" target="_blank" rel="noreferrer">
              GitHub
            </a>
            . Brand icons: <a href={ICON_URLS.svg}>SVG</a> ·{" "}
            <a href={ICON_URLS.png512}>512 PNG</a> ·{" "}
            <a href={ICON_URLS.png1024}>1024 PNG</a>.
          </p>
        </section>
        {footer}
      </main>
    </div>
  )
}
