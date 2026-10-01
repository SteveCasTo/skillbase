import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("real Sileo preserves queued notices in one default viewport and host SSR stays empty", () => {
  // Run with a fresh real vendor store, isolated from notifications.test.ts's
  // mock.module. No browser, auth fixture or shared development data is needed.
  const result = spawnSync(
    process.execPath,
    [
      "--eval",
      `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { Toaster, sileo } from "sileo";
      import { SileoHost } from "./src/components/SileoHost.tsx";
      import { notifications, notificationPosition } from "./src/lib/notifications.ts";
      const render = (theme) => renderToStaticMarkup(createElement(Toaster, {
        position: notificationPosition, theme,
      }));
      // Demonstrate the vendor contract: no empty default viewport; one
      // viewport per position captured by live notices, not per host.
      const empty = render("light");
      sileo.success({ title: "Vendor early", id: "vendor-early" });
      sileo.success({ title: "Vendor later", id: "vendor-later", position: notificationPosition });
      const split = render("light");
      sileo.clear();
      const first = notifications.success({ title: "Queued success" });
      const second = notifications.loading({ title: "Queued loading" });
      const operation = Promise.resolve("value");
      const returned = notifications.promise(operation, {
        loading: { title: "Queued promise" },
        success: { title: "Settled promise" },
        error: { title: "Failed promise" },
      });
      const loading = render("dark");
      const host = renderToStaticMarkup(createElement(SileoHost));
      await returned;
      notifications.info({ title: "Later notice" });
      console.log(JSON.stringify({ empty, split, first, second, loading, host,
        identity: returned === operation,
        themes: ["light", "dark", "system"].map(render),
      }));
      `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout) as {
    empty: string;
    split: string;
    first: string;
    second: string;
    loading: string;
    host: string;
    identity: boolean;
    themes: string[];
  };
  expect(output.empty).toBe("");
  expect(output.split.match(/data-sileo-viewport=/g)).toHaveLength(2);
  expect(output.split).toContain('data-position="top-right"');
  expect(output.host).toBe("");
  expect(output.first).not.toBe(output.second);
  expect(output.identity).toBe(true);
  for (const markup of [output.loading, ...output.themes]) {
    expect(markup.match(/data-sileo-viewport=/g)).toHaveLength(1);
    expect(markup).toContain('data-position="bottom-right"');
    expect(markup).not.toContain('data-position="top-right"');
    expect(markup).toContain("Queued success");
    expect(markup).toContain("Queued loading");
  }
  expect(output.loading).toContain("Queued promise");
  for (const markup of output.themes) {
    expect(markup).toContain("Settled promise");
    expect(markup).toContain("Later notice");
    expect(markup.match(/data-sileo-toast=/g)).toHaveLength(4);
  }
});
