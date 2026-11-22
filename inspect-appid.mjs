import WebSocket from "ws";

const response = await fetch("http://127.0.0.1:8080/json/list");
const targets = await response.json();
const target = targets.find(t => t.title === "Steam Big Picture Mode");

if (!target) {
    console.log("Steam Big Picture Mode target not found.");
    process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
});

const expression = `(() => {
    const menu = [...document.querySelectorAll('[role="menu"]')]
        .find(el => (el.innerText || "").includes("Properties"));

    if (!menu) return "Game context menu not found.";

    const key = Object.keys(menu).find(k => k.startsWith("__reactFiber$"));
    if (!key) return "React fiber not found.";

    let fiber = menu[key];
    const results = [];

    while (fiber) {
        const type = fiber.type;
        const props = fiber.memoizedProps || fiber.pendingProps || {};

        if (
            typeof type === "function" &&
            type.name === "Rt" &&
            props.overview?.appid
        ) {
            const owner = fiber._debugOwner;
            const source = Function.prototype.toString.call(type);

            results.push({
                componentName: type.name,
                componentType: typeof type,
                constructorName: type.constructor?.name,
                prototypeMethods: Object.getOwnPropertyNames(type.prototype || {}),
                owner: owner ? {
                    name: owner.type?.displayName || owner.type?.name || "",
                    type: typeof owner.type
                } : null,
                sourceLength: source.length,
                sourceStart: source.slice(0, 500),
                sourceEnd: source.slice(-1800),
                appid: props.overview.appid,
                additionalActionsType: typeof props.additionalActions,
                additionalActionsIsArray: Array.isArray(props.additionalActions)
            });
        }

        fiber = fiber.return;
    }

    return results.length ? results : "Rt component not found.";
})()`;

const result = await new Promise((resolve, reject) => {
    const handler = message => {
        const data = JSON.parse(message.toString());
        if (data.id !== 1) return;

        ws.off("message", handler);

        if (data.error) reject(data.error);
        else resolve(data.result.result.value);
    };

    ws.on("message", handler);

    ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
            expression,
            returnByValue: true
        }
    }));
});

console.log(JSON.stringify(result, null, 2));
ws.close();
