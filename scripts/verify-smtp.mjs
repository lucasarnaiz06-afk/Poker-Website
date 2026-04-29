import nextEnv from "@next/env";
import nodemailer from "nodemailer";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

function readOptionalPort(rawPort) {
  if (!rawPort) {
    return undefined;
  }

  const port = Number(rawPort);

  return Number.isInteger(port) && port > 0 ? port : undefined;
}

function createTransportConfig() {
  if (process.env.EMAIL_SERVER_HOST) {
    return {
      host: process.env.EMAIL_SERVER_HOST,
      port: readOptionalPort(process.env.EMAIL_SERVER_PORT),
      secure: process.env.EMAIL_SERVER_SECURE === "true",
      auth:
        process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD
          ? {
              user: process.env.EMAIL_SERVER_USER,
              pass: process.env.EMAIL_SERVER_PASSWORD,
            }
          : undefined,
    };
  }

  if (process.env.EMAIL_SERVER) {
    return process.env.EMAIL_SERVER;
  }

  throw new Error(
    "Missing EMAIL_SERVER or EMAIL_SERVER_HOST in the root .env file.",
  );
}

function summarizeError(error) {
  return {
    ok: false,
    code: error.code ?? null,
    command: error.command ?? null,
    responseCode: error.responseCode ?? null,
    response: error.response ?? null,
    message: error.message,
  };
}

const transport = nodemailer.createTransport(createTransportConfig());

try {
  await transport.verify();
  console.log(JSON.stringify({ ok: true }, null, 2));
} catch (error) {
  console.log(JSON.stringify(summarizeError(error), null, 2));
  process.exitCode = 1;
}
