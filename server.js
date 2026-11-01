const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = __dirname;
const MAX_BODY_BYTES = 100_000;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 6_000;

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  const defaultEnvPath = path.join(ROOT, ".env.example");

  if (!fs.existsSync(envPath) && fs.existsSync(defaultEnvPath)) {
    fs.copyFileSync(defaultEnvPath, envPath);
  }

  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function setPageHeaders(response) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  fs.createReadStream(path.join(ROOT, "index.html")).pipe(response);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function validateMessages(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return "Add a message before sending.";
  }
  if (body.messages.length > MAX_MESSAGES) {
    return "This conversation is too long. Start a new chat and try again.";
  }
  if (
    body.messages.some(
      (message) =>
        !message ||
        !["user", "model"].includes(message.role) ||
        typeof message.text !== "string" ||
        message.text.trim().length === 0 ||
        message.text.length > MAX_MESSAGE_LENGTH,
    )
  ) {
    return "A message is invalid or too long.";
  }
  if (body.messages[body.messages.length - 1].role !== "user") {
    return "The latest message must be from you.";
  }
  return null;
}

async function handleChat(request, response) {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_gemini_api_key_here") {
    sendJson(response, 503, {
      error: "Gemini is not connected yet. Add your API key to the .env file and restart the app.",
    });
    return;
  }

  const body = await readJsonBody(request);
  const validationError = validateMessages(body);
  if (validationError) {
    sendJson(response, 400, { error: validationError });
    return;
  }

  const preferredModels = [
    process.env.GEMINI_MODEL || "gemini-3.5-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];
  const modelCandidates = [...new Set(preferredModels.filter(Boolean))];

  let upstream;
  let lastError;
  for (const model of modelCandidates) {
    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: body.messages.map((message) => ({
              role: message.role,
              parts: [{ text: message.text }],
            })),
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (error) {
      lastError = error;
      continue;
    }

    let result;
    try {
      result = await upstream.json();
    } catch {
      sendJson(response, 502, { error: "Gemini returned an unreadable response. Please try again." });
      return;
    }

    if (upstream.ok) {
      const reply = result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();
      if (!reply) {
        sendJson(response, 502, {
          error: "Gemini did not return a text reply. Please try asking another question.",
        });
        return;
      }

      sendJson(response, 200, { reply });
      return;
    }

    const message = result.error?.message || `Gemini returned HTTP ${upstream.status}.`;
    const isModelUnavailable = /not found|not available|not supported|UNAVAILABLE/i.test(message);
    lastError = new Error(message);
    if (!isModelUnavailable) {
      console.error("Gemini API error:", message);
      sendJson(response, upstream.status === 429 ? 429 : 502, { error: message });
      return;
    }

    console.warn(`Gemini model ${model} unavailable; trying the next fallback model.`);
  }

  const fallbackMessage = lastError?.message || "Gemini model fallback failed.";
  console.error("Gemini request failed:", fallbackMessage);
  sendJson(response, 502, {
    error: "All available Gemini models are currently unavailable. Please try again in a moment.",
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/api/status") {
    sendJson(response, 200, {
      configured: Boolean(
        process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY !== "your_gemini_api_key_here",
      ),
    });
    return;
  }

  if (request.method === "GET" && ["/", "/index.html"].includes(request.url)) {
    setPageHeaders(response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/chat") {
    if (!request.headers["content-type"]?.includes("application/json")) {
      sendJson(response, 415, { error: "Send requests as JSON." });
      return;
    }
    try {
      await handleChat(request, response);
    } catch (error) {
      if (error.statusCode) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      console.error("Chat request failed:", error);
      sendJson(response, 500, { error: "Something went wrong. Please try again." });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

const port = Number.parseInt(process.env.PORT || "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a number between 1 and 65535.");
}

const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Toshu is running at http://localhost:${port}`);
});
