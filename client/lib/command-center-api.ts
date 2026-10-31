const COMMAND_CENTER_UPSTREAM_HEADER = "x-command-password";

function getCommandCenterPassword() {
  const password = process.env.COMMAND_CENTER_PASSWORD?.trim();

  if (!password) {
    throw new Error("Command center password is not configured.");
  }

  return password;
}

function getCommandCenterServerUrl() {
  return (
    process.env.SOCKET_SERVER_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOCKET_URL?.trim() ||
    "http://localhost:4000"
  );
}

export async function fetchCommandCenterUpstream(pathname: string) {
  return fetch(`${getCommandCenterServerUrl()}/admin${pathname}`, {
    method: "GET",
    headers: {
      [COMMAND_CENTER_UPSTREAM_HEADER]: getCommandCenterPassword(),
      "ngrok-skip-browser-warning": "true",
    },
    cache: "no-store",
  });
}
