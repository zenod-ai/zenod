import * as React from "react";
import {
  ActivityIcon,
  CreditCardIcon,
  LogOutIcon,
  MessageCircleIcon,
  QrCodeIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import QRCode from "qrcode";

import {
  ChannelExperienceFrame,
  PHYLAX_CHANNEL_EXPERIENCE,
} from "@/components/channel-experience";
import {
  HostedUsageCard,
  type HostedCustomerUsage,
} from "@/components/hosted-usage-card";
import { PhylaxTenantSettings } from "@/components/phylax-tenant-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

type Me = { login: string; avatar_url: string };
type Account = {
  subscription_status: string | null;
  current_period_end: string | null;
  usage: HostedCustomerUsage;
};
type CustomerState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "customer"; me: Me; account: Account | null }
  | { kind: "error" };

async function responseJson<T>(path: string): Promise<{
  status: number;
  data: T | null;
}> {
  const response = await fetch(path);
  let data: T | null = null;
  try {
    data = (await response.json()) as T;
  } catch {
    // An empty response is represented by null.
  }
  return { status: response.status, data };
}

function GithubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="size-5"
    >
      <path d="M12 .3a12 12 0 0 0-3.79 23.38c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18.76.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.48 5.92.42.36.81 1.1.81 2.22v3.29c0 .31.21.69.83.57A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

export function PhylaxSignIn() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <section className="w-full max-w-sm border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center border border-border">
          <ShieldCheckIcon />
        </div>
        <h1 className="text-3xl font-semibold">Phylax</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your agents on WhatsApp and Telegram
        </p>
        <Button asChild size="lg" className="mt-6 w-full rounded-none">
          <a href="/auth/signin">
            <GithubMark />
            Sign in with GitHub
          </a>
        </Button>
      </section>
    </main>
  );
}

function PhylaxPlan() {
  return (
    <Card className="rounded-none">
      <CardHeader>
        <CardTitle>Choose your Phylax plan</CardTitle>
        <CardDescription>
          One standalone channel tenant, one downstream agent binding.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="rounded-none">
          <a href="/buy?tier=monthly">Continue to subscription</a>
        </Button>
      </CardContent>
    </Card>
  );
}

type CustomerTab = "connections" | "usage" | "account";

export function PhylaxCustomerShell({
  me,
  account,
}: {
  me: Me;
  account: Account | null;
}) {
  const [tab, setTab] = React.useState<CustomerTab>("connections");
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">
            Standalone
          </p>
          <h1 className="text-2xl font-semibold">Phylax</h1>
          <p className="truncate text-sm text-muted-foreground">@{me.login}</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void fetch("/auth/signout", { method: "POST" }).then(() =>
              window.location.assign("/"),
            );
          }}
        >
          <LogOutIcon /> Log out
        </Button>
      </header>
      <nav
        className="grid grid-cols-3 gap-1 border border-border p-1"
        aria-label="Phylax settings"
      >
        {(
          [
            ["connections", "Connections", MessageCircleIcon],
            ["usage", "Usage", ActivityIcon],
            ["account", "Account", CreditCardIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? "secondary" : "ghost"}
            className="min-w-0 px-2"
            onClick={() => setTab(id)}
          >
            <Icon className="hidden size-4 sm:block" />
            <span className="truncate">{label}</span>
          </Button>
        ))}
      </nav>
      {!account ? (
        <PhylaxPlan />
      ) : tab === "connections" ? (
        <ChannelExperienceFrame experience={PHYLAX_CHANNEL_EXPERIENCE}>
          <Alert>
            <ShieldCheckIcon />
            <AlertTitle>One destination only</AlertTitle>
            <AlertDescription>
              This tenant transports messages to the single compatible service
              configured below.
            </AlertDescription>
          </Alert>
          <PhylaxTenantSettings />
        </ChannelExperienceFrame>
      ) : tab === "usage" ? (
        <HostedUsageCard usage={account.usage} productName="Phylax" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="rounded-none">
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>
                Phylax owns this standalone plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="capitalize">
                {(account.subscription_status ?? "pending").replace("_", " ")}
              </p>
              {account.current_period_end ? (
                <p className="text-muted-foreground">
                  Current period ends{" "}
                  {new Date(account.current_period_end).toLocaleDateString()}.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card className="rounded-none">
            <CardHeader>
              <CardTitle>Service boundary</CardTitle>
              <CardDescription>
                Channel credentials and delivery state stay in this Phylax
                instance.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      )}
    </main>
  );
}

type WhatsAppAdminStatus = {
  state: string;
  linkedNumber: string | null;
  qr: string | null;
  lastActivity: number | null;
  lastError: string | null;
};
type TelegramAdminStatus = {
  state: string;
  botUsername: string | null;
  lastActivity: number | null;
  lastError: string | null;
};
type OperatorMetering = {
  tenants: Array<{
    tenantId: string;
    grantedUnits: number;
    adjustedUnits: number;
    expiredUnits: number;
    usedUnits: number;
  }>;
};

function OperatorQr({ value }: { value: string }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { margin: 1, width: 280 }).then((next) => {
      if (active) setSrc(next);
    });
    return () => {
      active = false;
    };
  }, [value]);
  return src ? (
    <img
      src={src}
      alt="WhatsApp pairing QR code"
      className="mx-auto size-64 max-w-full"
    />
  ) : (
    <Spinner />
  );
}

export function PhylaxOperatorShell() {
  const [whatsapp, setWhatsapp] = React.useState<WhatsAppAdminStatus | null>(
    null,
  );
  const [telegram, setTelegram] = React.useState<TelegramAdminStatus | null>(
    null,
  );
  const [metering, setMetering] = React.useState<OperatorMetering | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [wa, tg, meter] = await Promise.all([
        responseJson<WhatsAppAdminStatus>("/api/whatsapp/status"),
        responseJson<TelegramAdminStatus>("/api/telegram/status"),
        responseJson<OperatorMetering>("/api/phylax/admin/metering"),
      ]);
      if (
        wa.status !== 200 ||
        tg.status !== 200 ||
        meter.status !== 200 ||
        !wa.data ||
        !tg.data ||
        !meter.data
      ) {
        throw new Error("Owner channel status is unavailable");
      }
      setWhatsapp(wa.data);
      setTelegram(tg.data);
      setMetering(meter.data);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load owner status",
      );
    }
  }, []);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function pair() {
    setBusy(true);
    try {
      const response = await fetch("/api/whatsapp/pair", { method: "POST" });
      if (!response.ok) throw new Error("Could not start pairing");
      setWhatsapp((await response.json()) as WhatsAppAdminStatus);
    } catch (pairError) {
      setError(
        pairError instanceof Error
          ? pairError.message
          : "Could not start pairing",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8"
      data-owner-surface="true"
    >
      <header className="border-b border-border pb-4">
        <p className="text-sm font-medium text-muted-foreground">Owner only</p>
        <h1 className="text-2xl font-semibold">Phylax transport operations</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Shared session health, number pairing and service diagnostics. This
          surface is not part of any customer product shell.
        </p>
      </header>
      {error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Operator status unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-none">
          <CardHeader>
            <QrCodeIcon />
            <CardTitle>WhatsApp service number</CardTitle>
            <CardDescription>
              Shared transport custody for this instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Badge
              variant={
                whatsapp?.state === "connected" ? "secondary" : "outline"
              }
            >
              {whatsapp?.state ?? "Loading"}
            </Badge>
            <p>{whatsapp?.linkedNumber ?? "No linked number"}</p>
            {whatsapp?.qr ? <OperatorQr value={whatsapp.qr} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void pair()}>
                {busy ? <Spinner /> : <QrCodeIcon />}
                {whatsapp?.linkedNumber ? "Re-pair" : "Pair number"}
              </Button>
              <Button variant="outline" onClick={() => void load()}>
                <RefreshCwIcon /> Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-none">
          <CardHeader>
            <MessageCircleIcon />
            <CardTitle>Telegram transport</CardTitle>
            <CardDescription>
              Service bot health for this instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Badge
              variant={
                telegram?.state === "connected" ? "secondary" : "outline"
              }
            >
              {telegram?.state ?? "Loading"}
            </Badge>
            <p>
              {telegram?.botUsername
                ? `@${telegram.botUsername}`
                : "No service bot"}
            </p>
            {telegram?.lastError ? (
              <p className="text-destructive">{telegram.lastError}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-none">
        <CardHeader>
          <ActivityIcon />
          <CardTitle>Service metering</CardTitle>
          <CardDescription>
            Raw internal units remain visible only to the instance owner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {metering?.tenants.length ? (
            metering.tenants.map((tenant) => (
              <div
                key={tenant.tenantId}
                className="grid gap-2 border border-border p-3 sm:grid-cols-3"
              >
                <strong className="break-all">{tenant.tenantId}</strong>
                <span>
                  Granted {tenant.grantedUnits + tenant.adjustedUnits}
                </span>
                <span>Used {tenant.usedUnits}</span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">
              No metered tenant periods yet.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function CustomerApp() {
  const [state, setState] = React.useState<CustomerState>({ kind: "loading" });
  React.useEffect(() => {
    Promise.all([
      responseJson<Me>("/api/me"),
      responseJson<Account>("/api/console/account"),
    ])
      .then(([me, account]) => {
        if (me.status === 401) {
          setState({ kind: "anonymous" });
          return;
        }
        if (me.status !== 200 || !me.data) {
          setState({ kind: "error" });
          return;
        }
        setState({
          kind: "customer",
          me: me.data,
          account: account.status === 200 ? account.data : null,
        });
      })
      .catch(() => setState({ kind: "error" }));
  }, []);

  if (state.kind === "loading")
    return (
      <main className="flex min-h-svh items-center justify-center">
        <Spinner />
      </main>
    );
  if (state.kind === "anonymous") return <PhylaxSignIn />;
  if (state.kind === "error")
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p>Phylax is temporarily unavailable.</p>
      </main>
    );
  return <PhylaxCustomerShell me={state.me} account={state.account} />;
}

export function App() {
  return window.location.pathname === "/admin" ? (
    <PhylaxOperatorShell />
  ) : (
    <CustomerApp />
  );
}

export default App;
