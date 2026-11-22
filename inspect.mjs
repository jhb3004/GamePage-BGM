
import WebSocket from "ws";

async function inspectTarget(target) {
  if (!target.webSocketDebuggerUrl) {
    console.log("\nSkipping target without WebSocket:", target.title);
    return;
  }

  console.log("\n========================================");
  console.log("TARGET:", target.title);
  console.log("TYPE:", target.type);
  console.log("ID:", target.id);
  console.log("URL:", target.url);
  console.log("========================================");

  const ws = new WebSocket(target.webSocketDebuggerUrl);

  try {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    let nextId = 1;

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;

        const timeout = setTimeout(() => {
          ws.off("message", onMessage);
          reject(new Error("CDP timeout: " + method));
        }, 10000);

        function onMessage(data) {
          const message = JSON.parse(data.toString());

          if (message.id !== id) return;

          clearTimeout(timeout);
          ws.off("message", onMessage);

          if (message.error) {
            reject(new Error(JSON.stringify(message.error)));
          } else {
            resolve(message.result);
          }
        }

        ws.on("message", onMessage);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    const result = await send("Runtime.evaluate", {
      expression: `(() => {
        const root = document.querySelector("#root");

        return {
          href: location.href,
          title: document.title,
          readyState: document.readyState,

          bodyText: document.body?.innerText?.slice(0, 2000),

          bodyHTML: document.body?.innerHTML?.slice(0, 2500),

          rootExists: !!root,

          rootHTML: root?.innerHTML?.slice(0, 2500),

          bodyChildren: [...(document.body?.children || [])]
            .map(el => ({
              tag: el.tagName,
              id: el.id,
              className: String(el.className).slice(0, 150)
            }))
        };
      })()`,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      console.log("JavaScript evaluation failed:");
      console.log(result.exceptionDetails.text);
      return;
    }

    console.log("\nINSPECTION RESULTS:\n");

    console.log(
      JSON.stringify(result.result?.value, null, 2)
    );

  } catch (error) {
    console.log("Could not inspect target:", error.message);
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

async function main() {
  console.log("Retrieving Steam renderer targets...\n");

  const response = await fetch(
    "http://127.0.0.1:8080/json/list"
  );

  if (!response.ok) {
    throw new Error(
      "Steam debugging endpoint returned: " + response.status
    );
  }

  const targets = await response.json();

  console.log("Found", targets.length, "targets.");

  for (const target of targets) {
    await inspectTarget(target);
  }

  console.log("\nFinished inspecting all targets.");
}

main().catch(console.error);
