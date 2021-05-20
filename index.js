const loaderPath = require.resolve("@wppconnect-team/loader");
const path = require("path");
const playwright = require("playwright");
const util = require("util");

function inspect(msg) {
  return util.inspect(msg, {
    colors: true,
    compact: 10,
    depth: null,
    showHidden: false,
  });
}

async function init() {
  const browser = await playwright.chromium.launchPersistentContext(
    path.join(__dirname, "chrome_data"),
    {
      headless: false,
    }
  );

  let page = browser.pages()[0];

  if (!page) {
    page = await browser.newPage();
  }

  await page.exposeFunction("logConsole", (...args) => {
    console.log(...args);
  });

  await page.exposeFunction("logSend", (msg) => {
    let name = "sendJSON";

    const tag = msg.tag || "";
    let data = msg.data;

    if (msg.binaryOpts) {
      name = "sendBinary";
      if (msg.binaryOpts.debugObj) {
        data = msg.binaryOpts.debugObj;
      }
    }

    const query = {
      tag,
      data,
    };

    if (msg.binaryOpts) {
      const obj = Object.assign({}, msg.binaryOpts);

      delete obj.ackRequest;
      delete obj.debugObj;
      delete obj.debugString;

      Object.assign(query, obj);
    }

    console.log(`${name}: ${inspect(query)}`);
  });

  await page.exposeFunction("logMessage", (msg) => {
    delete msg.binarySize;
    console.log(`message: ${inspect(msg)}`);
  });

  page.on("load", async (page) => {
    await page.addScriptTag({ path: loaderPath });

    await page.evaluate(async () => {
      logConsole("initializing");

      logConsole("loading module loader...");
      const loader = new WPPConnectLoader.default();
      logConsole("module loader: ok");

      logConsole("loading websocket module...");
      const websocket = await loader
        .waitForModule((m) => m.default._send)
        .then((m) => m.default);
      logConsole("websocket module: ok");

      const original = {
        _basicSend: websocket._basicSend,
        _send: websocket._send,
        sendEphemeralIgnore: websocket.sendEphemeralIgnore,
      };

      for (const k of Object.keys(original)) {
        websocket[k] = (e, ...args) => {
          const ret = original[k].call(websocket, e, ...args);
          try {
            logSend(e);
          } catch (error) {}
          return ret;
        };
      }

      logConsole("loading SocketClass...");
      const SocketClass = await loader
        .waitForModule((m) => m.default.prototype._onParsedMsg)
        .then((m) => m.default);
      logConsole("SocketClass: ok");

      const _onParsedMsg = SocketClass.prototype._onParsedMsg;
      SocketClass.prototype._onParsedMsg = function (e, ...args) {
        const ret = _onParsedMsg.call(this, e, ...args);
        try {
          logMessage(e);
        } catch (error) {}
        return ret;
      };
    });
  });

  await page.goto("https://web.whatsapp.com/");
}

init();
