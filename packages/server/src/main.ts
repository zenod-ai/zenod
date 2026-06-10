import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8080);

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`zenod server listening on :${info.port}`);
});
